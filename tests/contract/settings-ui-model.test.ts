import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { createDefaultSettings } from '@/core/settings'
import {
  requiredCloudConsents,
  routeValue,
  updateGlobalFallback,
  updateGlobalFallbackPolicy,
  updateGlobalRoute
} from '@/ui/settings/model'

const at = '2026-07-31T15:00:00.000Z'
const provider: ProviderDescriptor = {
  schemaVersion: 1,
  providerConfigId: 'provider:cloud',
  displayName: 'Cloud fixture',
  kind: 'openai-compatible',
  execution: 'cloud',
  endpointOrigin: 'https://provider.example',
  credentialMode: 'session-only',
  credentialRef: 'credential:fixture',
  policyUrl: 'https://provider.example/privacy',
  policyReviewedAt: at,
  createdAt: at,
  updatedAt: at,
  status: 'ready'
}
const model: ModelDescriptor = {
  providerConfigId: provider.providerConfigId,
  modelId: 'multimodal-fixture',
  displayName: 'Multimodal fixture',
  declaredVersion: '1',
  executionKind: 'cloud',
  catalogSource: 'user',
  lastCheckedAt: at,
  status: 'available',
  capabilities: [
    {
      task: 'classification-text',
      modalities: ['text'],
      languages: ['pt'],
      imageMimeTypes: [],
      maxInputBytes: 16_384,
      maxOutputBytes: 4_096,
      structuredOutput: true,
      evidence: 'declared',
      source: 'user',
      verifiedAt: null
    },
    {
      task: 'classification-vision',
      modalities: ['text', 'image'],
      languages: ['pt'],
      imageMimeTypes: ['image/jpeg'],
      maxInputBytes: 1_048_576,
      maxOutputBytes: 4_096,
      structuredOutput: true,
      evidence: 'declared',
      source: 'user',
      verifiedAt: null
    }
  ]
}
const snapshot = {
  state: 'ready',
  providers: {
    providers: [provider],
    models: [model],
    credentials: [],
    consents: []
  }
} as unknown as SettingsRuntimeSnapshot

describe('Settings UI routing model', () => {
  it('creates separate exact consent keys for text and image tasks', () => {
    const selected = routeValue(model)
    const withText = updateGlobalRoute(
      createDefaultSettings(),
      'classification-text',
      selected
    )
    const withVision = updateGlobalRoute(
      withText,
      'classification-vision',
      selected
    )
    const required = requiredCloudConsents(withVision, snapshot, at)

    expect(required).toHaveLength(2)
    expect(required.map(({ key }) => key.task)).toEqual([
      'classification-text',
      'classification-vision'
    ])
    expect(required[0]?.key).toMatchObject({
      platform: 'youtube',
      includeImages: false
    })
    expect(required[0]?.key.categories).not.toContain('image')
    expect(required[1]?.key).toMatchObject({
      platform: 'youtube',
      includeImages: true
    })
    expect(required[1]?.key.categories).toContain('image')
  })

  it('preserves an explicit fallback chain and policy while changing primary', () => {
    const first = { providerConfigId: 'provider:first', modelId: 'first' }
    const fallback = {
      providerConfigId: 'provider:fallback',
      modelId: 'fallback'
    }
    const replacement = {
      providerConfigId: 'provider:replacement',
      modelId: 'replacement'
    }
    const selected = updateGlobalRoute(
      createDefaultSettings(),
      'classification-text',
      routeValue(first)
    )
    const withFallback = updateGlobalFallback(
      selected,
      'classification-text',
      0,
      routeValue(fallback)
    )
    const withPolicy = updateGlobalFallbackPolicy(
      withFallback,
      'classification-text',
      'allowCloudFallback',
      true
    )
    const replaced = updateGlobalRoute(
      withPolicy,
      'classification-text',
      routeValue(replacement)
    )

    expect(replaced.routing.globalRoutes['classification-text']).toEqual({
      state: 'route',
      primary: replacement,
      fallbacks: [fallback],
      allowCloudFallback: true,
      allowHigherCostFallback: false
    })
    expect(
      updateGlobalFallback(
        replaced,
        'classification-text',
        1,
        routeValue(fallback)
      )
    ).toBe(replaced)
  })
})
