import { z } from 'zod'

import type { ProviderRequestPlan } from '@/ai/providers/adapters/contracts'

export type StructuredProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'openai-compatible'

type JsonSchema = Readonly<Record<string, unknown>>

const openAiResponseSchema = z.object({
  status: z.enum(['completed', 'incomplete']).optional(),
  output: z.array(
    z.object({
      type: z.literal('message'),
      content: z.array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('output_text'), text: z.string() }),
          z.object({ type: z.literal('refusal'), refusal: z.string() })
        ])
      )
    })
  )
})
const anthropicResponseSchema = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() }))
})
const geminiResponseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z.object({
          parts: z.array(z.object({ text: z.string() }))
        })
      })
    )
    .optional()
})
const ollamaResponseSchema = z.object({
  message: z.object({
    role: z.literal('assistant'),
    content: z.string()
  }),
  done: z.boolean(),
  done_reason: z.string().optional()
})
const compatibleResponseSchema = z.object({
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

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('provider-output-invalid')
  }
}

function providerTerminalError(message: string) {
  return (
    message === 'provider-refused' ||
    message === 'provider-content-filtered' ||
    message === 'provider-truncated'
  )
}

export function buildStructuredTextRequest(input: {
  kind: StructuredProviderKind
  modelId: string
  prompt: string
  schemaName: string
  schema: JsonSchema
}): ProviderRequestPlan {
  const system = 'ContentLens assistance-structured@1'
  switch (input.kind) {
    case 'openai':
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
              content: [{ type: 'input_text', text: input.prompt }]
            }
          ],
          instructions: system,
          store: false,
          stream: false,
          text: {
            format: {
              type: 'json_schema',
              name: input.schemaName,
              strict: true,
              schema: input.schema
            }
          }
        }
      }
    case 'anthropic':
      return {
        adapterKind: 'anthropic',
        method: 'POST',
        path: '/v1/messages',
        authentication: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        body: {
          model: input.modelId,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: input.prompt }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: input.schema
            }
          },
          stream: false,
          temperature: 0
        }
      }
    case 'gemini':
      return {
        adapterKind: 'gemini',
        method: 'POST',
        path: `/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
        authentication: 'x-goog-api-key',
        headers: {},
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: input.prompt }]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: input.schema
          }
        }
      }
    case 'ollama':
      return {
        adapterKind: 'ollama',
        method: 'POST',
        path: '/api/chat',
        authentication: 'none',
        headers: {},
        body: {
          model: input.modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: input.prompt }
          ],
          stream: false,
          format: input.schema,
          options: { temperature: 0 }
        }
      }
    case 'openai-compatible':
      return {
        adapterKind: 'openai-compatible',
        method: 'POST',
        path: '/v1/chat/completions',
        authentication: 'authorization-bearer',
        headers: {},
        body: {
          model: input.modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: input.prompt }
          ],
          stream: false,
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: input.schemaName,
              strict: true,
              schema: input.schema
            }
          }
        }
      }
  }
}

export function parseStructuredTextResponse(
  kind: StructuredProviderKind,
  response: unknown
) {
  try {
    let text: string | undefined
    switch (kind) {
      case 'openai': {
        const parsed = openAiResponseSchema.parse(response)
        if (parsed.status === 'incomplete') {
          throw new Error('provider-truncated')
        }
        const content = parsed.output.flatMap(output => output.content)
        if (content.some(entry => entry.type === 'refusal')) {
          throw new Error('provider-refused')
        }
        text = content.find(entry => entry.type === 'output_text')?.text
        break
      }
      case 'anthropic': {
        const parsed = anthropicResponseSchema.parse(response)
        if (parsed.stop_reason === 'refusal') {
          throw new Error('provider-refused')
        }
        if (parsed.stop_reason === 'max_tokens') {
          throw new Error('provider-truncated')
        }
        text = parsed.content.find(entry => entry.type === 'text')?.text
        break
      }
      case 'gemini': {
        const parsed = geminiResponseSchema.parse(response)
        const candidate = parsed.candidates?.[0]
        if (
          parsed.promptFeedback?.blockReason ||
          candidate?.finishReason === 'SAFETY'
        ) {
          throw new Error('provider-content-filtered')
        }
        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new Error('provider-truncated')
        }
        text = candidate?.content.parts[0]?.text
        break
      }
      case 'ollama': {
        const parsed = ollamaResponseSchema.parse(response)
        if (!parsed.done || parsed.done_reason === 'length') {
          throw new Error('provider-truncated')
        }
        text = parsed.message.content
        break
      }
      case 'openai-compatible': {
        const parsed = compatibleResponseSchema.parse(response)
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
        text = choice?.message.content ?? undefined
        break
      }
    }
    if (text === undefined) {
      throw new Error('provider-output-invalid')
    }
    return parseJson(text)
  } catch (error) {
    if (error instanceof Error && providerTerminalError(error.message)) {
      throw error
    }
    throw new Error('provider-output-invalid')
  }
}
