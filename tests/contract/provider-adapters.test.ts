import { describe, expect, it } from 'vitest'

import {
  createAnthropicAdapter,
  createGeminiAdapter,
  createOllamaAdapter,
  createOpenAiAdapter,
  createOpenAiCompatibleAdapter,
  createProviderAdapterFor
} from '@/ai/providers/adapters'
import type { ProviderAdapter } from '@/ai/providers/adapters/contracts'
import {
  TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  type TextModelOutput
} from '@/ai/text/contracts'

const modelOutput: TextModelOutput = {
  schemaVersion: TEXT_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [],
  archetypes: [],
  quality: {},
  semanticRuleMatches: [],
  evidence: [],
  confidence: null,
  abstention: null
}

const adapters: Array<{
  name: string
  adapter: ProviderAdapter
  response(text: string): unknown
}> = [
  {
    name: 'OpenAI',
    adapter: createOpenAiAdapter(),
    response: text => ({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text }]
        }
      ]
    })
  },
  {
    name: 'Anthropic',
    adapter: createAnthropicAdapter(),
    response: text => ({
      content: [{ type: 'text', text }]
    })
  },
  {
    name: 'Gemini',
    adapter: createGeminiAdapter(),
    response: text => ({
      candidates: [{ content: { parts: [{ text }] } }]
    })
  },
  {
    name: 'Ollama',
    adapter: createOllamaAdapter(),
    response: text => ({
      message: { role: 'assistant', content: text },
      done: true
    })
  },
  {
    name: 'OpenAI compatible',
    adapter: createOpenAiCompatibleAdapter(),
    response: text => ({
      choices: [{ message: { role: 'assistant', content: text } }]
    })
  }
]

describe('provider adapter factory', () => {
  it.each([
    'openai',
    'anthropic',
    'gemini',
    'ollama',
    'openai-compatible',
    'user-proxy',
    'custom'
  ] as const)('creates the %s network adapter', kind => {
    expect(createProviderAdapterFor({ kind }).buildRequest).toBeTypeOf(
      'function'
    )
  })

  it('rejects a browser-only provider at the network boundary', () => {
    expect(() =>
      createProviderAdapterFor({ kind: 'browser-built-in' })
    ).toThrow('Browser built-in provider has no network adapter')
  })
})

describe.each(adapters)('$name provider adapter', ({ adapter, response }) => {
  it('builds an embedded, non-streaming structured request', () => {
    const request = adapter.buildRequest({
      modelId: 'model:fixture',
      prompt: 'Synthetic classification fixture',
      task: 'classification-text'
    })

    expect(request.method).toBe('POST')
    expect(request.path.startsWith('/')).toBe(true)
    expect(request.authentication).toBeDefined()
    expect(JSON.stringify(request)).not.toContain('credential-canary')
    expect(JSON.stringify(request)).not.toContain('"tools"')
    expect(JSON.stringify(request.body)).toContain(
      'classification_model_output'
    )
    expect(JSON.stringify(request.body)).not.toContain('provenance')
    expect(JSON.stringify(request.body)).not.toContain('classifierVersion')
  })

  it('parses only the untrusted model-output envelope', () => {
    expect(
      adapter.parseModelOutput(response(JSON.stringify(modelOutput)))
    ).toEqual(modelOutput)
    expect(() =>
      adapter.parseModelOutput(
        response(JSON.stringify({ ...modelOutput, action: 'hide' }))
      )
    ).toThrow(/provider-output-invalid/)
    expect(() =>
      adapter.parseModelOutput(
        response(
          JSON.stringify({
            ...modelOutput,
            provenance: {
              sourceKind: 'text-model',
              sourceId: 'model-supplied'
            }
          })
        )
      )
    ).toThrow(/provider-output-invalid/)
  })

  it('builds a vision request only when bounded image data is present', () => {
    const request = adapter.buildRequest({
      modelId: 'model:fixture',
      prompt: 'Synthetic visual classification fixture',
      task: 'classification-vision',
      image: {
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo='
      }
    })
    const serialized = JSON.stringify(request.body)

    expect(serialized).toContain('iVBORw0KGgo=')
    if (adapter.kind !== 'ollama') {
      expect(serialized).toContain('image/png')
    }
    expect(serialized).toContain('classification_model_output')
    expect(serialized).not.toContain('"tools"')
    expect(() =>
      adapter.buildRequest({
        modelId: 'model:fixture',
        prompt: 'Missing image',
        task: 'classification-vision'
      })
    ).toThrow(/modality/)
    expect(() =>
      adapter.buildRequest({
        modelId: 'model:fixture',
        prompt: 'Unexpected image',
        task: 'classification-text',
        image: {
          mimeType: 'image/png',
          dataBase64: 'iVBORw0KGgo='
        }
      })
    ).toThrow(/modality/)
  })
})

describe('provider terminal output states', () => {
  it('uses the current Anthropic output_config JSON schema boundary', () => {
    const request = createAnthropicAdapter().buildRequest({
      modelId: 'model:fixture',
      prompt: 'Synthetic fixture',
      task: 'classification-text'
    })

    expect(request.body).toMatchObject({
      output_config: {
        format: {
          type: 'json_schema',
          schema: expect.objectContaining({
            $id: 'classification_model_output'
          })
        }
      }
    })
  })

  it('keeps refusal, content filter and truncation distinct', () => {
    expect(() =>
      createOpenAiAdapter().parseModelOutput({
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
      createAnthropicAdapter().parseModelOutput({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{}' }]
      })
    ).toThrow('provider-truncated')

    expect(() =>
      createGeminiAdapter().parseModelOutput({
        candidates: [
          {
            finishReason: 'SAFETY',
            content: { parts: [{ text: '{}' }] }
          }
        ]
      })
    ).toThrow('provider-content-filtered')

    expect(() =>
      createOllamaAdapter().parseModelOutput({
        message: { role: 'assistant', content: '{}' },
        done: true,
        done_reason: 'length'
      })
    ).toThrow('provider-truncated')

    expect(() =>
      createOpenAiCompatibleAdapter().parseModelOutput({
        choices: [
          {
            message: { role: 'assistant', content: null, refusal: 'policy' },
            finish_reason: 'stop'
          }
        ]
      })
    ).toThrow('provider-refused')
  })
})
