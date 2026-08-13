import { describe, expect, it, vi } from 'vitest'

import {
  classifyText,
  TextModelFailure,
  type TextModelPort
} from '@/ai/text/classifier'
import {
  TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  textClassificationInputSchema,
  textModelOutputSchema
} from '@/ai/text/contracts'
import { preprocessTextInput } from '@/ai/text/preprocessing'
import type { ContentItem } from '@/core/content/contracts'
import type { SemanticRule } from '@/core/rules/contracts/rule'

const item = (): ContentItem => ({
  id: 'youtube:video:classifier',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'classifier'
  },
  canonicalUrl: 'https://www.youtube.com/watch?v=classifier',
  surface: 'youtube:home',
  title: 'A careful technical explanation',
  body: 'A bounded body with enough detail for classification.',
  author: {
    platform: 'youtube',
    authorId: 'private-author-id',
    displayName: 'Public source label'
  },
  media: [
    {
      kind: 'thumbnail',
      url: 'https://images.example/private-thumbnail.jpg'
    }
  ],
  observedAt: '2026-07-31T08:00:00.000Z',
  language: 'en',
  context: {
    isPromoted: false,
    accountId: 'must-not-cross-provider-boundary'
  }
})

const semanticRule = (): SemanticRule => ({
  id: 'rule:technical-depth',
  enabled: true,
  kind: 'semantic',
  effect: 'reduce',
  scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
  description: 'Reduce shallow summaries without technical evidence.',
  examples: ['Ten facts with no cited mechanism'],
  exclusions: ['Primary-source technical walkthrough'],
  threshold: 0.8,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z'
})

const validModelOutput = () => ({
  schemaVersion: TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [
    {
      topicId: 'topic:software',
      score: 0.91,
      evidenceRefs: ['evidence:topic:1']
    }
  ],
  archetypes: [],
  quality: { technicalDepth: 0.88 },
  semanticRuleMatches: [],
  evidence: [
    {
      evidenceId: 'evidence:topic:1',
      label: 'Technical mechanism is explained'
    }
  ],
  confidence: 0.86,
  abstention: null
})

describe('text classifier contract', () => {
  it('accepts only the closed text input and model output schemas', () => {
    expect(
      textClassificationInputSchema.safeParse({
        schemaVersion: 1,
        task: 'classification-text',
        platform: 'youtube',
        surface: 'youtube:home',
        language: 'en',
        content: { title: 'Safe title', context: {} },
        semanticRules: [],
        truncation: {
          title: false,
          body: false,
          sourceLabel: false,
          contextKeys: [],
          semanticRuleDetails: false
        }
      }).success
    ).toBe(true)
    expect(
      textClassificationInputSchema.safeParse({
        schemaVersion: 1,
        task: 'classification-text',
        platform: 'youtube',
        surface: 'youtube:home',
        language: 'en',
        content: {
          title: 'Unsafe',
          context: {},
          imageUrl: 'https://images.example/private.jpg'
        },
        semanticRules: [],
        truncation: {
          title: false,
          body: false,
          sourceLabel: false,
          contextKeys: [],
          semanticRuleDetails: false
        }
      }).success
    ).toBe(false)
    expect(textModelOutputSchema.safeParse(validModelOutput()).success).toBe(
      true
    )
    expect(
      textModelOutputSchema.safeParse({
        ...validModelOutput(),
        action: 'hide'
      }).success
    ).toBe(false)
  })

  it('rejects ambiguous or internally inconsistent model evidence', () => {
    const valid = validModelOutput()
    expect(
      textModelOutputSchema.safeParse({
        ...valid,
        evidence: [...valid.evidence, valid.evidence[0]]
      }).success
    ).toBe(false)
    expect(
      textModelOutputSchema.safeParse({
        ...valid,
        topics: [
          {
            topicId: 'topic:orphan',
            score: 0.9,
            evidenceRefs: ['evidence:missing']
          }
        ]
      }).success
    ).toBe(false)
    expect(
      textModelOutputSchema.safeParse({
        ...valid,
        abstention: { code: 'low-confidence' }
      }).success
    ).toBe(false)
    expect(
      textModelOutputSchema.safeParse({
        ...valid,
        evidence: [
          {
            evidenceId: 'evidence:topic:1',
            label: 'Technical mechanism is explained',
            sourceRef: 'https://private.example/item?account=secret'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('constructs trusted provenance after strict provider validation', async () => {
    const preprocessed = await preprocessTextInput({
      item: item(),
      semanticRules: [semanticRule()],
      allowedContextKeys: ['isPromoted'],
      maxInputBytes: 4_096
    })
    expect(preprocessed.state).toBe('ready')
    if (preprocessed.state !== 'ready') {
      throw new Error('Expected text preprocessing to succeed')
    }
    const classify = vi.fn(
      async (_request: Parameters<TextModelPort['classify']>[0]) =>
        validModelOutput()
    )
    const provider: TextModelPort = { classify }

    const result = await classifyText({
      preprocessed,
      provider,
      classifierVersion: 'text-classifier@1',
      modelVersion: 'model@1',
      sourceId: 'provider:model',
      observedAt: '2026-07-31T08:01:00.000Z'
    })

    expect(result.state).toBe('signals')
    if (result.state !== 'signals') {
      throw new Error('Expected canonical signals')
    }
    expect(result.signals).toMatchObject({
      classifierVersion: 'text-classifier@1',
      modelVersion: 'model@1',
      provenance: {
        sourceKind: 'text-model',
        sourceId: 'provider:model',
        sourceVersion: 'model@1',
        inputFingerprint: preprocessed.inputFingerprint,
        scope: {
          contentId: 'youtube:video:classifier',
          platform: 'youtube',
          surface: 'youtube:home',
          task: 'classification-text'
        }
      }
    })
    expect(classify).toHaveBeenCalledTimes(1)
    expect(classify.mock.calls[0]?.[0]).toMatchObject({
      task: 'classification-text'
    })
  })

  it('fails open on unknown output, provider failure and cancellation', async () => {
    const preprocessed = await preprocessTextInput({
      item: item(),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 2_048
    })
    expect(preprocessed.state).toBe('ready')
    if (preprocessed.state !== 'ready') {
      throw new Error('Expected text preprocessing to succeed')
    }
    const base = {
      preprocessed,
      classifierVersion: 'text-classifier@1',
      modelVersion: 'model@1',
      sourceId: 'provider:model',
      observedAt: '2026-07-31T08:01:00.000Z'
    }

    await expect(
      classifyText({
        ...base,
        provider: {
          classify: async () => ({ ...validModelOutput(), tool_call: 'save' })
        }
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'invalid-output' }
    })
    await expect(
      classifyText({
        ...base,
        provider: {
          classify: async () => {
            throw new TextModelFailure('provider-unavailable')
          }
        }
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'provider-unavailable' }
    })

    const controller = new AbortController()
    controller.abort()
    const classify = vi.fn(async () => validModelOutput())
    await expect(
      classifyText({
        ...base,
        provider: { classify },
        signal: controller.signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'cancelled' }
    })
    expect(classify).not.toHaveBeenCalled()
  })
})
