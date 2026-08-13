import { describe, expect, it } from 'vitest'

import {
  advanceSyncJournal,
  createSyncJournal,
  decideSyncRecovery,
  type SyncJournalPhase
} from '@/sync/journal'

const at = '2026-07-31T12:00:00.000Z'
const baseDigest = 'a'.repeat(64)
const candidateDigest = 'b'.repeat(64)

function journalAt(phase: SyncJournalPhase) {
  let journal = createSyncJournal({
    operationId: 'sync-operation:one',
    syncProfileId: 'sync:journal',
    baseDigest,
    at
  })
  const path: SyncJournalPhase[] = [
    'remote-read',
    'validated',
    'snapshot-created',
    'local-committed',
    'push-attempted',
    'remote-confirmed',
    'completed'
  ]
  for (const next of path) {
    if (journal.phase === phase) {
      break
    }
    journal = advanceSyncJournal(journal, {
      phase: next,
      attempt: next === 'remote-read' ? 1 : journal.attempt,
      at,
      ...(next === 'local-committed' || journal.candidateDigest
        ? { candidateDigest }
        : {}),
      ...(next === 'remote-read' ? { remoteVersionToken: '"v1"' } : {})
    })
  }
  return journal
}

describe('sync journal recovery', () => {
  it('rejects invalid phase transitions and backwards attempts', () => {
    const started = journalAt('started')
    expect(() =>
      advanceSyncJournal(started, {
        phase: 'local-committed',
        attempt: 1,
        at,
        candidateDigest
      })
    ).toThrow('Invalid sync journal transition')
    const remoteRead = journalAt('remote-read')
    expect(() =>
      advanceSyncJournal(remoteRead, {
        phase: 'validated',
        attempt: 0,
        at
      })
    ).toThrow('cannot move backwards')
  })

  it('chooses a safe restart action for every persisted phase', () => {
    const expected: Record<SyncJournalPhase, string> = {
      started: 'restart-from-base',
      'remote-read': 'restart-from-base',
      validated: 'restart-from-base',
      'snapshot-created': 'restart-from-base',
      'local-committed': 'confirm-remote',
      'push-attempted': 'confirm-remote',
      'remote-confirmed': 'complete',
      completed: 'complete',
      conflict: 'await-conflict',
      degraded: 'degraded'
    }
    for (const [phase, decision] of Object.entries(expected)) {
      const base = journalAt(
        phase === 'conflict' || phase === 'degraded'
          ? 'validated'
          : (phase as SyncJournalPhase)
      )
      const journal =
        phase === 'conflict' || phase === 'degraded'
          ? advanceSyncJournal(base, {
              phase,
              attempt: base.attempt,
              at
            })
          : base
      for (let restart = 0; restart < 100; restart += 1) {
        expect(
          decideSyncRecovery({ journal, remoteDigest: candidateDigest })
        ).toBe(decision)
      }
    }
  })

  it('distinguishes confirmed, unchanged, third-party and unavailable remote state', () => {
    const journal = journalAt('push-attempted')
    expect(decideSyncRecovery({ journal })).toBe('reread-remote')
    expect(decideSyncRecovery({ journal, remoteDigest: candidateDigest })).toBe(
      'confirm-remote'
    )
    expect(decideSyncRecovery({ journal, remoteDigest: baseDigest })).toBe(
      'retry-push'
    )
    expect(decideSyncRecovery({ journal, remoteDigest: 'c'.repeat(64) })).toBe(
      'remerge'
    )
  })
})
