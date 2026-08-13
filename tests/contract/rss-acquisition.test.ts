import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_RSS_INTERVAL_MINUTES,
  type RssAcquisitionResult,
  type RssSubscription,
  rssSubscriptionSchema
} from '@/adapters/rss'
import {
  nextRssAttemptAt,
  RssAcquisitionQueue,
  RssAcquisitionService
} from '@/application/feed-subscriptions'

const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
const now = '2026-07-31T12:00:00.000Z'

const subscription = (
  overrides: Partial<RssSubscription> = {}
): RssSubscription => ({
  schemaVersion: 1,
  feedId,
  url: 'https://feeds.example/source.xml',
  origin: 'https://feeds.example',
  state: 'active',
  intervalMinutes: DEFAULT_RSS_INTERVAL_MINUTES,
  createdAt: now,
  updatedAt: now,
  ...overrides
})

describe('RSS acquisition', () => {
  it('fails closed because the browser cannot bind DNS validation to fetch', async () => {
    const service = new RssAcquisitionService({
      now: () => new Date(now)
    })

    await expect(
      service.acquire({
        subscription: subscription()
      })
    ).resolves.toEqual({
      state: 'unavailable',
      feedId,
      code: 'dns-api-unavailable',
      durationMs: 0
    })
  })

  it('skips paused subscriptions before reporting network availability', async () => {
    const service = new RssAcquisitionService({})

    await expect(
      service.acquire({
        subscription: subscription({ state: 'paused' })
      })
    ).resolves.toEqual({
      state: 'skipped',
      feedId,
      code: 'subscription-paused',
      durationMs: 0
    })
  })
})

describe('RSS scheduling', () => {
  it('uses interval, exponential backoff, cap, jitter and larger Retry-After', () => {
    const base = new Date(now)
    expect(
      nextRssAttemptAt({
        consecutiveFailures: 0,
        intervalMinutes: 60,
        now: base
      })
    ).toBe('2026-07-31T13:00:00.000Z')
    expect(
      nextRssAttemptAt({
        consecutiveFailures: 1,
        intervalMinutes: 60,
        jitter: () => 0.5,
        now: base
      })
    ).toBe('2026-07-31T12:15:00.000Z')
    expect(
      nextRssAttemptAt({
        consecutiveFailures: 20,
        intervalMinutes: 60,
        jitter: () => 0.5,
        now: base
      })
    ).toBe('2026-08-01T12:00:00.000Z')
    expect(
      nextRssAttemptAt({
        consecutiveFailures: 1,
        intervalMinutes: 60,
        jitter: () => 0.5,
        now: base,
        retryAfterMs: 2 * 60 * 60 * 1_000
      })
    ).toBe('2026-07-31T14:00:00.000Z')
  })

  it('caps global concurrency at five and coalesces the same feed', async () => {
    const pending: Array<(result: RssAcquisitionResult) => void> = []
    const acquire = vi.fn(
      () => new Promise<RssAcquisitionResult>(resolve => pending.push(resolve))
    )
    const queue = new RssAcquisitionQueue({ acquire })
    const scheduled = Array.from({ length: 7 }, (_, index) =>
      queue.schedule({
        subscription: subscription({
          feedId: `rss-feed:123e4567-e89b-42d3-a456-42661417400${index}`
        })
      })
    )
    const duplicate = queue.schedule({ subscription: subscription() })

    expect(queue.snapshot()).toEqual({ active: 5, pending: 2, inflight: 7 })
    expect(acquire).toHaveBeenCalledTimes(5)
    expect(duplicate).toBe(scheduled[0])

    for (let index = 0; index < 7; index += 1) {
      const resolve = pending.shift()
      resolve?.({
        state: 'ready',
        feedId: `rss-feed:123e4567-e89b-42d3-a456-42661417400${index}`,
        entries: 0,
        format: 'rss',
        redirects: 0,
        truncated: false,
        durationMs: 0,
        statusClass: '2xx'
      })
      await Promise.resolve()
      await Promise.resolve()
    }
    await Promise.all(scheduled)
    expect(queue.snapshot()).toEqual({ active: 0, pending: 0, inflight: 0 })
  })

  it('rejects invalid feed identifiers and intervals', () => {
    expect(
      rssSubscriptionSchema.safeParse(
        subscription({ feedId: 'https://feeds.example/source.xml' })
      ).success
    ).toBe(false)
    expect(
      rssSubscriptionSchema.safeParse(subscription({ intervalMinutes: 14 }))
        .success
    ).toBe(false)
  })
})
