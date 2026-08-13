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
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
        refusal: z.string().nullable().optional()
      }),
      finish_reason: z.string().nullable().optional()
    })
  )
})

export function createOpenAiCompatibleAdapter(): ProviderAdapter {
  return {
    kind: 'openai-compatible',
    buildRequest(input) {
      requireTask(input)
      const content = input.image
        ? [
            { type: 'text', text: input.prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${input.image.mimeType};base64,${input.image.dataBase64}`
              }
            }
          ]
        : input.prompt
      return {
        adapterKind: 'openai-compatible',
        method: 'POST',
        path: '/v1/chat/completions',
        authentication: 'authorization-bearer',
        headers: {},
        body: {
          model: input.modelId,
          messages: [
            {
              role: 'system',
              content: `ContentLens ${PROVIDER_PROMPT_VERSION}`
            },
            { role: 'user', content }
          ],
          stream: false,
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'classification_model_output',
              strict: true,
              schema: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA
            }
          }
        }
      }
    },
    parseModelOutput(response) {
      try {
        const parsed = responseSchema.parse(response)
        const choice = parsed.choices[0]
        if (choice?.finish_reason === 'content_filter') {
          throw new Error('provider-content-filtered')
        }
        if (choice?.finish_reason === 'length') {
          throw new Error('provider-truncated')
        }
        if (choice?.message.refusal) {
          throw new Error('provider-refused')
        }
        const text = choice?.message.content
        if (text === undefined || text === null) {
          throw new Error('missing output text')
        }
        return parseModelOutputText(text)
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'provider-refused' ||
            error.message === 'provider-content-filtered' ||
            error.message === 'provider-truncated')
        ) {
          throw error
        }
        throw new Error('provider-output-invalid')
      }
    }
  }
}
