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
  candidates: z.array(
    z.object({
      finishReason: z.string().optional(),
      content: z.object({
        parts: z.array(z.object({ text: z.string() }))
      })
    })
  )
})

export function createGeminiAdapter(): ProviderAdapter {
  return {
    kind: 'gemini',
    buildRequest(input) {
      requireTask(input)
      const parts = [
        ...(input.image
          ? [
              {
                inlineData: {
                  mimeType: input.image.mimeType,
                  data: input.image.dataBase64
                }
              }
            ]
          : []),
        { text: input.prompt }
      ]
      return {
        adapterKind: 'gemini',
        method: 'POST',
        path: `/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
        authentication: 'x-goog-api-key',
        headers: {},
        body: {
          systemInstruction: {
            parts: [{ text: `ContentLens ${PROVIDER_PROMPT_VERSION}` }]
          },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA
          }
        }
      }
    },
    parseModelOutput(response) {
      try {
        const parsed = responseSchema.parse(response)
        const candidate = parsed.candidates[0]
        if (candidate?.finishReason === 'SAFETY') {
          throw new Error('provider-content-filtered')
        }
        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new Error('provider-truncated')
        }
        const text = candidate?.content.parts[0]?.text
        if (text === undefined) {
          throw new Error('missing output text')
        }
        return parseModelOutputText(text)
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'provider-content-filtered' ||
            error.message === 'provider-truncated')
        ) {
          throw error
        }
        throw new Error('provider-output-invalid')
      }
    }
  }
}
