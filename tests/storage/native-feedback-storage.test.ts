import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const now = '2026-07-31T12:00:00.000Z'

function attempt(
  attemptId: string,
  state: NativeFeedbackAttempt['state'] = 'pending-review',
  updatedAt = now
): NativeFeedbackAttempt {
  return {
    attemptId,
    operationId: `operation:${attemptId}`,
    platform: 'reddit',
    surface: 'reddit:home',
    platformContentId: `post:${attemptId}`,
    pageInstanceId: 'page:1',
    actionType: 'reddit:show-less-similar',
    targetFingerprint: `target:${attemptId}`,
    adapterVersion: 'reddit-test@1',
    addendumVersion: 'reddit-native-test@1',
    state,
    review: {
      platform: 'reddit',
      surface: 'reddit:home',
      platformContentId: `post:${attemptId}`,
      pageInstanceId: 'page:1',
      actionType: 'reddit:show-less-similar',
      actionLabel: 'Show fewer posts like this',
      scope: 'this post',
      consequence: 'Reddit may show fewer similar posts',
      reversibility: { kind: 'irreversible' },
      targetFingerprint: `target:${attemptId}`,
      reviewedAt: updatedAt
    },
    createdAt: updatedAt,
    updatedAt
  }
}

describe('native feedback IndexedDB store', () => {
  it('round-trips attempts and cancels every pending review on disable', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'native-feedback-round-trip'
    })
    await database.putNativeFeedbackAttempt(attempt('attempt:1'))
    await database.putNativeFeedbackAttempt(attempt('attempt:2', 'submitted'))
    expect(await database.getNativeFeedbackAttempt('attempt:1')).toMatchObject({
      state: 'pending-review'
    })
    expect(await database.cancelPendingNativeFeedback(now)).toBe(1)
    expect(await database.getNativeFeedbackAttempt('attempt:1')).toMatchObject({
      state: 'cancelled',
      terminalReason: 'feature-disabled'
    })
    expect(await database.getNativeFeedbackAttempt('attempt:2')).toMatchObject({
      state: 'submitted'
    })
  })

  it('excludes expired pending and terminal records from retained reads', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'native-feedback-retention'
    })
    await database.putNativeFeedbackAttempt(
      attempt('pending-old', 'pending-review', '2026-07-01T12:00:00.000Z')
    )
    await database.putNativeFeedbackAttempt(
      attempt('terminal-old', 'uncertain', '2026-05-01T12:00:00.000Z')
    )
    await database.putNativeFeedbackAttempt(attempt('current'))
    await expect(database.listNativeFeedbackAttempts(now)).resolves.toEqual([
      expect.objectContaining({ attemptId: 'current' })
    ])
  })

  it('keeps attempts outside portable profile export', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'native-feedback-export-boundary'
    })
    await database.putNativeFeedbackAttempt(attempt('attempt:private'))
    expect(JSON.stringify(await database.exportProfile()) ?? '').not.toContain(
      'attempt:private'
    )
  })
})
