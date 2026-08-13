import {
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import type { ProviderStateSnapshot } from '@/storage/provider-state/contracts'
import { providerStateSnapshotSchema } from '@/storage/provider-state/contracts'
import type { SyncEnvelope } from '@/sync/contracts'

export function materializeImportedSyncEnvelope(
  envelope: SyncEnvelope,
  importedAt: string
) {
  const providers = envelope.profile.portableProviders.map(
    (portable): ProviderDescriptor =>
      providerDescriptorSchema.parse({
        schemaVersion: 1,
        ...portable,
        credentialMode:
          portable.execution === 'local' ? 'none' : 'session-only',
        credentialRef: null,
        policyReviewedAt: null,
        createdAt: importedAt,
        updatedAt: importedAt,
        status: 'locked',
        lastConnectionTest: null
      })
  )
  const providerIds = new Set(
    providers.map(({ providerConfigId }) => providerConfigId)
  )
  const modelKeys = new Set(
    envelope.profile.modelCatalog.map(
      ({ modelId, providerConfigId }) => `${providerConfigId}\u0000${modelId}`
    )
  )
  for (const model of envelope.profile.modelCatalog) {
    if (!providerIds.has(model.providerConfigId)) {
      throw new TypeError('Imported model references an unknown provider')
    }
  }
  const models = envelope.profile.modelCatalog.map(model => ({
    ...model,
    lastCheckedAt: null,
    status: 'unavailable' as const
  }))
  const modelBindings = envelope.profile.modelBindings.map(binding => {
    if (!providerIds.has(binding.providerConfigId)) {
      throw new TypeError('Imported binding references an unknown provider')
    }
    if (!modelKeys.has(`${binding.providerConfigId}\u0000${binding.modelId}`)) {
      throw new TypeError('Imported binding references an unknown model')
    }
    return { ...binding, active: false }
  })
  const providerState = {
    schemaVersion: 1 as const,
    providers,
    models,
    modelBindings,
    consents: [],
    credentials: []
  }
  providerStateSnapshotSchema.parse({
    schemaVersion: providerState.schemaVersion,
    providers: providerState.providers,
    models: providerState.models,
    consents: providerState.consents,
    credentials: providerState.credentials
  })
  return providerState
}

export function reconcileMergedSyncEnvelope(
  envelope: SyncEnvelope,
  current: ProviderStateSnapshot,
  importedAt: string
) {
  const imported = materializeImportedSyncEnvelope(envelope, importedAt)
  const currentProviders = new Map(
    current.providers.map(provider => [provider.providerConfigId, provider])
  )
  const preservedProviderIds = new Set<string>()
  const providers = imported.providers.map(provider => {
    const local = currentProviders.get(provider.providerConfigId)
    if (
      !local ||
      local.endpointOrigin !== provider.endpointOrigin ||
      local.kind !== provider.kind ||
      local.execution !== provider.execution
    ) {
      return provider
    }
    preservedProviderIds.add(provider.providerConfigId)
    return providerDescriptorSchema.parse({
      ...provider,
      credentialMode: local.credentialMode,
      credentialRef: local.credentialRef,
      policyReviewedAt:
        local.policyUrl === provider.policyUrl ? local.policyReviewedAt : null,
      createdAt: local.createdAt,
      status: local.status,
      lastConnectionTest: local.lastConnectionTest ?? null
    })
  })
  const currentModels = new Map(
    current.models.map(model => [
      `${model.providerConfigId}\u0000${model.modelId}`,
      model
    ])
  )
  const models = imported.models.map(model => {
    const local = currentModels.get(
      `${model.providerConfigId}\u0000${model.modelId}`
    )
    return local && preservedProviderIds.has(model.providerConfigId)
      ? {
          ...model,
          lastCheckedAt: local.lastCheckedAt,
          status: local.status
        }
      : model
  })
  const credentialReferences = new Set(
    providers.flatMap(provider =>
      provider.credentialRef ? [provider.credentialRef] : []
    )
  )
  const credentials = current.credentials.filter(credential =>
    credentialReferences.has(credential.reference)
  )
  const consents = current.consents.filter(receipt => {
    const provider = providers.find(
      candidate => candidate.providerConfigId === receipt.key.providerConfigId
    )
    return (
      provider !== undefined &&
      preservedProviderIds.has(provider.providerConfigId) &&
      provider.endpointOrigin === receipt.key.endpointOrigin
    )
  })
  return providerStateSnapshotSchema.parse({
    schemaVersion: 1,
    providers,
    models,
    consents,
    credentials
  })
}
