import { describe, expect, it, vi } from 'vitest'

import { queryContentGraph } from '@/application/content-graph/query'
import { GraphRebuildSession } from '@/application/content-graph/rebuild'
import { LocalContentGraph } from '@/application/content-graph/service'
import type { GraphEdge, GraphNode } from '@/core/graph/contracts'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-30T12:00:00.000Z'

function node(id: string): GraphNode {
  return {
    id,
    kind: 'content',
    namespace: 'youtube',
    stable: true,
    schemaVersion: 1,
    observedAt: at,
    validUntil: later
  }
}

function edge(
  id: string,
  from: string,
  to: string,
  overrides: Partial<GraphEdge> = {}
): GraphEdge {
  return {
    id,
    from,
    to,
    type: 'similar-to',
    evidenceKind: 'inferred',
    evidenceCodes: ['embedding-similarity'],
    confidence: 0.91,
    generatorVersion: 'graph-v1',
    advisoryOnly: false,
    createdAt: at,
    validUntil: later,
    ...overrides
  }
}

function graph() {
  return new LocalContentGraph({
    evidenceVersion: 'evidence-v1',
    representationVersionSpace: 'space-v1',
    at
  })
}

describe('local content graph', () => {
  it('stores valid edges atomically and rejects missing nodes', () => {
    const subject = graph()
    expect(subject.upsertNodes([node('one'), node('two')], at)).toEqual({
      state: 'stored',
      count: 2
    })
    expect(subject.upsertEdge(edge('missing', 'one', 'three'), at)).toEqual({
      state: 'missing-node'
    })
    expect(subject.upsertEdge(edge('valid', 'one', 'two'), at)).toEqual({
      state: 'stored'
    })
    expect(subject.snapshot().manifest).toMatchObject({
      nodeCount: 2,
      edgeCount: 1
    })
  })

  it('detects provenance cycles and leaves the conflicting edge out', () => {
    const subject = graph()
    subject.upsertNodes([node('one'), node('two'), node('three')], at)
    const provenance = {
      type: 'candidate-derived-from' as const,
      evidenceCodes: ['observed-link']
    }
    subject.upsertEdge(edge('one-two', 'one', 'two', provenance), at)
    subject.upsertEdge(edge('two-three', 'two', 'three', provenance), at)

    expect(
      subject.upsertEdge(edge('three-one', 'three', 'one', provenance), at)
    ).toEqual({ state: 'conflict', code: 'provenance-cycle' })
    expect(subject.activeEdges(at)).toHaveLength(2)
    expect(subject.snapshot().conflicts).toBe(1)
  })

  it('suppresses only the exact edge generator and hides rebuilding generations', () => {
    const subject = graph()
    subject.upsertNodes([node('one'), node('two')], at)
    subject.upsertEdge(edge('relation', 'one', 'two'), at)

    expect(subject.suppressEdge('relation', 'graph-v2')).toEqual({
      state: 'missing'
    })
    expect(subject.activeEdges(at)).toHaveLength(1)
    expect(subject.suppressEdge('relation', 'graph-v1')).toEqual({
      state: 'suppressed'
    })
    expect(subject.activeEdges(at)).toEqual([])

    subject.markRebuilding('graph-rebuild-required', at)
    expect(subject.activeEdges(at)).toEqual([])
  })

  it('replaces a generation atomically after a complete candidate graph', () => {
    const active = graph()
    active.upsertNodes([node('old-one'), node('old-two')], at)
    active.upsertEdge(edge('old', 'old-one', 'old-two'), at)
    const candidate = graph()
    candidate.upsertNodes([node('new-one'), node('new-two')], at)
    candidate.upsertEdge(edge('new', 'new-one', 'new-two'), at)

    expect(
      active.replaceGeneration({ graph: candidate, generation: 2, at })
    ).toEqual({ state: 'replaced' })
    expect(active.activeNodes().map(item => item.id)).toEqual([
      'new-one',
      'new-two'
    ])
    expect(active.snapshot().manifest).toMatchObject({
      generation: 2,
      nodeCount: 2,
      edgeCount: 1
    })
  })
})

describe('content graph query', () => {
  it('caps traversal depth, fan-out and returned edges', () => {
    const nodes = Array.from({ length: 110 }, (_, index) =>
      node(`node:${index}`)
    )
    const edges = nodes
      .slice(1)
      .map((item, index) => edge(`edge:${index}`, 'node:0', item.id))

    const result = queryContentGraph({
      startNodeId: 'node:0',
      nodes,
      edges,
      depth: 99,
      fanOut: 99,
      maximumEdges: 10
    })

    expect(result.edges).toHaveLength(10)
    expect(result.nodes).toHaveLength(11)
    expect(result.depthReached).toBe(1)
    expect(result.truncated).toBe(true)
  })
})

describe('graph rebuild session', () => {
  it('persists a cancellation checkpoint and resumes with matching versions', async () => {
    let tick = 0
    const clock = () => `2026-07-31T12:00:0${tick++}.000Z`
    const first = new GraphRebuildSession({
      generation: 2,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      at
    })
    const processed: number[] = []
    const outcome = await first.run({
      items: [0, 1, 2, 3],
      batchSize: 2,
      at: clock,
      process: async item => {
        processed.push(item)
        if (item === 1) {
          first.cancel()
        }
      }
    })
    expect(outcome).toMatchObject({
      state: 'cancelled',
      checkpoint: { cursor: 2, processedCount: 2 }
    })

    const resumed = new GraphRebuildSession({
      generation: 2,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      at,
      checkpoint: outcome.checkpoint
    })
    const process = vi.fn(
      async (_item: number, _signal: AbortSignal) => undefined
    )
    await expect(
      resumed.run({ items: [0, 1, 2, 3], batchSize: 2, at: clock, process })
    ).resolves.toMatchObject({
      state: 'completed',
      checkpoint: { cursor: 4, processedCount: 4 }
    })
    expect(process.mock.calls.map(([item]) => item)).toEqual([2, 3])
  })

  it('rejects checkpoints from another graph version space', () => {
    const first = new GraphRebuildSession({
      generation: 2,
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      at
    })
    expect(
      () =>
        new GraphRebuildSession({
          generation: 2,
          evidenceVersion: 'evidence-v1',
          representationVersionSpace: 'space-v2',
          at,
          checkpoint: first.snapshot()
        })
    ).toThrow('Graph rebuild checkpoint version mismatch')
  })
})
