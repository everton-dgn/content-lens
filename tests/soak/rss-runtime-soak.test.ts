import { describe, expect, it, vi } from 'vitest'

import type {
  RssAcquisitionResult,
  RssRuntimeState,
  RssSubscription
} from '@/adapters/rss'
import {
  RssAcquisitionQueue,
  RssRuntimeCoordinator
} from '@/application/feed-subscriptions'

const start = Date.parse('2026-07-31T00:00:00.000Z')

const subscriptions: RssSubscription[] = Array.from(
  { length: 100 },
  (_, index) => {
    const suffix = index.toString().padStart(12, '0')
    return {
      schemaVersion: 1,
      feedId: `rss-feed:00000000-0000-4000-8000-${suffix}`,
      url: `https://feed-${index}.example/source.xml`,
      origin: `https://feed-${index}.example`,
      state: 'active',
      intervalMinutes: 15,
      createdAt: new Date(start).toISOString(),
      updatedAt: new Date(start).toISOString()
    }
  }
)

describe('RSS runtime soak bounds', () => {
  it('keeps 100 failing feeds bounded through 24 simulated hours', async () => {
    let nowMs = start
    let maximumActive = 0
    const states = new Map<string, RssRuntimeState>()
    const acquire = vi.fn(async (input): Promise<RssAcquisitionResult> => {
      maximumActive = Math.max(maximumActive, queue.snapshot().active)
      return {
        state: 'failed',
        feedId: input.subscription.feedId,
        code: 'status-failed',
        durationMs: 10,
        statusClass: '5xx'
      }
    })
    const queue = new RssAcquisitionQueue({ acquire })
    const coordinator = new RssRuntimeCoordinator({
      queue,
      persistence: {
        read: vi.fn(async () => [...states.values()]),
        write: vi.fn(async state => {
          states.set(state.feedId, state)
        })
      },
      jitter: () => 0.5,
      now: () => new Date(nowMs)
    })

    for (let tick = 0; tick <= 96; tick += 1) {
      nowMs = start + tick * 15 * 60 * 1_000
      await coordinator.runDue(subscriptions)
    }

    expect(states).toHaveLength(100)
    expect(queue.snapshot()).toEqual({ active: 0, pending: 0, inflight: 0 })
    expect(maximumActive).toBeLessThanOrEqual(5)
    expect(maximumActive).toBeGreaterThan(1)
    expect(acquire.mock.calls.length).toBeLessThanOrEqual(700)
    expect(
      [...states.values()].every(
        state =>
          state.state === 'failed' &&
          state.consecutiveFailures <= 7 &&
          Date.parse(state.nextAttemptAt ?? '') > nowMs
      )
    ).toBe(true)
    expect(JSON.stringify([...states.values()])).not.toContain('.example')
  })
})
