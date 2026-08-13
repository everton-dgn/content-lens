import { describe, expect, it } from 'vitest'

import {
  graphEdgeSchema,
  graphManifestSchema,
  graphNodeSchema,
  graphRebuildCheckpointSchema
} from '@/core/graph/contracts'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-01T12:00:00.000Z'

describe('content graph contracts', () => {
  it('validates bounded typed nodes, manifests and restart checkpoints', () => {
    expect(
      graphNodeSchema.safeParse({
        id: 'youtube:content:one',
        kind: 'content',
        namespace: 'youtube',
        stable: true,
        schemaVersion: 1,
        observedAt: at,
        validUntil: later
      }).success
    ).toBe(true)
    expect(
      graphManifestSchema.safeParse({
        schemaVersion: 1,
        generation: 2,
        state: 'rebuilding',
        evidenceVersion: 'graph-evidence-v1',
        representationVersionSpace: 'embedding-space-v1',
        nodeCount: 10,
        edgeCount: 20,
        updatedAt: at,
        lastErrorCode: null
      }).success
    ).toBe(true)
    expect(
      graphRebuildCheckpointSchema.safeParse({
        id: 'graph-rebuild:2',
        generation: 2,
        evidenceVersion: 'graph-evidence-v1',
        representationVersionSpace: 'embedding-space-v1',
        cursor: 100,
        processedCount: 100,
        state: 'running',
        updatedAt: at
      }).success
    ).toBe(true)
  })

  it('keeps low-confidence inference advisory and rejects embedding-only provenance claims', () => {
    const edge = {
      id: 'edge:one',
      from: 'content:one',
      to: 'content:two',
      type: 'candidate-primary-source',
      evidenceKind: 'inferred',
      evidenceCodes: ['observed-link', 'published-time'],
      confidence: 0.89,
      generatorVersion: 'graph-v1',
      advisoryOnly: true,
      createdAt: at,
      validUntil: later
    }
    expect(graphEdgeSchema.safeParse(edge).success).toBe(true)
    expect(
      graphEdgeSchema.safeParse({ ...edge, advisoryOnly: false }).success
    ).toBe(false)
    expect(
      graphEdgeSchema.safeParse({
        ...edge,
        type: 'candidate-derived-from',
        evidenceCodes: ['embedding-similarity']
      }).success
    ).toBe(false)
  })
})
