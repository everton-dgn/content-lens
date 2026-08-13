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
  status: z.enum(['completed', 'incomplete']).optional(),
  incomplete_details: z
    .object({ reason: z.string().optional() })
    .nullable()
    .optional(),
  output: z.array(
    z.object({
      type: z.literal('message'),
      content: z.array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('output_text'),
            text: z.string()
          }),
          z.object({
            type: z.literal('refusal'),
            refusal: z.string()
          })
        ])
      )
    })
  )
})

export function createOpenAiAdapter(): ProviderAdapter {
  return {
    kind: 'openai',
    buildRequest(input) {
      requireTask(input)
      const content = [
        { type: 'input_text' as const, text: input.prompt },
        ...(input.image
          ? [
              {
                type: 'input_image' as const,
                image_url: `data:${input.image.mimeType};base64,${input.image.dataBase64}`
              }
            ]
          : [])
      ]
      return {
        adapterKind: 'openai',
        method: 'POST',
        path: '/v1/responses',
        authentication: 'authorization-bearer',
        headers: {},
        body: {
          model: input.modelId,
          input: [
            {
              role: 'user',
              content
            }
          ],
          instructions: `ContentLens ${PROVIDER_PROMPT_VERSION}`,
          store: false,
          stream: false,
          text: {
            format: {
              type: 'json_schema',
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
        if (parsed.status === 'incomplete') {
          throw new Error('provider-truncated')
        }
        if (
          parsed.output
            .flatMap(output => output.content)
            .some(content => content.type === 'refusal')
        ) {
          throw new Error('provider-refused')
        }
        const text = parsed.output
          .flatMap(output => output.content)
          .find(content => content.type === 'output_text')?.text
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
