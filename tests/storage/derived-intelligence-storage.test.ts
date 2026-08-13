import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { GraphDerivedState } from '@/storage/indexed-db/graph-store'
import type { SimilarityDerivedState } from '@/storage/indexed-db/similarity-store'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-30T12:00:00.000Z'

function profile(): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 0 },
    profileId: 'profile:local',
    revision: 1,
    createdAt: at,
    updatedAt: at,
    rules: [
      {
        id: 'rule:one',
        enabled: true,
        scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
        createdAt: at,
        updatedAt: at,
        kind: 'exact',
        effect: 'block',
        field: 'title',
        value: 'Noise',
        caseSensitive: false
      }
    ],
    feedbackExamples: [
      {
        id: 'feedback:one',
        contentId: 'youtube:one',
        action: 'correct-classification',
        correction: { desiredAction: 'show' },
        createdAt: at
      }
    ],
    settings: {},
    extensions: {}
  }
}

function similarityState(): SimilarityDerivedState {
  const manifest = {
    modelProviderId: 'provider:local',
    modelId: 'embedding:model',
    modality: 'text' as const,
    dimension: 3,
    preprocessingVersion: 'text-v1',
    normalization: 'l2' as const,
    versionSpace: 'space-v1'
  }
  return {
    vectors: [
      {
        id: 'vector:one',
        contentId: 'youtube:one',
        platform: 'youtube',
        surface: 'youtube:home',
        language: 'en',
        stableIdentity: true,
        exactFingerprint: 'a'.repeat(64),
        manifest,
        vector: [1, 0, 0],
        observedAt: at,
        expiresAt: later,
        byteLength: 12
      }
    ],
    relations: [
      {
        relationId: 'relation:one',
        leftContentId: 'youtube:one',
        rightContentId: 'youtube:two',
        type: 'near-duplicate',
        score: 0.98,
        confidence: 0.98,
        threshold: 0.96,
        evidenceCodes: ['text-vector', 'structural-overlap'],
        evidenceVersion: 'evidence-v1',
        representation: manifest,
        relationPolicyVersion: 'policy-v1',
        advisoryOnly: false,
        createdAt: at,
        validUntil: later
      }
    ],
    suppressions: [],
    clusters: [],
    batchActions: [],
    runtime: {
      schemaVersion: 1,
      state: 'ready',
      activeVersionSpace: 'space-v1',
      itemCount: 1,
      byteLength: 12,
      lastErrorCode: null,
      updatedAt: at
    },
    checkpoint: null
  }
}

function graphState(): GraphDerivedState {
  const nodes = ['one', 'two'].map(id => ({
    id: `youtube:${id}`,
    kind: 'content' as const,
    namespace: 'youtube',
    stable: true,
    schemaVersion: 1 as const,
    observedAt: at,
    validUntil: later
  }))
  return {
    nodes,
    edges: [
      {
        id: 'edge:one',
        from: 'youtube:one',
        to: 'youtube:two',
        type: 'near-duplicate',
        evidenceKind: 'inferred',
        evidenceCodes: ['structural-overlap'],
        confidence: 0.98,
        generatorVersion: 'graph-v1',
        advisoryOnly: false,
        createdAt: at,
        validUntil: later
      }
    ],
    manifest: {
      schemaVersion: 1,
      generation: 1,
      state: 'ready',
      evidenceVersion: 'evidence-v1',
      representationVersionSpace: 'space-v1',
      nodeCount: 2,
      edgeCount: 1,
      updatedAt: at,
      lastErrorCode: null
    },
    checkpoint: null
  }
}

describe('derived similarity and graph storage', () => {
  it('round-trips local generations while portable export excludes them', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-derived-roundtrip'
    })
    await database.saveProfile(profile())

    await expect(
      database.replaceSimilarityDerivedState(similarityState())
    ).resolves.toEqual({ state: 'replaced' })
    await expect(
      database.replaceGraphDerivedState(graphState())
    ).resolves.toEqual({ state: 'replaced' })
    await expect(database.readSimilarityDerivedState()).resolves.toEqual({
      state: 'ready',
      data: similarityState()
    })
    await expect(database.readGraphDerivedState()).resolves.toEqual({
      state: 'ready',
      data: graphState()
    })

    const exported = await database.exportProfile()
    expect(exported).toEqual(profile())
    const portable = JSON.stringify(exported)
    expect(portable).not.toContain('vector:one')
    expect(portable).not.toContain('edge:one')
    expect(portable).not.toContain('space-v1')
  })

  it('rejects an inconsistent replacement without overwriting active data', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-derived-invalid'
    })
    const valid = similarityState()
    await database.replaceSimilarityDerivedState(valid)

    await expect(
      database.replaceSimilarityDerivedState({
        ...valid,
        runtime: { ...valid.runtime, itemCount: 2 }
      })
    ).resolves.toEqual({ state: 'invalid' })
    await expect(database.readSimilarityDerivedState()).resolves.toEqual({
      state: 'ready',
      data: valid
    })
  })

  it('clears derived stores without changing profile, rules or feedback', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-derived-clear'
    })
    const expectedProfile = profile()
    await database.saveProfile(expectedProfile)
    await database.replaceSimilarityDerivedState(similarityState())
    await database.replaceGraphDerivedState(graphState())

    await expect(
      database.clear('derived-intelligence', { at })
    ).resolves.toEqual({ state: 'cleared' })
    await expect(database.readSimilarityDerivedState()).resolves.toEqual({
      state: 'missing'
    })
    await expect(database.readGraphDerivedState()).resolves.toEqual({
      state: 'missing'
    })
    await expect(database.exportProfile()).resolves.toEqual(expectedProfile)
    await expect(database.counts()).resolves.toMatchObject({
      profile: 1,
      rules: 1,
      feedback: 1,
      similarityVectors: 0,
      similarityRelations: 0,
      graphNodes: 0,
      graphEdges: 0
    })
  })
})
