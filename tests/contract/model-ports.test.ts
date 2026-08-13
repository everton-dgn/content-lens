import { describe, expect, it, vi } from 'vitest'

import {
  ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
  ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
  AssistanceModelFailure,
  createProviderAssistanceModelPort
} from '@/ai/assistance'
import {
  createBrowserAssistanceModelPort,
  createBrowserTextModelPort,
  createBrowserVisualModelPort
} from '@/ai/browser/model-ports'
import {
  CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA,
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION
} from '@/ai/classification/model-output'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { TextModelFailure } from '@/ai/text/classifier'
import { createProviderTextModelPort } from '@/ai/text/provider-port'
import { VisualModelFailure } from '@/ai/vision/classifier'
import { createProviderVisualModelPort } from '@/ai/vision/provider-port'
import { CredentialVault } from '@/security/credentials/vault'

const at = '2026-07-31T08:00:00.000Z'
const provider: ProviderDescriptor = {
  schemaVersion: 1,
  providerConfigId: 'provider:fixture',
  displayName: 'Fixture',
  kind: 'openai-compatible',
  execution: 'cloud',
  endpointOrigin: 'https://provider.example',
  credentialMode: 'none',
  credentialRef: null,
  policyUrl: 'https://provider.example/privacy',
  policyReviewedAt: at,
  createdAt: at,
  updatedAt: at,
  status: 'ready'
}
const vault = new CredentialVault()
const classificationOutput = {
  schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [],
  archetypes: [],
  quality: {},
  semanticRuleMatches: [],
  evidence: [],
  confidence: 0.9,
  abstention: null
}
const visualRequest = {
  task: 'classification-vision' as const,
  prompt: JSON.stringify({ untrustedData: { language: 'en' } }),
  image: {
    bytes: new Uint8Array(0x8001),
    mimeType: 'image/png' as const,
    width: 32,
    height: 32,
    fingerprint: 'sha256:model-port'
  }
}

describe('browser model ports', () => {
  it.each([
    ['{"untrustedData":{"language":"en"}}', 'en'],
    ['{"untrustedData":{"language":"es"}}', 'es'],
    ['{"untrustedData":{"language":"pt_BR"}}', 'pt_BR'],
    ['{"untrustedData":{"language":"unknown"}}', 'unknown'],
    ['{"untrustedData":{"language":"fr"}}', 'unknown'],
    ['not-json', 'unknown']
  ] as const)(
    'derives the bounded prompt language from %s',
    async (prompt, language) => {
      const execute = vi.fn().mockResolvedValue({
        state: 'output',
        value: classificationOutput
      })
      const port = createBrowserTextModelPort({ executor: { execute } })

      await expect(
        port.classify({ task: 'classification-text', prompt })
      ).resolves.toEqual(classificationOutput)
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          language,
          responseConstraint: CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA
        })
      )
    }
  )

  it.each([
    ['cancelled', 'cancelled'],
    ['timeout', 'timeout'],
    ['invalid-output', 'invalid-output'],
    ['language-unsupported', 'unsupported-language'],
    ['unsupported-input', 'unsupported-input'],
    ['api-unavailable', 'provider-unavailable']
  ] as const)(
    'maps browser failure %s for text',
    async (browserCode, expected) => {
      const port = createBrowserTextModelPort({
        executor: {
          execute: vi.fn().mockResolvedValue({
            state: browserCode === 'api-unavailable' ? 'unavailable' : 'failed',
            code: browserCode
          })
        }
      })

      await expect(
        port.classify({
          task: 'classification-text',
          prompt: '{}',
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({ name: 'TextModelFailure', code: expected })
    }
  )

  it('passes one base64 image and preserves a visual output', async () => {
    const execute = vi.fn().mockResolvedValue({
      state: 'output',
      value: classificationOutput
    })
    const port = createBrowserVisualModelPort({ executor: { execute } })

    await expect(port.classify(visualRequest)).resolves.toEqual(
      classificationOutput
    )
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        image: {
          mimeType: 'image/png',
          dataBase64: expect.any(String)
        }
      })
    )
    expect(execute.mock.calls[0]?.[0].image.dataBase64.length).toBeGreaterThan(
      0x8000
    )
  })

  it.each([
    ['language-unsupported', 'unsupported-input'],
    ['unsupported-input', 'unsupported-input'],
    ['timeout', 'timeout']
  ] as const)(
    'maps browser failure %s for vision',
    async (browserCode, expected) => {
      const port = createBrowserVisualModelPort({
        executor: {
          execute: vi.fn().mockResolvedValue({
            state: 'failed',
            code: browserCode
          })
        }
      })

      await expect(port.classify(visualRequest)).rejects.toMatchObject({
        name: 'VisualModelFailure',
        code: expected
      })
    }
  )

  it('uses both assistance task schemas and maps unsupported browser input', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ state: 'output', value: { draft: true } })
      .mockResolvedValueOnce({ state: 'output', value: { explanation: true } })
      .mockResolvedValueOnce({
        state: 'failed',
        code: 'language-unsupported'
      })
      .mockResolvedValueOnce({ state: 'failed', code: 'unsupported-input' })
      .mockResolvedValueOnce({ state: 'failed', code: 'timeout' })
    const port = createBrowserAssistanceModelPort({
      executor: { execute },
      language: 'es'
    })
    const signal = new AbortController().signal

    await expect(
      port.generateDraft({
        task: 'assistance-draft',
        prompt: 'draft',
        outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
        signal
      })
    ).resolves.toEqual({ draft: true })
    await expect(
      port.explain({
        task: 'assistance-explain',
        prompt: 'explain',
        outputSchema: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
        signal
      })
    ).resolves.toEqual({ explanation: true })
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      task: 'assistance-draft',
      language: 'es',
      responseConstraint: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA
    })
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      task: 'assistance-explain',
      responseConstraint: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA
    })

    for (const expected of ['invalid-output', 'invalid-output', 'timeout']) {
      await expect(
        port.explain({
          task: 'assistance-explain',
          prompt: 'failure',
          outputSchema: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
          signal
        })
      ).rejects.toMatchObject({
        name: 'AssistanceModelFailure',
        code: expected
      })
    }
  })
})

describe('network provider model ports', () => {
  it('builds and parses a text request with and without a signal', async () => {
    const execute = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify(classificationOutput)
          }
        }
      ]
    })
    const port = createProviderTextModelPort({
      provider,
      modelId: 'text',
      vault,
      execute
    })

    await expect(
      port.classify({ task: 'classification-text', prompt: 'fixture' })
    ).resolves.toEqual(classificationOutput)
    await expect(
      port.classify({
        task: 'classification-text',
        prompt: 'fixture',
        signal: new AbortController().signal
      })
    ).resolves.toEqual(classificationOutput)
  })

  it.each([
    ['provider-output-invalid', 'invalid-output'],
    ['provider-response-json-invalid', 'invalid-output'],
    ['provider-refused', 'refused'],
    ['provider-content-filtered', 'content-filtered'],
    ['provider-truncated', 'truncated'],
    ['provider-response-too-large', 'resource-limit'],
    ['provider-http-413', 'resource-limit'],
    ['provider-http-400', 'unsupported-input'],
    ['provider-http-422', 'unsupported-input'],
    ['provider-http-402', 'cost-limit'],
    ['provider-http-408', 'timeout'],
    ['provider-http-504', 'timeout'],
    ['other', 'provider-unavailable']
  ] as const)('maps text provider error %s', async (message, expected) => {
    const port = createProviderTextModelPort({
      provider,
      modelId: 'text',
      vault,
      execute: vi.fn().mockRejectedValue(new Error(message))
    })

    await expect(
      port.classify({ task: 'classification-text', prompt: 'fixture' })
    ).rejects.toMatchObject({
      name: 'TextModelFailure',
      code: expected
    })
  })

  it('maps text cancellation, DOM failures and non-errors', async () => {
    const failures: Array<[unknown, string]> = [
      [new TextModelFailure('refused'), 'refused'],
      [new DOMException('aborted', 'AbortError'), 'cancelled'],
      [new DOMException('timed out', 'TimeoutError'), 'timeout'],
      [42, 'provider-unavailable']
    ]
    for (const [failure, expected] of failures) {
      const port = createProviderTextModelPort({
        provider,
        modelId: 'text',
        vault,
        execute: vi.fn().mockRejectedValue(failure)
      })
      await expect(
        port.classify({ task: 'classification-text', prompt: 'fixture' })
      ).rejects.toMatchObject({ code: expected })
    }

    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn()
    const port = createProviderTextModelPort({
      provider,
      modelId: 'text',
      vault,
      execute
    })
    await expect(
      port.classify({
        task: 'classification-text',
        prompt: 'fixture',
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()

    const lateController = new AbortController()
    const late = createProviderTextModelPort({
      provider,
      modelId: 'text',
      vault,
      execute: vi.fn(async () => {
        lateController.abort()
        throw new Error('late')
      })
    })
    await expect(
      late.classify({
        task: 'classification-text',
        prompt: 'fixture',
        signal: lateController.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('builds and parses a visual request with and without a signal', async () => {
    const execute = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify(classificationOutput)
          }
        }
      ]
    })
    const port = createProviderVisualModelPort({
      provider,
      modelId: 'vision',
      vault,
      execute
    })

    await expect(port.classify(visualRequest)).resolves.toEqual(
      classificationOutput
    )
    await expect(
      port.classify({
        ...visualRequest,
        signal: new AbortController().signal
      })
    ).resolves.toEqual(classificationOutput)
    expect(JSON.stringify(execute.mock.calls[0]?.[0].plan.body)).toContain(
      'data:image/png;base64,'
    )
  })

  it.each([
    ['provider-output-invalid', 'invalid-output'],
    ['provider-response-json-invalid', 'invalid-output'],
    ['provider-refused', 'refused'],
    ['provider-content-filtered', 'content-filtered'],
    ['provider-truncated', 'truncated'],
    ['provider-response-too-large', 'resource-limit'],
    ['provider-http-413', 'resource-limit'],
    ['provider-http-400', 'unsupported-media'],
    ['provider-http-415', 'unsupported-media'],
    ['provider-http-422', 'unsupported-media'],
    ['provider-http-402', 'cost-limit'],
    ['provider-http-408', 'timeout'],
    ['provider-http-504', 'timeout'],
    ['other', 'provider-unavailable']
  ] as const)('maps visual provider error %s', async (message, expected) => {
    const port = createProviderVisualModelPort({
      provider,
      modelId: 'vision',
      vault,
      execute: vi.fn().mockRejectedValue(new Error(message))
    })

    await expect(port.classify(visualRequest)).rejects.toMatchObject({
      name: 'VisualModelFailure',
      code: expected
    })
  })

  it('maps visual cancellation, DOM failures and non-errors', async () => {
    const existing = new VisualModelFailure('refused')
    const failures: Array<[unknown, string]> = [
      [existing, 'refused'],
      [new DOMException('aborted', 'AbortError'), 'cancelled'],
      [new DOMException('timed out', 'TimeoutError'), 'timeout'],
      [42, 'provider-unavailable']
    ]
    for (const [failure, expected] of failures) {
      const port = createProviderVisualModelPort({
        provider,
        modelId: 'vision',
        vault,
        execute: vi.fn().mockRejectedValue(failure)
      })
      await expect(port.classify(visualRequest)).rejects.toMatchObject({
        code: expected
      })
    }

    const controller = new AbortController()
    const execute = vi.fn()
    const port = createProviderVisualModelPort({
      provider,
      modelId: 'vision',
      vault,
      execute
    })
    controller.abort()
    await expect(
      port.classify({ ...visualRequest, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()

    const lateController = new AbortController()
    const late = createProviderVisualModelPort({
      provider,
      modelId: 'vision',
      vault,
      execute: vi.fn(async () => {
        lateController.abort()
        throw new Error('late')
      })
    })
    await expect(
      late.classify({ ...visualRequest, signal: lateController.signal })
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('supports compatible proxy kinds and both assistance tasks', async () => {
    for (const kind of ['openai-compatible', 'user-proxy', 'custom'] as const) {
      const execute = vi.fn().mockResolvedValue({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"ok":true}' }
          }
        ]
      })
      const port = createProviderAssistanceModelPort({
        provider: { ...provider, kind },
        modelId: 'assistance',
        vault,
        execute
      })
      const signal = new AbortController().signal

      await expect(
        port.generateDraft({
          task: 'assistance-draft',
          prompt: 'draft',
          outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
          signal
        })
      ).resolves.toEqual({ ok: true })
      await expect(
        port.explain({
          task: 'assistance-explain',
          prompt: 'explain',
          outputSchema: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
          signal
        })
      ).resolves.toEqual({ ok: true })
      expect(JSON.stringify(execute.mock.calls[0]?.[0].plan.body)).toContain(
        'assistance_draft_model_output'
      )
      expect(JSON.stringify(execute.mock.calls[1]?.[0].plan.body)).toContain(
        'assistance_explanation_model_output'
      )
    }
  })

  it.each([
    ['provider-output-invalid', 'invalid-output'],
    ['provider-response-json-invalid', 'invalid-output'],
    ['provider-refused', 'refused'],
    ['provider-content-filtered', 'content-filtered'],
    ['provider-truncated', 'truncated'],
    ['provider-http-408', 'timeout'],
    ['provider-http-504', 'timeout'],
    ['other', 'provider-unavailable']
  ] as const)(
    'maps assistance provider error %s',
    async (message, expected) => {
      const port = createProviderAssistanceModelPort({
        provider,
        modelId: 'assistance',
        vault,
        execute: vi.fn().mockRejectedValue(new Error(message))
      })

      await expect(
        port.generateDraft({
          task: 'assistance-draft',
          prompt: 'draft',
          outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({
        name: 'AssistanceModelFailure',
        code: expected
      })
    }
  )

  it('maps assistance cancellation, DOM failures and non-errors', async () => {
    const failures: Array<[unknown, string]> = [
      [new AssistanceModelFailure('refused'), 'refused'],
      [new DOMException('aborted', 'AbortError'), 'cancelled'],
      [new DOMException('timed out', 'TimeoutError'), 'timeout'],
      [42, 'provider-unavailable']
    ]
    for (const [failure, expected] of failures) {
      const port = createProviderAssistanceModelPort({
        provider,
        modelId: 'assistance',
        vault,
        execute: vi.fn().mockRejectedValue(failure)
      })
      await expect(
        port.generateDraft({
          task: 'assistance-draft',
          prompt: 'draft',
          outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({ code: expected })
    }

    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn()
    const port = createProviderAssistanceModelPort({
      provider,
      modelId: 'assistance',
      vault,
      execute
    })
    await expect(
      port.generateDraft({
        task: 'assistance-draft',
        prompt: 'draft',
        outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()

    const lateController = new AbortController()
    const late = createProviderAssistanceModelPort({
      provider,
      modelId: 'assistance',
      vault,
      execute: vi.fn(async () => {
        lateController.abort()
        throw new Error('late')
      })
    })
    await expect(
      late.explain({
        task: 'assistance-explain',
        prompt: 'explain',
        outputSchema: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
        signal: lateController.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects a browser provider before building a network adapter', () => {
    expect(() =>
      createProviderAssistanceModelPort({
        provider: {
          ...provider,
          kind: 'browser-built-in',
          execution: 'browser',
          endpointOrigin: 'https://browser-ai.contentlens.invalid',
          policyUrl: null,
          policyReviewedAt: null
        },
        modelId: 'browser',
        vault
      })
    ).toThrow('Browser built-in provider has no network adapter')
  })
})
