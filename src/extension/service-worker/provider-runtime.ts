import type { ProviderPermissionProbe } from '@/application/provider-management/connection-test'
import type {
  ProviderRuntimeState,
  ProviderStateWriter
} from '@/application/provider-management/persistence'
import { ProviderManagementService } from '@/application/provider-management/service'

type ProviderStatePersistencePort = ProviderStateWriter & {
  load(): Promise<ProviderRuntimeState>
}

type ProviderRuntimePermissions = ProviderPermissionProbe & {
  remove(origin: string): boolean | Promise<boolean>
}

export type ServiceWorkerProviderRuntime =
  | ({
      state: 'ready'
      management: ProviderManagementService
    } & ProviderRuntimeState)
  | {
      state: 'unavailable'
      code: 'provider-state-unreadable'
    }

export async function bootstrapServiceWorkerProviderRuntime(options: {
  persistence: ProviderStatePersistencePort
  permissions: ProviderRuntimePermissions
  browser?: 'chrome' | 'firefox'
}): Promise<ServiceWorkerProviderRuntime> {
  try {
    const runtime = await options.persistence.load()
    if (options.browser === 'chrome') {
      runtime.providers.upsert(browserBuiltInProvider())
      runtime.catalog.upsertBuiltIn(browserBuiltInModel())
    }
    return {
      state: 'ready',
      ...runtime,
      management: new ProviderManagementService({
        registry: runtime.providers,
        catalog: runtime.catalog,
        consents: runtime.consents,
        vault: runtime.vault,
        permissions: options.permissions,
        persistence: options.persistence
      })
    }
  } catch {
    return {
      state: 'unavailable',
      code: 'provider-state-unreadable'
    }
  }
}

import {
  browserBuiltInModel,
  browserBuiltInProvider
} from '@/ai/browser/catalog'
