import { describe, expect, it } from 'vitest'

import { browserBuiltInModel } from '@/ai/browser/catalog'
import { getProviderRemovalImpact } from '@/application/settings/provider-impact'
import { createDefaultSettings } from '@/core/settings'

describe('provider removal impact', () => {
  it('lists global, platform, primary and fallback references', () => {
    const settings = createDefaultSettings()
    settings.routing.globalRoutes['classification-text'] = {
      state: 'route',
      primary: { providerConfigId: 'provider:target', modelId: 'text' },
      fallbacks: [
        { providerConfigId: 'provider:other', modelId: 'fallback-local' },
        { providerConfigId: 'provider:target', modelId: 'fallback-cloud' }
      ],
      allowCloudFallback: true,
      allowHigherCostFallback: false
    }
    settings.routing.platformOverrides.reddit = {
      'classification-vision': {
        state: 'route',
        primary: { providerConfigId: 'provider:target', modelId: 'vision' },
        fallbacks: [],
        allowCloudFallback: false,
        allowHigherCostFallback: false
      }
    }
    const models = [
      {
        ...browserBuiltInModel(),
        providerConfigId: 'provider:target',
        modelId: 'text'
      },
      {
        ...browserBuiltInModel(),
        providerConfigId: 'provider:target',
        modelId: 'vision'
      }
    ]

    expect(
      getProviderRemovalImpact(settings, models, 'provider:target')
    ).toEqual({
      blocked: true,
      models: ['text', 'vision'],
      providerConfigId: 'provider:target',
      routes: [
        {
          modelId: 'fallback-cloud',
          platform: null,
          role: 'fallback',
          task: 'classification-text'
        },
        {
          modelId: 'text',
          platform: null,
          role: 'primary',
          task: 'classification-text'
        },
        {
          modelId: 'vision',
          platform: 'reddit',
          role: 'primary',
          task: 'classification-vision'
        }
      ]
    })
  })

  it('allows removal when no active route references the provider', () => {
    expect(
      getProviderRemovalImpact(createDefaultSettings(), [], 'provider:unused')
    ).toEqual({
      blocked: false,
      models: [],
      providerConfigId: 'provider:unused',
      routes: []
    })
  })
})
