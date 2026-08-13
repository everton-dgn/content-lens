import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  type BudgetPolicy,
  DEFAULT_BUDGET_POLICY,
  type ModelCapability,
  type ModelDescriptor,
  modelDescriptorSchema,
  modelRoutingSettingsSchema
} from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { RoutingBudget } from '@/ai/routing/budget'
import { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import { resolveEligibleRoute } from '@/ai/routing/eligibility'

const now = '2026-07-31T00:00:00.000Z'
const nowMs = Date.parse(now)
const localOrigin = ['http', '://', '127', '.0.0.1:11434'].join('')

// Every case below stops before the cloud consent gate, so a local provider
// keeps the fixtures down to the guard actually under test.
function provider(
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId: 'provider:local',
    displayName: 'Local provider',
    kind: 'ollama',
    execution: 'local',
    endpointOrigin: localOrigin,
    credentialMode: 'none',
    credentialRef: null,
    policyUrl: null,
    policyReviewedAt: null,
    createdAt: now,
    updatedAt: now,
    status: 'ready',
    ...overrides
  })
}

function model(
  options: {
    capability?: Partial<ModelCapability>
    executionKind?: ModelDescriptor['executionKind']
    modelId?: string
    providerConfigId?: string
    status?: ModelDescriptor['status']
  } = {}
): ModelDescriptor {
  return modelDescriptorSchema.parse({
    providerConfigId: options.providerConfigId ?? 'provider:local',
    modelId: options.modelId ?? 'local-text',
    displayName: options.modelId ?? 'local-text',
    declaredVersion: '1',
    executionKind: options.executionKind ?? 'local',
    catalogSource: 'user',
    lastCheckedAt: now,
    status: options.status ?? 'available',
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
        verifiedAt: null,
        ...options.capability
      }
    ]
  })
}

function settings(
  selection: Record<string, unknown> = {
    state: 'route',
    primary: { providerConfigId: 'provider:local', modelId: 'local-text' },
    fallbacks: [],
    allowCloudFallback: false,
    allowHigherCostFallback: false
  }
) {
  return modelRoutingSettingsSchema.parse({
    schemaVersion: 1,
    globalRoutes: { 'classification-text': selection },
    platformOverrides: {},
    budgets: DEFAULT_BUDGET_POLICY
  })
}

function environment(
  options: {
    budgetPolicy?: BudgetPolicy
    circuit?: RouteCircuitBreaker
    credential?: boolean
    models?: ModelDescriptor[]
    permission?: boolean
    providers?: ProviderDescriptor[]
  } = {}
) {
  return {
    providers: new ProviderRegistry(options.providers ?? [provider()]),
    catalog: new ModelCatalog(options.models ?? [model()]),
    consents: new ConsentRepository(),
    permissions: { has: () => options.permission ?? true },
    credentials: { has: () => options.credential ?? true },
    budget: new RoutingBudget(options.budgetPolicy ?? DEFAULT_BUDGET_POLICY, {
      timeZone: 'UTC'
    }),
    circuit: options.circuit ?? new RouteCircuitBreaker()
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

type ResolveOverrides = Partial<Parameters<typeof resolveEligibleRoute>[0]>

const resolve = (overrides: ResolveOverrides = {}) =>
  resolveEligibleRoute({
    settings: settings(),
    platform: 'reddit',
    task: 'classification-text',
    content,
    environment: environment(),
    attempt: { kind: 'primary' },
    at: nowMs,
    ...overrides
  })

describe('route eligibility configuration blocks', () => {
  it.each([
    { attempt: { kind: 'primary' } as const, fallbackIndex: null },
    {
      attempt: {
        kind: 'fallback',
        index: 2,
        failureCategory: 'temporary'
      } as const,
      fallbackIndex: 2
    }
  ])(
    'reports a disabled route with fallback index $fallbackIndex',
    ({ attempt, fallbackIndex }) => {
      expect(
        resolve({ attempt, settings: settings({ state: 'disabled' }) })
      ).toEqual({
        state: 'unavailable',
        source: 'global',
        code: 'route-disabled',
        fallbackIndex
      })
    }
  )

  it('separates a missing model from a task the model cannot run', () => {
    expect(
      resolve({
        environment: environment({ models: [] })
      })
    ).toMatchObject({ code: 'model-not-found', fallbackIndex: null })

    expect(
      resolve({
        attempt: {
          kind: 'fallback',
          index: 0,
          failureCategory: 'temporary'
        },
        environment: environment({
          models: [
            model({
              capability: {
                task: 'classification-vision',
                modalities: ['text', 'image'],
                imageMimeTypes: ['image/png']
              }
            })
          ]
        })
      })
    ).toMatchObject({ code: 'task-unsupported', fallbackIndex: 0 })
  })

  it('reports a fallback index that the route never configured', () => {
    expect(
      resolve({
        attempt: {
          kind: 'fallback',
          index: 3,
          failureCategory: 'temporary'
        }
      })
    ).toEqual({
      state: 'unavailable',
      source: 'global',
      code: 'fallback-not-configured',
      fallbackIndex: 3
    })
  })

  it('blocks a costlier fallback the route never authorized', () => {
    const withFallback = settings({
      state: 'route',
      primary: { providerConfigId: 'provider:local', modelId: 'local-text' },
      fallbacks: [
        { providerConfigId: 'provider:local', modelId: 'local-spare' }
      ],
      allowCloudFallback: false,
      allowHigherCostFallback: false
    })
    const attempt = {
      kind: 'fallback',
      index: 0,
      failureCategory: 'temporary'
    } as const
    const environmentWithSpare = environment({
      models: [model(), model({ modelId: 'local-spare' })]
    })

    expect(
      resolve({
        attempt,
        environment: environmentWithSpare,
        settings: withFallback,
        pricing: {
          estimatedCost: 0.05,
          priceVerifiedAt: nowMs,
          primaryEstimatedCost: 0.01
        }
      })
    ).toMatchObject({
      code: 'fallback-higher-cost-not-authorized',
      fallbackIndex: 0
    })

    expect(
      resolve({
        attempt,
        environment: environmentWithSpare,
        settings: withFallback,
        pricing: {
          estimatedCost: 0.005,
          priceVerifiedAt: nowMs,
          primaryEstimatedCost: 0.01
        }
      })
    ).toMatchObject({ state: 'resolved', fallbackIndex: 0 })
  })

  it('reports a fallback that points at a model the catalog dropped', () => {
    expect(
      resolve({
        attempt: {
          kind: 'fallback',
          index: 0,
          failureCategory: 'temporary'
        },
        settings: settings({
          state: 'route',
          primary: {
            providerConfigId: 'provider:local',
            modelId: 'local-text'
          },
          fallbacks: [
            { providerConfigId: 'provider:local', modelId: 'local-gone' }
          ],
          allowCloudFallback: false,
          allowHigherCostFallback: false
        })
      })
    ).toMatchObject({ code: 'model-not-found', fallbackIndex: 0 })
  })

  it('reports a fallback whose model is no longer available', () => {
    expect(
      resolve({
        attempt: {
          kind: 'fallback',
          index: 0,
          failureCategory: 'temporary'
        },
        environment: environment({
          models: [
            model(),
            model({ modelId: 'local-stale', status: 'unavailable' })
          ]
        }),
        settings: settings({
          state: 'route',
          primary: {
            providerConfigId: 'provider:local',
            modelId: 'local-text'
          },
          fallbacks: [
            { providerConfigId: 'provider:local', modelId: 'local-stale' }
          ],
          allowCloudFallback: false,
          allowHigherCostFallback: false
        })
      })
    ).toMatchObject({ code: 'task-unsupported', fallbackIndex: 0 })
  })
})

describe('route eligibility provider and model blocks', () => {
  it('reports a provider the registry never had', () => {
    expect(
      resolve({ environment: environment({ providers: [] }) })
    ).toMatchObject({ code: 'provider-not-found' })
  })

  it.each([
    { code: 'provider-temporarily-unavailable', status: 'degraded' },
    { code: 'provider-temporarily-unavailable', status: 'rate-limited' },
    { code: 'provider-unavailable', status: 'unauthorized' },
    { code: 'provider-unavailable', status: 'revoked' },
    { code: 'provider-unavailable', status: 'locked' }
  ] as const)('maps provider status $status to $code', ({ code, status }) => {
    expect(
      resolve({
        environment: environment({ providers: [provider({ status })] })
      })
    ).toMatchObject({ code })
  })

  it('reports a model whose execution disagrees with its provider', () => {
    expect(
      resolve({
        environment: environment({
          models: [model({ executionKind: 'cloud' })]
        })
      })
    ).toMatchObject({ code: 'execution-mismatch' })
  })
})

describe('route eligibility capability blocks', () => {
  it('reports content the model cannot take', () => {
    expect(
      resolve({
        content: { ...content, modalities: ['text', 'image'] }
      })
    ).toMatchObject({ code: 'modality-unsupported' })

    expect(resolve({ content: { ...content, language: 'es' } })).toMatchObject({
      code: 'language-unsupported'
    })

    expect(
      resolve({ content: { ...content, inputBytes: 64_001 } })
    ).toMatchObject({ code: 'input-too-large' })

    expect(
      resolve({
        environment: environment({
          models: [model({ capability: { structuredOutput: false } })]
        })
      })
    ).toMatchObject({ code: 'structured-output-unsupported' })
  })

  it.each([
    { imageMimeType: null, reason: 'no declared image type' },
    { imageMimeType: 'image/heic', reason: 'an image type outside the list' }
  ])('rejects an image request with $reason', ({ imageMimeType }) => {
    expect(
      resolve({
        content: {
          ...content,
          includeImages: true,
          imageMimeType,
          modalities: ['text', 'image']
        },
        environment: environment({
          models: [
            model({
              capability: {
                imageMimeTypes: ['image/png'],
                modalities: ['text', 'image']
              }
            })
          ]
        })
      })
    ).toMatchObject({ code: 'image-mime-unsupported' })
  })
})

describe('route eligibility authorization and circuit blocks', () => {
  it.each([
    {
      credential: true,
      credentialRef: null,
      reason: 'a provider that declares no credential'
    },
    {
      credential: false,
      credentialRef: 'credential:local',
      reason: 'a credential the store no longer holds'
    }
  ])(
    'reports $reason as a missing credential',
    ({ credential, credentialRef }) => {
      expect(
        resolve({
          environment: environment({
            credential,
            providers: [
              provider({ credentialMode: 'session-only', credentialRef })
            ]
          })
        })
      ).toMatchObject({ code: 'credential-missing' })
    }
  )

  it('reports a missing host permission', () => {
    expect(
      resolve({ environment: environment({ permission: false }) })
    ).toMatchObject({ code: 'permission-missing' })
  })

  it('blocks a route whose budget has no room left', () => {
    const routeEnvironment = environment({
      budgetPolicy: { ...DEFAULT_BUDGET_POLICY, maxConcurrentGlobal: 1 }
    })

    expect(resolve({ environment: routeEnvironment })).toMatchObject({
      state: 'resolved'
    })
    // The first reservation is still open, so the single concurrency slot the
    // policy allows is taken.
    expect(resolve({ environment: routeEnvironment })).toMatchObject({
      code: 'budget-blocked'
    })
  })

  it('releases the budget reservation when the circuit is open', () => {
    const circuit = new RouteCircuitBreaker()
    const routeKey = 'provider:local/local-text/classification-text'
    for (let failure = 0; failure < 5; failure += 1) {
      circuit.recordTemporaryFailure(routeKey, nowMs)
    }
    // One concurrent reservation at a time, so a reservation the open circuit
    // failed to give back would surface as `budget-blocked` on the next call.
    const routeEnvironment = environment({
      budgetPolicy: { ...DEFAULT_BUDGET_POLICY, maxConcurrentGlobal: 1 },
      circuit
    })

    expect(resolve({ environment: routeEnvironment })).toMatchObject({
      code: 'circuit-open'
    })
    expect(resolve({ environment: routeEnvironment })).toMatchObject({
      code: 'circuit-open'
    })
  })
})
