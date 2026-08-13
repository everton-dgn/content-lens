import { describe, expect, it, vi } from 'vitest'

import type { EmbeddingPort } from '@/ai/similarity/embedding-provider'
import { BoundedSimilarityIndex } from '@/ai/similarity/index'
import { SimilarityRebuildSession } from '@/application/similarity/rebuild'
import { SimilarityService } from '@/application/similarity/service'
import type { ContentItem } from '@/core/content/contracts'
import type { RepresentationManifest } from '@/core/similarity/contracts'

const at = '2026-07-31T12:00:00.000Z'

const manifest: RepresentationManifest = {
  modelProviderId: 'provider:local',
  modelId: 'embedding:model',
  modality: 'text',
  dimension: 3,
  preprocessingVersion: 'text-v1',
  normalization: 'l2',
  versionSpace: 'provider:local:space-v1'
}

function content(
  id: string,
  overrides: Partial<ContentItem> = {}
): ContentItem {
  return {
    id,
    platform: 'youtube',
    identity: { status: 'stable', platformContentId: id },
    surface: 'youtube:home',
    title: `Title ${id}`,
    body: `Body ${id}`,
    media: [],
    observedAt: at,
    language: 'en',
    context: {},
    ...overrides
  }
}

function attempt(
  embed: EmbeddingPort['embed'] = vi.fn(async () => ({
    vector: [1, 0, 0],
    manifest
  }))
) {
  const port: EmbeddingPort = {
    execution: 'local',
    model: {
      providerConfigId: 'provider:local',
      modelId: 'embedding:model'
    },
    manifest,
    embed
  }
  return {
    embed,
    attempt: {
      port,
      accepted: true,
      consented: true,
      budgetAvailable: true
    }
  }
}

describe('similarity service', () => {
  it('runs exact matching first and skips embeddings after an exact match', async () => {
    const service = new SimilarityService()
    const firstRoute = attempt()
    await service.observe({
      item: content('first', { title: 'Same', body: 'Same' }),
      attempts: [firstRoute.attempt],
      at
    })
    const secondRoute = attempt()
    const result = await service.observe({
      item: content('second', { title: 'Same', body: 'Same' }),
      attempts: [secondRoute.attempt],
      at
    })

    expect(result).toMatchObject({
      exactEvaluated: true,
      embeddingState: 'not-needed',
      relations: [{ type: 'exact-duplicate', score: 1 }]
    })
    expect(secondRoute.embed).not.toHaveBeenCalled()
  })

  it('classifies a compatible candidate and suppresses only that fingerprint', async () => {
    const service = new SimilarityService()
    await service.observe({
      item: content('first'),
      attempts: [attempt().attempt],
      at
    })
    const second = await service.observe({
      item: content('second'),
      attempts: [attempt().attempt],
      at,
      evidenceFor: () => ({
        structuralOverlap: true,
        visualAgreement: false,
        materialFactDelta: false,
        publishedTimeDelta: false,
        sourceLink: false
      })
    })
    expect(second.relations).toMatchObject([
      { type: 'near-duplicate', advisoryOnly: false }
    ])
    await expect(service.clusters({ at })).resolves.toMatchObject([
      {
        representativeContentId: 'first',
        members: [
          expect.objectContaining({ contentId: 'first' }),
          expect.objectContaining({ contentId: 'second' })
        ]
      }
    ])

    const relationId = second.relations[0]?.relationId
    expect(relationId).toBeDefined()
    if (!relationId) {
      throw new Error('Expected a relation ID')
    }
    await expect(
      service.suppress({
        relationId,
        reason: 'false-grouping',
        at
      })
    ).resolves.toMatchObject({ state: 'suppressed' })
    expect(service.activeRelations(at)).toEqual([])
  })

  it('keeps exact matching available when the probabilistic index is degraded', async () => {
    const index = new BoundedSimilarityIndex()
    const service = new SimilarityService(index)
    await service.observe({
      item: content('first', { title: 'Same', body: 'Same' }),
      attempts: [attempt().attempt],
      at
    })
    index.markCorrupt()
    const result = await service.observe({
      item: content('second', { title: 'Same', body: 'Same' }),
      attempts: [],
      at
    })
    expect(result.relations[0]?.type).toBe('exact-duplicate')
    expect(service.snapshot().index.state).toBe('degraded')
  })

  it('does not mark an ephemeral-only relation as durable', async () => {
    const service = new SimilarityService()
    const ephemeral = (id: string) =>
      content(id, {
        identity: {
          status: 'ephemeral',
          pageInstanceId: `page:${id}`,
          reason: 'not-exposed'
        }
      })
    await service.observe({
      item: ephemeral('first'),
      attempts: [attempt().attempt],
      at
    })
    const result = await service.observe({
      item: ephemeral('second'),
      attempts: [attempt().attempt],
      at,
      evidenceFor: () => ({
        structuralOverlap: true,
        visualAgreement: false,
        materialFactDelta: false,
        publishedTimeDelta: false,
        sourceLink: false
      })
    })
    expect(result.durableEligible).toBe(false)
  })

  it('cancels active embedding work when disabled', async () => {
    const service = new SimilarityService()
    const embed = vi.fn(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        })
    )
    const running = service.observe({
      item: content('first'),
      attempts: [attempt(embed).attempt],
      at
    })
    await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce())
    service.disable()
    await expect(running).resolves.toMatchObject({
      embeddingState: 'cancelled'
    })
    expect(service.snapshot()).toMatchObject({
      enabled: false,
      relations: 0,
      suppressions: 0,
      index: { state: 'disabled', itemCount: 0 }
    })
  })
})

describe('similarity rebuild session', () => {
  it('resumes at a compatible checkpoint and rejects a different model space', async () => {
    let tick = 0
    const clock = () => `2026-07-31T12:00:0${tick++}.000Z`
    const first = new SimilarityRebuildSession({
      generation: 3,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      at
    })
    const firstRun = await first.run({
      items: [0, 1, 2],
      batchSize: 1,
      at: clock,
      process: async item => {
        if (item === 0) {
          first.cancel()
        }
      }
    })
    expect(firstRun).toMatchObject({
      state: 'cancelled',
      checkpoint: { cursor: 1 }
    })
    const resumed = new SimilarityRebuildSession({
      generation: 3,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      at,
      checkpoint: firstRun.checkpoint
    })
    const process = vi.fn(
      async (_item: number, _signal: AbortSignal) => undefined
    )
    await expect(
      resumed.run({ items: [0, 1, 2], batchSize: 1, at: clock, process })
    ).resolves.toMatchObject({ state: 'completed', checkpoint: { cursor: 3 } })
    expect(process.mock.calls.map(([item]) => item)).toEqual([1, 2])
    expect(
      () =>
        new SimilarityRebuildSession({
          generation: 3,
          evidenceVersion: 'evidence-v1',
          representationVersionSpace: 'space-v2',
          at,
          checkpoint: firstRun.checkpoint
        })
    ).toThrow('Similarity rebuild checkpoint version mismatch')
  })
})
