import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import { ConsentRepository } from '@/ai/providers/consent'
import { ProviderRegistry } from '@/ai/providers/registry'
import { createLocalProfile } from '@/application/profile/local-profile'
import type { SettingsRequestMessage } from '@/application/settings/runtime-contracts'
import type { ServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import { createServiceWorkerSettingsRuntime } from '@/extension/service-worker/settings-runtime'
import type { ServiceWorkerSyncRuntime } from '@/extension/service-worker/sync-runtime'
import { CredentialVault } from '@/security/credentials/vault'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { disconnectedSyncConnection } from '@/sync/connection'

const at = '2026-07-31T17:00:00.000Z'
const envelope = {
  namespace: 'contentlens.runtime.v1' as const,
  requestId: 'request:matrix',
  version: 1 as const
}

const command = (input: Record<string, unknown>) =>
  ({ ...envelope, ...input }) as SettingsRequestMessage

async function database(name: string) {
  const value = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName: name
  })
  await value.saveProfile(
    createLocalProfile({ at, profileId: `profile:${name}` })
  )
  return value
}

function syncRuntime() {
  const connection = disconnectedSyncConnection()
  return {
    status: vi.fn(async () => connection),
    conflict: vi.fn(async () => null),
    recoveries: vi.fn(async () => []),
    start: vi.fn(async () => connection),
    connect: vi.fn(async () => ({ state: 'connected', connection })),
    disconnect: vi.fn(async () => connection),
    updateSchedule: vi.fn(async () => connection),
    syncNow: vi.fn(async () => ({ state: 'disconnected' })),
    resolveConflict: vi.fn(async () => ({ state: 'unavailable' })),
    restoreRecovery: vi.fn(async () => ({
      state: 'restored',
      revision: 2,
      automaticPush: false
    })),
    deleteRemote: vi.fn(async () => ({
      state: 'invalid-confirmation',
      connection
    })),
    handleAlarm: vi.fn()
  } as unknown as ServiceWorkerSyncRuntime
}

describe('settings runtime command matrix', () => {
  it('maps every sync command to its single reviewed runtime operation', async () => {
    const store = await database('settings-command-sync')
    const sync = syncRuntime()
    const runtime = createServiceWorkerSettingsRuntime({
      database: store,
      providers: Promise.resolve({
        state: 'ready',
        providers: new ProviderRegistry(),
        catalog: new ModelCatalog(),
        consents: new ConsentRepository(),
        vault: new CredentialVault(),
        management: {
          snapshot: vi.fn(() => ({
            providers: [],
            models: [],
            credentials: [],
            consents: []
          }))
        }
      } as unknown as ServiceWorkerProviderRuntime),
      reconcileAdapterActivation: vi.fn(async () => ({ results: [] })),
      sync
    })

    const cases = [
      {
        input: {
          type: 'sync.connect',
          providerConfigId: 'provider:sync',
          endpointPath: '/contentlens.json',
          remoteObjectId: 'contentlens.json',
          scheduleMinutes: 15,
          retention: 'User controlled',
          revocation: 'Delete token',
          consentedAt: at
        },
        kind: 'sync-connect',
        method: 'connect'
      },
      {
        input: { type: 'sync.disconnect', at },
        kind: 'sync-disconnected',
        method: 'disconnect'
      },
      {
        input: { type: 'sync.now', at },
        kind: 'sync-run',
        method: 'syncNow'
      },
      {
        input: { type: 'sync.schedule', scheduleMinutes: 30 },
        kind: 'sync-schedule',
        method: 'updateSchedule'
      },
      {
        input: { type: 'sync.resolve', at, resolutions: [] },
        kind: 'sync-resolution',
        method: 'resolveConflict'
      },
      {
        input: {
          type: 'sync.recovery.restore',
          snapshotId: 'snapshot:1',
          operationId: 'operation:restore',
          at
        },
        kind: 'sync-recovery-restored',
        method: 'restoreRecovery'
      },
      {
        input: {
          type: 'sync.remote.delete',
          confirmedRemoteObjectId: 'contentlens.json',
          at
        },
        kind: 'sync-remote-deleted',
        method: 'deleteRemote'
      }
    ] as const

    for (const scenario of cases) {
      await expect(
        runtime.handle(command(scenario.input))
      ).resolves.toMatchObject({
        kind: scenario.kind
      })
      expect(vi.mocked(sync[scenario.method])).toHaveBeenCalledOnce()
    }
    store.close()
  })

  it('dispatches provider commands and all credential storage modes', async () => {
    const store = await database('settings-command-provider')
    const provider = {
      providerConfigId: 'provider:test',
      displayName: 'Provider'
    }
    const management = {
      snapshot: vi.fn(() => ({
        providers: [],
        models: [],
        credentials: [],
        consents: []
      })),
      registerProvider: vi.fn(async value => value),
      setSessionCredential: vi.fn(async () => provider),
      setWrappedCredential: vi.fn(async () => provider),
      setExternalVault: vi.fn(async () => provider),
      updateProvider: vi.fn(async () => provider),
      disconnect: vi.fn(async () => provider),
      testConnection: vi.fn(async () => ({ result: { outcome: 'success' } })),
      grantConsent: vi.fn(async receipt => receipt),
      registerModel: vi.fn(async model => model)
    }
    const runtime = createServiceWorkerSettingsRuntime({
      database: store,
      providers: Promise.resolve({
        state: 'ready',
        providers: new ProviderRegistry(),
        catalog: new ModelCatalog(),
        consents: new ConsentRepository(),
        vault: new CredentialVault(),
        management
      } as unknown as ServiceWorkerProviderRuntime),
      reconcileAdapterActivation: vi.fn(async () => ({ results: [] })),
      sync: syncRuntime()
    })

    await runtime.handle(
      command({
        type: 'provider.create',
        templateId: 'openai',
        displayName: 'Personal OpenAI'
      })
    )
    expect(management.registerProvider).toHaveBeenCalledOnce()

    for (const input of [
      {
        type: 'provider.credential',
        providerConfigId: 'provider:test',
        mode: 'session-only',
        value: 'secret'
      },
      {
        type: 'provider.credential',
        providerConfigId: 'provider:test',
        mode: 'passphrase-wrapped',
        value: 'secret',
        passphrase: 'passphrase'
      },
      {
        type: 'provider.credential',
        providerConfigId: 'provider:test',
        mode: 'external-vault',
        externalReference: 'vault:item'
      }
    ]) {
      await expect(runtime.handle(command(input))).resolves.toMatchObject({
        kind: 'provider'
      })
    }
    expect(management.setSessionCredential).toHaveBeenCalledOnce()
    expect(management.setWrappedCredential).toHaveBeenCalledOnce()
    expect(management.setExternalVault).toHaveBeenCalledOnce()

    await runtime.handle(
      command({
        type: 'provider.update',
        providerConfigId: 'provider:test',
        displayName: 'Updated',
        endpointOrigin: 'https://provider.example'
      })
    )
    await runtime.handle(
      command({
        type: 'provider.disconnect',
        providerConfigId: 'provider:test'
      })
    )
    await runtime.handle(
      command({
        type: 'provider.test',
        providerConfigId: 'provider:test',
        modelId: 'model:test',
        quotaAcknowledged: true
      })
    )
    expect(management.updateProvider).toHaveBeenCalledOnce()
    expect(management.disconnect).toHaveBeenCalledOnce()
    expect(management.testConnection).toHaveBeenCalledOnce()
    store.close()
  })

  it('returns a stable unavailable result when provider state cannot load', async () => {
    const store = await database('settings-command-unavailable')
    const runtime = createServiceWorkerSettingsRuntime({
      database: store,
      providers: Promise.resolve({
        state: 'unavailable',
        code: 'provider-state-unreadable'
      }),
      reconcileAdapterActivation: vi.fn(async () => ({ results: [] })),
      sync: syncRuntime()
    })
    await expect(
      runtime.handle(command({ type: 'settings.snapshot' }))
    ).resolves.toEqual({
      kind: 'unavailable',
      code: 'provider-state-unreadable'
    })
    store.close()
  })
})
