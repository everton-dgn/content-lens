import { sealSyncEnvelope } from '@/sync/canonical'
import type {
  SyncEntityType,
  SyncEnvelope,
  SyncProfile,
  Tombstone
} from '@/sync/contracts'
import type {
  SyncConflictRecord,
  SyncConflictState,
  SyncMergeResult
} from '@/sync/three-way-merge'

export type SyncConflictResolution = {
  entityType: SyncEntityType
  entityId: string
  choice: 'local' | 'remote' | 'custom'
  customValue?: unknown
}

function conflictKey(entityType: SyncEntityType, entityId: string) {
  return `${entityType}\u0000${entityId}`
}

function selectedState(
  conflict: SyncConflictRecord,
  resolution: SyncConflictResolution
): SyncConflictState {
  if (resolution.choice === 'custom') {
    return { kind: 'value', value: resolution.customValue }
  }
  const selected =
    resolution.choice === 'local' ? conflict.local : conflict.remote
  if (
    selected !== null &&
    typeof selected === 'object' &&
    'kind' in selected &&
    ['absent', 'tombstone', 'value'].includes(String(selected.kind))
  ) {
    return selected as SyncConflictState
  }
  throw new TypeError('Envelope conflicts require an explicit rebase')
}

function append(
  profile: SyncProfile,
  tombstones: Tombstone[],
  entityType: SyncEntityType,
  state: SyncConflictState
) {
  if (state.kind === 'value') {
    ;(profile[entityType] as unknown[]).push(state.value)
  } else if (state.kind === 'tombstone') {
    tombstones.push(state.value)
  }
}

export async function resolveSyncConflicts(input: {
  local: SyncEnvelope
  merge: SyncMergeResult
  resolutions: readonly SyncConflictResolution[]
}) {
  const entityConflicts = input.merge.conflicts.filter(
    conflict =>
      conflict.entityType !== 'envelope' &&
      conflict.reason === 'concurrent-change'
  )
  if (entityConflicts.length !== input.merge.conflicts.length) {
    return { state: 'invalid' as const, code: 'rebase-required' as const }
  }
  const resolutions = new Map(
    input.resolutions.map(resolution => [
      conflictKey(resolution.entityType, resolution.entityId),
      resolution
    ])
  )
  if (
    resolutions.size !== input.resolutions.length ||
    resolutions.size !== entityConflicts.length
  ) {
    return {
      state: 'invalid' as const,
      code: 'incomplete-resolution' as const
    }
  }
  const profile = structuredClone(input.merge.draft.profile)
  const tombstones = structuredClone(input.merge.draft.tombstones)
  try {
    for (const conflict of entityConflicts) {
      const entityType = conflict.entityType as SyncEntityType
      const resolution = resolutions.get(
        conflictKey(entityType, conflict.entityId)
      )
      if (!resolution) {
        throw new TypeError('Missing conflict resolution')
      }
      append(
        profile,
        tombstones,
        entityType,
        selectedState(conflict, resolution)
      )
    }
    const { digest: _digest, ...payload } = input.local
    const candidate = await sealSyncEnvelope({
      ...payload,
      profile,
      tombstones
    })
    return { state: 'resolved' as const, candidate }
  } catch {
    return { state: 'invalid' as const, code: 'invalid-resolution' as const }
  }
}
