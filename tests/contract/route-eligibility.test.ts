import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  DEFAULT_BUDGET_POLICY,
  type ModelDescriptor,
  modelDescriptorSchema,
  modelRoutingSettingsSchema
} from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  normalizeConsentKey,
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { RoutingBudget } from '@/ai/routing/budget'
import { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import { resolveEligibleRoute } from '@/ai/routing/eligibility'
import type { ContentItem } from '@/core/content/contracts'
import { buildRuleIndex, evaluateRules } from '@/core/rules/engine'

const now = '2026-07-31T00:00:00.000Z'
const nowMs = Date.parse(now)

function provider(
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId: 'provider:cloud',
    displayName: 'Cloud provider',
    kind: 'openai-compatible',
    execution: 'cloud',
    endpointOrigin: 'https://provider.example',
    credentialMode: 'session-only',
    credentialRef: 'credential:cloud',
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    createdAt: now,
    updatedAt: now,
    status: 'ready',
    ...overrides
  })
}

function model(
  providerConfigId: string,
  modelId: string,
  executionKind: ModelDescriptor['executionKind']
): ModelDescriptor {
  return modelDescriptorSchema.parse({
    providerConfigId,
    modelId,
    displayName: modelId,
    declaredVersion: '1',
    executionKind,
    catalogSource: 'user',
    lastCheckedAt: now,
    status: 'available',
    capabilities: [
      {
        task: 'classification-text',
        modalities: ['text'],
        languages: ['pt'],
        imageMimeTypes: [],
        maxInputBytes: 64_000,
        maxOutputBytes: 8_000,
        structuredOutput: true,
        evidence: 'declared',
        source: 'user',
        verifiedAt: null
      }
    ]
  })
}

function route(
  primaryProviderConfigId = 'provider:cloud',
  primaryModelId = 'cloud-text'
) {
  return {
    state: 'route' as const,
    primary: {
      providerConfigId: primaryProviderConfigId,
      modelId: primaryModelId
    },
    fallbacks: [
      {
        providerConfigId: 'provider:cloud',
        modelId: 'cloud-text'
      }
    ],
    allowCloudFallback: false,
    allowHigherCostFallback: false
  }
}

function settings(primaryProviderConfigId = 'provider:cloud') {
  return modelRoutingSettingsSchema.parse({
    schemaVersion: 1,
    globalRoutes: {
      'classification-text': {
        ...route(primaryProviderConfigId),
        fallbacks:
          primaryProviderConfigId === 'provider:cloud'
            ? []
            : route(primaryProviderConfigId).fallbacks
      }
    },
    platformOverrides: {},
    budgets: {
      ...DEFAULT_BUDGET_POLICY,
      monetaryBudget: {
        ...DEFAULT_BUDGET_POLICY.monetaryBudget,
        enabled: true,
        limit: 5
      }
    }
  })
}

function consentRepository() {
  const consents = new ConsentRepository()
  consents.grant({
    key: normalizeConsentKey({
      providerConfigId: 'provider:cloud',
      endpointOrigin: 'https://provider.example',
      task: 'classification-text',
      platform: 'reddit',
      categories: ['title'],
      includeImages: false,
      consentSchemaVersion: 1
    }),
    providerKind: 'openai-compatible',
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    estimatedFrequency: 'per visible item',
    declaredRetention: 'none',
    consentedAt: now
  })
  return consents
}

function environment(
  options: {
    providers?: ProviderDescriptor[]
    models?: ModelDescriptor[]
    consents?: ConsentRepository
    permission?: boolean
    credential?: boolean
  } = {}
) {
  return {
    providers: new ProviderRegistry(options.providers ?? [provider()]),
    catalog: new ModelCatalog(
      options.models ?? [model('provider:cloud', 'cloud-text', 'cloud')]
    ),
    consents: options.consents ?? consentRepository(),
    permissions: {
      has: () => options.permission ?? true
    },
    credentials: {
      has: () => options.credential ?? true
    },
    budget: new RoutingBudget(
      {
        ...DEFAULT_BUDGET_POLICY,
        monetaryBudget: {
          ...DEFAULT_BUDGET_POLICY.monetaryBudget,
          enabled: true,
          limit: 5
        }
      },
      { timeZone: 'UTC' }
    ),
    circuit: new RouteCircuitBreaker()
  }
}

const content = {
  language: 'pt',
  inputBytes: 4_096,
  modalities: ['text'] as const,
  imageMimeType: null,
  categories: ['title'] as const,
  includeImages: false
}

describe('route eligibility', () => {
  it('revalidates provider, model, consent, permission, credential, budget and circuit', () => {
    const eligible = resolveEligibleRoute({
      settings: settings(),
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: environment(),
      attempt: { kind: 'primary' },
      at: nowMs,
      pricing: {
        estimatedCost: 0.01,
        priceVerifiedAt: nowMs
      }
    })
    expect(eligible).toMatchObject({
      state: 'resolved',
      source: 'global',
      selected: {
        providerConfigId: 'provider:cloud',
        modelId: 'cloud-text'
      },
      fallbackIndex: null,
      reservationId: expect.stringMatching(/^budget:/)
    })
    expect(JSON.stringify(eligible)).not.toContain('provider.example')
    expect(JSON.stringify(eligible)).not.toContain('credential:cloud')

    const missingConsent = resolveEligibleRoute({
      settings: settings(),
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: environment({ consents: new ConsentRepository() }),
      attempt: { kind: 'primary' },
      at: nowMs,
      pricing: {
        estimatedCost: 0.01,
        priceVerifiedAt: nowMs
      }
    })
    expect(missingConsent).toEqual({
      state: 'unavailable',
      source: 'global',
      code: 'consent-missing',
      fallbackIndex: null
    })
  })

  it('supports browser-provided execution without host permission, credential or cloud consent', () => {
    const browserProvider = providerDescriptorSchema.parse({
      ...provider({
        providerConfigId: 'provider:browser',
        displayName: 'Browser model',
        execution: 'browser',
        endpointOrigin: 'https://browser-runtime.invalid',
        credentialMode: 'none',
        credentialRef: null,
        policyUrl: null,
        policyReviewedAt: null
      })
    })
    const result = resolveEligibleRoute({
      settings: settings('provider:browser'),
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: environment({
        providers: [browserProvider],
        models: [model('provider:browser', 'cloud-text', 'browser')],
        consents: new ConsentRepository(),
        permission: false,
        credential: false
      }),
      attempt: { kind: 'primary' },
      at: nowMs
    })

    expect(result).toMatchObject({
      state: 'resolved',
      selected: {
        providerConfigId: 'provider:browser',
        modelId: 'cloud-text'
      }
    })
  })

  it('blocks unauthorized fallback and revalidates an explicitly authorized cloud fallback', () => {
    const localProvider = provider({
      providerConfigId: 'provider:local',
      displayName: 'Local provider',
      execution: 'local',
      endpointOrigin: ['http://', '127', '.0.0.1:11434'].join(''),
      credentialMode: 'none',
      credentialRef: null,
      policyUrl: null,
      policyReviewedAt: null
    })
    const baseEnvironment = environment({
      providers: [localProvider, provider()],
      models: [
        model('provider:local', 'cloud-text', 'local'),
        model('provider:cloud', 'cloud-text', 'cloud')
      ]
    })

    const blocked = resolveEligibleRoute({
      settings: settings('provider:local'),
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: baseEnvironment,
      attempt: {
        kind: 'fallback',
        index: 0,
        failureCategory: 'temporary'
      },
      at: nowMs,
      pricing: {
        estimatedCost: 0.01,
        priceVerifiedAt: nowMs
      }
    })
    expect(blocked).toEqual({
      state: 'unavailable',
      source: 'global',
      code: 'fallback-cloud-not-authorized',
      fallbackIndex: 0
    })

    const authorizedSettings = settings('provider:local')
    const current = authorizedSettings.globalRoutes['classification-text']
    if (current?.state !== 'route') {
      throw new Error('Expected a route fixture')
    }
    current.allowCloudFallback = true
    const allowed = resolveEligibleRoute({
      settings: authorizedSettings,
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: environment({
        providers: [localProvider, provider()],
        models: [
          model('provider:local', 'cloud-text', 'local'),
          model('provider:cloud', 'cloud-text', 'cloud')
        ]
      }),
      attempt: {
        kind: 'fallback',
        index: 0,
        failureCategory: 'temporary'
      },
      at: nowMs,
      pricing: {
        estimatedCost: 0.01,
        priceVerifiedAt: nowMs
      }
    })
    expect(allowed).toMatchObject({
      state: 'resolved',
      fallbackIndex: 0,
      selected: {
        providerConfigId: 'provider:cloud',
        modelId: 'cloud-text'
      }
    })

    expect(
      resolveEligibleRoute({
        settings: authorizedSettings,
        platform: 'reddit',
        task: 'classification-text',
        content,
        environment: environment({
          providers: [localProvider, provider()],
          models: [
            model('provider:local', 'cloud-text', 'local'),
            model('provider:cloud', 'cloud-text', 'cloud')
          ]
        }),
        attempt: {
          kind: 'fallback',
          index: 0,
          failureCategory: 'authorization'
        },
        at: nowMs
      })
    ).toEqual({
      state: 'unavailable',
      source: 'global',
      code: 'fallback-cause-not-allowed',
      fallbackIndex: 0
    })
  })

  it('preserves the deterministic rule baseline after provider removal', () => {
    const routeEnvironment = environment()
    routeEnvironment.providers.revoke('provider:cloud', now)
    const unavailable = resolveEligibleRoute({
      settings: settings(),
      platform: 'reddit',
      task: 'classification-text',
      content,
      environment: routeEnvironment,
      attempt: { kind: 'primary' },
      at: nowMs,
      pricing: {
        estimatedCost: 0.01,
        priceVerifiedAt: nowMs
      }
    })
    expect(unavailable).toMatchObject({
      state: 'unavailable',
      code: 'provider-unavailable'
    })

    const item: ContentItem = {
      id: 'reddit:post:fixture',
      platform: 'reddit',
      identity: {
        status: 'stable',
        platformContentId: 'fixture'
      },
      surface: 'reddit:home',
      title: 'Blocked locally',
      media: [],
      observedAt: now,
      context: {}
    }
    const { index } = buildRuleIndex([
      {
        id: 'rule:local-baseline',
        enabled: true,
        scope: {
          platforms: ['reddit'],
          surfaces: ['reddit:home']
        },
        createdAt: now,
        updatedAt: now,
        kind: 'exact',
        effect: 'block',
        field: 'title',
        value: 'Blocked locally',
        caseSensitive: true
      }
    ])

    expect(
      evaluateRules({
        item,
        index,
        profileRevision: 1
      }).decision.action
    ).toBe('hide')
  })
})
