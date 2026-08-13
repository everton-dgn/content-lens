import { describe, expect, it, vi } from 'vitest'

import {
  ASSISTANCE_DRAFT_SCHEMA_VERSION,
  ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
  type AssistanceDraftRequest,
  type AssistanceExplanationRequest
} from '@/ai/assistance'
import {
  browserBuiltInModel,
  browserBuiltInProvider
} from '@/ai/browser/catalog'
import { ModelCatalog } from '@/ai/models/catalog'
import { DEFAULT_BUDGET_POLICY } from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import { normalizeConsentKey } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { createRoutedAssistanceService } from '@/application/assistance/routed-service'
import { createDefaultSettings } from '@/core/settings'
import { CredentialVault } from '@/security/credentials/vault'

const at = '2026-07-31T08:00:00.000Z'
const request: AssistanceDraftRequest = {
  origin: 'natural-language',
  baseRevision: 4,
  platform: 'youtube',
  surface: 'youtube:home',
  language: 'en',
  intent: 'Reduce sensationalist videos',
  trustedContext: {},
  allowedEvidenceCodes: ['user-intent']
}
const output = {
  schemaVersion: ASSISTANCE_DRAFT_SCHEMA_VERSION,
  rule: {
    effect: 'reduce',
    scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
    description: 'Sensationalist videos',
    examples: [],
    exclusions: [],
    threshold: 0.8
  },
  inferredFields: [
    {
      field: 'rule.description',
      confidence: 0.9,
      evidenceCodes: ['user-intent']
    }
  ],
  ambiguousFields: [],
  missingFields: []
}
const explanationRequest: AssistanceExplanationRequest = {
  baseRevision: 4,
  platform: 'youtube',
  surface: 'youtube:home',
  language: 'en',
  contentId: 'youtube:video:fixture',
  decision: 'reduce',
  evidenceCodes: ['rule-match'],
  appliedRuleRefs: ['rule:fixture']
}
const explanationOutput = {
  schemaVersion: ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
  summary: 'The explicit rule reduced this item.',
  signalSources: [
    {
      sourceKind: 'deterministic-rule' as const,
      sourceRef: 'rule:fixture',
      evidenceCodes: ['rule-match']
    }
  ],
  appliedRuleRefs: ['rule:fixture'],
  limitations: []
}

function settings(
  providerConfigId: string,
  modelId: string,
  fallbacks: Array<{ providerConfigId: string; modelId: string }> = []
) {
  const defaults = createDefaultSettings()
  return {
    ...defaults,
    routing: {
      ...defaults.routing,
      globalRoutes: {
        ...defaults.routing.globalRoutes,
        'assistance-draft': {
          state: 'route' as const,
          primary: { providerConfigId, modelId },
          fallbacks,
          allowCloudFallback: false,
          allowHigherCostFallback: false
        }
      }
    }
  }
}

function localRuntime() {
  return {
    providers: new ProviderRegistry([
      {
        schemaVersion: 1,
        providerConfigId: 'provider:ollama',
        displayName: 'Local Ollama',
        kind: 'ollama',
        execution: 'local',
        endpointOrigin: 'http://127.0.0.1:11434',
        credentialMode: 'none',
        credentialRef: null,
        policyUrl: null,
        policyReviewedAt: null,
        createdAt: at,
        updatedAt: at,
        status: 'ready'
      }
    ]),
    catalog: new ModelCatalog([
      {
        providerConfigId: 'provider:ollama',
        modelId: 'assistance',
        displayName: 'Assistance',
        declaredVersion: 'assistance@1',
        executionKind: 'local',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        capabilities: [
          {
            task: 'assistance-draft',
            modalities: ['text'],
            languages: ['en'],
            imageMimeTypes: [],
            maxInputBytes: 64 * 1024,
            maxOutputBytes: 64 * 1024,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      }
    ]),
    consents: new ConsentRepository(),
    vault: new CredentialVault()
  }
}

function explanationRuntime() {
  const runtime = localRuntime()
  return {
    ...runtime,
    catalog: new ModelCatalog([
      {
        providerConfigId: 'provider:ollama',
        modelId: 'assistance',
        displayName: 'Assistance',
        declaredVersion: 'assistance@1',
        executionKind: 'local',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        capabilities: [
          {
            task: 'assistance-explain',
            modalities: ['text'],
            languages: ['en'],
            imageMimeTypes: [],
            maxInputBytes: 64 * 1024,
            maxOutputBytes: 64 * 1024,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      }
    ])
  }
}

function explanationSettings(
  fallbacks: Array<{ providerConfigId: string; modelId: string }> = []
) {
  const configured = createDefaultSettings()
  configured.routing.globalRoutes['assistance-explain'] = {
    state: 'route',
    primary: {
      providerConfigId: 'provider:ollama',
      modelId: 'assistance'
    },
    fallbacks,
    allowCloudFallback: false,
    allowHigherCostFallback: false
  }
  return configured
}

function cloudRuntime(consents: ConsentRepository) {
  return {
    providers: new ProviderRegistry([
      {
        schemaVersion: 1,
        providerConfigId: 'provider:cloud',
        displayName: 'Cloud',
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
    ]),
    catalog: new ModelCatalog([
      {
        providerConfigId: 'provider:cloud',
        modelId: 'assistance-cloud',
        displayName: 'Assistance cloud',
        declaredVersion: 'assistance-cloud@1',
        executionKind: 'cloud',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        pricing: {
          currency: 'USD',
          unit: 'per-1m-tokens',
          inputPrice: 0.1,
          outputPrice: 0.2,
          verifiedAt: at,
          version: 'pricing@1',
          sourceUrl: 'https://provider.example/pricing'
        },
        capabilities: [
          {
            task: 'assistance-draft',
            modalities: ['text'],
            languages: ['en'],
            imageMimeTypes: [],
            maxInputBytes: 64 * 1024,
            maxOutputBytes: 64 * 1024,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      }
    ]),
    consents,
    vault: new CredentialVault()
  }
}

function cloudSettings() {
  const configured = settings('provider:cloud', 'assistance-cloud')
  return {
    ...configured,
    routing: {
      ...configured.routing,
      budgets: {
        ...DEFAULT_BUDGET_POLICY,
        monetaryBudget: {
          ...DEFAULT_BUDGET_POLICY.monetaryBudget,
          enabled: true,
          limit: 1
        }
      }
    }
  }
}

describe('routed assistance service', () => {
  it('routes the complete bounded batch context without dropping category consent inputs', async () => {
    const batchOutput = {
      ...output,
      rule: {
        effect: 'reduce' as const,
        scope: {
          platforms: ['youtube' as const],
          surfaces: ['youtube:home' as const]
        },
        description: 'Repeated sensationalist coverage',
        examples: ['Example one'],
        exclusions: ['Editorial analysis', 'Trusted channel'],
        threshold: 0.8
      },
      inferredFields: []
    }
    const execute = vi.fn().mockResolvedValue({
      done: true,
      message: { role: 'assistant', content: JSON.stringify(batchOutput) }
    })
    const service = createRoutedAssistanceService({
      runtime: localRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      createId: () => 'draft:batch',
      fingerprint: async () => 'sha256:batch'
    })
    const batchRequest: AssistanceDraftRequest = {
      ...request,
      origin: 'batch',
      itemText: 'Representative visible item',
      trustedContext: {
        effect: 'reduce',
        platforms: ['youtube'],
        surfaces: ['youtube:home'],
        description: 'Repeated sensationalist coverage',
        examples: ['Example one'],
        exclusions: ['Editorial analysis'],
        protectedExclusions: ['Trusted channel'],
        threshold: 0.8
      },
      batchEvidence: {
        count: 3,
        targetRefs: ['item:1', 'item:2', 'item:3'],
        representativeExamples: ['Example item'],
        protectedExceptions: ['Protected item'],
        evidenceVersion: 'batch-evidence@1'
      }
    }

    await expect(
      service.generateDraft({
        request: batchRequest,
        settings: settings('provider:ollama', 'assistance'),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'draft-ready' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('routes a local draft and keeps trusted runtime provenance out of the prompt', async () => {
    const execute = vi.fn().mockResolvedValue({
      done: true,
      message: { role: 'assistant', content: JSON.stringify(output) }
    })
    const service = createRoutedAssistanceService({
      runtime: localRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      createId: () => 'draft:routed',
      fingerprint: async () => 'sha256:routed'
    })

    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance'),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'draft-ready',
      proposal: {
        draftId: 'draft:routed',
        provenance: {
          providerConfigId: 'provider:ollama',
          modelId: 'assistance'
        }
      }
    })
    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance'),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'draft-ready', cached: true })
    expect(execute).toHaveBeenCalledOnce()
    expect(JSON.stringify(execute.mock.calls[0]?.[0].plan.body)).not.toContain(
      'provider:ollama'
    )
  })

  it('requires task-specific cloud consent before any request', async () => {
    const classificationOnly = new ConsentRepository([
      {
        key: normalizeConsentKey({
          providerConfigId: 'provider:cloud',
          endpointOrigin: 'https://provider.example',
          task: 'classification-text',
          platform: 'youtube',
          categories: ['body'],
          includeImages: false,
          consentSchemaVersion: 1
        }),
        providerKind: 'openai-compatible',
        policyUrl: 'https://provider.example/privacy',
        policyReviewedAt: at,
        estimatedFrequency: 'per item',
        declaredRetention: 'none',
        consentedAt: at
      }
    ])
    const execute = vi.fn()
    const service = createRoutedAssistanceService({
      runtime: cloudRuntime(classificationOnly),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      fingerprint: async () => 'sha256:cloud'
    })

    await expect(
      service.generateDraft({
        request,
        settings: cloudSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'consent-missing',
      preservedIntent: request.intent
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('uses the browser document executor without a network request', async () => {
    const runtime = {
      providers: new ProviderRegistry([browserBuiltInProvider()]),
      catalog: new ModelCatalog([browserBuiltInModel()]),
      consents: new ConsentRepository(),
      vault: new CredentialVault()
    }
    const browserAi = {
      execute: vi.fn().mockResolvedValue({ state: 'output', value: output })
    }
    const execute = vi.fn()
    const service = createRoutedAssistanceService({
      runtime,
      permissions: { has: vi.fn().mockResolvedValue(false) },
      browserAi,
      execute,
      now: () => new Date(at),
      createId: () => 'draft:browser',
      fingerprint: async () => 'sha256:browser'
    })

    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:browser-built-in', 'gemini-nano'),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'draft-ready',
      proposal: {
        provenance: { executionKind: 'browser' }
      }
    })
    expect(browserAi.execute).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it('routes a local read-only explanation with trusted provenance', async () => {
    const execute = vi.fn().mockResolvedValue({
      done: true,
      message: {
        role: 'assistant',
        content: JSON.stringify(explanationOutput)
      }
    })
    const service = createRoutedAssistanceService({
      runtime: explanationRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      createId: () => 'explanation:routed',
      fingerprint: async () => 'sha256:explanation-routed'
    })

    await expect(
      service.explain({
        request: explanationRequest,
        settings: explanationSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'explanation-ready',
      explanation: {
        explanationId: 'explanation:routed',
        provenance: {
          providerConfigId: 'provider:ollama',
          modelId: 'assistance',
          executionKind: 'local'
        }
      }
    })
    await expect(
      service.explain({
        request: explanationRequest,
        settings: explanationSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'explanation-ready', cached: true })
    expect(execute).toHaveBeenCalledOnce()
    expect(JSON.stringify(execute.mock.calls[0]?.[0].plan.body)).not.toContain(
      'provider:ollama'
    )
  })

  it('fails closed when provider state is unreadable for both tasks', async () => {
    const service = createRoutedAssistanceService({
      runtime: Promise.resolve(undefined),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      fingerprint: async () => 'sha256:unreadable'
    })
    const signal = new AbortController().signal

    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance'),
        signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'provider-state-unreadable',
      preservedIntent: request.intent
    })
    await expect(
      service.explain({
        request: explanationRequest,
        settings: explanationSettings(),
        signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'provider-state-unreadable'
    })
  })

  it('reports a disabled explanation route before invoking a provider', async () => {
    const execute = vi.fn()
    const service = createRoutedAssistanceService({
      runtime: explanationRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      fingerprint: async () => 'sha256:disabled'
    })

    await expect(
      service.explain({
        request: explanationRequest,
        settings: createDefaultSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'route-disabled'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires an open browser document for a browser explanation', async () => {
    const runtime = {
      providers: new ProviderRegistry([browserBuiltInProvider()]),
      catalog: new ModelCatalog([
        {
          ...browserBuiltInModel(),
          capabilities: [
            {
              ...browserBuiltInModel().capabilities[0],
              task: 'assistance-explain' as const
            }
          ]
        }
      ]),
      consents: new ConsentRepository(),
      vault: new CredentialVault()
    }
    const configured = createDefaultSettings()
    configured.routing.globalRoutes['assistance-explain'] = {
      state: 'route',
      primary: {
        providerConfigId: 'provider:browser-built-in',
        modelId: 'gemini-nano'
      },
      fallbacks: [],
      allowCloudFallback: false,
      allowHigherCostFallback: false
    }
    const service = createRoutedAssistanceService({
      runtime,
      permissions: { has: vi.fn().mockResolvedValue(false) },
      fingerprint: async () => 'sha256:browser-closed'
    })

    await expect(
      service.explain({
        request: explanationRequest,
        settings: configured,
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'provider-unavailable'
    })
  })

  it('reports disabled and permission-blocked draft routes before execution', async () => {
    const execute = vi.fn()
    const service = createRoutedAssistanceService({
      runtime: localRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(false) },
      execute,
      fingerprint: async () => 'sha256:draft-unavailable'
    })

    await expect(
      service.generateDraft({
        request,
        settings: createDefaultSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'route-disabled',
      preservedIntent: request.intent
    })
    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance'),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'permission-missing',
      preservedIntent: request.intent
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns rejected provider output for draft and explanation without mutating intent', async () => {
    const execute = vi.fn().mockResolvedValue({
      done: true,
      message: { role: 'assistant', content: '{}' }
    })
    const draftService = createRoutedAssistanceService({
      runtime: localRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      fingerprint: async () => 'sha256:invalid-draft'
    })
    await expect(
      draftService.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance'),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'rejected', code: 'invalid-output' })

    const explanationService = createRoutedAssistanceService({
      runtime: explanationRuntime(),
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      fingerprint: async () => 'sha256:invalid-explanation'
    })
    await expect(
      explanationService.explain({
        request: explanationRequest,
        settings: explanationSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'rejected', code: 'invalid-output' })
  })

  it('advances from invalid draft output to one explicit local fallback', async () => {
    const runtime = localRuntime()
    const primary = runtime.catalog.get({
      providerConfigId: 'provider:ollama',
      modelId: 'assistance'
    })
    if (!primary) {
      throw new Error('Primary assistance model is missing')
    }
    runtime.catalog.upsertUser({
      ...primary,
      modelId: 'assistance-fallback',
      displayName: 'Assistance fallback',
      declaredVersion: 'assistance-fallback@1'
    })
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        done: true,
        message: { role: 'assistant', content: '{}' }
      })
      .mockResolvedValueOnce({
        done: true,
        message: { role: 'assistant', content: JSON.stringify(output) }
      })
    const service = createRoutedAssistanceService({
      runtime,
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      createId: () => 'draft:fallback',
      fingerprint: async () => 'sha256:draft-fallback'
    })

    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:ollama', 'assistance', [
          {
            providerConfigId: 'provider:ollama',
            modelId: 'assistance-fallback'
          }
        ]),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'draft-ready',
      proposal: { draftId: 'draft:fallback' }
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('requires an open browser document for a browser draft', async () => {
    const runtime = {
      providers: new ProviderRegistry([browserBuiltInProvider()]),
      catalog: new ModelCatalog([browserBuiltInModel()]),
      consents: new ConsentRepository(),
      vault: new CredentialVault()
    }
    const service = createRoutedAssistanceService({
      runtime,
      permissions: { has: vi.fn().mockResolvedValue(false) },
      fingerprint: async () => 'sha256:browser-draft-closed'
    })

    await expect(
      service.generateDraft({
        request,
        settings: settings('provider:browser-built-in', 'gemini-nano'),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'provider-unavailable',
      preservedIntent: request.intent
    })
  })

  it('advances from invalid explanation output to one explicit fallback', async () => {
    const runtime = explanationRuntime()
    const primary = runtime.catalog.get({
      providerConfigId: 'provider:ollama',
      modelId: 'assistance'
    })
    if (!primary) {
      throw new Error('Primary explanation model is missing')
    }
    runtime.catalog.upsertUser({
      ...primary,
      modelId: 'explanation-fallback',
      displayName: 'Explanation fallback',
      declaredVersion: 'explanation-fallback@1'
    })
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        done: true,
        message: { role: 'assistant', content: '{}' }
      })
      .mockResolvedValueOnce({
        done: true,
        message: {
          role: 'assistant',
          content: JSON.stringify(explanationOutput)
        }
      })
    const service = createRoutedAssistanceService({
      runtime,
      permissions: { has: vi.fn().mockResolvedValue(true) },
      execute,
      now: () => new Date(at),
      createId: () => 'explanation:fallback',
      fingerprint: async () => 'sha256:explanation-fallback'
    })

    await expect(
      service.explain({
        request: explanationRequest,
        settings: explanationSettings([
          {
            providerConfigId: 'provider:ollama',
            modelId: 'explanation-fallback'
          }
        ]),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'explanation-ready',
      explanation: { explanationId: 'explanation:fallback' }
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
