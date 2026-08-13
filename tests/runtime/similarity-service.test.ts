import { describe, expect, it, vi } from 'vitest'

import type {
  EmbeddingAttempt,
  EmbeddingPort
} from '@/ai/similarity/embedding-provider'
import { SimilarityService } from '@/application/similarity/service'
import type { ContentItem } from '@/core/content/contracts'
import type { RepresentationManifest } from '@/core/similarity/contracts'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-07-31T13:00:00.000Z'
const manifest: RepresentationManifest = {
  modelProviderId: 'provider:local',
  modelId: 'embedding:model',
  modality: 'text',
  dimension: 3,
  preprocessingVersion: 'text-v1',
  normalization: 'l2',
  versionSpace: 'provider:local:space'
}

function item(
  id: string,
  title: string,
  overrides: Partial<ContentItem> = {}
): ContentItem {
  return {
    id: `youtube:${id}`,
    platform: 'youtube',
    identity: { status: 'stable', platformContentId: id },
    surface: 'youtube:home',
    title,
    body: `Body ${id}`,
    media: [],
    observedAt: at,
    language: 'en',
    context: {},
    ...overrides
  }
}

function attempt(vector = [1, 0, 0]): EmbeddingAttempt {
  const port: EmbeddingPort = {
    execution: 'local',
    model: { providerConfigId: 'provider:local', modelId: 'embedding:model' },
    manifest,
    embed: vi.fn(async () => ({ vector, manifest }))
  }
  return { port, accepted: true, consented: true, budgetAvailable: true }
}

describe('similarity service', () => {
  it('creates, clusters, suppresses and expires exact duplicate relations', async () => {
    const service = new SimilarityService()
    const first = item('exact-one', 'Same', { body: 'Same body' })
    const second = item('exact-two', 'Same', { body: 'Same body' })
    await expect(
      service.observe({ item: first, attempts: [], at })
    ).resolves.toMatchObject({
      embeddingState: 'route-unavailable',
      durableEligible: true
    })
    const observed = await service.observe({ item: second, attempts: [], at })
    expect(observed).toMatchObject({
      embeddingState: 'not-needed',
      durableEligible: true
    })
    expect(observed.relations).toHaveLength(1)
    const relation = observed.relations[0]
    if (!relation) throw new Error('Expected one exact relation')
    expect(relation.type).toBe('exact-duplicate')
    await expect(service.clusters({ at })).resolves.toHaveLength(1)
    await expect(
      service.suppress({ relationId: 'missing', reason: 'false-grouping', at })
    ).resolves.toEqual({ state: 'missing' })
    await expect(
      service.suppress({
        relationId: relation.relationId,
        reason: 'false-grouping',
        at
      })
    ).resolves.toMatchObject({ state: 'suppressed' })
    expect(service.activeRelations(at)).toEqual([])
    expect(service.activeRelations('2026-09-01T12:00:00.000Z')).toEqual([])
  })

  it('builds a probabilistic relation, derived state and protected cluster', async () => {
    const service = new SimilarityService()
    const first = item('vector-one', 'Alpha')
    const second = item('vector-two', 'Beta', {
      context: { sponsored: true },
      publishedAt: later
    })
    await expect(
      service.observe({ item: first, attempts: [attempt()], at })
    ).resolves.toMatchObject({ embeddingState: 'embedded', relations: [] })
    const observed = await service.observe({
      item: second,
      attempts: [attempt()],
      at: later,
      evidenceFor: vi.fn(async () => ({
        structuralOverlap: true,
        visualAgreement: false,
        materialFactDelta: false,
        publishedTimeDelta: true,
        sourceLink: true
      }))
    })
    expect(observed.relations).toHaveLength(1)
    expect(observed.relations[0]).toMatchObject({
      type: 'near-duplicate',
      advisoryOnly: false
    })
    const clusters = await service.clusters({
      at: later,
      protectedContentIds: new Set([first.id])
    })
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentId: first.id, protected: true }),
        expect.objectContaining({ contentId: second.id, sponsored: true })
      ])
    )
    const derived = await service.derivedState({
      at: later,
      protectedContentIds: new Set([first.id])
    })
    expect(derived).toMatchObject({
      runtime: { state: 'ready', itemCount: 2 },
      relations: [expect.objectContaining({ type: 'near-duplicate' })],
      checkpoint: null
    })
    expect(derived.clusters).toHaveLength(1)
  })

  it('restores valid derived data and quarantines each corrupt category', async () => {
    const source = new SimilarityService()
    const first = item('restore-one', 'One')
    const second = item('restore-two', 'Two')
    await source.observe({ item: first, attempts: [attempt()], at })
    await source.observe({
      item: second,
      attempts: [attempt()],
      at: later,
      evidenceFor: () => ({
        structuralOverlap: true,
        visualAgreement: false,
        materialFactDelta: false,
        publishedTimeDelta: false,
        sourceLink: false
      })
    })
    const derived = await source.derivedState({ at: later })

    const restored = new SimilarityService()
    restored.loadObservations([first, second])
    await expect(
      restored.restoreDerived({
        vectors: derived.vectors,
        relations: derived.relations,
        suppressions: derived.suppressions,
        at: later
      })
    ).resolves.toEqual({ state: 'restored' })
    expect(restored.snapshot()).toMatchObject({
      observations: 2,
      relations: 1
    })

    const sourceVector = derived.vectors[0]
    const sourceRelation = derived.relations[0]
    if (!sourceVector || !sourceRelation) {
      throw new Error('Expected derived vector and relation fixtures')
    }
    const corruptVector = structuredClone(sourceVector)
    corruptVector.vector = []
    await expect(
      restored.restoreDerived({
        vectors: [corruptVector],
        relations: [],
        suppressions: [],
        at: later
      })
    ).resolves.toEqual({ state: 'corrupt' })

    const corruptRelation = { ...sourceRelation, score: 2 }
    await expect(
      restored.restoreDerived({
        vectors: [],
        relations: [corruptRelation],
        suppressions: [],
        at: later
      })
    ).resolves.toEqual({ state: 'corrupt' })

    await expect(
      restored.restoreDerived({
        vectors: [],
        relations: [],
        suppressions: [{ id: 'bad' } as never],
        at: later
      })
    ).resolves.toEqual({ state: 'corrupt' })
  })

  it('disables active work, blocks observations and resets to exact-only', async () => {
    const service = new SimilarityService()
    service.disable()
    await expect(
      service.observe({
        item: item('disabled', 'Disabled'),
        attempts: [attempt()],
        at
      })
    ).resolves.toEqual({
      exactEvaluated: true,
      embeddingState: 'route-unavailable',
      relations: [],
      durableEligible: false
    })
    await expect(service.derivedState({ at })).resolves.toMatchObject({
      runtime: { state: 'disabled' }
    })
    service.reset()
    expect(service.snapshot()).toMatchObject({
      enabled: true,
      observations: 0,
      relations: 0,
      suppressions: 0,
      index: { state: 'ready' }
    })
  })
})
