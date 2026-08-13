import { describe, expect, it } from 'vitest'

import { MODEL_TASK_VALUES, type ModelDescriptor } from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import { createDefaultSettings } from '@/core/settings'
import {
  effectiveRoute,
  hasConsent,
  modelsForTask,
  parseRouteValue,
  requiredCloudConsents,
  routeValue,
  updateGlobalFallback,
  updateGlobalFallbackPolicy,
  updateGlobalRoute,
  updatePlatformFallback,
  updatePlatformFallbackPolicy,
  updatePlatformRoute
} from '@/ui/settings/model'

const at = '2026-07-31T12:00:00.000Z'
const primary = { providerConfigId: 'provider:cloud', modelId: 'model:all' }
const secondary = {
  providerConfigId: 'provider:local',
  modelId: 'model:local'
}

const capabilities: ModelDescriptor['capabilities'] = MODEL_TASK_VALUES.map(
  task => ({
    task,
    modalities:
      task === 'classification-vision'
        ? (['text', 'image'] as const)
        : (['text'] as const),
    languages: ['en', 'pt_BR', 'es'],
    imageMimeTypes: task === 'classification-vision' ? ['image/png'] : [],
    maxInputBytes: 65_536,
    maxOutputBytes: 8_192,
    structuredOutput: true,
    evidence: 'probe-verified' as const,
    source: 'provider' as const,
    verifiedAt: at
  })
)

const cloudModel: ModelDescriptor = {
  ...primary,
  displayName: 'Cloud all tasks',
  declaredVersion: '1',
  executionKind: 'cloud',
  catalogSource: 'provider',
  lastCheckedAt: at,
  status: 'available',
  capabilities
}
const localModel: ModelDescriptor = {
  ...secondary,
  displayName: 'Local text',
  declaredVersion: null,
  executionKind: 'local',
  catalogSource: 'user',
  lastCheckedAt: at,
  status: 'available',
  capabilities: capabilities.slice(0, 1)
}
const cloudProvider: ProviderDescriptor = {
  schemaVersion: 1,
  providerConfigId: primary.providerConfigId,
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

describe('settings routing model', () => {
  it('round-trips route values and rejects malformed encodings', () => {
    expect(parseRouteValue(routeValue(primary))).toEqual(primary)
    expect(parseRouteValue('provider-only')).toBeUndefined()
    expect(parseRouteValue('\u0000model')).toBeUndefined()
    expect(parseRouteValue('provider\u0000')).toBeUndefined()
    expect(parseRouteValue('provider\u0000model\u0000extra')).toBeUndefined()
  })

  it('filters models by availability and task', () => {
    const unavailable = { ...localModel, status: 'unavailable' as const }
    expect(
      modelsForTask(
        [cloudModel, localModel, unavailable],
        'classification-text'
      )
    ).toEqual([cloudModel, localModel])
    expect(modelsForTask([localModel], 'embedding')).toEqual([])
  })

  it('creates, replaces and disables global routes while keeping a valid fallback chain', () => {
    const defaults = createDefaultSettings()
    const configured = updateGlobalRoute(
      defaults,
      'classification-text',
      routeValue(primary)
    )
    expect(
      effectiveRoute(configured, 'youtube', 'classification-text')
    ).toMatchObject({
      state: 'route',
      primary,
      fallbacks: []
    })
    const withFallback = updateGlobalFallback(
      configured,
      'classification-text',
      0,
      routeValue(secondary)
    )
    expect(
      effectiveRoute(withFallback, 'youtube', 'classification-text')
    ).toMatchObject({ fallbacks: [secondary] })
    expect(
      updateGlobalFallback(
        withFallback,
        'classification-text',
        -1,
        routeValue(primary)
      )
    ).toBe(withFallback)
    expect(
      updateGlobalFallback(
        withFallback,
        'classification-text',
        0,
        routeValue(primary)
      )
    ).toBe(withFallback)
    expect(
      updateGlobalFallback(
        withFallback,
        'classification-text',
        2,
        routeValue(primary)
      )
    ).toBe(withFallback)
    const truncated = updateGlobalFallback(
      withFallback,
      'classification-text',
      0,
      'invalid'
    )
    expect(
      effectiveRoute(truncated, 'youtube', 'classification-text')
    ).toMatchObject({
      fallbacks: []
    })
    const replaced = updateGlobalRoute(
      withFallback,
      'classification-text',
      routeValue(secondary)
    )
    expect(
      effectiveRoute(replaced, 'youtube', 'classification-text')
    ).toMatchObject({
      primary: secondary,
      fallbacks: []
    })
    const disabled = updateGlobalRoute(
      replaced,
      'classification-text',
      'disabled'
    )
    expect(effectiveRoute(disabled, 'youtube', 'classification-text')).toEqual({
      state: 'disabled'
    })
  })

  it('updates global and platform fallback policies only for active routes', () => {
    const defaults = createDefaultSettings()
    expect(
      updateGlobalFallbackPolicy(
        defaults,
        'embedding',
        'allowCloudFallback',
        true
      )
    ).toBe(defaults)
    const global = updateGlobalRoute(defaults, 'embedding', routeValue(primary))
    expect(
      updateGlobalFallbackPolicy(
        global,
        'embedding',
        'allowHigherCostFallback',
        true
      ).routing.globalRoutes.embedding
    ).toMatchObject({ allowHigherCostFallback: true })

    expect(
      updatePlatformFallbackPolicy(
        defaults,
        'reddit',
        'embedding',
        'allowCloudFallback',
        true
      )
    ).toBe(defaults)
    const platform = updatePlatformRoute(
      defaults,
      'reddit',
      'embedding',
      routeValue(primary)
    )
    expect(
      updatePlatformFallbackPolicy(
        platform,
        'reddit',
        'embedding',
        'allowCloudFallback',
        true
      ).routing.platformOverrides.reddit?.embedding
    ).toMatchObject({ allowCloudFallback: true })
  })

  it('supports inherit, disabled, routed and fallback platform states', () => {
    const defaults = createDefaultSettings()
    const inherited = updatePlatformRoute(
      defaults,
      'reddit',
      'classification-text',
      'inherit'
    )
    expect(
      inherited.routing.platformOverrides.reddit?.['classification-text']
    ).toEqual({
      state: 'inherit'
    })
    const disabled = updatePlatformRoute(
      inherited,
      'reddit',
      'classification-text',
      'disabled'
    )
    expect(effectiveRoute(disabled, 'reddit', 'classification-text')).toEqual({
      state: 'disabled'
    })
    const routed = updatePlatformRoute(
      disabled,
      'reddit',
      'classification-text',
      routeValue(primary)
    )
    const withFallback = updatePlatformFallback(
      routed,
      'reddit',
      'classification-text',
      0,
      routeValue(secondary)
    )
    expect(
      effectiveRoute(withFallback, 'reddit', 'classification-text')
    ).toMatchObject({
      primary,
      fallbacks: [secondary]
    })
    expect(
      updatePlatformFallback(
        withFallback,
        'reddit',
        'classification-text',
        1,
        routeValue(secondary)
      )
    ).toBe(withFallback)
    expect(
      updatePlatformFallback(
        withFallback,
        'reddit',
        'classification-text',
        0,
        'invalid'
      ).routing.platformOverrides.reddit?.['classification-text']
    ).toMatchObject({ fallbacks: [] })
  })

  it('derives deduplicated cloud consent receipts for every model task', () => {
    const settings = createDefaultSettings()
    for (const platform of PLATFORM_VALUES) {
      settings.platforms[platform].state = 'enabled'
    }
    for (const task of MODEL_TASK_VALUES) {
      settings.routing.globalRoutes[task] = {
        state: 'route',
        primary,
        fallbacks: [],
        allowCloudFallback: false,
        allowHigherCostFallback: false
      }
    }
    const snapshot = {
      providers: {
        providers: [cloudProvider],
        models: [cloudModel],
        credentials: [],
        consents: []
      }
    } as unknown as SettingsRuntimeSnapshot
    const required = requiredCloudConsents(settings, snapshot, at)
    expect(required).toHaveLength(
      PLATFORM_VALUES.length * MODEL_TASK_VALUES.length
    )
    expect(required.map(({ key }) => key.task)).toEqual(
      expect.arrayContaining([...MODEL_TASK_VALUES])
    )
    const vision = required.find(
      ({ key }) => key.task === 'classification-vision'
    )
    expect(vision?.key).toMatchObject({ includeImages: true })
    expect(vision?.key.categories).toContain('image')
    expect(
      required.find(({ key }) => key.task === 'embedding')?.key.categories
    ).toEqual(['title', 'body'])
    const firstRequirement = required[0]
    if (!firstRequirement) throw new Error('Cloud consent fixture is missing')
    expect(hasConsent([firstRequirement.receipt], firstRequirement.key)).toBe(
      true
    )
    expect(hasConsent([], firstRequirement.key)).toBe(false)

    settings.platforms.youtube.state = 'disabled'
    settings.routing.globalRoutes.embedding = { state: 'disabled' }
    expect(requiredCloudConsents(settings, snapshot, at)).toHaveLength(
      (PLATFORM_VALUES.length - 1) * (MODEL_TASK_VALUES.length - 1)
    )
    expect(
      requiredCloudConsents(
        settings,
        {
          providers: { ...snapshot.providers, models: [] }
        } as unknown as SettingsRuntimeSnapshot,
        at
      )
    ).toEqual([])
  })
})
