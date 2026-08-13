import { describe, expect, it } from 'vitest'

import { BoundedSimilarityIndex } from '@/ai/similarity/index'
import { SimilarityRebuildSession } from '@/application/similarity/rebuild'

import { effectiveBudgetMs } from './budget'

const count = 10_000
const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-30T12:00:00.000Z'
const dimension = 16
const manifest = {
  modelProviderId: 'provider:benchmark',
  modelId: 'embedding:benchmark',
  modality: 'text' as const,
  dimension,
  preprocessingVersion: 'benchmark-v1',
  normalization: 'l2' as const,
  versionSpace: 'benchmark-space-v1'
}

const vector = (index: number) =>
  Array.from({ length: dimension }, (_, component) =>
    component === index % dimension ? 1 : 0
  )

const record = (index: number) => ({
  id: `vector:${index.toString().padStart(5, '0')}`,
  contentId: `content:${index.toString().padStart(5, '0')}`,
  platform: 'youtube' as const,
  surface: 'youtube:home' as const,
  language: 'en',
  stableIdentity: true,
  exactFingerprint: index.toString(16).padStart(64, '0'),
  manifest,
  vector: vector(index),
  observedAt: at,
  expiresAt: later,
  byteLength: dimension * Float32Array.BYTES_PER_ELEMENT
})

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ??
    0
  )
}

describe('similarity index release budgets', () => {
  it('meets insert, query and rebuild budgets at 10,000 observations', async () => {
    const index = new BoundedSimilarityIndex()
    const insertLatencies: number[] = []
    const memoryBefore = process.memoryUsage().heapUsed
    const rebuildStartedAt = performance.now()
    const rebuild = new SimilarityRebuildSession({
      generation: 1,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: manifest.versionSpace,
      at
    })
    const outcome = await rebuild.run({
      items: Array.from({ length: count }, (_, itemIndex) => itemIndex),
      batchSize: 256,
      at: () => at,
      process: async itemIndex => {
        const startedAt = performance.now()
        index.insert(record(itemIndex), at)
        insertLatencies.push(performance.now() - startedAt)
      }
    })
    const rebuildMilliseconds = performance.now() - rebuildStartedAt
    const queryLatencies: number[] = []
    for (let queryIndex = 0; queryIndex < 100; queryIndex += 1) {
      const startedAt = performance.now()
      const result = index.query({
        vector: vector(queryIndex),
        versionSpace: manifest.versionSpace,
        platform: 'youtube',
        surface: 'youtube:home',
        language: 'en',
        now: at
      })
      expect(result.state).toBe('ready')
      expect(result.candidates.length).toBeGreaterThan(0)
      queryLatencies.push(performance.now() - startedAt)
    }
    const additionalHeapBytes = Math.max(
      0,
      process.memoryUsage().heapUsed - memoryBefore
    )
    const insertP95Milliseconds = percentile(insertLatencies, 0.95)
    const queryP95Milliseconds = percentile(queryLatencies, 0.95)

    expect(outcome.state).toBe('completed')
    expect(index.snapshot().itemCount).toBe(count)
    expect(insertP95Milliseconds).toBeLessThan(effectiveBudgetMs(50))
    expect(queryP95Milliseconds).toBeLessThan(effectiveBudgetMs(100))
    expect(rebuildMilliseconds).toBeLessThan(effectiveBudgetMs(60_000))
    expect(additionalHeapBytes).toBeLessThan(256 * 1024 * 1024)
    console.info(
      JSON.stringify({
        benchmark: 'similarity-index-10000',
        observations: count,
        insertP95Milliseconds: Number(insertP95Milliseconds.toFixed(2)),
        queryP95Milliseconds: Number(queryP95Milliseconds.toFixed(2)),
        rebuildMilliseconds: Number(rebuildMilliseconds.toFixed(2)),
        additionalHeapBytes,
        storedBytes: index.snapshot().byteLength
      })
    )
  })
})
