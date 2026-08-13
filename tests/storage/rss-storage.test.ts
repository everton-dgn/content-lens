import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@/core/content/contracts'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
const at = '2026-07-31T12:00:00.000Z'

const entry = (
  index: number,
  overrides: Partial<ContentItem> = {}
): ContentItem => ({
  id: `rss:entry:${index}`,
  platform: 'rss',
  identity: { status: 'stable', platformContentId: String(index) },
  surface: 'rss:feed-entry',
  title: `Entry ${index}`,
  media: [],
  publishedAt: new Date(Date.parse(at) + index * 1_000).toISOString(),
  observedAt: new Date(Date.parse(at) + index * 1_000).toISOString(),
  context: { feedId, identityKind: 'rss-guid' },
  ...overrides
})

describe('RSS durable storage', () => {
  it('keeps the newest 100 unique entries for one feed across reopen', async () => {
    const factory = new IDBFactory()
    const databaseName = 'contentlens-rss-entry-retention'
    const database = new ContentLensDatabase({ factory, databaseName })
    const inputs = Array.from({ length: 120 }, (_, index) => entry(index))
    inputs.push(entry(119))

    expect(await database.replaceRecentRssEntries(feedId, inputs)).toEqual({
      state: 'recorded',
      count: 100
    })
    database.close()

    const reopened = new ContentLensDatabase({ factory, databaseName })
    const stored = await reopened.readRecentRssEntries(feedId)
    expect(stored).toHaveLength(100)
    expect(stored[0]?.id).toBe('rss:entry:20')
    expect(stored.at(-1)?.id).toBe('rss:entry:119')
  })

  it('rejects entries from another platform or feed atomically', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-rss-entry-boundary'
    })

    await expect(
      database.replaceRecentRssEntries(feedId, [
        entry(1),
        entry(2, { platform: 'reddit', surface: 'reddit:home' })
      ])
    ).resolves.toEqual({ state: 'invalid' })
    expect(await database.readRecentRssEntries(feedId)).toEqual([])
  })

  it('persists finite runtime state and clears feed data to a tombstone', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-rss-runtime-state'
    })
    await database.replaceRecentRssEntries(feedId, [entry(1)])
    await database.replaceRssRuntimeState({
      schemaVersion: 1,
      feedId,
      state: 'failed',
      consecutiveFailures: 2,
      updatedAt: at,
      lastAttemptAt: at,
      nextAttemptAt: '2026-07-31T12:30:00.000Z',
      code: 'status-failed',
      statusClass: '5xx'
    })

    expect(await database.readRssRuntimeStates()).toEqual([
      expect.objectContaining({
        feedId,
        state: 'failed',
        code: 'status-failed',
        statusClass: '5xx'
      })
    ])
    expect(await database.clearRssFeedData(feedId, at)).toEqual({
      state: 'cleared'
    })
    expect(await database.readRecentRssEntries(feedId)).toEqual([])
    expect(await database.readRssRuntimeStates()).toEqual([
      {
        schemaVersion: 1,
        feedId,
        state: 'removed',
        consecutiveFailures: 0,
        updatedAt: at
      }
    ])
  })
})
