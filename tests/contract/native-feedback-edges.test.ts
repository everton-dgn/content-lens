import { describe, expect, it, vi } from 'vitest'

import {
  type NativeFeedbackAdapterPort,
  type NativeFeedbackAttemptStore,
  NativeFeedbackCoordinator
} from '@/application/native-feedback/coordinator'
import { issueTrustedUserGesture } from '@/application/native-feedback/gesture'
import type {
  NativeFeedbackAttempt,
  NativeFeedbackCapability
} from '@/core/feedback/native-contracts'

const now = '2026-07-31T12:00:00.000Z'

const capability: NativeFeedbackCapability = {
  state: 'supported',
  platform: 'youtube',
  surface: 'youtube:home',
  actionType: 'youtube:not-interested',
  adapterVersion: 'youtube-test@1',
  addendumVersion: 'youtube-native-test@1',
  code: 'fixture-supported',
  actionLabelPatterns: ['Not interested'],
  targetIdentity: 'video ID',
  positiveEvidence: 'visible confirmation',
  timeoutMs: 2_000,
  cooldownMs: 86_400_000,
  reversibility: { kind: 'irreversible' },
  selectors: ['[data-video-id]', '[role=menuitem]'],
  fixtureVersion: 'fixture@1',
  lastLiveSmokeAt: '2026-07-30T12:00:00.000Z'
}

class MemoryStore implements NativeFeedbackAttemptStore {
  records = new Map<string, NativeFeedbackAttempt>()
  async get(attemptId: string) {
    return this.records.get(attemptId)
  }
  async put(attempt: NativeFeedbackAttempt) {
    this.records.set(attempt.attemptId, structuredClone(attempt))
  }
  async list() {
    return [...this.records.values()]
  }
}

const offerInput = (attemptId = 'attempt:1') => ({
  localCommitState: 'committed' as const,
  operationId: 'operation:feedback:1',
  attemptId,
  platform: 'youtube' as const,
  surface: 'youtube:home',
  platformContentId: 'video:1',
  pageInstanceId: 'page:1',
  actionType: 'youtube:not-interested' as const,
  actionLabel: 'Not interested',
  scope: 'this video recommendation',
  consequence: 'YouTube may recommend fewer items like this',
  targetFingerprint: 'sha256:target-1',
  now
})

const validRevalidation = (attempt: NativeFeedbackAttempt, elapsedMs = 12) => ({
  state: 'valid' as const,
  platform: attempt.platform,
  surface: attempt.surface,
  platformContentId: attempt.platformContentId,
  pageInstanceId: attempt.pageInstanceId,
  actionType: attempt.actionType,
  actionLabel: attempt.review.actionLabel,
  targetFingerprint: attempt.targetFingerprint,
  visible: true as const,
  enabled: true as const,
  nodeConnected: true as const,
  elapsedMs
})

function adapter(overrides: Partial<NativeFeedbackAdapterPort> = {}) {
  return {
    capability: vi.fn(() => capability),
    revalidate: vi.fn(async (attempt: NativeFeedbackAttempt) =>
      validRevalidation(attempt)
    ),
    activate: vi.fn(async () => ({
      state: 'verified' as const,
      verificationMethod: 'visible-target-confirmation',
      evidenceAt: now
    })),
    ...overrides
  } satisfies NativeFeedbackAdapterPort
}

async function trustedGesture(
  coordinator: NativeFeedbackCoordinator,
  attemptId: string
) {
  const reviewFingerprint = await coordinator.reviewFingerprint(attemptId)
  return issueTrustedUserGesture(
    { isTrusted: true, type: 'click' },
    { attemptId, reviewFingerprint: reviewFingerprint ?? '', occurredAt: now }
  )
}

describe('native feedback coordinator edge states', () => {
  it('rejects an offer before the local operation commits', async () => {
    const coordinator = new NativeFeedbackCoordinator({
      store: new MemoryStore(),
      adapter: adapter(),
      enabled: true
    })

    await expect(
      coordinator.offer({
        ...offerInput(),
        localCommitState: 'pending' as never
      })
    ).rejects.toThrow('committed local operation')
  })

  it('returns the existing offer instead of creating a duplicate', async () => {
    const store = new MemoryStore()
    const nativeAdapter = adapter()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: nativeAdapter,
      enabled: true
    })

    const first = await coordinator.offer(offerInput())
    const second = await coordinator.offer(offerInput())

    expect(second).toEqual(first)
    expect(store.records.size).toBe(1)
    expect(nativeAdapter.capability).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['submitting', 'uncertain', 'worker-interrupted'],
    ['cancelled', 'cancelled', 'review-changed'],
    ['submitted', 'submitted', 'positive-evidence']
  ] as const)(
    'short-circuits a %s attempt',
    async (initialState, expectedState, reason) => {
      const store = new MemoryStore()
      const nativeAdapter = adapter()
      const coordinator = new NativeFeedbackCoordinator({
        store,
        adapter: nativeAdapter,
        enabled: true
      })
      const offered = await coordinator.offer(offerInput())
      await store.put({
        ...offered,
        state: initialState,
        terminalReason: reason
      })

      const gesture = await trustedGesture(coordinator, 'attempt:1')
      const result = await coordinator.submit('attempt:1', gesture, now)

      expect(result.state).toBe(expectedState)
      expect(nativeAdapter.activate).not.toHaveBeenCalled()
    }
  )

  it('fails an unknown attempt id', async () => {
    const coordinator = new NativeFeedbackCoordinator({
      store: new MemoryStore(),
      adapter: adapter(),
      enabled: true
    })

    await expect(
      coordinator.submit('attempt:missing', {}, now)
    ).rejects.toThrow('not found')
  })

  it('marks a revalidation timeout as uncertain and a contract failure as cancelled', async () => {
    for (const [code, expected] of [
      ['timeout', 'uncertain'],
      ['node-detached', 'cancelled']
    ] as const) {
      const store = new MemoryStore()
      const coordinator = new NativeFeedbackCoordinator({
        store,
        adapter: adapter({
          revalidate: vi.fn(async () => ({
            state: 'invalid' as const,
            code,
            elapsedMs: 40
          }))
        }),
        enabled: true
      })
      await coordinator.offer(offerInput())
      const gesture = await trustedGesture(coordinator, 'attempt:1')

      const result = await coordinator.submit('attempt:1', gesture, now)

      expect(result).toMatchObject({
        state: expected,
        terminalReason: code,
        latencyBucket: '25-50ms'
      })
    }
  })

  it.each([
    [10, 'under-25ms'],
    [30, '25-50ms'],
    [80, '51-100ms'],
    [400, 'over-100ms']
  ] as const)('buckets %sms of latency as %s', async (elapsedMs, bucket) => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter({
        revalidate: vi.fn(async (attempt: NativeFeedbackAttempt) =>
          validRevalidation(attempt, elapsedMs)
        )
      }),
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')

    const result = await coordinator.submit('attempt:1', gesture, now)

    expect(result).toMatchObject({ state: 'submitted', latencyBucket: bucket })
  })

  it("enters cooldown honoring the adapter's retry hint above the floor", async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter({
        activate: vi.fn(async () => ({
          state: 'cooldown' as const,
          code: 'rate-limited',
          retryAfterMs: 300_000
        }))
      }),
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')

    const result = await coordinator.submit('attempt:1', gesture, now)

    expect(result).toMatchObject({
      state: 'cooldown',
      terminalReason: 'rate-limited'
    })
    expect(result.cooldownUntil).toBeDefined()
    expect(Date.parse(result.cooldownUntil ?? now)).toBeGreaterThan(
      Date.parse(now) + 300_000 - 1
    )
  })

  it('marks activation that throws as uncertain without retry', async () => {
    const store = new MemoryStore()
    const nativeAdapter = adapter({
      activate: vi.fn(async () => {
        throw new Error('tab crashed')
      })
    })
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: nativeAdapter,
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')

    const result = await coordinator.submit('attempt:1', gesture, now)

    expect(result).toMatchObject({
      state: 'uncertain',
      terminalReason: 'activation-interrupted'
    })
  })

  it('recovers zero when no attempt is submitting', async () => {
    const coordinator = new NativeFeedbackCoordinator({
      store: new MemoryStore(),
      adapter: adapter(),
      enabled: true
    })

    await expect(coordinator.recoverInterrupted(now)).resolves.toBe(0)
  })

  it('leaves pending offers alone when re-enabling', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    await coordinator.offer(offerInput())

    await coordinator.setEnabled(true, now)

    expect(store.records.get('attempt:1')).toMatchObject({
      state: 'pending-review'
    })
  })
})
