import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  type ModelDescriptor,
  type ModelTask,
  modelDescriptorSchema
} from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { validateSettingsDraft } from '@/application/settings'
import type { Platform } from '@/core/content/contracts'
import {
  type ContentLensSettings,
  contentLensSettingsSchema,
  createDefaultSettings
} from '@/core/settings'
import {
  type ConsentKey,
  normalizeConsentKey
} from '@/security/credentials/contracts'

const now = '2026-07-31T06:20:00.000Z'

function provider(
  providerConfigId: string,
  execution: ProviderDescriptor['execution']
): ProviderDescriptor {
  const localOrigin = ['http://', '127', '.0.0.1:11434'].join('')
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId,
    displayName: providerConfigId,
    kind: 'openai-compatible',
    execution,
    endpointOrigin:
      execution === 'local' ? localOrigin : 'https://provider.example',
    credentialMode: execution === 'cloud' ? 'session-only' : 'none',
    credentialRef:
      execution === 'cloud' ? `credential:${providerConfigId}` : null,
    policyUrl:
      execution === 'cloud' ? 'https://provider.example/privacy' : null,
    policyReviewedAt: execution === 'cloud' ? now : null,
    createdAt: now,
    updatedAt: now,
    status: 'ready'
  })
}

function model(
  providerConfigId: string,
  modelId: string,
  executionKind: ModelDescriptor['executionKind'],
  task: ModelTask
): ModelDescriptor {
  const vision = task === 'classification-vision'
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
        task,
        modalities: vision ? ['text', 'image'] : ['text'],
        languages: ['en', 'pt', 'es'],
        imageMimeTypes: vision ? ['image/jpeg'] : [],
        maxInputBytes: 128_000,
        maxOutputBytes: 16_000,
        structuredOutput: true,
        evidence: 'declared',
        source: 'user',
        verifiedAt: null
      }
    ]
  })
}

function route(
  providerConfigId: string,
  modelId: string,
  options: {
    fallbacks?: { providerConfigId: string; modelId: string }[]
    allowCloudFallback?: boolean
  } = {}
) {
  return {
    state: 'route' as const,
    primary: { providerConfigId, modelId },
    fallbacks: options.fallbacks ?? [],
    allowCloudFallback: options.allowCloudFallback ?? false,
    allowHigherCostFallback: false
  }
}

function configuredSettings(input: {
  platform?: Platform
  task: ModelTask
  primary: { providerConfigId: string; modelId: string }
  fallbacks?: { providerConfigId: string; modelId: string }[]
  allowCloudFallback?: boolean
}): ContentLensSettings {
  const platform = input.platform ?? 'youtube'
  const defaults = createDefaultSettings()
  const configuredRoute = route(
    input.primary.providerConfigId,
    input.primary.modelId,
    {
      fallbacks: input.fallbacks?.map(({ providerConfigId, modelId }) => ({
        providerConfigId,
        modelId
      })),
      allowCloudFallback: input.allowCloudFallback
    }
  )
  return contentLensSettingsSchema.parse({
    ...defaults,
    platforms: {
      ...defaults.platforms,
      [platform]: {
        ...defaults.platforms[platform],
        state: 'enabled'
      }
    },
    routing: {
      ...defaults.routing,
      globalRoutes: {
        ...defaults.routing.globalRoutes,
        ...(input.platform ? {} : { [input.task]: configuredRoute })
      },
      platformOverrides: input.platform
        ? {
            ...defaults.routing.platformOverrides,
            [platform]: { [input.task]: configuredRoute }
          }
        : defaults.routing.platformOverrides
    }
  })
}

function key(
  input: {
    providerConfigId?: string
    task?: ModelTask
    platform?: Platform
    categories?: ConsentKey['categories']
    includeImages?: boolean
  } = {}
): ConsentKey {
  const task = input.task ?? 'classification-text'
  return normalizeConsentKey({
    providerConfigId: input.providerConfigId ?? 'provider:cloud',
    endpointOrigin: 'https://provider.example',
    task,
    platform: input.platform ?? 'youtube',
    categories:
      input.categories ??
      (task === 'classification-vision' ? ['title', 'image'] : ['title']),
    includeImages: input.includeImages ?? task === 'classification-vision',
    consentSchemaVersion: 1
  })
}

function grant(repository: ConsentRepository, consentKey: ConsentKey) {
  repository.grant({
    key: consentKey,
    providerKind: 'openai-compatible',
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    estimatedFrequency: 'per visible item',
    declaredRetention: 'none',
    consentedAt: now
  })
}

function environment(input: {
  providers: ProviderDescriptor[]
  models: ModelDescriptor[]
  consents?: ConsentRepository
}) {
  return {
    providers: new ProviderRegistry(input.providers),
    catalog: new ModelCatalog(input.models),
    consents: input.consents ?? new ConsentRepository()
  }
}

describe('settings cloud consent', () => {
  it('blocks a cloud route until the exact reviewed ConsentKey has a receipt', () => {
    const cloud = provider('provider:cloud', 'cloud')
    const cloudModel = model(
      'provider:cloud',
      'cloud-text',
      'cloud',
      'classification-text'
    )
    const settings = configuredSettings({
      task: 'classification-text',
      primary: cloudModel
    })
    const consents = new ConsentRepository()
    const consentKey = key()
    grant(consents, consentKey)
    const currentEnvironment = environment({
      providers: [cloud],
      models: [cloudModel],
      consents
    })

    expect(
      validateSettingsDraft(settings, currentEnvironment, {
        reviewedConsentKeys: []
      })
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: 'consent-missing',
          path: 'routing.globalRoutes.classification-text.primary'
        }
      ]
    })
    expect(
      validateSettingsDraft(settings, currentEnvironment, {
        reviewedConsentKeys: [consentKey]
      })
    ).toMatchObject({
      success: true,
      consentKeys: [consentKey]
    })
  })

  it('does not let a text receipt authorize a visual route', () => {
    const cloud = provider('provider:cloud', 'cloud')
    const visionModel = model(
      'provider:cloud',
      'cloud-vision',
      'cloud',
      'classification-vision'
    )
    const settings = configuredSettings({
      platform: 'x',
      task: 'classification-vision',
      primary: visionModel
    })
    const consents = new ConsentRepository()
    const textConsent = key({
      task: 'classification-text',
      platform: 'x',
      categories: ['title'],
      includeImages: false
    })
    grant(consents, textConsent)

    expect(
      validateSettingsDraft(
        settings,
        environment({
          providers: [cloud],
          models: [visionModel],
          consents
        }),
        { reviewedConsentKeys: [textConsent] }
      )
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: 'consent-missing',
          path: 'routing.platformOverrides.x.classification-vision.primary'
        }
      ]
    })
  })

  it('requires an exact receipt for every executable cloud fallback', () => {
    const local = provider('provider:local', 'local')
    const cloud = provider('provider:cloud', 'cloud')
    const localModel = model(
      'provider:local',
      'local-text',
      'local',
      'classification-text'
    )
    const cloudModel = model(
      'provider:cloud',
      'cloud-text',
      'cloud',
      'classification-text'
    )
    const settings = configuredSettings({
      task: 'classification-text',
      primary: localModel,
      fallbacks: [cloudModel],
      allowCloudFallback: true
    })
    const consents = new ConsentRepository()
    const consentKey = key()
    const currentEnvironment = environment({
      providers: [local, cloud],
      models: [localModel, cloudModel],
      consents
    })

    expect(
      validateSettingsDraft(settings, currentEnvironment, {
        reviewedConsentKeys: []
      })
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: 'consent-missing',
          path: 'routing.globalRoutes.classification-text.fallbacks.0'
        }
      ]
    })

    grant(consents, consentKey)
    expect(
      validateSettingsDraft(settings, currentEnvironment, {
        reviewedConsentKeys: [consentKey]
      })
    ).toMatchObject({ success: true })
  })

  it('keeps local routes valid without a consent review', () => {
    const local = provider('provider:local', 'local')
    const localModel = model(
      'provider:local',
      'local-text',
      'local',
      'classification-text'
    )
    const settings = configuredSettings({
      task: 'classification-text',
      primary: localModel
    })

    expect(
      validateSettingsDraft(
        settings,
        environment({ providers: [local], models: [localModel] }),
        { reviewedConsentKeys: [] }
      )
    ).toMatchObject({ success: true, consentKeys: [] })
  })
})
