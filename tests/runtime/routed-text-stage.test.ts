import { describe, expect, it, vi } from 'vitest'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import { ModelCatalog } from '@/ai/models/catalog'
import { DEFAULT_BUDGET_POLICY } from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import { normalizeConsentKey } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import {
  createRoutedTextStage,
  ruleSignalsFromClassification
} from '@/application/decision-pipeline/text-stage'
import type { ContentItem } from '@/core/content/contracts'
import { createDefaultSettings } from '@/core/settings'
import { CredentialVault } from '@/security/credentials/vault'

const at = '2026-07-31T08:00:00.000Z'
const item: ContentItem = {
  id: 'youtube:video:routed-text',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'routed-text'
  },
  surface: 'youtube:home',
  title: 'Synthetic routed text fixture',
  body: 'A bounded body for semantic classification.',
  media: [
    {
      kind: 'image',
      url: 'https://images.example/must-not-cross.jpg'
    }
  ],
  observedAt: at,
  language: 'en',
  context: {}
}

const output: ClassificationModelOutput = {
  schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [{ topicId: 'software', score: 0.9, evidenceRefs: [] }],
  archetypes: [],
  quality: {},
  semanticRuleMatches: [],
  evidence: [],
  confidence: 0.9,
  abstention: null
}

function runtime(maxInputBytes = 4_096) {
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
        modelId: 'text-primary',
        displayName: 'Text primary',
        declaredVersion: 'text-primary@1',
        executionKind: 'local',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        capabilities: [
          {
            task: 'classification-text',
            modalities: ['text'],
            languages: ['en', 'pt_BR', 'es', 'unknown'],
            imageMimeTypes: [],
            maxInputBytes,
            maxOutputBytes: 16_384,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      },
      {
        providerConfigId: 'provider:ollama',
        modelId: 'text-fallback',
        displayName: 'Text fallback',
        declaredVersion: 'text-fallback@1',
        executionKind: 'local',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        capabilities: [
          {
            task: 'classification-text',
            modalities: ['text'],
            languages: ['en', 'pt_BR', 'es', 'unknown'],
            imageMimeTypes: [],
            maxInputBytes,
            maxOutputBytes: 16_384,
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

function cloudRuntime() {
  const providerConfigId = 'provider:cloud'
  const endpointOrigin = 'https://provider.example'
  return {
    providers: new ProviderRegistry([
      {
        schemaVersion: 1,
        providerConfigId,
        displayName: 'Cloud fixture',
        kind: 'openai-compatible',
        execution: 'cloud',
        endpointOrigin,
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
        providerConfigId,
        modelId: 'cloud-text',
        displayName: 'Cloud text',
        declaredVersion: 'cloud-text@1',
        executionKind: 'cloud',
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        pricing: {
          currency: 'USD',
          unit: 'per-1m-tokens',
          inputPrice: 0.15,
          outputPrice: 0.6,
          verifiedAt: at,
          version: 'fixture-pricing@1',
          sourceUrl: 'https://provider.example/pricing'
        },
        capabilities: [
          {
            task: 'classification-text',
            modalities: ['text'],
            languages: ['en'],
            imageMimeTypes: [],
            maxInputBytes: 4_096,
            maxOutputBytes: 16_384,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      }
    ]),
    consents: new ConsentRepository([
      {
        key: normalizeConsentKey({
          providerConfigId,
          endpointOrigin,
          task: 'classification-text',
          platform: 'youtube',
          categories: ['title', 'body'],
          includeImages: false,
          consentSchemaVersion: 1
        }),
        providerKind: 'openai-compatible',
        policyUrl: 'https://provider.example/privacy',
        policyReviewedAt: at,
        estimatedFrequency: 'per visible unresolved item',
        declaredRetention: 'none',
        consentedAt: at
      }
    ]),
    vault: new CredentialVault()
  }
}

function settings(
  fallbacks: Array<{ providerConfigId: string; modelId: string }> = []
) {
  const defaults = createDefaultSettings()
  return {
    ...defaults,
    routing: {
      schemaVersion: 1 as const,
      globalRoutes: {
        ...defaults.routing.globalRoutes,
        'classification-text': {
          state: 'route' as const,
          primary: {
            providerConfigId: 'provider:ollama',
            modelId: 'text-primary'
          },
          fallbacks,
          allowCloudFallback: false,
          allowHigherCostFallback: false
        }
      },
      platformOverrides: {},
      budgets: DEFAULT_BUDGET_POLICY
    }
  }
}

function ollamaResponse(value: unknown) {
  return {
    message: {
      role: 'assistant',
      content: JSON.stringify(value)
    },
    done: true
  }
}

function cloudSettings(monetaryBudgetEnabled: boolean) {
  const defaults = createDefaultSettings()
  return {
    ...defaults,
    routing: {
      ...defaults.routing,
      globalRoutes: {
        ...defaults.routing.globalRoutes,
        'classification-text': {
          state: 'route' as const,
          primary: {
            providerConfigId: 'provider:cloud',
            modelId: 'cloud-text'
          },
          fallbacks: [],
          allowCloudFallback: false,
          allowHigherCostFallback: false
        }
      },
      budgets: {
        ...DEFAULT_BUDGET_POLICY,
        monetaryBudget: {
          ...DEFAULT_BUDGET_POLICY.monetaryBudget,
          enabled: monetaryBudgetEnabled,
          limit: monetaryBudgetEnabled ? 1 : 0
        }
      }
    }
  }
}

describe('routed text stage', () => {
  it('resolves a local text route and sends zero image data', async () => {
    const execute = vi.fn(async (_request: { plan: { body: unknown } }) =>
      ollamaResponse(output)
    )
    const stage = createRoutedTextStage({
      runtime: runtime(),
      permissions: {
        has: vi.fn(async () => true)
      },
      execute,
      now: () => new Date(at)
    })

    const result = await stage.classify({
      item,
      semanticRules: [],
      profileRevision: 3,
      pageInstanceId: 'page:routed-text',
      settings: settings(),
      signal: new AbortController().signal
    })

    expect(result.state).toBe('signals')
    expect(execute).toHaveBeenCalledOnce()
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).not.toContain(
      'must-not-cross'
    )
  })

  it('uses only an explicit fallback after invalid primary output', async () => {
    const execute = vi.fn(async (request: { plan: { body: unknown } }) => {
      const modelId = JSON.stringify(request.plan.body).includes('text-primary')
        ? 'primary'
        : 'fallback'
      return ollamaResponse(
        modelId === 'primary' ? { ...output, action: 'hide' } : output
      )
    })
    const stage = createRoutedTextStage({
      runtime: runtime(),
      permissions: {
        has: vi.fn(async () => true)
      },
      execute,
      now: () => new Date(at)
    })

    await expect(
      stage.classify({
        item,
        semanticRules: [],
        profileRevision: 3,
        pageInstanceId: 'page:routed-text',
        settings: settings([
          {
            providerConfigId: 'provider:ollama',
            modelId: 'text-fallback'
          }
        ]),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'signals' })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('fails open without a configured route or network request', async () => {
    const execute = vi.fn()
    const stage = createRoutedTextStage({
      runtime: runtime(),
      permissions: {
        has: vi.fn(async () => true)
      },
      execute,
      now: () => new Date(at)
    })

    await expect(
      stage.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:routed-text',
        settings: createDefaultSettings(),
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'provider-unavailable',
        detailCode: 'route-disabled'
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reuses only a versioned compatible signal cache entry', async () => {
    const entries = new Map<string, unknown>()
    const execute = vi.fn(async () => ollamaResponse(output))
    const stage = createRoutedTextStage({
      runtime: runtime(),
      permissions: {
        has: vi.fn(async () => true)
      },
      cache: {
        read: async id => entries.get(id),
        write: async entry => {
          entries.set(entry.id, entry.value)
        }
      },
      execute,
      now: () => new Date(at)
    })
    const request = {
      item,
      semanticRules: [],
      profileRevision: 3,
      pageInstanceId: 'page:routed-text',
      settings: settings(),
      signal: new AbortController().signal
    }

    const first = await stage.classify(request)
    const second = await stage.classify(request)
    const changedRevision = await stage.classify({
      ...request,
      profileRevision: 4
    })

    expect(first.state).toBe('signals')
    expect(second).toEqual(first)
    expect(changedRevision.state).toBe('signals')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(entries.size).toBe(2)
  })

  it('blocks cloud by default and runs only with consent, fresh pricing and budget', async () => {
    const execute = vi.fn(async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify(output)
          }
        }
      ]
    }))
    const stage = createRoutedTextStage({
      runtime: cloudRuntime(),
      permissions: {
        has: vi.fn(async () => true)
      },
      execute,
      now: () => new Date(at)
    })
    const request = {
      item,
      semanticRules: [],
      profileRevision: 3,
      pageInstanceId: 'page:routed-cloud',
      signal: new AbortController().signal
    }

    await expect(
      stage.classify({
        ...request,
        settings: cloudSettings(false)
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: {
        code: 'cost-limit',
        detailCode: 'budget-blocked'
      }
    })
    expect(execute).not.toHaveBeenCalled()

    await expect(
      stage.classify({
        ...request,
        settings: cloudSettings(true)
      })
    ).resolves.toMatchObject({ state: 'signals' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('fails open before execution for cancellation and unreadable runtime state', async () => {
    const execute = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const stage = createRoutedTextStage({
      runtime: Promise.resolve(undefined),
      permissions: { has: vi.fn(async () => true) },
      execute
    })

    await expect(
      stage.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:cancelled',
        settings: settings(),
        signal: controller.signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'cancelled' }
    })
    await expect(
      stage.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:runtime-unavailable',
        settings: settings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'provider-state-unreadable' }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails open when the configured provider binding disappears', async () => {
    const environment = runtime()
    environment.providers.remove('provider:ollama')
    const execute = vi.fn()
    const stage = createRoutedTextStage({
      runtime: environment,
      permissions: { has: vi.fn(async () => true) },
      execute
    })

    await expect(
      stage.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:binding-unavailable',
        settings: settings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'route-binding-unavailable' }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('maps permission and preprocessing limits without calling a provider', async () => {
    const deniedExecute = vi.fn()
    const denied = createRoutedTextStage({
      runtime: runtime(),
      permissions: { has: vi.fn(async () => false) },
      execute: deniedExecute
    })
    await expect(
      denied.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:permission-denied',
        settings: settings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: {
        code: 'provider-unavailable',
        detailCode: 'permission-missing'
      }
    })
    expect(deniedExecute).not.toHaveBeenCalled()

    const limitedExecute = vi.fn()
    const limited = createRoutedTextStage({
      runtime: runtime(8),
      permissions: { has: vi.fn(async () => true) },
      execute: limitedExecute
    })
    await expect(
      limited.classify({
        item,
        semanticRules: [],
        profileRevision: 0,
        pageInstanceId: 'page:input-limited',
        settings: settings(),
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'resource-limit' }
    })
    expect(limitedExecute).not.toHaveBeenCalled()
  })

  it('retains the highest semantic and preference scores', async () => {
    const stage = createRoutedTextStage({
      runtime: runtime(),
      permissions: { has: vi.fn(async () => true) },
      execute: vi.fn(async () => ollamaResponse(output))
    })
    const result = await stage.classify({
      item,
      semanticRules: [],
      profileRevision: 0,
      pageInstanceId: 'page:rule-signals',
      settings: settings(),
      signal: new AbortController().signal
    })
    if (result.state !== 'signals') {
      throw new Error('Text classification did not produce signals')
    }

    expect(
      ruleSignalsFromClassification({
        ...result.signals,
        topics: [
          { topicId: 'software', score: 0.4, evidenceRefs: [] },
          { topicId: 'software', score: 0.9, evidenceRefs: [] }
        ],
        archetypes: [
          { archetypeId: 'ragebait', score: 0.75, evidenceRefs: [] }
        ],
        quality: { clickbait: 0.8, noise: undefined },
        semanticRuleMatches: [
          { ruleId: 'rule:one', score: 0.3, evidenceRefs: [] },
          { ruleId: 'rule:one', score: 0.85, evidenceRefs: [] }
        ]
      })
    ).toEqual({
      semanticScores: { 'rule:one': 0.85 },
      preferenceScores: {
        'topic\u0000software': 0.9,
        'archetype\u0000ragebait': 0.75,
        'quality\u0000clickbait': 0.8
      }
    })
  })
})
