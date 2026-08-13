import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContentSimilarityRelation } from '@/core/similarity/contracts'
import type { SimilarityDerivedState } from '@/storage/indexed-db/similarity-store'
import type { ReviewPanelCopy } from '@/ui/review/copy'
import { ReviewPanel } from '@/ui/review/ReviewPanel'

vi.mock('@/application/similarity/service', () => ({
  relationFingerprint: vi.fn(
    async () =>
      '6d49ebc0aea0d3828337a0e69450962e3cd68a021e8a44002a854f5892bee6b5'
  )
}))

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-30T12:00:00.000Z'

const copy = new Proxy(
  {
    clustersLabel: (count: number) => `clusters:${count}`,
    graphEdgesLabel: (count: number) => `edges:${count}`,
    graphNodesLabel: (count: number) => `nodes:${count}`,
    hideSimilarDescription: (
      count: number,
      updates: number,
      protectedCount: number
    ) => `scope:${count}:${updates}:${protectedCount}`,
    relationLabel: (type: string) => `relation:${type}`,
    relationsLabel: (count: number) => `relations:${count}`,
    scoreLabel: (score: number) => `score:${score}`
  },
  {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : String(key)
  }
) as ReviewPanelCopy

const relation: ContentSimilarityRelation = {
  relationId: 'relation:one',
  leftContentId: 'youtube:representative',
  rightContentId: 'youtube:eligible',
  type: 'near-duplicate',
  score: 0.98,
  confidence: 0.98,
  threshold: 0.96,
  evidenceCodes: ['text-vector', 'structural-overlap'],
  evidenceVersion: 'evidence-v1',
  representation: {
    modelProviderId: 'provider:local',
    modelId: 'embedding:model',
    modality: 'text',
    dimension: 3,
    preprocessingVersion: 'text-v1',
    normalization: 'l2',
    versionSpace: 'space-v1'
  },
  relationPolicyVersion: 'policy-v1',
  advisoryOnly: false,
  createdAt: at,
  validUntil: later
}

const member = (
  contentId: string,
  overrides: Partial<
    SimilarityDerivedState['clusters'][number]['members'][number]
  > = {}
) => ({
  contentId,
  platform: 'youtube' as const,
  stableIdentity: true,
  sponsored: false,
  sourceEvidence: false,
  publishedAt: at,
  portableOrderId: contentId,
  relationType: 'near-duplicate' as const,
  protected: false,
  update: false,
  ...overrides
})

function similarity(): SimilarityDerivedState {
  return {
    vectors: [],
    relations: [relation],
    suppressions: [],
    clusters: [
      {
        clusterId: 'cluster:one',
        representativeContentId: 'youtube:representative',
        members: [
          member('youtube:representative'),
          member('youtube:eligible'),
          member('youtube:update', {
            relationType: 'story-update',
            update: true
          }),
          member('youtube:protected', { protected: true })
        ],
        evidenceVersion: 'evidence-v1',
        createdAt: at,
        updatedAt: at
      }
    ],
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
  }
}

const graph = {
  state: 'ready' as const,
  data: {
    nodes: [],
    edges: [],
    manifest: {
      schemaVersion: 1 as const,
      generation: 1,
      state: 'ready' as const,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: null,
      nodeCount: 0,
      edgeCount: 0,
      updatedAt: at,
      lastErrorCode: null
    },
    checkpoint: null
  }
}

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

async function mount(database: Parameters<typeof ReviewPanel>[0]['database']) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => {
    root.render(<ReviewPanel copy={copy} database={database} />)
  })
  await act(async () => {
    await vi.waitFor(
      () => {
        if (container.textContent?.includes('loadingTitle')) {
          throw new Error('Review is still loading')
        }
      },
      { timeout: 5_000 }
    )
  })
  return container
}

function button(container: HTMLElement, label: string) {
  const target = [...container.querySelectorAll('button')].find(
    candidate => candidate.textContent === label
  )
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return target
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => view.root.unmount())
      view.container.remove()
    }
  }
})

describe('similarity review', () => {
  it('reviews batch scope and preserves representative, update and protected items', async () => {
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: similarity()
      })),
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState
    })

    expect(container.textContent).toContain('relation:near-duplicate')
    expect(container.textContent).toContain('text-vector')
    await click(button(container, 'hideSimilarAction'))
    expect(container.textContent).toContain('scope:4:1:1')
    await click(button(container, 'hideSimilarConfirmAction'))
    await vi.waitFor(() =>
      expect(replaceSimilarityDerivedState).toHaveBeenCalledOnce()
    )

    expect(replaceSimilarityDerivedState).toHaveBeenCalledWith(
      expect.objectContaining({
        batchActions: [
          expect.objectContaining({
            clusterId: 'cluster:one',
            contentIds: ['youtube:eligible'],
            preservedContentIds: [
              'youtube:representative',
              'youtube:update',
              'youtube:protected'
            ]
          })
        ]
      })
    )
  })

  it('stores one versioned suppression after explicit confirmation', async () => {
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const readSimilarityDerivedState = vi.fn(async () => ({
      state: 'ready' as const,
      data: similarity()
    }))
    const container = await mount({
      readSimilarityDerivedState,
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState
    })

    await click(button(container, 'separateAction'))
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement?.textContent).toBe('cancelAction')
    await click(button(container, 'separateConfirmAction'))
    await vi.waitFor(() =>
      expect(replaceSimilarityDerivedState).toHaveBeenCalledOnce()
    )

    expect(replaceSimilarityDerivedState).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: [relation],
        suppressions: [
          expect.objectContaining({
            evidenceVersion: 'evidence-v1',
            reason: 'false-grouping'
          })
        ]
      })
    )
  })

  it('shows a safe empty state when no derived generation exists', async () => {
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'missing' as const
      })),
      readGraphDerivedState: vi.fn(async () => ({ state: 'missing' as const })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      }))
    })
    expect(container.textContent).toContain('emptyTitle')
  })

  it('filters version-matched suppressions and shows an empty state', async () => {
    const fingerprint =
      '6d49ebc0aea0d3828337a0e69450962e3cd68a021e8a44002a854f5892bee6b5'
    const data = similarity()
    data.clusters = []
    data.suppressions = [
      {
        id: `suppression:${fingerprint}:evidence-v1`,
        relationFingerprint: fingerprint,
        evidenceVersion: 'evidence-v1',
        reason: 'false-grouping',
        createdAt: at
      }
    ]
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data
      })),
      readGraphDerivedState: vi.fn(async () => ({ state: 'missing' as const })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      }))
    })

    expect(container.textContent).toContain('emptyTitle')
  })

  it('renders standalone relations when graph generation is missing', async () => {
    const data = similarity()
    data.clusters = []
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data
      })),
      readGraphDerivedState: vi.fn(async () => ({ state: 'missing' as const })),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      }))
    })

    expect(container.textContent).toContain('nodes:0')
    expect(container.textContent).toContain('edges:0')
    expect(container.textContent).toContain('relation:near-duplicate')
  })

  it('recovers from a corrupt generation when the user retries', async () => {
    const readSimilarityDerivedState = vi
      .fn()
      .mockResolvedValueOnce({ state: 'corrupt' as const })
      .mockResolvedValue({ state: 'ready' as const, data: similarity() })
    const container = await mount({
      readSimilarityDerivedState,
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      }))
    })

    expect(container.textContent).toContain('errorTitle')
    await click(button(container, 'title'))
    await vi.waitFor(() =>
      expect(container.textContent).toContain('relation:near-duplicate')
    )
    expect(readSimilarityDerivedState).toHaveBeenCalledTimes(2)
  })

  it('shows an error when loading rejects', async () => {
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => {
        throw new Error('storage unavailable')
      }),
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'replaced' as const
      }))
    })

    expect(container.textContent).toContain('errorTitle')
  })

  it('closes a separation review without storing a suppression', async () => {
    const replaceSimilarityDerivedState = vi.fn(async () => ({
      state: 'replaced' as const
    }))
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: similarity()
      })),
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState
    })

    await click(button(container, 'separateAction'))
    await click(button(container, 'cancelAction'))

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(replaceSimilarityDerivedState).not.toHaveBeenCalled()
  })

  it('fails closed when a separation cannot be persisted', async () => {
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: similarity()
      })),
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'invalid' as const
      }))
    })

    await click(button(container, 'separateAction'))
    await click(button(container, 'separateConfirmAction'))
    await vi.waitFor(() =>
      expect(container.textContent).toContain('errorTitle')
    )
  })

  it('fails closed when a batch hide cannot be persisted', async () => {
    const container = await mount({
      readSimilarityDerivedState: vi.fn(async () => ({
        state: 'ready' as const,
        data: similarity()
      })),
      readGraphDerivedState: vi.fn(async () => graph),
      replaceSimilarityDerivedState: vi.fn(async () => ({
        state: 'invalid' as const
      }))
    })

    await click(button(container, 'hideSimilarAction'))
    await click(button(container, 'hideSimilarConfirmAction'))
    await vi.waitFor(() =>
      expect(container.textContent).toContain('errorTitle')
    )
  })
})
