import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  DEFAULT_BUDGET_POLICY,
  MODEL_TASK_VALUES,
  modelDescriptorSchema,
  modelRoutingSettingsSchema
} from '@/ai/models/contracts'
import { RoutingBudget } from '@/ai/routing/budget'
import { buildModelCacheKey } from '@/ai/routing/cache-key'
import { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import {
  canAdvanceToFallback,
  resolveConfiguredRoute
} from '@/ai/routing/resolver'
import { PLATFORM_VALUES } from '@/core/content/contracts'

function model(
  modelId: string,
  modalities: Array<'text' | 'image'>,
  executionKind: 'local' | 'browser' | 'cloud' = 'local'
) {
  return modelDescriptorSchema.parse({
    providerConfigId: 'provider:fixture',
    modelId,
    displayName: modelId,
    declaredVersion: null,
    executionKind,
    catalogSource: 'user',
    lastCheckedAt: null,
    status: 'available',
    capabilities: [
      {
        task: 'classification-text',
        modalities,
        languages: ['en', 'pt', 'es'],
        imageMimeTypes: modalities.includes('image') ? ['image/jpeg'] : [],
        maxInputBytes: 128_000,
        maxOutputBytes: 16_000,
        structuredOutput: true,
        evidence: 'declared',
        source: 'user',
        verifiedAt: null
      },
      ...(modalities.includes('image')
        ? [
            {
              task: 'classification-vision' as const,
              modalities,
              languages: ['en', 'pt', 'es'],
              imageMimeTypes: ['image/jpeg'],
              maxInputBytes: 1_000_000,
              maxOutputBytes: 16_000,
              structuredOutput: true,
              evidence: 'declared' as const,
              source: 'user' as const,
              verifiedAt: null
            }
          ]
        : [])
    ]
  })
}

const route = (modelId: string) => ({
  state: 'route' as const,
  primary: {
    providerConfigId: 'provider:fixture',
    modelId
  },
  fallbacks: [],
  allowCloudFallback: false,
  allowHigherCostFallback: false
})

describe('model catalog and routing', () => {
  it('validates versioned cloud token pricing without treating absence as zero', () => {
    const base = {
      ...model('priced-cloud', ['text'], 'cloud'),
      pricing: {
        currency: 'USD',
        unit: 'per-1m-tokens',
        inputPrice: 0.15,
        outputPrice: 0.6,
        verifiedAt: '2026-07-31T00:00:00.000Z',
        version: 'provider-table-2026-07-31',
        sourceUrl: 'https://provider.example/pricing'
      }
    }

    expect(modelDescriptorSchema.parse(base).pricing).toEqual(base.pricing)
    expect(
      modelDescriptorSchema.safeParse({
        ...base,
        pricing: { ...base.pricing, inputPrice: -1 }
      }).success
    ).toBe(false)
    expect(model('unpriced-cloud', ['text'], 'cloud').pricing).toBeUndefined()
  })

  it('resolves all six platforms, five tasks and three configuration states', () => {
    const universal = modelDescriptorSchema.parse({
      providerConfigId: 'provider:matrix',
      modelId: 'all-tasks',
      displayName: 'All tasks',
      declaredVersion: '1',
      executionKind: 'local',
      catalogSource: 'built-in',
      lastCheckedAt: null,
      status: 'available',
      capabilities: MODEL_TASK_VALUES.map(task => ({
        task,
        modalities:
          task === 'classification-vision'
            ? (['text', 'image'] as const)
            : (['text'] as const),
        languages: ['en', 'pt', 'es'],
        imageMimeTypes: task === 'classification-vision' ? ['image/jpeg'] : [],
        maxInputBytes: 128_000,
        maxOutputBytes: 16_000,
        structuredOutput: true,
        evidence: 'declared' as const,
        source: 'built-in' as const,
        verifiedAt: null
      }))
    })
    const catalog = new ModelCatalog([universal])
    const matrixRoute = {
      state: 'route' as const,
      primary: {
        providerConfigId: 'provider:matrix',
        modelId: 'all-tasks'
      },
      fallbacks: [],
      allowCloudFallback: false,
      allowHigherCostFallback: false
    }
    let cases = 0

    for (const platform of PLATFORM_VALUES) {
      for (const task of MODEL_TASK_VALUES) {
        for (const state of ['inherit', 'disabled', 'route'] as const) {
          const settings = modelRoutingSettingsSchema.parse({
            schemaVersion: 1,
            globalRoutes: {
              [task]: matrixRoute
            },
            platformOverrides: {
              [platform]: {
                [task]: state === 'route' ? matrixRoute : { state }
              }
            },
            budgets: DEFAULT_BUDGET_POLICY
          })
          const result = resolveConfiguredRoute({
            settings,
            catalog,
            platform,
            task
          })

          expect(result.state).toBe(
            state === 'disabled' ? 'disabled' : 'resolved'
          )
          expect(result.source).toBe(
            state === 'inherit' ? 'global' : 'platform'
          )
          cases += 1
        }
      }
    }

    expect(cases).toBe(6 * 5 * 3)
  })

  it('never infers image capability from a model name', () => {
    const catalog = new ModelCatalog([model('vision-looking-name', ['text'])])

    expect(
      catalog.supports(
        {
          providerConfigId: 'provider:fixture',
          modelId: 'vision-looking-name'
        },
        'classification-vision'
      )
    ).toBe(false)
  })

  it('applies platform override precedence and hard disabled', () => {
    const catalog = new ModelCatalog([
      model('global-text', ['text']),
      model('reddit-text', ['text'])
    ])
    const settings = modelRoutingSettingsSchema.parse({
      schemaVersion: 1,
      globalRoutes: {
        'classification-text': route('global-text')
      },
      platformOverrides: {
        reddit: {
          'classification-text': route('reddit-text')
        },
        youtube: {
          'classification-text': { state: 'disabled' }
        }
      },
      budgets: DEFAULT_BUDGET_POLICY
    })

    expect(
      resolveConfiguredRoute({
        settings,
        catalog,
        platform: 'reddit',
        task: 'classification-text'
      })
    ).toMatchObject({
      state: 'resolved',
      source: 'platform',
      primary: { modelId: 'reddit-text' }
    })
    expect(
      resolveConfiguredRoute({
        settings,
        catalog,
        platform: 'youtube',
        task: 'classification-text'
      })
    ).toEqual({ state: 'disabled', source: 'platform' })
  })

  it('keeps a separately configured visual route with a text-only override', () => {
    const catalog = new ModelCatalog([
      model('global-multimodal', ['text', 'image']),
      model('reddit-text', ['text'])
    ])
    const settings = modelRoutingSettingsSchema.parse({
      schemaVersion: 1,
      globalRoutes: {
        'classification-text': route('global-multimodal'),
        'classification-vision': route('global-multimodal')
      },
      platformOverrides: {
        reddit: {
          'classification-text': route('reddit-text')
        }
      },
      budgets: DEFAULT_BUDGET_POLICY
    })

    expect(
      resolveConfiguredRoute({
        settings,
        catalog,
        platform: 'reddit',
        task: 'classification-vision'
      })
    ).toMatchObject({
      state: 'resolved',
      source: 'global',
      primary: {
        modelId: 'global-multimodal'
      }
    })
  })

  it('disables vision when a text-only route has no visual route', () => {
    const catalog = new ModelCatalog([model('text-only', ['text'])])
    const settings = modelRoutingSettingsSchema.parse({
      schemaVersion: 1,
      globalRoutes: {
        'classification-text': route('text-only')
      },
      platformOverrides: {},
      budgets: DEFAULT_BUDGET_POLICY
    })

    expect(
      resolveConfiguredRoute({
        settings,
        catalog,
        platform: 'reddit',
        task: 'classification-vision'
      })
    ).toEqual({
      state: 'disabled',
      source: 'global',
      reason: 'text-only-without-vision-route'
    })
  })

  it('rejects duplicate, cyclic and overlong fallback chains', () => {
    const base = {
      schemaVersion: 1,
      globalRoutes: {
        'classification-text': {
          ...route('primary'),
          fallbacks: [
            { providerConfigId: 'provider:fixture', modelId: 'fallback' },
            { providerConfigId: 'provider:fixture', modelId: 'fallback' }
          ]
        }
      },
      platformOverrides: {},
      budgets: DEFAULT_BUDGET_POLICY
    }

    expect(modelRoutingSettingsSchema.safeParse(base).success).toBe(false)
    expect(
      modelRoutingSettingsSchema.safeParse({
        ...base,
        globalRoutes: {
          'classification-text': {
            ...route('primary'),
            fallbacks: [
              { providerConfigId: 'provider:fixture', modelId: 'fallback-1' },
              { providerConfigId: 'provider:fixture', modelId: 'fallback-2' },
              { providerConfigId: 'provider:fixture', modelId: 'fallback-3' },
              { providerConfigId: 'provider:fixture', modelId: 'fallback-4' }
            ]
          }
        }
      }).success
    ).toBe(false)
  })

  it('allows fallback only for temporary or invalid output failures', () => {
    expect(canAdvanceToFallback('temporary')).toBe(true)
    expect(canAdvanceToFallback('invalid-output')).toBe(true)
    expect(canAdvanceToFallback('authorization')).toBe(false)
    expect(canAdvanceToFallback('input')).toBe(false)
    expect(canAdvanceToFallback('budget')).toBe(false)
  })

  it('opens after five temporary failures and permits one recovery probe', () => {
    const circuit = new RouteCircuitBreaker()
    const routeKey = 'provider:fixture/model:fixture/classification-text'
    const start = Date.parse('2026-07-31T00:00:00.000Z')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      circuit.recordTemporaryFailure(routeKey, start + attempt * 1_000)
    }

    expect(circuit.acquire(routeKey, start + 5_000)).toEqual({
      allowed: false,
      state: 'open',
      retryAt: start + 64_000
    })
    expect(circuit.acquire(routeKey, start + 64_000)).toEqual({
      allowed: true,
      state: 'half-open',
      probe: true
    })
    expect(circuit.acquire(routeKey, start + 64_001)).toMatchObject({
      allowed: false,
      state: 'half-open'
    })
    circuit.recordSuccess(routeKey)
    expect(circuit.acquire(routeKey, start + 64_002)).toEqual({
      allowed: true,
      state: 'closed',
      probe: false
    })
  })

  it('reserves and releases provider capacity under the normative defaults', () => {
    const budget = new RoutingBudget(DEFAULT_BUDGET_POLICY, {
      timeZone: 'UTC'
    })
    const at = Date.parse('2026-07-31T00:00:00.000Z')

    const first = budget.reserve({
      providerConfigId: 'provider:one',
      executionKind: 'local',
      at
    })
    expect(first).toMatchObject({ state: 'reserved' })
    expect(
      budget.reserve({
        providerConfigId: 'provider:one',
        executionKind: 'local',
        at
      })
    ).toEqual({ state: 'blocked', code: 'provider-concurrency' })
    if (first.state !== 'reserved') {
      throw new Error('Expected a routing budget reservation')
    }
    budget.release(first.reservationId)
    expect(
      budget.reserve({
        providerConfigId: 'provider:one',
        executionKind: 'local',
        at
      })
    ).toMatchObject({ state: 'reserved' })
  })

  it('blocks automatic cloud execution with disabled or stale pricing', () => {
    const at = Date.parse('2026-07-31T00:00:00.000Z')
    const budget = new RoutingBudget(DEFAULT_BUDGET_POLICY, {
      timeZone: 'UTC'
    })

    expect(
      budget.reserve({
        providerConfigId: 'provider:cloud',
        executionKind: 'cloud',
        at
      })
    ).toEqual({ state: 'blocked', code: 'monetary-budget-disabled' })

    const enabled = new RoutingBudget(
      {
        ...DEFAULT_BUDGET_POLICY,
        monetaryBudget: {
          ...DEFAULT_BUDGET_POLICY.monetaryBudget,
          enabled: true,
          limit: 5
        }
      },
      { timeZone: 'UTC' }
    )
    expect(
      enabled.reserve({
        providerConfigId: 'provider:cloud',
        executionKind: 'cloud',
        at
      })
    ).toEqual({ state: 'blocked', code: 'price-unavailable' })
    expect(
      enabled.reserve({
        providerConfigId: 'provider:cloud',
        executionKind: 'cloud',
        at,
        estimatedCost: 0.01,
        priceVerifiedAt: at - 25 * 60 * 60 * 1_000
      })
    ).toEqual({ state: 'blocked', code: 'price-stale' })
  })

  it('separates cache spaces by route, model, content and policy versions', () => {
    const input = {
      providerConfigId: 'provider:fixture',
      providerFingerprint: 'provider-fingerprint@1',
      modelId: 'model:fixture',
      modelVersion: 'model@1',
      capabilityVersion: 'capability@1',
      task: 'classification-text' as const,
      profileRevision: 8,
      contentFingerprint: 'content@1',
      routeVersion: 'route@1',
      promptVersion: 'prompt@1',
      outputSchemaVersion: 'signals@1',
      preprocessingVersion: 'preprocess@1',
      policyVersion: 'policy@1'
    }

    expect(buildModelCacheKey(input)).toBe(buildModelCacheKey({ ...input }))
    expect(buildModelCacheKey({ ...input, modelVersion: 'model@2' })).not.toBe(
      buildModelCacheKey(input)
    )
    expect(
      buildModelCacheKey({ ...input, policyVersion: 'policy@2' })
    ).not.toBe(buildModelCacheKey(input))
  })
})
