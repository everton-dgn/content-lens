import {
  createProviderFromTemplate,
  listProviderTemplates
} from '@/ai/providers/templates'
import type { PlatformActivationResult } from '@/application/adapter-activation/browser-content-scripts'
import {
  SettingsCapabilitySnapshotStore,
  SettingsManagementService
} from '@/application/settings'
import { getProviderRemovalImpact } from '@/application/settings/provider-impact'
import type {
  SettingsRequestMessage,
  SettingsRuntimeResponse
} from '@/application/settings/runtime-contracts'
import type { ServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import type { ServiceWorkerSyncRuntime } from '@/extension/service-worker/sync-runtime'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'

export type ServiceWorkerSettingsRuntime = {
  handle(message: SettingsRequestMessage): Promise<SettingsRuntimeResponse>
}

export function createServiceWorkerSettingsRuntime(options: {
  database: ContentLensDatabase
  providers: Promise<ServiceWorkerProviderRuntime>
  sync: ServiceWorkerSyncRuntime
  reconcileAdapterActivation(): Promise<{
    results: PlatformActivationResult[]
  }>
}): ServiceWorkerSettingsRuntime {
  const capabilitySnapshots = new SettingsCapabilitySnapshotStore()

  const requireProviders = async () => {
    const runtime = await options.providers
    if (runtime.state !== 'ready') {
      throw new Error(runtime.code)
    }
    return runtime
  }

  const settingsService = async () => {
    const runtime = await requireProviders()
    return {
      runtime,
      service: new SettingsManagementService(options.database, {
        catalog: runtime.catalog,
        providers: runtime.providers,
        consents: runtime.consents,
        capabilitySnapshots
      })
    }
  }

  return {
    async handle(message) {
      try {
        const runtime = await requireProviders()
        switch (message.type) {
          case 'settings.snapshot': {
            const { service } = await settingsService()
            const settings = await service.load()
            if (settings.state !== 'ready') {
              return { kind: 'unavailable', code: settings.code }
            }
            const [sync, syncConflict, syncRecoveries] = await Promise.all([
              options.sync.status(),
              options.sync.conflict(),
              options.sync.recoveries()
            ])
            return {
              kind: 'snapshot',
              value: {
                state: 'ready',
                settings,
                providers: runtime.management.snapshot(),
                templates: listProviderTemplates(),
                sync,
                syncConflict,
                syncRecoveries
              }
            }
          }
          case 'provider.create': {
            const provider = createProviderFromTemplate({
              templateId: message.templateId,
              providerConfigId: `provider:${crypto.randomUUID()}`,
              displayName: message.displayName,
              ...(message.endpointOrigin
                ? { endpointOrigin: message.endpointOrigin }
                : {}),
              at: new Date().toISOString()
            })
            return {
              kind: 'provider',
              value: await runtime.management.registerProvider(provider)
            }
          }
          case 'provider.credential': {
            const at = new Date().toISOString()
            const value =
              message.mode === 'session-only'
                ? await runtime.management.setSessionCredential(
                    message.providerConfigId,
                    message.value,
                    at
                  )
                : message.mode === 'passphrase-wrapped'
                  ? await runtime.management.setWrappedCredential(
                      message.providerConfigId,
                      message.value,
                      message.passphrase,
                      at
                    )
                  : await runtime.management.setExternalVault(
                      message.providerConfigId,
                      { externalReference: message.externalReference },
                      at
                    )
            return { kind: 'provider', value }
          }
          case 'provider.update':
            return {
              kind: 'provider',
              value: await runtime.management.updateProvider(
                message.providerConfigId,
                {
                  displayName: message.displayName,
                  endpointOrigin: message.endpointOrigin
                },
                new Date().toISOString()
              )
            }
          case 'provider.disconnect':
            return {
              kind: 'provider',
              value: await runtime.management.disconnect(
                message.providerConfigId,
                new Date().toISOString()
              )
            }
          case 'provider.remove.preview':
          case 'provider.remove': {
            const { service } = await settingsService()
            const settings = await service.load()
            if (settings.state !== 'ready') {
              return { kind: 'unavailable', code: settings.code }
            }
            const impact = getProviderRemovalImpact(
              settings.settings,
              runtime.catalog.list(),
              message.providerConfigId
            )
            if (message.type === 'provider.remove.preview' || impact.blocked) {
              return { kind: 'provider-removal-preview', value: impact }
            }
            return {
              kind: 'provider-removed',
              value: await runtime.management.removeProvider(
                message.providerConfigId
              )
            }
          }
          case 'provider.catalog.refresh':
            return {
              kind: 'provider-catalog',
              value: await runtime.management.refreshCatalog(
                message.providerConfigId,
                {
                  checkedAt: new Date().toISOString(),
                  userInitiated: true
                }
              )
            }
          case 'provider.test':
            return {
              kind: 'connection-test',
              value: await runtime.management.testConnection(
                message.providerConfigId,
                {
                  modelId: message.modelId,
                  userInitiated: true,
                  quotaAcknowledged: message.quotaAcknowledged,
                  checkedAt: new Date().toISOString()
                }
              )
            }
          case 'provider.consent':
            return {
              kind: 'consent',
              value: await runtime.management.grantConsent(message.receipt)
            }
          case 'model.register':
            return {
              kind: 'model',
              value: await runtime.management.registerModel(message.model)
            }
          case 'settings.save': {
            const { service } = await settingsService()
            const value = await service.save({
              operationId: message.operationId,
              expectedRevision: message.expectedRevision,
              settings: message.settings,
              reviewedConsentKeys: message.reviewedConsentKeys,
              at: message.at
            })
            const activation =
              value.state === 'committed'
                ? (await options.reconcileAdapterActivation()).results
                : []
            return { kind: 'settings-save', value, activation }
          }
          case 'sync.connect':
            return {
              kind: 'sync-connect',
              value: await options.sync.connect({
                providerConfigId: message.providerConfigId,
                endpointPath: message.endpointPath,
                remoteObjectId: message.remoteObjectId,
                scheduleMinutes: message.scheduleMinutes,
                retention: message.retention,
                revocation: message.revocation,
                consentedAt: message.consentedAt
              })
            }
          case 'sync.disconnect':
            return {
              kind: 'sync-disconnected',
              value: await options.sync.disconnect(message.at)
            }
          case 'sync.now':
            return {
              kind: 'sync-run',
              value: await options.sync.syncNow(message.at)
            }
          case 'sync.schedule':
            return {
              kind: 'sync-schedule',
              value: await options.sync.updateSchedule(message.scheduleMinutes)
            }
          case 'sync.resolve':
            return {
              kind: 'sync-resolution',
              value: await options.sync.resolveConflict({
                at: message.at,
                resolutions: message.resolutions
              })
            }
          case 'sync.recovery.restore':
            return {
              kind: 'sync-recovery-restored',
              value: await options.sync.restoreRecovery({
                snapshotId: message.snapshotId,
                operationId: message.operationId,
                at: message.at
              })
            }
          case 'sync.remote.delete':
            return {
              kind: 'sync-remote-deleted',
              value: await options.sync.deleteRemote({
                at: message.at,
                confirmedRemoteObjectId: message.confirmedRemoteObjectId
              })
            }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'provider-state-unreadable'
        ) {
          return { kind: 'unavailable', code: 'provider-state-unreadable' }
        }
        throw error
      }
    }
  }
}
