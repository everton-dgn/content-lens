import { describe, expect, it, vi } from 'vitest'

import { NativeFeedbackCoordinator } from '@/application/native-feedback/coordinator'
import { issueTrustedUserGesture } from '@/application/native-feedback/gesture'
import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'

const now = '2026-07-31T12:00:00.000Z'

describe('native feedback interruption', () => {
  it('records worker interruption as uncertain and never retries', async () => {
    let attempt: NativeFeedbackAttempt | undefined
    const activate = vi.fn(async () => {
      throw new Error('worker stopped')
    })
    const coordinator = new NativeFeedbackCoordinator({
      enabled: true,
      store: {
        get: async () => attempt,
        put: async value => {
          attempt = structuredClone(value)
        }
      },
      adapter: {
        capability: () => ({
          state: 'supported',
          platform: 'x',
          surface: 'x:for-you',
          actionType: 'x:not-interested-post',
          adapterVersion: 'x-test@1',
          addendumVersion: 'x-native-test@1',
          code: 'fixture-supported',
          actionLabelPatterns: ['Not interested'],
          targetIdentity: 'post ID',
          positiveEvidence: 'visible confirmation',
          timeoutMs: 1000,
          cooldownMs: 86_400_000,
          reversibility: { kind: 'irreversible' },
          selectors: ['[data-testid=tweet]'],
          fixtureVersion: 'fixture@1',
          lastLiveSmokeAt: now
        }),
        revalidate: async current => ({
          state: 'valid',
          platform: current.platform,
          surface: current.surface,
          platformContentId: current.platformContentId,
          pageInstanceId: current.pageInstanceId,
          actionType: current.actionType,
          actionLabel: current.review.actionLabel,
          targetFingerprint: current.targetFingerprint,
          visible: true,
          enabled: true,
          nodeConnected: true,
          elapsedMs: 5
        }),
        activate
      }
    })
    await coordinator.offer({
      localCommitState: 'committed',
      operationId: 'operation:1',
      attemptId: 'attempt:1',
      platform: 'x',
      surface: 'x:for-you',
      platformContentId: 'post:1',
      pageInstanceId: 'page:1',
      actionType: 'x:not-interested-post',
      actionLabel: 'Not interested',
      scope: 'this post',
      consequence: 'X may show fewer posts like this',
      targetFingerprint: 'target:1',
      now
    })
    const reviewFingerprint = await coordinator.reviewFingerprint('attempt:1')
    const gesture = issueTrustedUserGesture(
      { isTrusted: true, type: 'click' },
      {
        attemptId: 'attempt:1',
        reviewFingerprint: reviewFingerprint ?? '',
        occurredAt: now
      }
    )
    await coordinator.submit('attempt:1', gesture, now)
    await coordinator.submit('attempt:1', gesture, now)
    expect(attempt).toMatchObject({
      state: 'uncertain',
      terminalReason: 'activation-interrupted'
    })
    expect(activate).toHaveBeenCalledTimes(1)
  })
})
