import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  MODEL_TASK_VALUES,
  type ModelDescriptor,
  type ModelRoutingSettings,
  modelDescriptorSchema
} from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import {
  previewEffectiveRoute,
  projectContentLensSettings,
  resetPlatformOverride,
  validateSettingsDraft,
  writeContentLensSettings
} from '@/application/settings'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import {
  type ContentLensSettings,
  contentLensSettingsSchema,
  createDefaultSettings
} from '@/core/settings'

const now = '2026-07-31T00:00:00.000Z'

function provider(
  providerConfigId: string,
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  const loopbackOrigin = [
    'http:',
    '',
    [[...['127', '0', '0', '1']].join('.'), '11434'].join(':')
  ].join('/')
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId,
    displayName: providerConfigId,
    kind: 'openai-compatible',
    execution: 'local',
    endpointOrigin: loopbackOrigin,
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
  providerConfigId: string,
  modelId: string,
  tasks: readonly ('classification-text' | 'classification-vision')[]
): ModelDescriptor {
  return modelDescriptorSchema.parse({
    providerConfigId,
    modelId,
    displayName: modelId,
    declaredVersion: '1',
    executionKind: 'local',
    catalogSource: 'user',
    lastCheckedAt: now,
    status: 'available',
    capabilities: tasks.map(task => ({
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
      evidence: 'declared',
      source: 'user',
      verifiedAt: null
    }))
  })
}

function route(providerConfigId: string, modelId: string) {
  return {
    state: 'route' as const,
    primary: { providerConfigId, modelId },
    fallbacks: [],
    allowCloudFallback: false,
    allowHigherCostFallback: false
  }
}

function withRouting(
  settings: ContentLensSettings,
  routing: Partial<ModelRoutingSettings>
): ContentLensSettings {
  return contentLensSettingsSchema.parse({
    ...settings,
    routing: {
      ...settings.routing,
      ...routing
    }
  })
}

describe('shared settings contract', () => {
  it('projects legacy profile settings without duplicating model routing', () => {
    const defaults = createDefaultSettings()
    const projected = projectContentLensSettings({
      enabledPlatforms: ['youtube', 'reddit', 'unknown'],
      modelRouting: defaults.routing,
      thresholds: { hide: 0.9 }
    })

    expect(projected.source).toBe('legacy')
    expect(projected.issues).toEqual(['unknown-platform:unknown'])
    expect(projected.settings.routing).toEqual(defaults.routing)
    expect(projected.settings.platforms.youtube.state).toBe('enabled')
    expect(projected.settings.platforms.reddit.state).toBe('enabled')
    expect(projected.settings.platforms.linkedin.state).toBe('disabled')

    const written = writeContentLensSettings(
      {
        enabledPlatforms: ['youtube'],
        routing: { obsolete: true },
        thresholds: { hide: 0.9 }
      },
      projected.settings
    )

    expect(written).toMatchObject({
      settingsSchemaVersion: 1,
      modelRouting: projected.settings.routing,
      platforms: projected.settings.platforms,
      interface: projected.settings.interface,
      thresholds: { hide: 0.9 }
    })
    expect(written).not.toHaveProperty('enabledPlatforms')
    expect(written).not.toHaveProperty('routing')
    expect(written).not.toHaveProperty('contentLensSettings')
  })

  it('recovers invalid canonical profile fields with explicit diagnostics', () => {
    const projected = projectContentLensSettings({
      settingsSchemaVersion: 1,
      modelRouting: { schemaVersion: 999 },
      platforms: { youtube: { state: 'enabled' } },
      interface: { locale: 'made-up' }
    })

    expect(projected.source).toBe('recovered')
    expect(projected.issues).toEqual([
      'invalid-model-routing',
      'invalid-platform-settings',
      'invalid-interface-settings'
    ])
    expect(projected.settings).toEqual(createDefaultSettings())
  })

  it('creates a deterministic baseline with five tasks and six platforms', () => {
    const settings = createDefaultSettings()

    expect(Object.keys(settings.routing.globalRoutes)).toEqual(
      MODEL_TASK_VALUES
    )
    expect(
      MODEL_TASK_VALUES.map(task => settings.routing.globalRoutes[task]?.state)
    ).toEqual(MODEL_TASK_VALUES.map(() => 'disabled'))
    expect(Object.keys(settings.platforms)).toEqual(PLATFORM_VALUES)
    expect(settings.platforms.youtube.state).toBe('enabled')
    expect(
      PLATFORM_VALUES.filter(platform => platform !== 'youtube').map(
        platform => settings.platforms[platform].state
      )
    ).toEqual(['disabled', 'disabled', 'disabled', 'disabled', 'disabled'])
    expect(JSON.stringify(settings)).not.toMatch(
      /api[-_]?key|passphrase|credentialValue|secret/i
    )
  })

  it('uses a strict secret-free schema and rejects cross-platform surfaces', () => {
    const settings = createDefaultSettings()

    expect(
      contentLensSettingsSchema.safeParse({
        ...settings,
        [['api', 'Key'].join('')]: ['canary', 'secret'].join('-')
      }).success
    ).toBe(false)
    expect(
      contentLensSettingsSchema.safeParse({
        ...settings,
        platforms: {
          ...settings.platforms,
          youtube: {
            ...settings.platforms.youtube,
            surfaces: {
              ...settings.platforms.youtube.surfaces,
              'reddit:home': true
            }
          }
        }
      }).success
    ).toBe(false)
  })

  it('previews inheritance and a platform override without copying global values', () => {
    const providers = new ProviderRegistry([provider('provider:local')])
    const catalog = new ModelCatalog([
      model('provider:local', 'global-text', ['classification-text']),
      model('provider:local', 'reddit-text', ['classification-text'])
    ])
    const global = route('provider:local', 'global-text')
    const overridden = withRouting(createDefaultSettings(), {
      globalRoutes: {
        ...createDefaultSettings().routing.globalRoutes,
        'classification-text': global
      },
      platformOverrides: {
        reddit: {
          'classification-text': route('provider:local', 'reddit-text')
        }
      }
    })

    expect(
      previewEffectiveRoute({
        settings: overridden,
        catalog,
        providers,
        platform: 'youtube',
        task: 'classification-text'
      })
    ).toMatchObject({
      state: 'resolved',
      source: 'global',
      inherited: true,
      primary: {
        providerConfigId: 'provider:local',
        modelId: 'global-text'
      }
    })
    expect(
      previewEffectiveRoute({
        settings: overridden,
        catalog,
        providers,
        platform: 'reddit',
        task: 'classification-text'
      })
    ).toMatchObject({
      state: 'resolved',
      source: 'platform',
      inherited: false,
      primary: {
        providerConfigId: 'provider:local',
        modelId: 'reddit-text'
      }
    })

    const reset = resetPlatformOverride(
      overridden,
      'reddit',
      'classification-text'
    )
    expect(
      reset.routing.platformOverrides.reddit?.['classification-text']
    ).toBeUndefined()
    expect(
      previewEffectiveRoute({
        settings: reset,
        catalog,
        providers,
        platform: 'reddit',
        task: 'classification-text'
      })
    ).toMatchObject({
      source: 'global',
      inherited: true,
      primary: global.primary
    })
  })

  it('disables vision for text-only routing and keeps a separate visual route', () => {
    const providers = new ProviderRegistry([provider('provider:local')])
    const catalog = new ModelCatalog([
      model('provider:local', 'text-only', ['classification-text']),
      model('provider:local', 'visual', ['classification-vision'])
    ])
    const textOnly = withRouting(createDefaultSettings(), {
      globalRoutes: {
        ...createDefaultSettings().routing.globalRoutes,
        'classification-text': route('provider:local', 'text-only')
      }
    })

    expect(
      previewEffectiveRoute({
        settings: textOnly,
        catalog,
        providers,
        platform: 'youtube',
        task: 'classification-vision'
      })
    ).toEqual({
      state: 'disabled',
      source: 'global',
      inherited: true,
      reason: 'text-only-without-vision-route'
    })

    const separateVision = withRouting(textOnly, {
      globalRoutes: {
        ...textOnly.routing.globalRoutes,
        'classification-vision': route('provider:local', 'visual')
      }
    })
    expect(
      previewEffectiveRoute({
        settings: separateVision,
        catalog,
        providers,
        platform: 'youtube',
        task: 'classification-vision'
      })
    ).toMatchObject({
      state: 'resolved',
      primary: {
        providerConfigId: 'provider:local',
        modelId: 'visual'
      }
    })
  })

  it('validates every configured primary and fallback before save', () => {
    const active = createDefaultSettings()
    const providers = new ProviderRegistry([
      provider('provider:ready'),
      provider('provider:revoked', { status: 'revoked' })
    ])
    const catalog = new ModelCatalog([
      model('provider:ready', 'text', ['classification-text']),
      model('provider:revoked', 'revoked-text', ['classification-text'])
    ])
    const missingModel = withRouting(active, {
      globalRoutes: {
        ...active.routing.globalRoutes,
        'classification-text': route('provider:ready', 'missing')
      }
    })
    const disconnectedProvider = withRouting(active, {
      globalRoutes: {
        ...active.routing.globalRoutes,
        'classification-text': route('provider:revoked', 'revoked-text')
      }
    })

    expect(
      validateSettingsDraft(missingModel, {
        catalog,
        providers,
        consents: new ConsentRepository()
      })
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: 'model-not-found',
          path: 'routing.globalRoutes.classification-text.primary'
        }
      ]
    })
    expect(
      validateSettingsDraft(disconnectedProvider, {
        catalog,
        providers,
        consents: new ConsentRepository()
      })
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: 'provider-disconnected',
          path: 'routing.globalRoutes.classification-text.primary'
        }
      ]
    })
    expect(active).toEqual(createDefaultSettings())
  })

  it('resolves the complete six-platform by five-task preview matrix', () => {
    const settings = createDefaultSettings()
    const providers = new ProviderRegistry()
    const catalog = new ModelCatalog()
    let cases = 0

    for (const platform of PLATFORM_VALUES) {
      for (const task of MODEL_TASK_VALUES) {
        expect(
          previewEffectiveRoute({
            settings,
            catalog,
            providers,
            platform,
            task
          })
        ).toMatchObject({
          state: 'disabled',
          source: 'global',
          inherited: true
        })
        cases += 1
      }
    }
    expect(cases).toBe(6 * 5)
  })
})
