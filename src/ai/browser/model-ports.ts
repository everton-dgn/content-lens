import type { AssistanceModelPort } from '@/ai/assistance'
import {
  type ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
  type ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
  AssistanceModelFailure
} from '@/ai/assistance'
import type {
  BrowserAiLanguage,
  BrowserPromptExecutor,
  BrowserPromptResult
} from '@/ai/browser/language-model'
import { CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA } from '@/ai/classification/model-output'
import { TextModelFailure, type TextModelPort } from '@/ai/text/classifier'
import {
  VisualModelFailure,
  type VisualModelPort
} from '@/ai/vision/classifier'

function promptLanguage(prompt: string): BrowserAiLanguage {
  try {
    const input = JSON.parse(prompt) as {
      untrustedData?: { language?: unknown }
    }
    const language = input.untrustedData?.language
    return language === 'en' ||
      language === 'es' ||
      language === 'pt_BR' ||
      language === 'unknown'
      ? language
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    )
  }
  return btoa(binary)
}

function failureCode(
  result: Exclude<BrowserPromptResult, { state: 'output' }>
) {
  switch (result.code) {
    case 'cancelled':
      return 'cancelled'
    case 'timeout':
      return 'timeout'
    case 'invalid-output':
      return 'invalid-output'
    case 'language-unsupported':
      return 'unsupported-language'
    case 'unsupported-input':
      return 'unsupported-input'
    default:
      return 'provider-unavailable'
  }
}

export function createBrowserTextModelPort(input: {
  executor: BrowserPromptExecutor
}): TextModelPort {
  return {
    async classify(request) {
      const result = await input.executor.execute({
        task: request.task,
        prompt: request.prompt,
        language: promptLanguage(request.prompt),
        responseConstraint: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
        ...(request.signal ? { signal: request.signal } : {})
      })
      if (result.state === 'output') {
        return result.value
      }
      throw new TextModelFailure(failureCode(result))
    }
  }
}

export function createBrowserVisualModelPort(input: {
  executor: BrowserPromptExecutor
}): VisualModelPort {
  return {
    async classify(request) {
      const result = await input.executor.execute({
        task: request.task,
        prompt: request.prompt,
        language: promptLanguage(request.prompt),
        responseConstraint: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
        image: {
          mimeType: request.image.mimeType,
          dataBase64: bytesToBase64(request.image.bytes)
        },
        ...(request.signal ? { signal: request.signal } : {})
      })
      if (result.state === 'output') {
        return result.value
      }
      const code = failureCode(result)
      throw new VisualModelFailure(
        code === 'unsupported-language' ? 'unsupported-input' : code
      )
    }
  }
}

export function createBrowserAssistanceModelPort(input: {
  executor: BrowserPromptExecutor
  language: BrowserAiLanguage
}): AssistanceModelPort {
  const invoke = async (request: {
    task: 'assistance-draft' | 'assistance-explain'
    prompt: string
    outputSchema:
      | typeof ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA
      | typeof ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA
    signal: AbortSignal
  }) => {
    const result = await input.executor.execute({
      task: request.task,
      prompt: request.prompt,
      language: input.language,
      responseConstraint: request.outputSchema,
      signal: request.signal
    })
    if (result.state === 'output') {
      return result.value
    }
    const code = failureCode(result)
    throw new AssistanceModelFailure(
      code === 'unsupported-language' || code === 'unsupported-input'
        ? 'invalid-output'
        : code
    )
  }
  return {
    generateDraft: request => invoke(request),
    explain: request => invoke(request)
  }
}
