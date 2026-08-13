import { describe, expect, it, vi } from 'vitest'

import { offerNativeFeedbackAfterLocalCommit } from '@/application/native-feedback/after-local-commit'
import { NativeFeedbackCircuitBreaker } from '@/application/native-feedback/circuit-breaker'
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
  async cancelPending(at: string) {
    let count = 0
    for (const [id, attempt] of this.records) {
      if (attempt.state !== 'pending-review') continue
      this.records.set(id, {
        ...attempt,
        state: 'cancelled',
        terminalReason: 'feature-disabled',
        updatedAt: at
      })
      count += 1
    }
    return count
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

function adapter(overrides: Partial<NativeFeedbackAdapterPort> = {}) {
  return {
    capability: vi.fn(() => capability),
    revalidate: vi.fn(async (attempt: NativeFeedbackAttempt) => ({
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
      elapsedMs: 12
    })),
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

describe('native feedback coordinator', () => {
  it('keeps the capability unavailable until enabled and live-verified', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter()
    })
    await expect(coordinator.offer(offerInput())).resolves.toMatchObject({
      state: 'unavailable'
    })
  })

  it('creates no native attempt before the local operation commits', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    await expect(
      offerNativeFeedbackAfterLocalCommit(
        { state: 'pending', operationId: 'operation:feedback:1' },
        coordinator,
        offerInput()
      )
    ).resolves.toBeUndefined()
    expect(store.records.size).toBe(0)
  })

  it('requires a distinct trusted gesture after the visible review', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    await coordinator.offer(offerInput())
    await expect(
      coordinator.submit('attempt:1', { source: 'classifier' }, now)
    ).resolves.toMatchObject({
      state: 'rejected',
      terminalReason: 'trusted-gesture-required'
    })
  })

  it('activates at most once across 100 clicks and 100 replays', async () => {
    const store = new MemoryStore()
    const nativeAdapter = adapter()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: nativeAdapter,
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')
    const clicks = await Promise.all(
      Array.from({ length: 100 }, () =>
        coordinator.submit('attempt:1', gesture, now)
      )
    )
    const replays = await Promise.all(
      Array.from({ length: 100 }, () =>
        coordinator.submit('attempt:1', gesture, now)
      )
    )
    expect(clicks.every(attempt => attempt.state === 'submitted')).toBe(true)
    expect(replays.every(attempt => attempt.state === 'submitted')).toBe(true)
    expect(nativeAdapter.activate).toHaveBeenCalledTimes(1)
  })

  it('cancels when the reviewed target changes before submission', async () => {
    const store = new MemoryStore()
    const nativeAdapter = adapter({
      revalidate: vi.fn(async () => ({
        state: 'valid' as const,
        platform: 'youtube' as const,
        surface: 'youtube:home',
        platformContentId: 'video:recycled',
        pageInstanceId: 'page:1',
        actionType: 'youtube:not-interested' as const,
        actionLabel: 'Not interested',
        targetFingerprint: 'sha256:target-1',
        visible: true as const,
        enabled: true as const,
        nodeConnected: true as const,
        elapsedMs: 8
      }))
    })
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: nativeAdapter,
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')
    await expect(
      coordinator.submit('attempt:1', gesture, now)
    ).resolves.toMatchObject({
      state: 'cancelled',
      terminalReason: 'review-changed'
    })
    expect(nativeAdapter.activate).not.toHaveBeenCalled()
  })

  it('ends ambiguous activation in uncertain without retry', async () => {
    const store = new MemoryStore()
    const nativeAdapter = adapter({
      activate: vi.fn(async () => ({
        state: 'uncertain' as const,
        code: 'positive-evidence-missing'
      }))
    })
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: nativeAdapter,
      enabled: true
    })
    await coordinator.offer(offerInput())
    const gesture = await trustedGesture(coordinator, 'attempt:1')
    await coordinator.submit('attempt:1', gesture, now)
    await coordinator.submit('attempt:1', gesture, now)
    expect(nativeAdapter.activate).toHaveBeenCalledTimes(1)
    expect(store.records.get('attempt:1')?.state).toBe('uncertain')
  })

  it('disabling cancels durable pending reviews', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    await coordinator.offer(offerInput())
    await coordinator.setEnabled(false, now)
    expect(store.records.get('attempt:1')).toMatchObject({
      state: 'cancelled',
      terminalReason: 'feature-disabled'
    })
  })

  it('recovers a submitting worker state as uncertain', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    const offered = await coordinator.offer(offerInput())
    await store.put({ ...offered, state: 'submitting' })
    await expect(coordinator.recoverInterrupted(now)).resolves.toBe(1)
    expect(store.records.get('attempt:1')).toMatchObject({
      state: 'uncertain',
      terminalReason: 'worker-interrupted'
    })
  })

  it('requires a new attempt ID and causal prior for manual retry', async () => {
    const store = new MemoryStore()
    const coordinator = new NativeFeedbackCoordinator({
      store,
      adapter: adapter(),
      enabled: true
    })
    const prior = await coordinator.offer(offerInput())
    await store.put({
      ...prior,
      state: 'uncertain',
      terminalReason: 'timeout'
    })
    await expect(
      coordinator.retryOffer('attempt:1', offerInput('attempt:2'))
    ).resolves.toMatchObject({
      state: 'pending-review',
      priorAttemptId: 'attempt:1'
    })
    await expect(
      coordinator.retryOffer('attempt:1', offerInput('attempt:1'))
    ).rejects.toThrow('new attempt ID')
  })
})

describe('native feedback circuit breaker', () => {
  it('opens on three failures in ten minutes and only closes by version or self-test', () => {
    const breaker = new NativeFeedbackCircuitBreaker()
    const key = 'youtube\u0000youtube:home\u0000youtube:not-interested'
    breaker.contractFailure(key, 'adapter@1', 'selector', 0)
    breaker.contractFailure(key, 'adapter@1', 'selector', 60_000)
    expect(breaker.allow(key, 'adapter@1')).toBe(true)
    breaker.contractFailure(key, 'adapter@1', 'selector', 120_000)
    expect(breaker.allow(key, 'adapter@1')).toBe(false)
    expect(breaker.allow(key, 'adapter@1')).toBe(false)
    expect(breaker.allow(key, 'adapter@2')).toBe(true)

    breaker.contractFailure(key, 'adapter@2', 'selector', 180_000)
    breaker.contractFailure(key, 'adapter@2', 'selector', 240_000)
    breaker.contractFailure(key, 'adapter@2', 'selector', 300_000)
    breaker.selfTestSucceeded(key, 'adapter@2')
    expect(breaker.allow(key, 'adapter@2')).toBe(true)
  })
})
