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
const later = '2026-07-31T12:10:00.000Z'
const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
const otherFeedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174001'

const profile = (
  subscriptions: readonly RssSubscription[] = []
): ProfileEnvelope => ({
  schemaVersion: { major: 1, minor: 3 },
  profileId: 'profile:rss-subscription-edges',
  revision: 0,
  createdAt: at,
  updatedAt: at,
  rules: [],
  feedbackExamples: [],
  settings: writeRssSubscriptions({}, [...subscriptions])
})

const subscription = (
  overrides: Partial<RssSubscription> = {}
): RssSubscription => ({
  schemaVersion: 1,
  feedId,
  url: 'https://feeds.example/source.xml',
  origin: 'https://feeds.example',
  state: 'active',
  intervalMinutes: 60,
  createdAt: at,
  updatedAt: at,
  ...overrides
})

function environment() {
  const database = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName: `contentlens-rss-edges-${crypto.randomUUID()}`
  })
  const service = new FeedSubscriptionService({ database })
  return { database, service }
}

describe('RSS subscription state without a profile', () => {
  it('returns an empty list when no profile has been written', async () => {
    expect(await environment().service.list()).toEqual([])
  })

  it.each([
    {
      call: (service: FeedSubscriptionService) =>
        service.setPaused({
          operationId: 'operation:rss:pause:no-profile',
          expectedRevision: 0,
          feedId,
          paused: true,
          at
        }),
      name: 'setPaused'
    },
    {
      call: (service: FeedSubscriptionService) =>
        service.remove({
          operationId: 'operation:rss:remove:no-profile',
          expectedRevision: 0,
          feedId,
          confirmed: true,
          at
        }),
      name: 'remove'
    }
  ])(
    'fails $name with a stable missing-subscription code',
    async ({ call }) => {
      expect(await call(environment().service)).toMatchObject({
        state: 'failed',
        error: { code: 'rss-subscription-not-found' }
      })
    }
  )
})

describe('RSS subscription state changes', () => {
  let context: ReturnType<typeof environment>

  beforeEach(async () => {
    context = environment()
    await context.database.saveProfile(
      profile([
        subscription(),
        subscription({
          feedId: otherFeedId,
          url: 'https://other.example/source.xml',
          origin: 'https://other.example'
        })
      ])
    )
  })

  it('pauses one subscription and leaves the other active', async () => {
    expect(
      await context.service.setPaused({
        operationId: 'operation:rss:pause:one',
        expectedRevision: 0,
        feedId,
        paused: true,
        at: later
      })
    ).toMatchObject({ state: 'committed' })

    const subscriptions = await context.service.list()
    expect(subscriptions.find(item => item.feedId === feedId)?.state).toBe(
      'paused'
    )
    expect(subscriptions.find(item => item.feedId === otherFeedId)?.state).toBe(
      'active'
    )
  })

  it('resumes a paused subscription', async () => {
    await context.service.setPaused({
      operationId: 'operation:rss:pause:before-resume',
      expectedRevision: 0,
      feedId,
      paused: true,
      at: later
    })

    expect(
      await context.service.setPaused({
        operationId: 'operation:rss:resume',
        expectedRevision: 1,
        feedId,
        paused: false,
        at: later
      })
    ).toMatchObject({ state: 'committed' })
    expect(
      (await context.service.list()).find(item => item.feedId === feedId)?.state
    ).toBe('active')
  })

  it('replays a pause rather than applying it twice', async () => {
    const command = {
      operationId: 'operation:rss:pause:replayed',
      expectedRevision: 0,
      feedId,
      paused: true,
      at: later
    } as const
    const first = await context.service.setPaused(command)

    expect(await context.service.setPaused(command)).toEqual(first)
    expect((await context.database.exportProfile())?.revision).toBe(1)
  })

  it('replays a removal rather than applying it twice', async () => {
    const command = {
      operationId: 'operation:rss:remove:replayed',
      expectedRevision: 0,
      feedId,
      confirmed: true,
      at: later
    } as const
    const first = await context.service.remove(command)

    expect(await context.service.remove(command)).toEqual(first)
    expect(await context.service.list()).toHaveLength(1)
  })
})
