import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import { reconcileLocalProjection } from '@/sync/reconcile-local'

const at = '2026-07-31T12:00:00.000Z'

async function envelope(
  exclusions: Array<{ id: string; value: { phrase: string } }>
) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:local',
    generation: 0,
    profile: { ...emptySyncProfile(), exclusions },
    tombstones: []
  })
}

describe('local sync projection reconciliation', () => {
  it('creates tombstones for entities removed from durable local configuration', async () => {
    const result = await reconcileLocalProjection({
      previous: await envelope([{ id: 'removed', value: { phrase: 'x' } }]),
      projection: await envelope([]),
      at
    })
    expect(result.tombstones).toMatchObject([
      { entityType: 'exclusions', entityId: 'removed' }
    ])
  })

  it('preserves tombstones and blocks implicit resurrection with the same ID', async () => {
    const previous = await reconcileLocalProjection({
      previous: await envelope([{ id: 'removed', value: { phrase: 'x' } }]),
      projection: await envelope([]),
      at
    })
    await expect(
      reconcileLocalProjection({
        previous,
        projection: await envelope([
          { id: 'removed', value: { phrase: 'restored' } }
        ]),
        at
      })
    ).rejects.toThrow('require a new ID')
  })
})
