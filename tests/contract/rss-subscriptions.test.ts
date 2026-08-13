import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RssSubscription } from '@/adapters/rss'
import {
  FeedSubscriptionService,
  writeRssSubscriptions
} from '@/application/feed-subscriptions'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const at = '2026-07-31T12:00:00.000Z'
const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'

const subscription: RssSubscription = {
  schemaVersion: 1,
  feedId,
  url: 'https://feeds.example/source.xml',
  origin: 'https://feeds.example',
  state: 'active',
  intervalMinutes: 30,
  createdAt: at,
  updatedAt: at
}

const profile = (
  subscriptions: readonly RssSubscription[] = [subscription]
): ProfileEnvelope => ({
  schemaVersion: { major: 1, minor: 3 },
  profileId: 'profile:rss-subscriptions',
  revision: 0,
  createdAt: at,
  updatedAt: at,
  rules: [],
  feedbackExamples: [],
  settings: writeRssSubscriptions({}, [...subscriptions])
})

function environment() {
  const database = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName: `contentlens-rss-subscriptions-${crypto.randomUUID()}`
  })
  const service = new FeedSubscriptionService({ database })
  return { database, service }
}

describe('RSS subscription management', () => {
  let context: ReturnType<typeof environment>

  beforeEach(async () => {
    context = environment()
    await context.database.saveProfile(profile())
  })

  it('lists subscriptions already stored in the portable profile', async () => {
    expect(await context.service.list()).toEqual([subscription])
  })

  it('pauses a stored subscription without changing its feed ID', async () => {
    const editedAt = '2026-07-31T12:10:00.000Z'
    expect(
      await context.service.setPaused({
        operationId: 'operation:rss:pause',
        expectedRevision: 0,
        feedId,
        paused: true,
        at: editedAt
      })
    ).toMatchObject({ state: 'committed', revision: 1 })
    expect(await context.service.list()).toEqual([
      expect.objectContaining({
        feedId,
        state: 'paused'
      })
    ])
  })

  it('requires confirmation and clears cached feed data after removal', async () => {
    expect(
      await context.service.remove({
        operationId: 'operation:rss:remove:blocked',
        expectedRevision: 0,
        feedId,
        confirmed: false,
        at
      })
    ).toMatchObject({
      state: 'failed',
      error: { code: 'rss-removal-confirmation-required' }
    })
    expect(await context.service.list()).toHaveLength(1)

    expect(
      await context.service.remove({
        operationId: 'operation:rss:remove',
        expectedRevision: 0,
        feedId,
        confirmed: true,
        at
      })
    ).toMatchObject({ state: 'committed', revision: 1 })
    expect(await context.service.list()).toEqual([])
    expect(await context.database.readRecentRssEntries(feedId)).toEqual([])
    expect(await context.database.readRssRuntimeStates()).toEqual([
      expect.objectContaining({ feedId, state: 'removed' })
    ])
  })

  it('rejects state changes for unknown feeds without incrementing revision', async () => {
    expect(
      await context.service.setPaused({
        operationId: 'operation:rss:pause:missing',
        expectedRevision: 0,
        feedId: 'rss-feed:00000000-0000-4000-8000-000000000000',
        paused: true,
        at
      })
    ).toMatchObject({
      state: 'failed',
      error: { code: 'rss-subscription-not-found' }
    })
    expect((await context.database.exportProfile())?.revision).toBe(0)
  })
})
