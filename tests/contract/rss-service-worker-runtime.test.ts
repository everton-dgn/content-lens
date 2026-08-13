import { describe, expect, it, vi } from 'vitest'

import type { RssRuntimeState, RssSubscription } from '@/adapters/rss'
import {
  createServiceWorkerRssRuntime,
  type RssRuntimeDatabase
} from '@/extension/service-worker/rss-runtime'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'

const at = '2026-07-31T12:00:00.000Z'
const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
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
function profile(): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 3 },
    profileId: 'profile:rss-service-worker',
    revision: 0,
    createdAt: at,
    updatedAt: at,
    rules: [],
    feedbackExamples: [],
    settings: { rssSubscriptions: [subscription] }
  }
}

function database() {
  const states = new Map<string, RssRuntimeState>()
  const implementation: RssRuntimeDatabase = {
    exportProfile: vi.fn(async () => profile()),
    readRssRuntimeStates: vi.fn(async () => [...states.values()]),
    replaceRssRuntimeState: vi.fn(async state => {
      states.set(state.feedId, state)
    })
  }
  return { implementation, states }
}

describe('service-worker RSS runtime', () => {
  it('marks active subscriptions unavailable without scheduling network work', async () => {
    const storage = database()
    const runtime = createServiceWorkerRssRuntime({
      database: storage.implementation,
      now: () => new Date(at)
    })

    await expect(runtime.start()).resolves.toEqual([
      {
        state: 'unavailable',
        feedId,
        code: 'dns-api-unavailable',
        durationMs: 0
      }
    ])
    expect(storage.states.get(feedId)).toMatchObject({
      code: 'dns-api-unavailable',
      state: 'unavailable'
    })
  })

  it('coalesces overlapping wakeups', async () => {
    let releaseProfile: (value: ProfileEnvelope) => void = () => undefined
    const pendingProfile = new Promise<ProfileEnvelope>(resolve => {
      releaseProfile = resolve
    })
    const storage = database()
    storage.implementation.exportProfile = vi.fn(() => pendingProfile)
    const runtime = createServiceWorkerRssRuntime({
      database: storage.implementation
    })

    const first = runtime.runDue()
    const overlapping = runtime.runDue()
    expect(overlapping).toBe(first)
    expect(storage.implementation.exportProfile).toHaveBeenCalledOnce()
    releaseProfile(profile())
    await expect(first).resolves.toHaveLength(1)
  })

  it('revalidates a known feed and rejects an unknown identifier safely', async () => {
    const storage = database()
    const runtime = createServiceWorkerRssRuntime({
      database: storage.implementation
    })

    await expect(runtime.revalidate(feedId)).resolves.toMatchObject({
      state: 'unavailable',
      feedId,
      code: 'dns-api-unavailable'
    })
    await expect(
      runtime.revalidate('rss-feed:00000000-0000-4000-8000-000000000099')
    ).resolves.toEqual({
      state: 'failed',
      feedId: 'rss-feed:00000000-0000-4000-8000-000000000099',
      code: 'unexpected-failure',
      durationMs: 0
    })
  })

  it('prevents state writes after a feed is cancelled', async () => {
    const storage = database()
    const runtime = createServiceWorkerRssRuntime({
      database: storage.implementation,
      now: () => new Date(at)
    })

    await expect(runtime.cancel(feedId)).resolves.toBe(false)
    await expect(runtime.runDue()).resolves.toEqual([
      expect.objectContaining({ state: 'unavailable', feedId })
    ])
    expect(storage.states.has(feedId)).toBe(false)
  })
})
