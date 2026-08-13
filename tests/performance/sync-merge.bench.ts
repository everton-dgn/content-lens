import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import { mergeSyncEnvelopes } from '@/sync/three-way-merge'

import { effectiveBudgetMs } from './budget'

const entity = (index: number, value: number) => ({
  id: `entity:${index.toString().padStart(5, '0')}`,
  value: { value }
})

describe('sync merge performance', () => {
  it('merges 10,000 independent entities within the release budget', async () => {
    const count = 10_000
    const baseValues = Array.from({ length: count }, (_, index) =>
      entity(index, 0)
    )
    const base = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: 'sync:benchmark',
      generation: 0,
      profile: { ...emptySyncProfile(), exclusions: baseValues },
      tombstones: []
    })
    const local = await sealSyncEnvelope({
      ...withoutDigest(base),
      profile: {
        ...emptySyncProfile(),
        exclusions: baseValues.map((value, index) =>
          index % 2 === 0 ? entity(index, 1) : value
        )
      }
    })
    const remote = await sealSyncEnvelope({
      ...withoutDigest(base),
      profile: {
        ...emptySyncProfile(),
        exclusions: baseValues.map((value, index) =>
          index % 2 === 1 ? entity(index, 2) : value
        )
      }
    })
    const memoryBefore = process.memoryUsage().heapUsed
    const startedAt = performance.now()

    const result = await mergeSyncEnvelopes({ base, local, remote })

    const durationMs = performance.now() - startedAt
    const additionalHeapBytes = Math.max(
      0,
      process.memoryUsage().heapUsed - memoryBefore
    )
    expect(result.conflicts).toEqual([])
    expect(result.candidate?.profile.exclusions).toHaveLength(count)
    expect(durationMs).toBeLessThan(effectiveBudgetMs(5_000))
    expect(additionalHeapBytes).toBeLessThan(256 * 1024 * 1024)
    console.info(
      JSON.stringify({
        benchmark: 'sync-merge-10000',
        durationMs: Number(durationMs.toFixed(2)),
        additionalHeapBytes,
        entities: count
      })
    )
  })
})

function withoutDigest<T extends { digest: string }>(value: T) {
  const { digest: _digest, ...payload } = value
  return payload
}
