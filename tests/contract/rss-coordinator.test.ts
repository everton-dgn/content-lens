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

const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
const at = '2026-07-31T12:00:00.000Z'
const subscription: RssSubscription = {
  schemaVersion: 1,
  feedId,
  url: 'https://feeds.example/source.xml',
  origin: 'https://feeds.example',
  state: 'active',
  intervalMinutes: 60,
  createdAt: at,
  updatedAt: at
}

const ready = (): RssAcquisitionResult => ({
  state: 'ready',
  feedId,
  entries: 2,
  format: 'rss',
  redirects: 0,
  truncated: false,
  durationMs: 25,
  statusClass: '2xx'
})

describe('RSS runtime coordinator', () => {
  it('removes pending work and aborts active work by feedId', async () => {
    const firstFeedId = feedId
    const secondFeedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174001'
    const acquire = vi.fn(
      ({
        subscription,
        signal
      }: {
        subscription: RssSubscription
        signal?: AbortSignal
      }) =>
        new Promise<RssAcquisitionResult>(resolve => {
          signal?.addEventListener(
            'abort',
            () =>
              resolve({
                state: 'failed',
                feedId: subscription.feedId,
                code: 'aborted',
                durationMs: 0
              }),
            { once: true }
          )
        })
    )
    const queue = new RssAcquisitionQueue({ acquire, concurrency: 1 })
    const first = queue.schedule({ subscription })
    const second = queue.schedule({
      subscription: { ...subscription, feedId: secondFeedId }
    })

    expect(queue.snapshot()).toEqual({ active: 1, pending: 1, inflight: 2 })
    expect(queue.cancel(secondFeedId)).toBe(true)
    await expect(second).resolves.toMatchObject({
      state: 'failed',
      feedId: secondFeedId,
      code: 'aborted'
    })
    expect(queue.cancel(firstFeedId)).toBe(true)
    await expect(first).resolves.toMatchObject({
      state: 'failed',
      feedId: firstFeedId,
      code: 'aborted'
    })
    await vi.waitFor(() =>
      expect(queue.snapshot()).toEqual({ active: 0, pending: 0, inflight: 0 })
    )
  })

  it('persists fetching and ready states with the next interval', async () => {
    const states: RssRuntimeState[] = []
    const coordinator = new RssRuntimeCoordinator({
      queue: new RssAcquisitionQueue({ acquire: vi.fn(async () => ready()) }),
      persistence: {
        read: vi.fn(async () => states.slice(-1)),
        write: vi.fn(async state => {
          states.push(state)
        })
      },
      now: () => new Date(at),
      jitter: () => 0.5
    })

    await expect(coordinator.run(subscription)).resolves.toEqual(ready())
    expect(states).toEqual([
      expect.objectContaining({ state: 'fetching', consecutiveFailures: 0 }),
      expect.objectContaining({
        state: 'ready',
        consecutiveFailures: 0,
        nextAttemptAt: '2026-07-31T13:00:00.000Z',
        statusClass: '2xx'
      })
    ])
  })

  it('persists finite failure data and honors a larger Retry-After', async () => {
    const states: RssRuntimeState[] = [
      {
        schemaVersion: 1,
        feedId,
        state: 'failed',
        consecutiveFailures: 1,
        updatedAt: at,
        code: 'status-failed'
      }
    ]
    const coordinator = new RssRuntimeCoordinator({
      queue: new RssAcquisitionQueue({
        acquire: vi.fn(
          async (): Promise<RssAcquisitionResult> => ({
            state: 'failed',
            feedId,
            code: 'status-failed',
            durationMs: 20,
            retryAfterMs: 7_200_000,
            statusClass: '5xx'
          })
        )
      }),
      persistence: {
        read: vi.fn(async () => states.slice(-1)),
        write: vi.fn(async state => {
          states.push(state)
        })
      },
      now: () => new Date(at),
      jitter: () => 0.5
    })

    await coordinator.run(subscription)
    expect(states.at(-1)).toEqual({
      schemaVersion: 1,
      feedId,
      state: 'failed',
      consecutiveFailures: 2,
      updatedAt: at,
      lastAttemptAt: at,
      nextAttemptAt: '2026-07-31T14:00:00.000Z',
      code: 'status-failed',
      retryAfterUntil: '2026-07-31T14:00:00.000Z',
      statusClass: '5xx'
    })
  })

  it('schedules the next check after acquisition is unavailable', async () => {
    const states: RssRuntimeState[] = []
    const acquire = vi.fn(
      async (): Promise<RssAcquisitionResult> => ({
        state: 'unavailable',
        feedId,
        code: 'dns-api-unavailable',
        durationMs: 0
      })
    )
    const coordinator = new RssRuntimeCoordinator({
      queue: new RssAcquisitionQueue({ acquire }),
      persistence: {
        read: vi.fn(async () => states.slice(-1)),
        write: vi.fn(async state => {
          states.push(state)
        })
      },
      now: () => new Date(at),
      jitter: () => 0.5
    })

    await coordinator.run(subscription)
    expect(states.at(-1)).toEqual({
      schemaVersion: 1,
      feedId,
      state: 'unavailable',
      consecutiveFailures: 0,
      updatedAt: at,
      lastAttemptAt: at,
      nextAttemptAt: '2026-07-31T13:00:00.000Z',
      code: 'dns-api-unavailable'
    })
    await expect(coordinator.runDue([subscription])).resolves.toEqual([])
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('runs only active feeds whose schedule is due', async () => {
    const acquire = vi.fn(async () => ready())
    const states: RssRuntimeState[] = [
      {
        schemaVersion: 1,
        feedId,
        state: 'ready',
        consecutiveFailures: 0,
        updatedAt: at,
        nextAttemptAt: '2026-07-31T13:00:00.000Z'
      }
    ]
    const coordinator = new RssRuntimeCoordinator({
      queue: new RssAcquisitionQueue({ acquire }),
      persistence: {
        read: vi.fn(async () => states),
        write: vi.fn(async () => undefined)
      },
      now: () => new Date(at)
    })

    await expect(coordinator.runDue([subscription])).resolves.toEqual([])
    expect(acquire).not.toHaveBeenCalled()
  })
})
