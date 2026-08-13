import type { ModelRoutingSettings } from '@/ai/models/contracts'
import { projectContentLensSettings } from '@/application/settings/profile-settings'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import type { ProviderStateSnapshot } from '@/storage/provider-state/contracts'
import { sealSyncEnvelope } from '@/sync/canonical'
import {
  emptySyncProfile,
  type PortableModelBinding,
  type SyncEnvelope,
  type Tombstone
} from '@/sync/contracts'

type BuildLocalSyncEnvelopeInput = {
  generation: number
  profile: ProfileEnvelope
  providerState: ProviderStateSnapshot
  syncProfileId: string
  tombstones?: Tombstone[]
}

function appendRouteBindings(
  bindings: PortableModelBinding[],
  scope: string,
  platform: Platform | null,
  task: PortableModelBinding['task'],
  route: ModelRoutingSettings['globalRoutes'][PortableModelBinding['task']]
) {
  if (route?.state !== 'route') {
    return
  }
  ;[route.primary, ...route.fallbacks].forEach((reference, position) => {
    bindings.push({
      id: `binding:${scope}:${task}:${position}`,
      platform,
      task,
      providerConfigId: reference.providerConfigId,
      modelId: reference.modelId,
      active: true
    })
  })
}

function portableBindings(routing: ModelRoutingSettings) {
  const bindings: PortableModelBinding[] = []
  for (const [task, route] of Object.entries(routing.globalRoutes)) {
    appendRouteBindings(
      bindings,
      'global',
      null,
      task as PortableModelBinding['task'],
      route
    )
  }
  for (const platform of PLATFORM_VALUES) {
    const overrides = routing.platformOverrides[platform]
    if (!overrides) {
      continue
    }
    for (const [task, route] of Object.entries(overrides)) {
      appendRouteBindings(
        bindings,
        `platform:${platform}`,
        platform,
        task as PortableModelBinding['task'],
        route?.state === 'inherit' ? undefined : route
      )
    }
  }
  return bindings
}

export async function buildLocalSyncEnvelope(
  input: BuildLocalSyncEnvelopeInput
): Promise<SyncEnvelope> {
  const settings = projectContentLensSettings(input.profile.settings).settings
  const portableProviders = input.providerState.providers.map(provider => ({
    providerConfigId: provider.providerConfigId,
    displayName: provider.displayName,
    kind: provider.kind,
    execution: provider.execution,
    endpointOrigin: provider.endpointOrigin,
    policyUrl: provider.policyUrl
  }))
  const portableProviderIds = new Set(
    portableProviders.map(({ providerConfigId }) => providerConfigId)
  )
  const modelCatalog = input.providerState.models.map(
    ({ lastCheckedAt: _lastCheckedAt, status: _status, ...model }) => model
  )
  const modelKeys = new Set(
    modelCatalog.map(
      ({ providerConfigId, modelId }) => `${providerConfigId}\u0000${modelId}`
    )
  )
  const modelBindings = portableBindings(settings.routing)

  for (const model of modelCatalog) {
    if (!portableProviderIds.has(model.providerConfigId)) {
      throw new TypeError('Portable model references an unknown provider')
    }
  }
  for (const binding of modelBindings) {
    if (
      !portableProviderIds.has(binding.providerConfigId) ||
      !modelKeys.has(`${binding.providerConfigId}\u0000${binding.modelId}`)
    ) {
      throw new TypeError('Portable route references an unknown model binding')
    }
  }

  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: input.syncProfileId,
    generation: input.generation,
    profile: {
      ...emptySyncProfile(),
      portableProviders,
      modelCatalog,
      modelBindings,
      rules: input.profile.rules,
      platformPreferences: [
        { id: 'settings:interface', value: settings.interface },
        { id: 'settings:routing', value: settings.routing },
        ...PLATFORM_VALUES.map(platform => ({
          id: `platform:${platform}`,
          value: {
            platform,
            state: settings.platforms[platform].state,
            nativeFeedbackEnabled:
              settings.platforms[platform].nativeFeedbackEnabled,
            surfaces: settings.platforms[platform].surfaces
          }
        }))
      ]
    },
    tombstones: input.tombstones ?? []
  })
}
