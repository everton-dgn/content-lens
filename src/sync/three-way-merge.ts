import { sealSyncEnvelope, syncEntityId } from '@/sync/canonical'
import {
  emptySyncProfile,
  type SyncEntityType,
  type SyncEnvelope,
  type SyncProfile,
  type Tombstone
} from '@/sync/contracts'

const collectionOrder: readonly SyncEntityType[] = [
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
]

export type SyncConflictState =
  | { kind: 'absent' }
  | { kind: 'tombstone'; value: Tombstone }
  | { kind: 'value'; value: unknown }

export type SyncChangeRecord = {
  entityType: SyncEntityType
  entityId: string
  source: 'local' | 'remote'
}

export type SyncConflictRecord = {
  entityType: SyncEntityType | 'envelope'
  entityId: string
  base: SyncConflictState | string | number
  local: SyncConflictState | string | number
  remote: SyncConflictState | string | number
  reason: 'concurrent-change' | 'generation-mismatch' | 'profile-mismatch'
}

export type SyncMergeResult = {
  candidate: SyncEnvelope | null
  applied: SyncChangeRecord[]
  coalesced: SyncChangeRecord[]
  conflicts: SyncConflictRecord[]
  tombstones: Tombstone[]
  draft: { profile: SyncProfile; tombstones: Tombstone[] }
}

const stable = (value: unknown) =>
  JSON.stringify(value, (_key, entry) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))
      )
    }
    return entry
  })

const equalState = (left: SyncConflictState, right: SyncConflictState) => {
  if (left.kind === 'tombstone' && right.kind === 'tombstone') {
    return (
      left.value.deletedInGeneration === right.value.deletedInGeneration &&
      left.value.baseFingerprint === right.value.baseFingerprint
    )
  }
  return stable(left) === stable(right)
}

function states(envelope: SyncEnvelope, entityType: SyncEntityType) {
  const result = new Map<string, SyncConflictState>()
  for (const value of envelope.profile[entityType]) {
    const record = value as unknown as Record<string, unknown>
    result.set(syncEntityId(entityType, record), { kind: 'value', value })
  }
  for (const tombstone of envelope.tombstones) {
    if (tombstone.entityType === entityType) {
      result.set(tombstone.entityId, { kind: 'tombstone', value: tombstone })
    }
  }
  return result
}

function stateFor(
  map: Map<string, SyncConflictState>,
  id: string
): SyncConflictState {
  return map.get(id) ?? { kind: 'absent' }
}

function appendState(
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

export async function mergeSyncEnvelopes(input: {
  base: SyncEnvelope
  local: SyncEnvelope
  remote: SyncEnvelope
}): Promise<SyncMergeResult> {
  const { base, local, remote } = input
  const conflicts: SyncConflictRecord[] = []
  if (
    base.syncProfileId !== local.syncProfileId ||
    base.syncProfileId !== remote.syncProfileId
  ) {
    conflicts.push({
      entityType: 'envelope',
      entityId: base.syncProfileId,
      base: base.syncProfileId,
      local: local.syncProfileId,
      remote: remote.syncProfileId,
      reason: 'profile-mismatch'
    })
  }
  if (
    base.generation !== local.generation ||
    base.generation !== remote.generation
  ) {
    conflicts.push({
      entityType: 'envelope',
      entityId: String(base.generation),
      base: base.generation,
      local: local.generation,
      remote: remote.generation,
      reason: 'generation-mismatch'
    })
  }
  if (conflicts.length > 0) {
    return {
      candidate: null,
      applied: [],
      coalesced: [],
      conflicts,
      tombstones: [],
      draft: { profile: emptySyncProfile(), tombstones: [] }
    }
  }

  const profile = emptySyncProfile()
  const tombstones: Tombstone[] = []
  const applied: SyncChangeRecord[] = []
  const coalesced: SyncChangeRecord[] = []

  for (const entityType of collectionOrder) {
    const baseStates = states(base, entityType)
    const localStates = states(local, entityType)
    const remoteStates = states(remote, entityType)
    const ids = new Set([
      ...baseStates.keys(),
      ...localStates.keys(),
      ...remoteStates.keys()
    ])
    for (const entityId of [...ids].sort()) {
      const baseState = stateFor(baseStates, entityId)
      const localState = stateFor(localStates, entityId)
      const remoteState = stateFor(remoteStates, entityId)
      if (equalState(localState, remoteState)) {
        appendState(profile, tombstones, entityType, localState)
        if (!equalState(baseState, localState)) {
          coalesced.push({ entityType, entityId, source: 'local' })
        }
        continue
      }
      if (equalState(baseState, localState)) {
        appendState(profile, tombstones, entityType, remoteState)
        applied.push({ entityType, entityId, source: 'remote' })
        continue
      }
      if (equalState(baseState, remoteState)) {
        appendState(profile, tombstones, entityType, localState)
        applied.push({ entityType, entityId, source: 'local' })
        continue
      }
      conflicts.push({
        entityType,
        entityId,
        base: baseState,
        local: localState,
        remote: remoteState,
        reason: 'concurrent-change'
      })
    }
  }

  if (conflicts.length > 0) {
    return {
      candidate: null,
      applied,
      coalesced,
      conflicts,
      tombstones,
      draft: { profile, tombstones }
    }
  }
  const { digest: _digest, ...localPayload } = local
  const candidate = await sealSyncEnvelope({
    ...localPayload,
    profile,
    tombstones
  })
  return {
    candidate,
    applied,
    coalesced,
    conflicts,
    tombstones,
    draft: { profile, tombstones }
  }
}
