import { describe, expect, it, vi } from 'vitest'

import { createBrowserPromptExecutor } from '@/ai/browser/language-model'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: {
    answer: { type: 'string' }
  }
} as const

describe('browser-provided Prompt API executor', () => {
  it('reports absence and unsupported Portuguese without creating a session', async () => {
    const absent = createBrowserPromptExecutor({ languageModel: undefined })
    await expect(
      absent.execute({
        task: 'assistance-explain',
        prompt: 'fixture',
        language: 'en',
        responseConstraint: schema
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'api-unavailable'
    })

    const create = vi.fn()
    const unsupported = createBrowserPromptExecutor({
      languageModel: {
        availability: vi.fn(),
        create
      }
    })
    await expect(
      unsupported.execute({
        task: 'assistance-draft',
        prompt: 'fixture',
        language: 'pt_BR',
        responseConstraint: schema
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'language-unsupported'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('uses identical modality options and validates structured JSON locally', async () => {
    const destroy = vi.fn()
    const prompt = vi.fn().mockResolvedValue('{"answer":"ok"}')
    const availability = vi.fn().mockResolvedValue('available')
    const create = vi.fn().mockResolvedValue({ prompt, destroy })
    const executor = createBrowserPromptExecutor({
      languageModel: { availability, create }
    })

    await expect(
      executor.execute({
        task: 'classification-text',
        prompt: 'Classify this fixture',
        language: 'es',
        responseConstraint: schema
      })
    ).resolves.toEqual({
      state: 'output',
      value: { answer: 'ok' }
    })

    expect(availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['en', 'es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }]
    })
    expect(create).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['en', 'es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
      signal: expect.any(AbortSignal)
    })
    expect(prompt).toHaveBeenCalledWith('Classify this fixture', {
      responseConstraint: schema,
      signal: expect.any(AbortSignal)
    })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('passes one minimized image as a Blob and requires activation for download', async () => {
    const downloading = createBrowserPromptExecutor({
      languageModel: {
        availability: vi.fn().mockResolvedValue('downloadable'),
        create: vi.fn()
      },
      userActivation: () => false
    })
    await expect(
      downloading.execute({
        task: 'classification-vision',
        prompt: 'fixture',
        language: 'en',
        responseConstraint: schema,
        image: {
          mimeType: 'image/png',
          dataBase64: 'iVBORw0KGgo='
        }
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'download-user-activation-required'
    })

    const prompt = vi.fn().mockResolvedValue('{"answer":"image"}')
    const executor = createBrowserPromptExecutor({
      languageModel: {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue({
          prompt,
          destroy: vi.fn()
        })
      }
    })
    await executor.execute({
      task: 'classification-vision',
      prompt: 'fixture',
      language: 'en',
      responseConstraint: schema,
      image: {
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo='
      }
    })

    const promptInput = prompt.mock.calls[0]?.[0]
    expect(promptInput).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', value: 'fixture' },
          { type: 'image', value: expect.any(Blob) }
        ]
      }
    ])
  })

  it('maps invalid JSON and aborts without returning partial output', async () => {
    const invalid = createBrowserPromptExecutor({
      languageModel: {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue({
          prompt: vi.fn().mockResolvedValue('{invalid'),
          destroy: vi.fn()
        })
      }
    })
    await expect(
      invalid.execute({
        task: 'assistance-explain',
        prompt: 'fixture',
        language: 'en',
        responseConstraint: schema
      })
    ).resolves.toEqual({
      state: 'failed',
      code: 'invalid-output'
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      invalid.execute({
        task: 'assistance-explain',
        prompt: 'fixture',
        language: 'en',
        responseConstraint: schema,
        signal: controller.signal
      })
    ).resolves.toEqual({
      state: 'failed',
      code: 'cancelled'
    })
  })

  it.each(['unavailable', 'no', 'not-available'])(
    'maps browser availability %s to model unavailable',
    async availabilityState => {
      const executor = createBrowserPromptExecutor({
        languageModel: {
          availability: vi.fn().mockResolvedValue(availabilityState),
          create: vi.fn()
        }
      })

      await expect(
        executor.execute({
          task: 'classification-text',
          prompt: 'fixture',
          language: 'en',
          responseConstraint: schema
        })
      ).resolves.toEqual({
        state: 'unavailable',
        code: 'model-unavailable'
      })
    }
  )

  it.each([
    [new DOMException('aborted', 'AbortError'), 'cancelled'],
    [new DOMException('timed out', 'TimeoutError'), 'timeout'],
    [new DOMException('unsupported', 'NotSupportedError'), 'unsupported-input'],
    [new Error('provider failed'), 'provider-unavailable']
  ] as const)(
    'maps availability failure %# to %s',
    async (failure, expectedCode) => {
      const executor = createBrowserPromptExecutor({
        languageModel: {
          availability: vi.fn().mockRejectedValue(failure),
          create: vi.fn()
        }
      })

      await expect(
        executor.execute({
          task: 'classification-text',
          prompt: 'fixture',
          language: 'en',
          responseConstraint: schema
        })
      ).resolves.toEqual({
        state: 'failed',
        code: expectedCode
      })
    }
  )

  it('treats cancellation during availability as authoritative', async () => {
    const controller = new AbortController()
    const executor = createBrowserPromptExecutor({
      languageModel: {
        availability: vi.fn(async () => {
          controller.abort()
          throw new Error('late provider error')
        }),
        create: vi.fn()
      }
    })

    await expect(
      executor.execute({
        task: 'classification-text',
        prompt: 'fixture',
        language: 'en',
        responseConstraint: schema,
        signal: controller.signal
      })
    ).resolves.toEqual({
      state: 'failed',
      code: 'cancelled'
    })
  })
})
