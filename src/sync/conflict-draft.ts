import { verifySyncEnvelope } from '@/sync/canonical'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import type { SyncEnvelope } from '@/sync/contracts'
import {
  mergeSyncEnvelopes,
  type SyncMergeResult
} from '@/sync/three-way-merge'

export type SyncConflictDraft = {
  id: string
  syncProfileId: string
  base: SyncEnvelope
  local: SyncEnvelope
  remote: SyncEnvelope
  remoteVersionToken: string
  merge: SyncMergeResult
  resolutions: SyncConflictResolution[]
  createdAt: string
  updatedAt: string
}

const key = (entityType: string, entityId: string) =>
  `${entityType}\u0000${entityId}`

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export async function createSyncConflictDraft(input: {
  base: SyncEnvelope
  local: SyncEnvelope
  remote: SyncEnvelope
  remoteVersionToken: string
  at: string
}): Promise<SyncConflictDraft> {
  const merge = await mergeSyncEnvelopes(input)
  if (merge.conflicts.length === 0) {
    throw new TypeError('A conflict draft requires at least one conflict')
  }
  return {
    id: `sync-conflict:${input.local.syncProfileId}`,
    syncProfileId: input.local.syncProfileId,
    base: structuredClone(input.base),
    local: structuredClone(input.local),
    remote: structuredClone(input.remote),
    remoteVersionToken: input.remoteVersionToken,
    merge,
    resolutions: [],
    createdAt: input.at,
    updatedAt: input.at
  } satisfies SyncConflictDraft
}

export async function validateSyncConflictDraft(
  input: unknown
): Promise<SyncConflictDraft | undefined> {
  if (input === null || typeof input !== 'object') {
    return undefined
  }
  const candidate = input as Partial<SyncConflictDraft>
  const [base, local, remote] = await Promise.all([
    verifySyncEnvelope(candidate.base),
    verifySyncEnvelope(candidate.local),
    verifySyncEnvelope(candidate.remote)
  ])
  if (
    !base.valid ||
    !local.valid ||
    !remote.valid ||
    typeof candidate.syncProfileId !== 'string' ||
    candidate.syncProfileId !== local.envelope.syncProfileId ||
    base.envelope.syncProfileId !== local.envelope.syncProfileId ||
    remote.envelope.syncProfileId !== local.envelope.syncProfileId ||
    candidate.id !== `sync-conflict:${candidate.syncProfileId}` ||
    typeof candidate.remoteVersionToken !== 'string' ||
    candidate.remoteVersionToken.length === 0 ||
    candidate.remoteVersionToken.length > 1_024 ||
    /[\r\n]/.test(candidate.remoteVersionToken) ||
    !validTimestamp(candidate.createdAt) ||
    !validTimestamp(candidate.updatedAt)
  ) {
    return undefined
  }
  const merge = await mergeSyncEnvelopes({
    base: base.envelope,
    local: local.envelope,
    remote: remote.envelope
  })
  if (merge.conflicts.length === 0 || !Array.isArray(candidate.resolutions)) {
    return undefined
  }
  const conflictKeys = new Set(
    merge.conflicts
      .filter(conflict => conflict.entityType !== 'envelope')
      .map(conflict => key(conflict.entityType, conflict.entityId))
  )
  const resolutions = candidate.resolutions.filter(
    (resolution): resolution is SyncConflictResolution =>
      resolution !== null &&
      typeof resolution === 'object' &&
      typeof resolution.entityType === 'string' &&
      typeof resolution.entityId === 'string' &&
      ['local', 'remote', 'custom'].includes(resolution.choice) &&
      conflictKeys.has(key(resolution.entityType, resolution.entityId))
  )
  if (
    resolutions.length !== candidate.resolutions.length ||
    new Set(
      resolutions.map(resolution =>
        key(resolution.entityType, resolution.entityId)
      )
    ).size !== resolutions.length
  ) {
    return undefined
  }
  return {
    id: candidate.id,
    syncProfileId: candidate.syncProfileId,
    base: base.envelope,
    local: local.envelope,
    remote: remote.envelope,
    remoteVersionToken: candidate.remoteVersionToken,
    merge,
    resolutions: structuredClone(resolutions),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  }
}
