import { describe, expect, it, vi } from 'vitest'

import { classifyText, TextModelFailure } from '@/ai/text/classifier'
import {
  TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  type TextModelOutput
} from '@/ai/text/contracts'
import { preprocessTextInput } from '@/ai/text/preprocessing'
import type { ContentItem } from '@/core/content/contracts'
import type { SemanticRule } from '@/core/rules/contracts/rule'

const item = (): ContentItem => ({
  id: 'x:post:text-runtime',
  platform: 'x',
  identity: {
    status: 'stable',
    platformContentId: 'text-runtime'
  },
  surface: 'x:for-you',
  title: 'A short item',
  body: 'x'.repeat(8_000),
  media: [
    {
      kind: 'image',
      url: 'https://images.example/never-accessed.jpg'
    }
  ],
  observedAt: '2026-07-31T08:00:00.000Z',
  language: 'en',
  context: {}
})

const output = (): TextModelOutput => ({
  schemaVersion: TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [],
  archetypes: [],
  quality: { noise: 0.2 },
  semanticRuleMatches: [],
  evidence: [],
  confidence: 0.8,
  abstention: null
})

const semanticRule = (): SemanticRule => ({
  id: 'semantic:runtime-priority',
  enabled: true,
  kind: 'semantic',
  effect: 'reduce',
  scope: {},
  description: 'Reduce low-signal promotional content.',
  examples: ['example '.repeat(500)],
  exclusions: ['exception '.repeat(500)],
  threshold: 0.8,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z'
})

describe('text classification runtime', () => {
  it('truncates UTF-8 input within the route budget without touching media', async () => {
    const mediaAccess = vi.fn()
    const result = await preprocessTextInput({
      item: item(),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 768,
      mediaAccess
    })

    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      throw new Error('Expected a budgeted text input')
    }
    expect(result.inputBytes).toBeLessThanOrEqual(768)
    expect(result.input.truncation.body).toBe(true)
    expect(mediaAccess).not.toHaveBeenCalled()
    expect(JSON.stringify(result.input)).not.toContain('never-accessed')
  })

  it('prioritizes the classified body over optional rule details', async () => {
    const result = await preprocessTextInput({
      item: item(),
      semanticRules: [semanticRule()],
      allowedContextKeys: [],
      maxInputBytes: 6_000
    })

    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      throw new Error('Expected a budgeted text input')
    }
    expect(result.input.content.body?.length).toBeGreaterThan(4_000)
    expect(result.input.truncation.body).toBe(true)
    expect(result.input.truncation.semanticRuleDetails).toBe(true)
    expect(result.input.semanticRules[0]?.examples).toEqual([])
    expect(result.input.semanticRules[0]?.exclusions).toEqual([])
    expect(result.input.semanticRules[0]?.description).toBe(
      'Reduce low-signal promotional content.'
    )
  })

  it.each([
    'unsupported-language',
    'resource-limit',
    'cost-limit',
    'provider-unavailable',
    'timeout',
    'cancelled'
  ] as const)('maps %s to an explicit fail-open abstention', async code => {
    const preprocessed = await preprocessTextInput({
      item: item(),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 2_048
    })
    expect(preprocessed.state).toBe('ready')
    if (preprocessed.state !== 'ready') {
      throw new Error('Expected a ready text input')
    }

    const result = await classifyText({
      preprocessed,
      classifierVersion: 'text-classifier@1',
      modelVersion: 'model@1',
      sourceId: 'provider:model',
      observedAt: '2026-07-31T08:01:00.000Z',
      provider: {
        classify: async () => {
          throw new TextModelFailure(code)
        }
      }
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: { code }
    })
  })

  it('propagates a validated model abstention without producing signals', async () => {
    const preprocessed = await preprocessTextInput({
      item: item(),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 2_048
    })
    expect(preprocessed.state).toBe('ready')
    if (preprocessed.state !== 'ready') {
      throw new Error('Expected a ready text input')
    }

    await expect(
      classifyText({
        preprocessed,
        classifierVersion: 'text-classifier@1',
        modelVersion: 'model@1',
        sourceId: 'provider:model',
        observedAt: '2026-07-31T08:01:00.000Z',
        provider: {
          classify: async () => ({
            ...output(),
            quality: {},
            confidence: null,
            abstention: {
              code: 'low-confidence',
              detailCode: 'insufficient-semantic-evidence'
            }
          })
        }
      })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'low-confidence',
        detailCode: 'insufficient-semantic-evidence'
      }
    })
  })

  it('returns canonical signals without calling any action authority', async () => {
    const preprocessed = await preprocessTextInput({
      item: item(),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 2_048
    })
    expect(preprocessed.state).toBe('ready')
    if (preprocessed.state !== 'ready') {
      throw new Error('Expected a ready text input')
    }
    const classify = vi.fn(async () => output())

    const result = await classifyText({
      preprocessed,
      classifierVersion: 'text-classifier@1',
      modelVersion: 'model@1',
      sourceId: 'provider:model',
      observedAt: '2026-07-31T08:01:00.000Z',
      provider: { classify }
    })

    expect(result.state).toBe('signals')
    expect(classify).toHaveBeenCalledTimes(1)
  })
})
