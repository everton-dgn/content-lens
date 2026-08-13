import { describe, expect, it } from 'vitest'

import {
  inferredRelationSchema,
  observedRelationSchema
} from '@/core/content/relations'
import {
  PLATFORM_SURFACES,
  platformSurfaceSchema
} from '@/core/content/surfaces'
import {
  classificationSignalsSchema,
  emptyClassificationSignals
} from '@/core/decisions/signals'
import { provenanceSchema } from '@/core/evidence/provenance'

const observedAt = '2026-07-31T00:00:00.000Z'

function provenance() {
  return {
    sourceKind: 'text-model' as const,
    sourceId: 'classifier:fixture',
    sourceVersion: '1.0.0',
    observedAt,
    inputFingerprint: 'sha256:fixture',
    scope: {
      platform: 'youtube' as const,
      surface: 'youtube:home' as const,
      contentId: 'youtube:video:fixture'
    },
    confidence: 0.75,
    evidenceRefs: ['evidence:topic:1']
  }
}

describe('canonical content and model contracts', () => {
  it('accepts every platform surface and rejects impossible combinations', () => {
    for (const [platform, surfaces] of Object.entries(PLATFORM_SURFACES)) {
      for (const surface of surfaces) {
        expect(platformSurfaceSchema.parse(`${platform}:${surface}`)).toBe(
          `${platform}:${surface}`
        )
      }
    }

    expect(platformSurfaceSchema.safeParse('linkedin:shorts').success).toBe(
      false
    )
    expect(platformSurfaceSchema.safeParse('hacker-news:article').success).toBe(
      false
    )
    expect(platformSurfaceSchema.safeParse('unknown:feed').success).toBe(false)
  })

  it('keeps observed and inferred relation vocabularies disjoint', () => {
    const base = {
      fromContentId: 'x:post:1',
      toContentId: 'x:post:2',
      provenance: {
        ...provenance(),
        sourceKind: 'adapter-observation' as const,
        scope: {
          platform: 'x' as const,
          surface: 'x:threads' as const,
          contentId: 'x:post:1'
        }
      }
    }

    expect(
      observedRelationSchema.parse({
        ...base,
        kind: 'observed',
        relation: 'reply-to'
      })
    ).toMatchObject({ kind: 'observed', relation: 'reply-to' })
    expect(
      inferredRelationSchema.parse({
        ...base,
        kind: 'inferred',
        relation: 'similar-to',
        score: 0.81
      })
    ).toMatchObject({ kind: 'inferred', relation: 'similar-to' })
    expect(
      observedRelationSchema.safeParse({
        ...base,
        kind: 'observed',
        relation: 'similar-to'
      }).success
    ).toBe(false)
    expect(
      inferredRelationSchema.safeParse({
        ...base,
        kind: 'inferred',
        relation: 'reply-to',
        score: 0.81
      }).success
    ).toBe(false)
  })

  it('rejects unsafe provenance and unknown fields', () => {
    expect(provenanceSchema.parse(provenance())).toMatchObject({
      sourceKind: 'text-model',
      confidence: 0.75
    })
    expect(
      provenanceSchema.safeParse({
        ...provenance(),
        evidenceRefs: [
          ['https://provider.example/evidence', '?prompt=private'].join('')
        ]
      }).success
    ).toBe(false)
    expect(
      provenanceSchema.safeParse({
        ...provenance(),
        rawPrompt: 'must never cross the contract'
      }).success
    ).toBe(false)
  })

  it('accepts the canonical signal envelope and rejects model actions', () => {
    const valid = {
      ...emptyClassificationSignals({
        provenance: provenance(),
        classifierVersion: 'classifier@1',
        modelVersion: 'model@1'
      }),
      topics: [
        {
          topicId: 'topic:programming',
          score: 0.9,
          evidenceRefs: ['evidence:topic:1']
        }
      ],
      confidence: 0.86
    }

    expect(classificationSignalsSchema.parse(valid)).toMatchObject({
      confidence: 0.86,
      classifierVersion: 'classifier@1'
    })
    expect(
      classificationSignalsSchema.safeParse({ ...valid, action: 'hide' })
        .success
    ).toBe(false)
    expect(
      classificationSignalsSchema.safeParse({
        ...valid,
        confidence: Number.NaN
      }).success
    ).toBe(false)
    expect(
      classificationSignalsSchema.safeParse({
        ...valid,
        topics: [{ ...valid.topics[0], score: 1.01 }]
      }).success
    ).toBe(false)
  })
})
