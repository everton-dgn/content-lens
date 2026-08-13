import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'

export const SYNC_JOURNAL_PHASES = [
  'started',
  'remote-read',
  'validated',
  'snapshot-created',
  'local-committed',
  'push-attempted',
  'remote-confirmed',
  'completed',
  'conflict',
  'degraded'
] as const

export const syncJournalPhaseSchema = z.enum(SYNC_JOURNAL_PHASES)

export const syncJournalRecordSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  operationId: nonEmptyStringSchema.max(256),
  syncProfileId: nonEmptyStringSchema.max(256),
  phase: syncJournalPhaseSchema,
  attempt: z.int().min(0).max(3),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  baseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  candidateDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  remoteVersionToken: nonEmptyStringSchema.max(1_024).optional(),
  errorCode: nonEmptyStringSchema.max(128).optional()
})

export type SyncJournalPhase = z.infer<typeof syncJournalPhaseSchema>
export type SyncJournalRecord = z.infer<typeof syncJournalRecordSchema>

const transitions: Record<SyncJournalPhase, readonly SyncJournalPhase[]> = {
  started: ['remote-read', 'degraded'],
  'remote-read': ['validated', 'degraded'],
  validated: ['snapshot-created', 'local-committed', 'conflict', 'degraded'],
  'snapshot-created': ['local-committed', 'degraded'],
  'local-committed': ['push-attempted', 'degraded'],
  'push-attempted': ['remote-confirmed', 'remote-read', 'conflict', 'degraded'],
  'remote-confirmed': ['completed', 'degraded'],
  completed: [],
  conflict: [],
  degraded: []
}

export function createSyncJournal(input: {
  operationId: string
  syncProfileId: string
  baseDigest: string
  at: string
}) {
  return syncJournalRecordSchema.parse({
    id: `sync-journal:${input.syncProfileId}`,
    operationId: input.operationId,
    syncProfileId: input.syncProfileId,
    phase: 'started',
    attempt: 0,
    startedAt: input.at,
    updatedAt: input.at,
    baseDigest: input.baseDigest
  })
}

export function advanceSyncJournal(
  currentInput: unknown,
  update: {
    phase: SyncJournalPhase
    attempt: number
    at: string
    candidateDigest?: string
    remoteVersionToken?: string
    errorCode?: string
  }
) {
  const current = syncJournalRecordSchema.parse(currentInput)
  if (!transitions[current.phase].includes(update.phase)) {
    throw new TypeError(
      `Invalid sync journal transition: ${current.phase} -> ${update.phase}`
    )
  }
  if (update.attempt < current.attempt) {
    throw new TypeError('Sync journal attempt cannot move backwards')
  }
  if (
    [
      'local-committed',
      'push-attempted',
      'remote-confirmed',
      'completed'
    ].includes(update.phase) &&
    !(update.candidateDigest ?? current.candidateDigest)
  ) {
    throw new TypeError('Committed journal phases require a candidate digest')
  }
  const { at, ...fields } = update
  return syncJournalRecordSchema.parse({
    ...current,
    ...fields,
    candidateDigest: update.candidateDigest ?? current.candidateDigest,
    remoteVersionToken: update.remoteVersionToken ?? current.remoteVersionToken,
    errorCode: update.errorCode,
    updatedAt: at
  })
}

export type SyncRecoveryDecision =
  | 'restart-from-base'
  | 'reread-remote'
  | 'confirm-remote'
  | 'retry-push'
  | 'remerge'
  | 'complete'
  | 'await-conflict'
  | 'degraded'

export function decideSyncRecovery(input: {
  journal: unknown
  remoteDigest?: string
}): SyncRecoveryDecision {
  const journal = syncJournalRecordSchema.parse(input.journal)
  if (
    ['started', 'remote-read', 'validated', 'snapshot-created'].includes(
      journal.phase
    )
  ) {
    return 'restart-from-base'
  }
  if (
    journal.phase === 'local-committed' ||
    journal.phase === 'push-attempted'
  ) {
    if (!input.remoteDigest) {
      return 'reread-remote'
    }
    if (input.remoteDigest === journal.candidateDigest) {
      return 'confirm-remote'
    }
    if (input.remoteDigest === journal.baseDigest) {
      return 'retry-push'
    }
    return 'remerge'
  }
  if (journal.phase === 'conflict') {
    return 'await-conflict'
  }
  if (journal.phase === 'degraded') {
    return 'degraded'
  }
  return 'complete'
}
