import { describe, expect, it, vi } from 'vitest'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import { classifyVision } from '@/ai/vision/classifier'
import type { ReadyVisualInput } from '@/ai/vision/contracts'

const observedAt = '2026-07-31T09:00:00.000Z'

const prepared: ReadyVisualInput = {
  binding: {
    contentId: 'youtube:video:vision',
    pageInstanceId: 'page:vision',
    platform: 'youtube',
    surface: 'youtube:home',
    profileRevision: 7
  },
  input: {
    title: 'A visual fixture',
    body: 'Text remains bounded.',
    language: 'en',
    semanticRules: [
      {
        ruleId: 'rule:visual-clickbait',
        description: 'Reduce exaggerated thumbnails.',
        examples: [],
        exclusions: []
      }
    ],
    candidateTopicIds: ['software'],
    candidateArchetypeIds: ['visual-clickbait'],
    candidateEvidenceCodes: ['visual.clickbait'],
    media: {
      kind: 'thumbnail',
      mimeType: 'image/png',
      width: 320,
      height: 180,
      fingerprint: 'sha256:visual-media'
    }
  },
  image: {
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    mimeType: 'image/png',
    width: 320,
    height: 180,
    fingerprint: 'sha256:visual-media'
  },
  inputBytes: 512,
  inputFingerprint: 'sha256:visual-input',
  dataCategories: ['title', 'body', 'rule', 'image']
}

const output: ClassificationModelOutput = {
  schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [{ topicId: 'software', score: 0.8, evidenceRefs: ['e:1'] }],
  archetypes: [
    {
      archetypeId: 'visual-clickbait',
      score: 0.91,
      evidenceRefs: ['e:1']
    }
  ],
  quality: { clickbait: 0.91 },
  semanticRuleMatches: [
    {
      ruleId: 'rule:visual-clickbait',
      score: 0.9,
      evidenceRefs: ['e:1']
    }
  ],
  evidence: [
    {
      evidenceId: 'e:1',
      label: 'visual.clickbait',
      sourceRef: 'media:thumbnail'
    }
  ],
  confidence: 0.92,
  abstention: null
}

describe('vision classifier', () => {
  it('validates untrusted output and creates trusted vision provenance', async () => {
    const classify = vi.fn(async () => output)

    const result = await classifyVision({
      prepared,
      provider: { classify },
      classifierVersion: 'vision-classifier@1',
      modelVersion: 'vision-model@1',
      sourceId: 'provider:model',
      observedAt
    })

    expect(result).toMatchObject({
      state: 'signals',
      signals: {
        schemaVersion: '1',
        classifierVersion: 'vision-classifier@1',
        modelVersion: 'vision-model@1',
        provenance: {
          sourceKind: 'vision-model',
          sourceId: 'provider:model',
          sourceVersion: 'vision-model@1',
          inputFingerprint: 'sha256:visual-input',
          scope: {
            platform: 'youtube',
            surface: 'youtube:home',
            contentId: 'youtube:video:vision',
            task: 'classification-vision'
          }
        }
      }
    })
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'classification-vision',
        image: prepared.image
      })
    )
  })

  it('rejects a model attempt to choose a final action', async () => {
    const result = await classifyVision({
      prepared,
      provider: {
        classify: vi.fn(async () => ({ ...output, action: 'hide' }))
      },
      classifierVersion: 'vision-classifier@1',
      modelVersion: 'vision-model@1',
      sourceId: 'provider:model',
      observedAt
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: { code: 'invalid-output' }
    })
  })

  it('rejects topic, archetype, rule and evidence IDs outside request candidates', async () => {
    const result = await classifyVision({
      prepared,
      provider: {
        classify: vi.fn(async () => ({
          ...output,
          topics: [
            { topicId: 'sensitive-invented-topic', score: 1, evidenceRefs: [] }
          ]
        }))
      },
      classifierVersion: 'vision-classifier@1',
      modelVersion: 'vision-model@1',
      sourceId: 'provider:model',
      observedAt
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: { code: 'invalid-output' }
    })
  })

  it('returns cancellation without applying a late provider result', async () => {
    const controller = new AbortController()
    const classify = vi.fn(async () => {
      controller.abort()
      return output
    })

    const result = await classifyVision({
      prepared,
      provider: { classify },
      classifierVersion: 'vision-classifier@1',
      modelVersion: 'vision-model@1',
      sourceId: 'provider:model',
      observedAt,
      signal: controller.signal
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: { code: 'cancelled' }
    })
  })
})
