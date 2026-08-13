import { describe, expect, it, vi } from 'vitest'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import { providerDescriptorSchema } from '@/ai/providers/contracts'
import type { executeProviderRequestPlan } from '@/ai/providers/request-policy'
import { createProviderTextModelPort } from '@/ai/text/provider-port'
import { CredentialVault } from '@/security/credentials/vault'

const at = '2026-07-31T08:00:00.000Z'
const provider = providerDescriptorSchema.parse({
  schemaVersion: 1,
  providerConfigId: 'provider:text-port',
  displayName: 'Text port fixture',
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
})
const output: ClassificationModelOutput = {
  schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [],
  archetypes: [],
  quality: {},
  semanticRuleMatches: [],
  evidence: [],
  confidence: null,
  abstention: null
}

function response(value: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: JSON.stringify(value)
        }
      }
    ]
  }
}

describe('provider text-model port', () => {
  it('executes one text-only request and returns only validated model output', async () => {
    const execute = vi.fn(
      async (_input: Parameters<typeof executeProviderRequestPlan>[0]) =>
        response(output)
    )
    const port = createProviderTextModelPort({
      provider,
      modelId: 'model:text-only',
      vault: new CredentialVault(),
      execute
    })

    await expect(
      port.classify({
        task: 'classification-text',
        prompt: '{"untrustedData":{"content":{"body":"fixture"}}}'
      })
    ).resolves.toEqual(output)
    expect(execute).toHaveBeenCalledOnce()
    const serialized = JSON.stringify(execute.mock.calls[0]?.[0])
    expect(serialized).not.toContain('image_url')
    expect(serialized).not.toContain('input_image')
    expect(serialized).not.toContain('provenance')
  })

  it('maps invalid provider output and cancellation to explicit failures', async () => {
    const invalid = createProviderTextModelPort({
      provider,
      modelId: 'model:text-only',
      vault: new CredentialVault(),
      execute: async () => response({ ...output, action: 'hide' })
    })
    await expect(
      invalid.classify({
        task: 'classification-text',
        prompt: '{}'
      })
    ).rejects.toMatchObject({
      code: 'invalid-output'
    })

    const controller = new AbortController()
    controller.abort()
    const cancelled = createProviderTextModelPort({
      provider,
      modelId: 'model:text-only',
      vault: new CredentialVault(),
      execute: async () => {
        throw new DOMException('cancelled', 'AbortError')
      }
    })
    await expect(
      cancelled.classify({
        task: 'classification-text',
        prompt: '{}',
        signal: controller.signal
      })
    ).rejects.toMatchObject({
      code: 'cancelled'
    })
  })
})
