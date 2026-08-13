import { describe, expect, it } from 'vitest'

import {
  createNativeDomAdapter,
  supportedFixtureCapability
} from '@/application/native-feedback/dom-adapter'
import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'

import { effectiveBudgetMs } from './budget'

const at = '2026-07-31T12:00:00.000Z'

describe('native feedback revalidation performance', () => {
  it('keeps p95 under 100 ms and every fixture task under 50 ms', async () => {
    document.body.innerHTML = `
      <article data-content-id="video:1">
        <button type="button">Not interested</button>
      </article>
    `
    const target = document.querySelector('article')
    const control = document.querySelector('button')
    if (!target || !control)
      throw new Error('Native feedback fixture is missing')
    const attempt: NativeFeedbackAttempt = {
      attemptId: 'attempt:performance',
      operationId: 'operation:performance',
      platform: 'youtube',
      surface: 'youtube:home',
      platformContentId: 'video:1',
      pageInstanceId: 'page:1',
      actionType: 'youtube:not-interested',
      targetFingerprint: 'target:1',
      adapterVersion: 'youtube-performance@1',
      addendumVersion: 'youtube-native-performance@1',
      state: 'submitting',
      review: {
        platform: 'youtube',
        surface: 'youtube:home',
        platformContentId: 'video:1',
        pageInstanceId: 'page:1',
        actionType: 'youtube:not-interested',
        actionLabel: 'Not interested',
        scope: 'this video',
        consequence: 'fewer similar recommendations',
        reversibility: { kind: 'irreversible' },
        targetFingerprint: 'target:1',
        reviewedAt: at
      },
      createdAt: at,
      updatedAt: at
    }
    const capability = supportedFixtureCapability({
      platform: 'youtube',
      surface: 'youtube:home',
      actionType: 'youtube:not-interested',
      adapterVersion: attempt.adapterVersion,
      addendumVersion: attempt.addendumVersion,
      code: 'fixture-supported',
      actionLabelPatterns: ['Not interested'],
      targetIdentity: 'video ID',
      positiveEvidence: 'visible confirmation',
      timeoutMs: 1_000,
      cooldownMs: 86_400_000,
      reversibility: { kind: 'irreversible' },
      selectors: ['article', 'button'],
      fixtureVersion: 'performance-fixture@1',
      lastLiveSmokeAt: at
    })
    const adapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => ({
        target,
        control,
        platformContentId: 'video:1',
        pageInstanceId: 'page:1',
        surface: 'youtube:home',
        actionLabel: 'Not interested',
        targetFingerprint: 'target:1',
        verifyPositiveEvidence: async () => ({
          state: 'verified',
          method: 'fixture',
          at
        })
      })
    })
    const durations: number[] = []
    for (let index = 0; index < 1_000; index += 1) {
      const startedAt = performance.now()
      const result = await adapter.revalidate(attempt)
      durations.push(performance.now() - startedAt)
      expect(result.state).toBe('valid')
    }
    durations.sort((left, right) => left - right)
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Infinity
    expect(p95).toBeLessThanOrEqual(effectiveBudgetMs(100))
    expect(Math.max(...durations)).toBeLessThanOrEqual(effectiveBudgetMs(50))
  })
})
