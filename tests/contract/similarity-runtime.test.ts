import { describe, expect, it, vi } from 'vitest'

import {
  chooseClusterRepresentative,
  clusterReviewSummary,
  createSimilarityCluster
} from '@/ai/similarity/cluster'
import {
  type EmbeddingPort,
  embeddingRoutePlatform,
  executeEmbeddingRoute
} from '@/ai/similarity/embedding-provider'
import { BoundedSimilarityIndex } from '@/ai/similarity/index'
import {
  classifySimilarityRelation,
  representationSpacesCompatible
} from '@/ai/similarity/relations'
import type { ContentItem } from '@/core/content/contracts'
import type {
  RepresentationManifest,
  SimilarityClusterMember
} from '@/core/similarity/contracts'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-30T12:00:00.000Z'

const manifest: RepresentationManifest = {
  modelProviderId: 'provider:browser',
  modelId: 'embedding:model',
  modality: 'text',
  dimension: 3,
  preprocessingVersion: 'text-v1',
  normalization: 'l2',
  versionSpace: 'provider:browser:space'
}

const content: ContentItem = {
  id: 'youtube:one',
  platform: 'youtube',
  identity: { status: 'stable', platformContentId: 'one' },
  canonicalUrl: 'https://www.youtube.com/watch?v=one&secret=ignored',
  surface: 'youtube:search',
  title: 'Visible title',
  body: 'Visible body',
  media: [],
  observedAt: at,
  language: 'en',
  context: { privateContext: 'never sent' }
}

function port(input: {
  execution: EmbeddingPort['execution']
  embed: EmbeddingPort['embed']
  providerConfigId?: string
}): EmbeddingPort {
  return {
    execution: input.execution,
    model: {
      providerConfigId: input.providerConfigId ?? `provider:${input.execution}`,
      modelId: 'embedding:model'
    },
    manifest: {
      ...manifest,
      modelProviderId: input.providerConfigId ?? `provider:${input.execution}`,
      versionSpace: `${input.providerConfigId ?? input.execution}:space`
    },
    embed: input.embed
  }
}

describe('similarity execution', () => {
  it('uses only accepted routes, requires cloud consent and sends minimized text', async () => {
    const cloudEmbed = vi.fn(async () => ({ vector: [1, 0, 0], manifest }))
    const browserPort = port({
      execution: 'browser',
      providerConfigId: 'provider:browser',
      embed: vi.fn(async () => ({ vector: [3, 4, 0], manifest }))
    })

    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [
          {
            port: port({ execution: 'cloud', embed: cloudEmbed }),
            accepted: true,
            consented: false,
            budgetAvailable: true
          },
          {
            port: browserPort,
            accepted: true,
            consented: true,
            budgetAvailable: true
          }
        ]
      })
    ).resolves.toMatchObject({
      state: 'embedded',
      vector: [0.6, 0.8, 0],
      execution: 'browser'
    })
    expect(cloudEmbed).not.toHaveBeenCalled()
    expect(browserPort.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Visible title\n\nVisible body',
        language: 'en'
      })
    )
    expect(
      JSON.stringify(vi.mocked(browserPort.embed).mock.calls)
    ).not.toContain('privateContext')
  })

  it('falls back from a failed cloud route only to an already accepted local route', async () => {
    const secondCloud = vi.fn(async () => ({ vector: [1, 0, 0], manifest }))
    const localManifest = {
      ...manifest,
      modelProviderId: 'provider:local',
      versionSpace: 'provider:local:space'
    }
    const localPort = port({
      execution: 'local',
      providerConfigId: 'provider:local',
      embed: vi.fn(async () => ({
        vector: [1, 0, 0],
        manifest: localManifest
      }))
    })

    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [
          {
            port: port({
              execution: 'cloud',
              embed: async () => {
                throw new Error('temporary')
              }
            }),
            accepted: true,
            consented: true,
            budgetAvailable: true
          },
          {
            port: port({ execution: 'cloud', embed: secondCloud }),
            accepted: true,
            consented: true,
            budgetAvailable: true
          },
          {
            port: localPort,
            accepted: true,
            consented: true,
            budgetAvailable: true
          }
        ]
      })
    ).resolves.toMatchObject({ state: 'embedded', execution: 'local' })
    expect(secondCloud).not.toHaveBeenCalled()
  })

  it('distinguishes route, size, cancellation and provider failures', async () => {
    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [],
        maximumInputBytes: 1
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'input-too-large' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [],
        signal: aborted.signal
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'cancelled' })
    const skipped = port({ execution: 'local', embed: vi.fn() })
    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [
          {
            port: skipped,
            accepted: false,
            consented: true,
            budgetAvailable: true
          },
          {
            port: skipped,
            accepted: true,
            consented: true,
            budgetAvailable: false
          }
        ]
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'route-unavailable' })
    expect(skipped.embed).not.toHaveBeenCalled()

    const invalid = port({
      execution: 'local',
      embed: vi.fn(async () => ({
        vector: [0, 0, 0],
        manifest: {
          ...manifest,
          modelProviderId: 'provider:local',
          versionSpace: 'provider:local:space'
        }
      })),
      providerConfigId: 'provider:local'
    })
    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [
          {
            port: invalid,
            accepted: true,
            consented: true,
            budgetAvailable: true
          }
        ]
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'provider-failed' })
    expect(embeddingRoutePlatform(content)).toBe('youtube')
  })

  it('rejects malformed, mismatched and wrong-sized provider outputs before a valid fallback', async () => {
    const localManifest = {
      ...manifest,
      modelProviderId: 'provider:local',
      versionSpace: 'provider:local:space'
    }
    const outputs: unknown[] = [
      { nope: true },
      {
        vector: [1, 0, 0],
        manifest: { ...localManifest, versionSpace: 'other' }
      },
      { vector: [1, 0], manifest: localManifest }
    ]
    const attempts = outputs.map(output => ({
      port: port({
        execution: 'local',
        providerConfigId: 'provider:local',
        embed: vi.fn(async () => output)
      }),
      accepted: true,
      consented: true,
      budgetAvailable: true
    }))
    const validManifest = { ...localManifest, normalization: 'none' as const }
    attempts.push({
      port: {
        ...port({
          execution: 'local',
          providerConfigId: 'provider:local',
          embed: vi.fn(async () => ({
            vector: [3, 4, 0],
            manifest: validManifest
          }))
        }),
        manifest: validManifest
      },
      accepted: true,
      consented: true,
      budgetAvailable: true
    })
    await expect(
      executeEmbeddingRoute({
        item: { ...content, language: undefined },
        attempts
      })
    ).resolves.toMatchObject({
      state: 'embedded',
      vector: [3, 4, 0],
      execution: 'local'
    })
  })

  it('returns cancellation when a failing provider observes an aborted signal', async () => {
    const controller = new AbortController()
    const cancelling = port({
      execution: 'local',
      embed: vi.fn(async () => {
        controller.abort()
        throw new Error('cancelled')
      })
    })
    await expect(
      executeEmbeddingRoute({
        item: content,
        attempts: [
          {
            port: cancelling,
            accepted: true,
            consented: true,
            budgetAvailable: true
          }
        ],
        signal: controller.signal
      })
    ).resolves.toEqual({ state: 'unavailable', code: 'cancelled' })
  })

  it('queries only compatible version spaces and evicts expired and least-recent records', () => {
    const index = new BoundedSimilarityIndex({
      maximumItems: 2,
      maximumBytes: 24
    })
    const record = (id: string, versionSpace: string, expiresAt = later) => ({
      id: `vector:${id}`,
      contentId: `content:${id}`,
      platform: 'youtube' as const,
      surface: 'youtube:search' as const,
      language: 'en',
      stableIdentity: true,
      exactFingerprint: 'a'.repeat(64),
      manifest: { ...manifest, versionSpace },
      vector: [1, 0, 0],
      observedAt: at,
      expiresAt,
      byteLength: 12
    })
    expect(index.insert(record('expired', 'space:a', at), at)).toEqual({
      state: 'stored'
    })
    index.insert(record('one', 'space:a'), at)
    index.insert(record('two', 'space:b'), at)
    const queryAt = '2026-07-31T13:00:00.000Z'
    index.insert(record('three', 'space:a'), queryAt)

    expect(
      index.query({
        vector: [1, 0, 0],
        versionSpace: 'space:a',
        now: queryAt
      })
    ).toMatchObject({
      state: 'ready',
      candidates: [{ contentId: 'content:three', score: 1 }]
    })
    expect(index.snapshot()).toMatchObject({ itemCount: 2, byteLength: 24 })
    index.markCorrupt()
    expect(
      index.query({ vector: [1, 0, 0], versionSpace: 'space:a', now: at })
    ).toEqual({ state: 'unavailable', candidates: [] })
  })

  it('keeps updates, near duplicates and related items as different relation types', async () => {
    const common = {
      leftContentId: 'content:left',
      rightContentId: 'content:right',
      score: 0.97,
      confidence: 0.95,
      representation: manifest,
      evidenceVersion: 'evidence-v1',
      relationPolicyVersion: 'relation-policy-v1',
      createdAt: at,
      validUntil: later
    }
    await expect(
      classifySimilarityRelation({
        ...common,
        evidence: {
          structuralOverlap: true,
          visualAgreement: false,
          materialFactDelta: false,
          publishedTimeDelta: false,
          sourceLink: false
        }
      })
    ).resolves.toMatchObject({
      state: 'related',
      relation: { type: 'near-duplicate', advisoryOnly: false }
    })
    await expect(
      classifySimilarityRelation({
        ...common,
        score: 0.9,
        evidence: {
          structuralOverlap: true,
          visualAgreement: false,
          materialFactDelta: true,
          publishedTimeDelta: true,
          sourceLink: true
        }
      })
    ).resolves.toMatchObject({
      state: 'related',
      relation: { type: 'story-update', advisoryOnly: true }
    })
    expect(
      representationSpacesCompatible(manifest, {
        ...manifest,
        versionSpace: 'other-space'
      })
    ).toBe(false)
  })

  it('classifies every remaining relation band and rejects invalid spaces', async () => {
    const common = {
      leftContentId: 'content:left',
      rightContentId: 'content:right',
      confidence: 0.88,
      representation: manifest,
      evidence: {
        structuralOverlap: false,
        visualAgreement: false,
        materialFactDelta: false,
        publishedTimeDelta: false,
        sourceLink: false
      },
      evidenceVersion: 'evidence-v1',
      relationPolicyVersion: 'relation-policy-v1',
      createdAt: at,
      validUntil: later
    }

    await expect(
      classifySimilarityRelation({ ...common, score: 0.85 })
    ).resolves.toMatchObject({
      state: 'related',
      relation: { type: 'semantically-similar', advisoryOnly: true }
    })
    await expect(
      classifySimilarityRelation({ ...common, score: 0.7 })
    ).resolves.toMatchObject({
      state: 'related',
      relation: { type: 'related-distinct', advisoryOnly: true }
    })
    await expect(
      classifySimilarityRelation({ ...common, score: 0.4 })
    ).resolves.toEqual({ state: 'separate', code: 'low-score' })
    await expect(
      classifySimilarityRelation({
        ...common,
        score: 0.99,
        representation: { ...manifest, versionSpace: '' }
      })
    ).resolves.toEqual({
      state: 'separate',
      code: 'incompatible-version-space'
    })
    await expect(
      classifySimilarityRelation({
        ...common,
        score: 0.99,
        representation: { ...manifest, modality: 'visual' },
        evidence: {
          ...common.evidence,
          visualAgreement: true,
          publishedTimeDelta: true,
          sourceLink: true
        }
      })
    ).resolves.toMatchObject({
      relation: {
        type: 'near-duplicate',
        evidenceCodes: ['visual-vector', 'published-time-delta', 'source-link']
      }
    })
  })

  it('requires every representation-space field to match', () => {
    expect(representationSpacesCompatible(manifest, manifest)).toBe(true)
    for (const changed of [
      { versionSpace: 'other' },
      { dimension: 4 },
      { modality: 'visual' as const },
      { normalization: 'none' as const },
      { preprocessingVersion: 'text-v2' },
      { modelProviderId: 'provider:other' },
      { modelId: 'embedding:other' }
    ]) {
      expect(
        representationSpacesCompatible(manifest, { ...manifest, ...changed })
      ).toBe(false)
    }
  })

  it('selects a deterministic representative and preserves protected and update counts', async () => {
    const member = (
      contentId: string,
      overrides: Partial<SimilarityClusterMember> = {}
    ): SimilarityClusterMember => ({
      contentId,
      platform: 'youtube',
      stableIdentity: true,
      sponsored: false,
      sourceEvidence: false,
      publishedAt: at,
      portableOrderId: contentId,
      relationType: 'near-duplicate',
      protected: false,
      update: false,
      ...overrides
    })
    const members = [
      member('sponsored', { sponsored: true, sourceEvidence: true }),
      member('source', { sourceEvidence: true, protected: true }),
      member('update', { update: true, publishedAt: null })
    ]

    expect(chooseClusterRepresentative(members)?.contentId).toBe('source')
    const cluster = await createSimilarityCluster({
      members,
      evidenceVersion: 'evidence-v1',
      createdAt: at
    })
    expect(clusterReviewSummary(cluster)).toMatchObject({
      total: 3,
      representativeContentId: 'source',
      protectedCount: 1,
      updateCount: 1,
      sponsoredCount: 1
    })
  })
})
