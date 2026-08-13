import type { ServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SyncConnection } from '@/sync/connection'
import { previewPortableChanges } from '@/sync/import-preview'
import { IndexedDbSyncStore } from '@/sync/indexed-db-store'
import { ConditionalHttpSyncProvider } from '@/sync/providers/conditional-http'
import { SyncProviderError } from '@/sync/providers/contracts'
import { type SyncConnectInput, UserOwnedSyncService } from '@/sync/service'

export const CONTENT_LENS_SYNC_ALARM = 'contentlens.sync.v1'

type SyncAlarmsApi = {
  create(
    name: string,
    alarmInfo: { delayInMinutes: number; periodInMinutes: number }
  ): Promise<void> | void
  clear?(name: string): Promise<boolean>
}

export function createServiceWorkerSyncRuntime(options: {
  alarms: SyncAlarmsApi
  database: ContentLensDatabase
  providers: Promise<ServiceWorkerProviderRuntime>
  hasPermission(input: {
    endpointOrigin: string
    execution: 'local' | 'cloud' | 'browser'
  }): Promise<boolean>
}) {
  const providerFactory = async (connection: SyncConnection) => {
    const runtime = await options.providers
    if (runtime.state !== 'ready') {
      throw new SyncProviderError({
        code: 'remote-unavailable',
        retryable: false
      })
    }
    const provider = connection.providerConfigId
      ? runtime.providers.get(connection.providerConfigId)
      : undefined
    if (
      !provider?.credentialRef ||
      !connection.endpointPath ||
      !connection.retention ||
      !connection.revocation
    ) {
      throw new SyncProviderError({
        code: 'authentication-required',
        retryable: false
      })
    }
    if (
      !(await options.hasPermission({
        endpointOrigin: provider.endpointOrigin,
        execution: provider.execution
      }))
    ) {
      throw new SyncProviderError({
        code: 'permission-required',
        retryable: false
      })
    }
    return runtime.vault.use(
      provider.credentialRef,
      {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      },
      credential =>
        new ConditionalHttpSyncProvider({
          metadata: {
            providerConfigId: provider.providerConfigId,
            displayName: provider.displayName,
            endpointOrigin: provider.endpointOrigin,
            policyUrl: provider.policyUrl,
            retention: connection.retention as string,
            revocation: connection.revocation as string,
            casMethod: 'Strong ETag with If-Match',
            maxBytes: 10 * 1024 * 1024
          },
          endpoint: new URL(
            connection.endpointPath as string,
            provider.endpointOrigin
          ).toString(),
          authorization: `Bearer ${credential}`
        })
    )
  }
  const service = new UserOwnedSyncService({
    repository: options.database,
    providerFactory,
    storeFactory: ({ connection, operationId, at }) =>
      new IndexedDbSyncStore({
        database: options.database,
        providerConfigId: connection.providerConfigId ?? '',
        remoteObjectId: connection.remoteObjectId ?? '',
        operationId,
        at
      })
  })

  const reconcileSchedule = async () => {
    await options.alarms.clear?.(CONTENT_LENS_SYNC_ALARM)
    const connection = await service.status()
    if (connection.enabled && connection.scheduleMinutes) {
      await options.alarms.create(CONTENT_LENS_SYNC_ALARM, {
        delayInMinutes: connection.scheduleMinutes,
        periodInMinutes: connection.scheduleMinutes
      })
    }
    return connection
  }

  const start = async () => {
    const connection = await reconcileSchedule()
    if (connection.enabled) {
      await service.resumeIncomplete(new Date().toISOString())
    }
    return service.status()
  }

  return {
    status: () => service.status(),
    async conflict() {
      const draft = await service.conflictDraft()
      return draft
        ? {
            id: draft.id,
            createdAt: draft.createdAt,
            conflicts: draft.merge.conflicts.map(conflict => ({
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              reason: conflict.reason,
              local: structuredClone(conflict.local),
              remote: structuredClone(conflict.remote)
            })),
            resolutions: structuredClone(draft.resolutions)
          }
        : null
    },
    async recoveries() {
      const snapshots = await options.database.listSyncRecoverySnapshots()
      if (snapshots.length === 0) {
        return []
      }
      const connection = await service.status()
      const current = await new IndexedDbSyncStore({
        database: options.database,
        providerConfigId: connection.providerConfigId ?? 'recovery-preview',
        remoteObjectId: connection.remoteObjectId ?? 'recovery-preview',
        operationId: `sync-recovery-preview:${crypto.randomUUID()}`,
        at: new Date().toISOString()
      }).readLocal()
      return snapshots.map(snapshot => ({
        id: snapshot.id,
        operationId: snapshot.operationId,
        createdAt: snapshot.createdAt,
        revision: snapshot.profile.revision,
        diff: snapshot.activeSync
          ? previewPortableChanges(current, snapshot.activeSync.envelope).totals
          : null
      }))
    },
    start,
    async connect(input: SyncConnectInput) {
      const result = await service.connect(input)
      await reconcileSchedule()
      return result
    },
    async disconnect(at: string) {
      const result = await service.disconnect(at)
      await reconcileSchedule()
      return result
    },
    async updateSchedule(scheduleMinutes: number | null) {
      const result = await service.updateSchedule(scheduleMinutes)
      await reconcileSchedule()
      return result
    },
    syncNow: (at: string) => service.syncNow(at),
    resolveConflict: (input: Parameters<typeof service.resolveConflict>[0]) =>
      service.resolveConflict(input),
    async restoreRecovery(input: {
      snapshotId: string
      operationId: string
      at: string
    }) {
      await service.disconnect(input.at)
      return options.database.restoreSyncRecoverySnapshot(input.snapshotId, {
        operationId: input.operationId,
        at: input.at
      })
    },
    async deleteRemote(input: { at: string; confirmedRemoteObjectId: string }) {
      const result = await service.deleteRemote(input)
      await reconcileSchedule()
      return result
    },
    async handleAlarm(alarm: { name: string }) {
      if (alarm.name !== CONTENT_LENS_SYNC_ALARM) {
        return undefined
      }
      return service.syncNow(new Date().toISOString())
    }
  }
}

export type ServiceWorkerSyncRuntime = ReturnType<
  typeof createServiceWorkerSyncRuntime
>
