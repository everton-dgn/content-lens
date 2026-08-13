import { describe, expect, it } from 'vitest'

import {
  canonicalSimilarityUrl,
  compareExactContent
} from '@/ai/similarity/exact'
import type { ContentItem } from '@/core/content/contracts'
import {
  contentSimilarityRelationSchema,
  representationManifestSchema,
  similarityClusterSchema,
  similarityVectorRecordSchema
} from '@/core/similarity/contracts'

const at = '2026-07-31T12:00:00.000Z'
const later = '2026-08-01T12:00:00.000Z'

function item(input: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'youtube:item:one',
    platform: 'youtube',
    identity: { status: 'stable', platformContentId: 'video:one' },
    canonicalUrl: 'https://www.youtube.com/watch?v=one&feature=share',
    surface: 'youtube:search',
    title: 'A title',
    body: 'Exact body',
    media: [],
    observedAt: at,
    context: {},
    ...input
  }
}

const manifest = representationManifestSchema.parse({
  modelProviderId: 'provider:local',
  modelId: 'embedding:model',
  modality: 'text',
  dimension: 3,
  preprocessingVersion: 'text-v1',
  normalization: 'l2',
  versionSpace: 'provider:local/model/text-v1/l2/3'
})

describe('similarity contracts', () => {
  it('evaluates stable identity and adapter-scoped canonical URL before content fingerprints', async () => {
    const left = item()
    const right = item({
      id: 'youtube:item:two',
      canonicalUrl: 'https://www.youtube.com/watch?si=tracking&v=one',
      title: 'Different title',
      body: 'Different body'
    })

    await expect(compareExactContent(left, right)).resolves.toMatchObject({
      matched: true,
      evidenceCodes: ['stable-platform-id', 'canonical-url']
    })
    expect(
      canonicalSimilarityUrl(
        'youtube',
        'https://www.youtube.com/watch?v=one&utm_source=test#fragment'
      )
    ).toBe('youtube:https://www.youtube.com/watch?v=one')
  })

  it('keeps platform namespaces separate and does not merge empty ephemeral items', async () => {
    const left = item({
      id: 'youtube:ephemeral',
      identity: {
        status: 'ephemeral',
        pageInstanceId: 'page:one',
        reason: 'not-exposed'
      },
      canonicalUrl: undefined,
      title: undefined,
      body: undefined
    })
    const right = {
      ...left,
      id: 'rss:ephemeral',
      platform: 'rss' as const,
      surface: 'rss:feed-entry' as const,
      identity: {
        status: 'ephemeral' as const,
        pageInstanceId: 'page:two',
        reason: 'not-exposed' as const
      }
    }

    await expect(compareExactContent(left, right)).resolves.toMatchObject({
      matched: false,
      evidenceCodes: []
    })
  })

  it('rejects unsafe URLs and matches normalized text with ordered media fingerprints', async () => {
    const credentialedUrl = [
      'https',
      '://user:pass@',
      'example.com/video'
    ].join('')
    const syntheticOrigin = ['https', '://example.com'].join('')
    expect(canonicalSimilarityUrl('youtube', undefined)).toBeUndefined()
    expect(canonicalSimilarityUrl('youtube', 'not-a-url')).toBeUndefined()
    expect(
      canonicalSimilarityUrl('youtube', 'ftp://example.com/video')
    ).toBeUndefined()
    expect(canonicalSimilarityUrl('youtube', credentialedUrl)).toBeUndefined()

    const left = item({
      identity: {
        status: 'ephemeral',
        pageInstanceId: 'page:left',
        reason: 'not-exposed'
      },
      canonicalUrl: undefined,
      title: 'Normalized\r\ntitle',
      body: undefined,
      media: [
        { kind: 'thumbnail', url: `${syntheticOrigin}/a`, fingerprint: 'b' },
        { kind: 'image', url: `${syntheticOrigin}/b`, fingerprint: 'a' }
      ]
    })
    const right = item({
      id: 'youtube:item:two',
      identity: {
        status: 'ephemeral',
        pageInstanceId: 'page:right',
        reason: 'not-exposed'
      },
      canonicalUrl: undefined,
      title: 'Normalized\ntitle',
      body: undefined,
      media: [...left.media].reverse()
    })

    await expect(compareExactContent(left, right)).resolves.toMatchObject({
      matched: true,
      evidenceCodes: ['exact-content-fingerprint']
    })
  })

  it('binds vectors to one declared version space and exact dimensions', () => {
    const vector = {
      id: 'vector:one',
      contentId: 'content:one',
      platform: 'youtube',
      surface: 'youtube:search',
      language: 'en',
      stableIdentity: true,
      exactFingerprint: 'a'.repeat(64),
      manifest,
      vector: [0.1, 0.2, 0.3],
      observedAt: at,
      expiresAt: later,
      byteLength: 12
    }
    expect(similarityVectorRecordSchema.safeParse(vector).success).toBe(true)
    expect(
      similarityVectorRecordSchema.safeParse({
        ...vector,
        vector: [0.1, 0.2]
      }).success
    ).toBe(false)
  })

  it('keeps relation types explicit and low-confidence evidence advisory', () => {
    const relation = {
      relationId: 'relation:one',
      leftContentId: 'content:left',
      rightContentId: 'content:right',
      type: 'near-duplicate',
      score: 0.97,
      confidence: 0.89,
      threshold: 0.95,
      evidenceCodes: ['text-vector', 'structural-overlap'],
      evidenceVersion: 'evidence-v1',
      representation: manifest,
      relationPolicyVersion: 'relation-policy-v1',
      advisoryOnly: true,
      createdAt: at,
      validUntil: later
    }
    expect(contentSimilarityRelationSchema.safeParse(relation).success).toBe(
      true
    )
    expect(
      contentSimilarityRelationSchema.safeParse({
        ...relation,
        advisoryOnly: false
      }).success
    ).toBe(false)
    expect(
      contentSimilarityRelationSchema.safeParse({
        ...relation,
        type: 'exact-duplicate'
      }).success
    ).toBe(false)
  })

  it('requires one stable member and a real representative for durable clusters', () => {
    const member = {
      contentId: 'content:one',
      platform: 'youtube',
      stableIdentity: true,
      sponsored: false,
      sourceEvidence: true,
      publishedAt: at,
      portableOrderId: 'order:one',
      relationType: 'exact-duplicate',
      protected: false,
      update: false
    }
    const cluster = {
      clusterId: 'cluster:one',
      representativeContentId: 'content:one',
      members: [member],
      evidenceVersion: 'evidence-v1',
      createdAt: at,
      updatedAt: at
    }
    expect(similarityClusterSchema.safeParse(cluster).success).toBe(true)
    expect(
      similarityClusterSchema.safeParse({
        ...cluster,
        members: [{ ...member, stableIdentity: false }]
      }).success
    ).toBe(false)
  })
})
