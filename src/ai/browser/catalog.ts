import type { ModelDescriptor } from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'

export const BROWSER_BUILT_IN_PROVIDER_ID = 'provider:browser-built-in'
export const BROWSER_BUILT_IN_MODEL_ID = 'gemini-nano'
export const BROWSER_BUILT_IN_CAPABILITY_VERSION =
  'chrome-prompt-api@2026-05-19'

const checkedAt = '2026-05-19T00:00:00.000Z'

export function browserBuiltInProvider(): ProviderDescriptor {
  return {
    schemaVersion: 1,
    providerConfigId: BROWSER_BUILT_IN_PROVIDER_ID,
    displayName: 'Browser built-in AI',
    kind: 'browser-built-in',
    execution: 'browser',
    endpointOrigin: 'https://browser-ai.contentlens.invalid',
    credentialMode: 'none',
    credentialRef: null,
    policyUrl: null,
    policyReviewedAt: null,
    createdAt: checkedAt,
    updatedAt: checkedAt,
    status: 'ready'
  }
}

export function browserBuiltInModel(): ModelDescriptor {
  const capabilityBase = {
    modalities: ['text'] as Array<'text' | 'image'>,
    languages: ['en', 'es'],
    imageMimeTypes: [],
    maxInputBytes: 64 * 1024,
    maxOutputBytes: 64 * 1024,
    structuredOutput: true,
    evidence: 'declared' as const,
    source: 'built-in' as const,
    verifiedAt: checkedAt
  }
  return {
    providerConfigId: BROWSER_BUILT_IN_PROVIDER_ID,
    modelId: BROWSER_BUILT_IN_MODEL_ID,
    displayName: 'Gemini Nano through Chrome Prompt API',
    declaredVersion: BROWSER_BUILT_IN_CAPABILITY_VERSION,
    executionKind: 'browser',
    catalogSource: 'built-in',
    lastCheckedAt: checkedAt,
    status: 'available',
    capabilities: [
      { ...capabilityBase, task: 'classification-text' },
      {
        ...capabilityBase,
        task: 'classification-vision',
        modalities: ['text', 'image'],
        imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
      },
      { ...capabilityBase, task: 'assistance-draft' },
      { ...capabilityBase, task: 'assistance-explain' }
    ]
  }
}
