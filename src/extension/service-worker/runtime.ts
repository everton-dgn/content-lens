import { BrowserAiBridgeClient } from '@/ai/browser/bridge'
import type { BrowserPromptExecutor } from '@/ai/browser/language-model'
import {
  createBrowserTextModelPort,
  createBrowserVisualModelPort
} from '@/ai/browser/model-ports'
import { createBrowserVisualMediaPorts } from '@/ai/vision/media-runtime'
import type { PlatformActivationResult } from '@/application/adapter-activation/browser-content-scripts'
import {
  BrowserContentScriptActivation,
  type BrowserScriptingApi
} from '@/application/adapter-activation/browser-content-scripts'
import { ProposalSuppressionService } from '@/application/assistance/proposal-suppression'
import { createRoutedAssistanceService } from '@/application/assistance/routed-service'
import { DecisionRequestService } from '@/application/decision-pipeline/service'
import { createRoutedTextStage } from '@/application/decision-pipeline/text-stage'
import { createRoutedVisualStage } from '@/application/decision-pipeline/visual-stage'
import {
  BrowserPermissionPort,
  type BrowserPermissionsApi
} from '@/application/provider-management/browser-permissions'
import { ProviderStatePersistence } from '@/application/provider-management/persistence'
import { projectContentLensSettings } from '@/application/settings/profile-settings'
import { INSTALLED_ADAPTER_ORIGINS } from '@/config/adapter-origins'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import { bootstrapServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import { createServiceWorkerRssRuntime } from '@/extension/service-worker/rss-runtime'
import { createServiceWorkerSettingsRuntime } from '@/extension/service-worker/settings-runtime'
import { createServiceWorkerSyncRuntime } from '@/extension/service-worker/sync-runtime'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

export function createServiceWorkerRuntime(options: {
  browser: 'chrome' | 'firefox'
  permissionApi: BrowserPermissionsApi
  scriptingApi: BrowserScriptingApi
  alarmsApi: {
    create(
      name: string,
      alarmInfo: { delayInMinutes: number; periodInMinutes: number }
    ): Promise<void> | void
    clear?(name: string): Promise<boolean>
  }
  database?: ContentLensDatabase
  browserAi?: BrowserPromptExecutor
  /**
   * Called after every activation reconciliation, including the one a settings
   * save triggers. Without it a saved language would only reach open platform
   * tabs on the next permission change or worker restart.
   */
  onAdapterActivationReconciled?(outcome: {
    enabledSurfaces: Partial<Record<Platform, readonly PlatformSurface[]>>
    locale: string
    results: PlatformActivationResult[]
  }): Promise<void> | void
}) {
  const database = options.database ?? new ContentLensDatabase()
  const browserAiBridge = new BrowserAiBridgeClient()
  const browserAi = options.browserAi ?? browserAiBridge
  const permissionPort = new BrowserPermissionPort({
    api: options.permissionApi,
    browser: options.browser
  })
  const adapterActivation = new BrowserContentScriptActivation({
    permissions: options.permissionApi,
    scripting: options.scriptingApi
  })
  const runReconcile = async () => {
    const profile = await database.exportProfile()
    const settings = projectContentLensSettings(
      profile?.settings ?? {}
    ).settings
    const results = await adapterActivation.reconcile(
      Object.values(settings.platforms)
        .filter(({ state }) => state === 'enabled')
        .map(({ platform }) => platform)
    )
    const outcome = {
      locale: settings.interface.locale,
      enabledSurfaces: Object.fromEntries(
        Object.values(settings.platforms).map(({ platform, surfaces }) => [
          platform,
          Object.entries(surfaces)
            .filter(([, enabled]) => enabled)
            .map(([surface]) => surface as PlatformSurface)
        ])
      ),
      results
    }

    await options.onAdapterActivationReconciled?.(outcome)

    return outcome
  }
  /**
   * Reconciliations run one at a time. Each reads the profile at its start and
   * only installs the language once its own asynchronous work finishes, so
   * overlapping runs could otherwise publish an older locale last and leave
   * open platform tabs on the previous language.
   */
  let pendingReconcile: Promise<unknown> = Promise.resolve()
  const reconcileAdapterActivation = () => {
    const next = pendingReconcile.then(runReconcile, runReconcile)

    pendingReconcile = next.catch(() => undefined)

    return next
  }
  const providers = bootstrapServiceWorkerProviderRuntime({
    browser: options.browser,
    persistence: new ProviderStatePersistence(database),
    permissions: permissionPort
  })
  const rss = createServiceWorkerRssRuntime({
    database
  })
  const sync = createServiceWorkerSyncRuntime({
    alarms: options.alarmsApi,
    database,
    providers,
    hasPermission: binding =>
      permissionPort.has(binding, ['authenticationInfo'])
  })
  const textStage = createRoutedTextStage({
    runtime: providers.then(runtime =>
      runtime.state === 'ready' ? runtime : undefined
    ),
    permissions: permissionPort,
    createBrowserModelPort: () =>
      createBrowserTextModelPort({ executor: browserAi }),
    cache: {
      read: id => database.readCacheEntry(id),
      write: async entry => {
        const result = await database.putCacheEntries([entry])
        if (result.state !== 'recorded' || result.count !== 1) {
          throw new Error('model-cache-write-failed')
        }
      }
    }
  })
  const visualStage = createRoutedVisualStage({
    runtime: providers.then(runtime =>
      runtime.state === 'ready' ? runtime : undefined
    ),
    permissions: permissionPort,
    createBrowserModelPort: () =>
      createBrowserVisualModelPort({ executor: browserAi }),
    media: createBrowserVisualMediaPorts({
      allowedOrigins: platform =>
        INSTALLED_ADAPTER_ORIGINS.filter(
          entry => entry.platform === platform
        ).map(entry => entry.origin),
      hasPermission: origin =>
        permissionPort.has({ endpointOrigin: origin, execution: 'cloud' }, [
          'websiteContent'
        ])
    }),
    cache: {
      read: id => database.readCacheEntry(id),
      write: async entry => {
        const result = await database.putCacheEntries([entry])
        if (result.state !== 'recorded' || result.count !== 1) {
          throw new Error('model-cache-write-failed')
        }
      }
    }
  })
  const assistance = createRoutedAssistanceService({
    runtime: providers.then(runtime =>
      runtime.state === 'ready' ? runtime : undefined
    ),
    permissions: permissionPort,
    browserAi,
    cache: {
      read: id => database.readCacheEntry(id),
      write: async (id, value) => {
        const result = await database.putCacheEntries([
          { id, updatedAt: new Date().toISOString(), value }
        ])
        if (result.state !== 'recorded' || result.count !== 1) {
          throw new Error('assistance-cache-write-failed')
        }
      }
    },
    fingerprint: fingerprintPortableValue
  })
  const assistanceSuppression = new ProposalSuppressionService({
    read: fingerprint =>
      database.readCacheEntry(`assistance-suppression:v1:${fingerprint}`),
    write: async record => {
      const result = await database.putCacheEntries([
        {
          id: `assistance-suppression:v1:${record.fingerprint}`,
          updatedAt:
            record.lastDismissedAt ??
            record.reactivatedAt ??
            new Date().toISOString(),
          value: record
        }
      ])
      if (result.state !== 'recorded' || result.count !== 1) {
        throw new Error('assistance-suppression-write-failed')
      }
    }
  })
  const settings = createServiceWorkerSettingsRuntime({
    database,
    providers,
    reconcileAdapterActivation,
    sync
  })
  return {
    adapterActivation,
    assistance,
    assistanceSuppression,
    browserAiBridge,
    decisions: new DecisionRequestService({ database, textStage, visualStage }),
    providers,
    reconcileAdapterActivation,
    rss,
    settings,
    sync
  }
}
