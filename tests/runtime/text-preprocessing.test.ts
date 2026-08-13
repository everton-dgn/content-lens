import { describe, expect, it } from 'vitest'

import { preprocessTextInput } from '@/ai/text/preprocessing'
import type { ContentItem } from '@/core/content/contracts'
import type { SemanticRule } from '@/core/rules/contracts/rule'

const at = '2026-07-31T08:00:00.000Z'

const item = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: 'x:post:preprocessing',
  platform: 'x',
  identity: { status: 'stable', platformContentId: 'preprocessing' },
  surface: 'x:for-you',
  title: 'A short item',
  body: 'A short body',
  media: [],
  observedAt: at,
  language: 'en',
  context: {},
  ...overrides
})

const semanticRule = (overrides: Partial<SemanticRule> = {}): SemanticRule => ({
  id: 'semantic:preprocessing',
  enabled: true,
  kind: 'semantic',
  effect: 'reduce',
  scope: {},
  description: 'Reduce low-signal content.',
  examples: [],
  exclusions: [],
  threshold: 0.8,
  createdAt: at,
  updatedAt: at,
  ...overrides
})

describe('text preprocessing boundary', () => {
  it.each([
    ['pt', 'pt_BR'],
    ['pt-br', 'pt_BR'],
    ['pt_BR', 'pt_BR'],
    ['en', 'en'],
    ['en_US', 'en'],
    ['es', 'es'],
    ['es-mx', 'es'],
    ['fr', 'unknown'],
    [undefined, 'unknown'],
    ['  EN  ', 'en']
  ])('normalizes the language %s to %s', async (language, expected) => {
    const result = await preprocessTextInput({
      item: item({ language }),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 64_000
    })

    expect(result.state).toBe('ready')
    if (result.state === 'ready') {
      expect(result.input.language).toBe(expected)
    }
  })

  it('rejects an out-of-range byte budget before reading content', async () => {
    for (const maxInputBytes of [0, 100, 511, 2 * 1024 * 1024, 1.5]) {
      const result = await preprocessTextInput({
        item: item(),
        semanticRules: [],
        allowedContextKeys: [],
        maxInputBytes
      })

      expect(result).toEqual({
        state: 'abstained',
        abstention: {
          code: 'resource-limit',
          detailCode: 'text-input-budget-invalid'
        }
      })
    }
  })

  it('rejects a semantic rule list beyond the contract cap', async () => {
    const result = await preprocessTextInput({
      item: item(),
      semanticRules: Array.from({ length: 33 }, () => semanticRule()),
      allowedContextKeys: [],
      maxInputBytes: 64_000
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: {
        code: 'resource-limit',
        detailCode: 'semantic-rule-count-exceeded'
      }
    })
  })

  it('abstains when nothing at all is available to classify', async () => {
    const result = await preprocessTextInput({
      item: item({
        title: '   ',
        body: undefined,
        author: undefined,
        context: {}
      }),
      semanticRules: [],
      allowedContextKeys: [],
      maxInputBytes: 64_000
    })

    expect(result).toEqual({
      state: 'abstained',
      abstention: { code: 'insufficient-input' }
    })
  })

  it('sorts context keys so the fingerprint is stable', async () => {
    const first = await preprocessTextInput({
      item: item({
        context: { zebra: '1', alpha: '2', mango: '3' }
      }),
      semanticRules: [],
      allowedContextKeys: ['zebra', 'alpha', 'mango'],
      maxInputBytes: 64_000
    })
    const second = await preprocessTextInput({
      item: item({
        context: { mango: '3', zebra: '1', alpha: '2' }
      }),
      semanticRules: [],
      allowedContextKeys: ['alpha', 'mango', 'zebra'],
      maxInputBytes: 64_000
    })

    expect(first.state).toBe('ready')
    expect(second.state).toBe('ready')
    if (first.state === 'ready' && second.state === 'ready') {
      expect(Object.keys(first.input.content.context)).toEqual([
        'alpha',
        'mango',
        'zebra'
      ])
      expect(first.inputFingerprint).toBe(second.inputFingerprint)
    }
  })

  it('drops a rule detail that does not fit instead of failing the input', async () => {
    const result = await preprocessTextInput({
      item: item(),
      semanticRules: [
        semanticRule({
          examples: ['x'.repeat(2_000)],
          exclusions: ['y'.repeat(2_000)]
        })
      ],
      allowedContextKeys: [],
      maxInputBytes: 2_600
    })

    expect(result.state).toBe('ready')
    if (result.state === 'ready') {
      expect(result.input.truncation.semanticRuleDetails).toBe(true)
      expect(result.inputBytes).toBeLessThanOrEqual(2_600)
    }
  })

  it('drops a context entry that does not fit and records the key', async () => {
    const result = await preprocessTextInput({
      item: item({
        context: { small: 'ok', huge: 'z'.repeat(50_000) }
      }),
      semanticRules: [],
      allowedContextKeys: ['small', 'huge'],
      maxInputBytes: 4_000
    })

    expect(result.state).toBe('ready')
    if (result.state === 'ready') {
      expect(result.input.content.context.small).toBe('ok')
      expect(result.input.content.context.huge).toBeUndefined()
      expect(result.input.truncation.contextKeys).toEqual(['huge'])
    }
  })
})
