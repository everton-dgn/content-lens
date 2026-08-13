import { describe, expect, it } from 'vitest'

import {
  browserBuiltInModel,
  browserBuiltInProvider
} from '@/ai/browser/catalog'
import { createLocalProfile } from '@/application/profile/local-profile'
import { writeContentLensSettings } from '@/application/settings/profile-settings'
import { createDefaultSettings } from '@/core/settings'
import { buildLocalSyncEnvelope } from '@/sync/local-envelope'
import { routeValue, updateGlobalRoute } from '@/ui/settings/model'

const at = '2026-07-31T12:00:00.000Z'

describe('local sync envelope projection', () => {
  it('exports the allowlisted configuration and omits local provider secrets', async () => {
    const provider = browserBuiltInProvider()
    const model = browserBuiltInModel()
    const settings = updateGlobalRoute(
      createDefaultSettings(),
      'classification-text',
      routeValue(model)
    )
    const profile = createLocalProfile({ at, profileId: 'profile:fixture' })
    profile.settings = writeContentLensSettings(profile.settings, settings)
    const envelope = await buildLocalSyncEnvelope({
      generation: 0,
      profile,
      providerState: {
        schemaVersion: 1,
        providers: [
          {
            ...provider,
            credentialMode: 'external-vault',
            credentialRef: 'credential:must-not-export'
          }
        ],
        models: [model],
        consents: [],
        credentials: [
          {
            schemaVersion: 1,
            reference: 'credential:must-not-export',
            mode: 'external-vault',
            binding: {
              providerConfigId: provider.providerConfigId,
              endpointOrigin: provider.endpointOrigin
            },
            externalReference: 'vault:item:must-not-export',
            proxyCredentialMode: 'none'
          }
        ]
      },
      syncProfileId: 'sync:fixture'
    })

    expect(envelope.profile.portableProviders[0]).toEqual({
      providerConfigId: provider.providerConfigId,
      displayName: provider.displayName,
      kind: provider.kind,
      execution: provider.execution,
      endpointOrigin: provider.endpointOrigin,
      policyUrl: provider.policyUrl
    })
    expect(envelope.profile.modelCatalog[0]).not.toHaveProperty('status')
    expect(envelope.profile.modelCatalog[0]).not.toHaveProperty('lastCheckedAt')
    expect(envelope.profile.modelBindings).toEqual([
      expect.objectContaining({
        id: 'binding:global:classification-text:0',
        active: true,
        providerConfigId: provider.providerConfigId,
        modelId: model.modelId
      })
    ])
    expect(JSON.stringify(envelope)).not.toMatch(
      /credential:must-not-export|externalReference|vault:item/iu
    )
  })

  it('fails closed when a configured route has no catalog entry', async () => {
    const provider = browserBuiltInProvider()
    const settings = updateGlobalRoute(
      createDefaultSettings(),
      'classification-text',
      'provider:browser-built-in\u0000missing-model'
    )
    const profile = createLocalProfile({ at, profileId: 'profile:fixture' })
    profile.settings = writeContentLensSettings(profile.settings, settings)

    await expect(
      buildLocalSyncEnvelope({
        generation: 0,
        profile,
        providerState: {
          schemaVersion: 1,
          providers: [provider],
          models: [],
          consents: [],
          credentials: []
        },
        syncProfileId: 'sync:fixture'
      })
    ).rejects.toThrow('unknown model binding')
  })
})
