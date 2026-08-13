import {
  fingerprintSyncEntity,
  sealSyncEnvelope,
  syncEntityId
} from '@/sync/canonical'
import type { SyncEntityType, SyncEnvelope, Tombstone } from '@/sync/contracts'

export const tombstoneKey = (
  tombstone: Pick<Tombstone, 'entityType' | 'entityId'>
) => `${tombstone.entityType}\u0000${tombstone.entityId}`

export async function deleteSyncEntity(input: {
  envelope: SyncEnvelope
  entityType: SyncEntityType
  entityId: string
  deletedAt: string
}) {
  const collection = input.envelope.profile[input.entityType]
  const index = collection.findIndex(
    entity =>
      syncEntityId(
        input.entityType,
        entity as unknown as Record<string, unknown>
      ) === input.entityId
  )
  if (index < 0) {
    return { state: 'missing' as const }
  }
  const entity = collection[index]
  const tombstone = {
    entityType: input.entityType,
    entityId: input.entityId,
    deletedInGeneration: input.envelope.generation,
    baseFingerprint: await fingerprintSyncEntity(entity),
    deletedAt: input.deletedAt
  } satisfies Tombstone
  const profile = structuredClone(input.envelope.profile)
  ;(profile[input.entityType] as unknown[]).splice(index, 1)
  const tombstones = input.envelope.tombstones.filter(
    existing => tombstoneKey(existing) !== tombstoneKey(tombstone)
  )
  tombstones.push(tombstone)
  const { digest: _digest, ...payload } = input.envelope
  return {
    state: 'deleted' as const,
    tombstone,
    envelope: await sealSyncEnvelope({ ...payload, profile, tombstones })
  }
}

export type KnownSyncDevice = {
  deviceId: string
  confirmedGeneration: number
  revoked: boolean
}

export type TombstoneCompactionBlock =
  | 'remote-unconfirmed'
  | 'recovery-snapshot-required'
  | 'conflict-present'
  | 'operation-pending'
  | 'device-behind'
  | 'selection-invalid'

export async function compactTombstones(input: {
  envelope: SyncEnvelope
  confirmedRemoteDigest: string
  recoverySnapshotDigest?: string
  selectedKeys: readonly string[]
  knownDevices: readonly KnownSyncDevice[]
  conflictCount: number
  pendingOperationCount: number
}) {
  if (input.confirmedRemoteDigest !== input.envelope.digest) {
    return { state: 'blocked' as const, code: 'remote-unconfirmed' as const }
  }
  if (!input.recoverySnapshotDigest) {
    return {
      state: 'blocked' as const,
      code: 'recovery-snapshot-required' as const
    }
  }
  if (input.conflictCount > 0) {
    return { state: 'blocked' as const, code: 'conflict-present' as const }
  }
  if (input.pendingOperationCount > 0) {
    return { state: 'blocked' as const, code: 'operation-pending' as const }
  }
  if (
    input.knownDevices.some(
      device =>
        !device.revoked &&
        device.confirmedGeneration < input.envelope.generation
    )
  ) {
    return { state: 'blocked' as const, code: 'device-behind' as const }
  }
  const availableKeys = new Set(input.envelope.tombstones.map(tombstoneKey))
  const selectedKeys = new Set(input.selectedKeys)
  if (
    selectedKeys.size === 0 ||
    selectedKeys.size !== input.selectedKeys.length ||
    [...selectedKeys].some(key => !availableKeys.has(key))
  ) {
    return { state: 'blocked' as const, code: 'selection-invalid' as const }
  }
  const { digest: _digest, ...payload } = input.envelope
  const envelope = await sealSyncEnvelope({
    ...payload,
    generation: input.envelope.generation + 1,
    tombstones: input.envelope.tombstones.filter(
      tombstone => !selectedKeys.has(tombstoneKey(tombstone))
    )
  })
  return {
    state: 'compacted' as const,
    removed: selectedKeys.size,
    previousGeneration: input.envelope.generation,
    envelope
  }
}

export function compareSyncGeneration(local: number, remote: number) {
  if (local === remote) {
    return 'compatible' as const
  }
  return local < remote
    ? ('generation-behind' as const)
    : ('remote-behind' as const)
}
