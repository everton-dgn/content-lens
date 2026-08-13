import { sealSyncEnvelope, syncEntityId } from '@/sync/canonical'
import type { SyncEntityType, SyncEnvelope, Tombstone } from '@/sync/contracts'
import { deleteSyncEntity, tombstoneKey } from '@/sync/tombstones'

const entityTypes: readonly SyncEntityType[] = [
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
]

export async function reconcileLocalProjection(input: {
  previous?: SyncEnvelope
  projection: SyncEnvelope
  at: string
}) {
  if (!input.previous) {
    return input.projection
  }
  if (
    input.previous.syncProfileId !== input.projection.syncProfileId ||
    input.previous.generation !== input.projection.generation
  ) {
    throw new TypeError('Local sync projection requires rebase')
  }
  const tombstones = new Map(
    input.previous.tombstones.map(tombstone => [
      tombstoneKey(tombstone),
      tombstone
    ])
  )
  let candidate = input.projection
  for (const entityType of entityTypes) {
    const currentIds = new Set(
      candidate.profile[entityType].map(entity =>
        syncEntityId(entityType, entity as unknown as Record<string, unknown>)
      )
    )
    for (const entityId of currentIds) {
      if (tombstones.has(`${entityType}\u0000${entityId}`)) {
        throw new TypeError('Deleted sync entities require a new ID to restore')
      }
    }
    for (const previousEntity of input.previous.profile[entityType]) {
      const entityId = syncEntityId(
        entityType,
        previousEntity as unknown as Record<string, unknown>
      )
      if (currentIds.has(entityId)) {
        continue
      }
      const deleted = await deleteSyncEntity({
        envelope: candidate,
        entityType,
        entityId,
        deletedAt: input.at
      })
      if (deleted.state === 'deleted') {
        candidate = deleted.envelope
        tombstones.set(tombstoneKey(deleted.tombstone), deleted.tombstone)
      } else {
        const previousOnly = await sealSyncEnvelope({
          ...withoutDigest(candidate),
          profile: {
            ...candidate.profile,
            [entityType]: [...candidate.profile[entityType], previousEntity]
          },
          tombstones: [...tombstones.values()]
        })
        const removed = await deleteSyncEntity({
          envelope: previousOnly,
          entityType,
          entityId,
          deletedAt: input.at
        })
        if (removed.state !== 'deleted') {
          throw new TypeError('Unable to create a sync tombstone')
        }
        candidate = removed.envelope
        tombstones.set(tombstoneKey(removed.tombstone), removed.tombstone)
      }
    }
  }
  return sealSyncEnvelope({
    ...withoutDigest(candidate),
    tombstones: [...tombstones.values()] as Tombstone[]
  })
}

function withoutDigest(envelope: SyncEnvelope) {
  const { digest: _digest, ...payload } = envelope
  return payload
}
