import { z } from 'zod'

import {
  CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
  parseModelOutputText,
  requireTask
} from '@/ai/providers/adapters/base'
import {
  PROVIDER_PROMPT_VERSION,
  type ProviderAdapter
} from '@/ai/providers/adapters/contracts'

const responseSchema = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string()
    })
  )
})

export function createAnthropicAdapter(): ProviderAdapter {
  return {
    kind: 'anthropic',
    buildRequest(input) {
      requireTask(input)
      const content = input.image
        ? [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.image.mimeType,
                data: input.image.dataBase64
              }
            },
            { type: 'text', text: input.prompt }
          ]
        : input.prompt
      return {
        adapterKind: 'anthropic',
        method: 'POST',
        path: '/v1/messages',
        authentication: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        body: {
          model: input.modelId,
          max_tokens: 4096,
          system: [
            `ContentLens ${PROVIDER_PROMPT_VERSION}.`,
            'Return only JSON matching this schema:',
            JSON.stringify(CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA)
          ].join('\n'),
          messages: [{ role: 'user', content }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA
            }
          },
          stream: false,
          temperature: 0
        }
      }
    },
    parseModelOutput(response) {
      try {
        const parsed = responseSchema.parse(response)
        if (parsed.stop_reason === 'refusal') {
          throw new Error('provider-refused')
        }
        if (parsed.stop_reason === 'max_tokens') {
          throw new Error('provider-truncated')
        }
        const text = parsed.content.find(
          content => content.type === 'text'
        )?.text
        if (text === undefined) {
          throw new Error('missing output text')
        }
        return parseModelOutputText(text)
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'provider-refused' ||
            error.message === 'provider-truncated')
        ) {
          throw error
        }
        throw new Error('provider-output-invalid')
      }
    }
  }
}
