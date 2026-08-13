import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { ContentLensDatabase } from '@/storage/indexed-db/database'

describe('model cache storage', () => {
  it('reads back one exact versioned cache entry without exposing store internals', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-model-cache'
    })

    await expect(
      database.putCacheEntries([
        {
          id: 'model-cache:v1:fixture',
          updatedAt: '2026-07-31T08:00:00.000Z',
          value: {
            schemaVersion: '1',
            confidence: 0.8
          }
        }
      ])
    ).resolves.toEqual({ state: 'recorded', count: 1 })
    await expect(
      database.readCacheEntry('model-cache:v1:fixture')
    ).resolves.toEqual({
      schemaVersion: '1',
      confidence: 0.8
    })
    await expect(database.readCacheEntry('missing')).resolves.toBeUndefined()

    database.close()
  })
})
