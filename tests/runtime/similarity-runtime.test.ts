import { describe, expect, it, vi } from 'vitest'

import { SimilarityRuntime } from '@/application/similarity/runtime'
import type { ContentItem } from '@/core/content/contracts'
import type { SimilarityDerivedState } from '@/storage/indexed-db/similarity-store'

const at = '2026-07-31T12:00:00.000Z'

const content: ContentItem = {
  id: 'youtube:one',
  platform: 'youtube',
  identity: { status: 'stable', platformContentId: 'one' },
  surface: 'youtube:home',
  title: 'Visible title',
  media: [],
  observedAt: at,
  context: {}
}

describe('similarity runtime', () => {
  it('starts exact-only from local observations without requiring a provider', async () => {
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => [content]),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'missing' as const
      })),
      replaceSimilarityDerivedState,
      clearDerivedIntelligence: vi.fn(async () => ({
        state: 'cleared' as const
      }))
    })

    await expect(runtime.start(at)).resolves.toMatchObject({
      state: 'exact-only',
      persisted: { state: 'replaced' }
    })
    expect(runtime.service().snapshot().observations).toBe(1)
    expect(replaceSimilarityDerivedState).toHaveBeenCalledWith(
      expect.objectContaining({
        vectors: [],
        runtime: expect.objectContaining({ state: 'exact-only' })
      })
    )
  })

  it('quarantines corrupt derived state while keeping reconstructible observations', async () => {
    const clearDerivedIntelligence = vi.fn(async () => ({
      state: 'cleared' as const
    }))
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => [content]),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'corrupt' as const
      })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      })),
      clearDerivedIntelligence
    })

    await expect(runtime.start(at)).resolves.toMatchObject({
      state: 'exact-only',
      code: 'derived-state-corrupt'
    })
    expect(clearDerivedIntelligence).toHaveBeenCalledOnce()
    expect(runtime.service().snapshot().observations).toBe(1)
  })

  it('cancels work and removes all dependent derived state on disable', async () => {
    const clearDerivedIntelligence = vi.fn(async () => ({
      state: 'cleared' as const
    }))
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => []),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'missing' as const
      })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      })),
      clearDerivedIntelligence
    })
    await runtime.start(at)

    await expect(runtime.disable()).resolves.toEqual({ state: 'cleared' })
    expect(runtime.service().snapshot().index.state).toBe('disabled')
    expect(clearDerivedIntelligence).toHaveBeenCalledOnce()
  })

  it('restores a ready derived generation and its batch actions', async () => {
    let stored: SimilarityDerivedState | undefined
    const capture = vi.fn(async (state: SimilarityDerivedState) => {
      stored = structuredClone(state)
      return { state: 'replaced' as const }
    })
    const seed = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => [content]),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'missing' as const
      })),
      replaceSimilarityDerivedState: capture,
      clearDerivedIntelligence: vi.fn(async () => ({
        state: 'cleared' as const
      }))
    })
    await seed.start(at)
    if (!stored) {
      throw new Error('Derived state was not persisted')
    }
    const readyState: SimilarityDerivedState = stored
    readyState.batchActions = [
      {
        id: 'similarity-batch:restore',
        clusterId: 'cluster:restore',
        action: 'hide',
        contentIds: ['youtube:one'],
        preservedContentIds: [],
        policyVersion: 'similarity-batch-policy-v1',
        acceptedAt: at,
        expiresAt: '2026-08-30T12:00:00.000Z'
      }
    ]
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => [content]),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: readyState
      })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      })),
      clearDerivedIntelligence: vi.fn(async () => ({
        state: 'cleared' as const
      }))
    })

    await expect(runtime.start(at)).resolves.toEqual({ state: 'ready' })
    expect(runtime.service().snapshot().observations).toBe(1)
  })

  it('quarantines a ready generation whose derived payload cannot be restored', async () => {
    const clearDerivedIntelligence = vi.fn(async () => ({
      state: 'cleared' as const
    }))
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => [content]),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: {
          vectors: [{ invalid: true }],
          relations: [],
          suppressions: [],
          clusters: [],
          batchActions: [],
          runtime: {
            schemaVersion: 1,
            state: 'exact-only',
            activeVersionSpace: null,
            itemCount: 0,
            byteLength: 0,
            lastErrorCode: null,
            updatedAt: at
          },
          checkpoint: null
        } as unknown as SimilarityDerivedState
      })),
      replaceSimilarityDerivedState,
      clearDerivedIntelligence
    })

    await expect(runtime.start(at)).resolves.toMatchObject({
      state: 'exact-only',
      code: 'derived-state-corrupt'
    })
    expect(clearDerivedIntelligence).toHaveBeenCalledOnce()
    expect(replaceSimilarityDerivedState).toHaveBeenCalledOnce()
  })

  it('persists every new observation with its protected set', async () => {
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const runtime = new SimilarityRuntime({
      readRecentContent: vi.fn(async () => []),
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'missing' as const
      })),
      replaceSimilarityDerivedState,
      clearDerivedIntelligence: vi.fn(async () => ({
        state: 'cleared' as const
      }))
    })
    await runtime.start(at)

    await expect(
      runtime.observe({
        item: content,
        attempts: [],
        at,
        protectedContentIds: new Set([content.id])
      })
    ).resolves.toMatchObject({
      exactEvaluated: true,
      persisted: { state: 'replaced' }
    })
    expect(replaceSimilarityDerivedState).toHaveBeenCalledTimes(2)
  })
})
