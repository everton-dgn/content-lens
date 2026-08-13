import type { ModelTask } from '@/ai/models/contracts'

export type BrowserAiLanguage = 'en' | 'es' | 'pt_BR' | 'unknown'
export type BrowserAiJsonSchema = Readonly<Record<string, unknown>>

type LanguageModelOptions = {
  expectedInputs: ReadonlyArray<{
    type: 'text' | 'image'
    languages?: readonly string[]
  }>
  expectedOutputs: ReadonlyArray<{
    type: 'text'
    languages: readonly string[]
  }>
}

type LanguageModelSession = {
  prompt(
    input:
      | string
      | ReadonlyArray<{
          role: 'user'
          content: ReadonlyArray<
            { type: 'text'; value: string } | { type: 'image'; value: Blob }
          >
        }>,
    options: {
      responseConstraint: BrowserAiJsonSchema
      signal: AbortSignal
    }
  ): Promise<string>
  destroy(): void
}

export type BrowserLanguageModelApi = {
  availability(options: LanguageModelOptions): Promise<string>
  create(
    options: LanguageModelOptions & { signal: AbortSignal }
  ): Promise<LanguageModelSession>
}

export type BrowserPromptRequest = {
  task: ModelTask
  prompt: string
  language: BrowserAiLanguage
  responseConstraint: BrowserAiJsonSchema
  image?: {
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    dataBase64: string
  }
  signal?: AbortSignal
}

export type BrowserPromptResult =
  | { state: 'output'; value: unknown }
  | {
      state: 'unavailable'
      code:
        | 'api-unavailable'
        | 'document-unavailable'
        | 'model-unavailable'
        | 'language-unsupported'
        | 'download-user-activation-required'
    }
  | {
      state: 'failed'
      code:
        | 'cancelled'
        | 'timeout'
        | 'invalid-output'
        | 'unsupported-input'
        | 'provider-unavailable'
    }

export type BrowserPromptExecutor = {
  execute(request: BrowserPromptRequest): Promise<BrowserPromptResult>
}

type LanguageModelGlobal = typeof globalThis & {
  LanguageModel?: BrowserLanguageModelApi
}

function languageOptions(
  language: Exclude<BrowserAiLanguage, 'pt_BR' | 'unknown'>,
  hasImage: boolean
): LanguageModelOptions {
  const languages = language === 'en' ? ['en'] : ['en', language]
  return {
    expectedInputs: [
      { type: 'text', languages },
      ...(hasImage ? [{ type: 'image' as const }] : [])
    ],
    expectedOutputs: [{ type: 'text', languages: [language] }]
  }
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function mappedFailure(
  error: unknown,
  signal: AbortSignal
): BrowserPromptResult {
  if (signal.aborted) {
    return { state: 'failed', code: 'cancelled' }
  }
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'AbortError':
        return { state: 'failed', code: 'cancelled' }
      case 'TimeoutError':
        return { state: 'failed', code: 'timeout' }
      case 'NotSupportedError':
        return { state: 'failed', code: 'unsupported-input' }
    }
  }
  return { state: 'failed', code: 'provider-unavailable' }
}

export function createBrowserPromptExecutor(options: {
  languageModel?: BrowserLanguageModelApi
  userActivation?: () => boolean
  timeoutMs?: number
}): BrowserPromptExecutor {
  const languageModel =
    options.languageModel ?? (globalThis as LanguageModelGlobal).LanguageModel
  const userActivation =
    options.userActivation ??
    (() => globalThis.navigator?.userActivation?.isActive ?? false)

  return {
    async execute(request) {
      if (!languageModel) {
        return { state: 'unavailable', code: 'api-unavailable' }
      }
      if (request.signal?.aborted) {
        return { state: 'failed', code: 'cancelled' }
      }
      if (request.language === 'pt_BR' || request.language === 'unknown') {
        return { state: 'unavailable', code: 'language-unsupported' }
      }
      const modelOptions = languageOptions(
        request.language,
        request.image !== undefined
      )
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 45_000)
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout
      let availability: string
      try {
        availability = await languageModel.availability(modelOptions)
      } catch (error) {
        return mappedFailure(error, signal)
      }
      if (
        availability === 'unavailable' ||
        availability === 'no' ||
        availability === 'not-available'
      ) {
        return { state: 'unavailable', code: 'model-unavailable' }
      }
      if (
        (availability === 'downloadable' ||
          availability === 'after-download') &&
        !userActivation()
      ) {
        return {
          state: 'unavailable',
          code: 'download-user-activation-required'
        }
      }

      let session: LanguageModelSession | undefined
      try {
        session = await languageModel.create({
          ...modelOptions,
          signal
        })
        const promptInput = request.image
          ? [
              {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, value: request.prompt },
                  {
                    type: 'image' as const,
                    value: new Blob([decodeBase64(request.image.dataBase64)], {
                      type: request.image.mimeType
                    })
                  }
                ]
              }
            ]
          : request.prompt
        const output = await session.prompt(promptInput, {
          responseConstraint: request.responseConstraint,
          signal
        })
        try {
          return { state: 'output', value: JSON.parse(output) }
        } catch {
          return { state: 'failed', code: 'invalid-output' }
        }
      } catch (error) {
        return mappedFailure(error, signal)
      } finally {
        session?.destroy()
      }
    }
  }
}
