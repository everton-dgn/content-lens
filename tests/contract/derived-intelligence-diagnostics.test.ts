import { describe, expect, it } from 'vitest'

import { diagnosticCatalog } from '@/diagnostics/catalog'
import {
  derivedIntelligenceDiagnosticSnapshotSchema,
  diagnosticCodeSchema
} from '@/diagnostics/contracts'

describe('derived intelligence diagnostics', () => {
  it('accepts only bounded aggregate metrics and finite incident codes', () => {
    const snapshot = derivedIntelligenceDiagnosticSnapshotSchema.parse({
      schemaVersion: 1,
      similarity: {
        state: 'ready',
        itemCount: 10_000,
        relationCount: 2_000,
        byteLength: 40_000_000,
        evictionCount: 3,
        abstentionCount: 8,
        queryP95Milliseconds: 12.4,
        insertP95Milliseconds: 3.1,
        versionSpace: 'space-v1'
      },
      graph: {
        state: 'ready',
        nodeCount: 12_000,
        edgeCount: 50_000,
        conflictCount: 2,
        rebuildCount: 1,
        corruptionCount: 0,
        queryP95Milliseconds: 4.8,
        schemaVersion: 1,
        evidenceVersion: 'evidence-v1'
      },
      recordedAt: '2026-07-31T12:00:00.000Z'
    })
    expect(JSON.stringify(snapshot)).not.toMatch(
      /raw|contentId|url|vector|providerConfigId/i
    )
    for (const code of [
      'similarity-index-corrupt',
      'similarity-version-mismatch',
      'graph-conflict',
      'graph-rebuild-required'
    ] as const) {
      expect(diagnosticCodeSchema.parse(code)).toBe(code)
      expect(diagnosticCatalog[code]).toBeDefined()
    }
  })
})
