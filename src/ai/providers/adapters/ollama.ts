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
  message: z.object({
    role: z.literal('assistant'),
    content: z.string()
  }),
  done: z.boolean(),
  done_reason: z.string().optional()
})

export function createOllamaAdapter(): ProviderAdapter {
  return {
    kind: 'ollama',
    buildRequest(input) {
      requireTask(input)
      return {
        adapterKind: 'ollama',
        method: 'POST',
        path: '/api/chat',
        authentication: 'none',
        headers: {},
        body: {
          model: input.modelId,
          messages: [
            {
              role: 'system',
              content: `ContentLens ${PROVIDER_PROMPT_VERSION}`
            },
            {
              role: 'user',
              content: input.prompt,
              ...(input.image ? { images: [input.image.dataBase64] } : {})
            }
          ],
          stream: false,
          format: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
          options: { temperature: 0 }
        }
      }
    },
    parseModelOutput(response) {
      try {
        const parsed = responseSchema.parse(response)
        if (!parsed.done || parsed.done_reason === 'length') {
          throw new Error('provider-truncated')
        }
        return parseModelOutputText(parsed.message.content)
      } catch (error) {
        if (error instanceof Error && error.message === 'provider-truncated') {
          throw error
        }
        throw new Error('provider-output-invalid')
      }
    }
  }
}
