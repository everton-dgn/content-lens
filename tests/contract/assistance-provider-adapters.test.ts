import { describe, expect, it } from 'vitest'

import {
  ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
  ASSISTANCE_DRAFT_SCHEMA_VERSION
} from '@/ai/assistance'
import {
  buildStructuredTextRequest,
  parseStructuredTextResponse,
  type StructuredProviderKind
} from '@/ai/providers/adapters/structured'

const fixtures: Array<{
  kind: StructuredProviderKind
  response(text: string): unknown
}> = [
  {
    kind: 'openai',
    response: text => ({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text }]
        }
      ]
    })
  },
  {
    kind: 'anthropic',
    response: text => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }]
    })
  },
  {
    kind: 'gemini',
    response: text => ({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text }] }
        }
      ]
    })
  },
  {
    kind: 'ollama',
    response: text => ({
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: text }
    })
  },
  {
    kind: 'openai-compatible',
    response: text => ({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: text }
        }
      ]
    })
  }
]

const output = {
  schemaVersion: ASSISTANCE_DRAFT_SCHEMA_VERSION,
  rule: {
    effect: 'reduce',
    scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
    description: 'Clickbait',
    examples: [],
    exclusions: [],
    threshold: 0.8
  },
  inferredFields: [],
  ambiguousFields: [],
  missingFields: []
}

describe.each(fixtures)(
  '$kind structured assistance adapter',
  ({ kind, response }) => {
    it('builds a non-streaming request with the task schema and no tools', () => {
      const request = buildStructuredTextRequest({
        kind,
        modelId: 'model:fixture',
        prompt: 'Assistance fixture',
        schemaName: 'assistance_draft_model_output',
        schema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA
      })
      const serialized = JSON.stringify(request)

      expect(request.method).toBe('POST')
      expect(serialized).toContain('assistance_draft_model_output')
      expect(serialized).toContain('rule-draft-proposal@1')
      expect(serialized).not.toContain('"tools"')
      expect(serialized).not.toContain('classification_model_output')
    })

    it('extracts JSON without trusting provider envelope fields', () => {
      expect(
        parseStructuredTextResponse(kind, response(JSON.stringify(output)))
      ).toEqual(output)
      expect(() =>
        parseStructuredTextResponse(kind, response('{not-json'))
      ).toThrow('provider-output-invalid')
    })
  }
)

describe('structured assistance terminal states', () => {
  it('keeps refusal, filtering and truncation distinct', () => {
    expect(() =>
      parseStructuredTextResponse('openai', {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'policy' }]
          }
        ]
      })
    ).toThrow('provider-refused')
    expect(() =>
      parseStructuredTextResponse('gemini', {
        candidates: [
          {
            finishReason: 'SAFETY',
            content: { parts: [{ text: '{}' }] }
          }
        ]
      })
    ).toThrow('provider-content-filtered')
    expect(() =>
      parseStructuredTextResponse('anthropic', {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{}' }]
      })
    ).toThrow('provider-truncated')
  })
})
