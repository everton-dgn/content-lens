import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { providerDescriptorSchema } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { createLocalProfile } from '@/application/profile/local-profile'
import type { ServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import {
  CONTENT_LENS_SYNC_ALARM,
  createServiceWorkerSyncRuntime
} from '@/extension/service-worker/sync-runtime'
import { CredentialVault } from '@/security/credentials/vault'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const at = '2026-07-31T12:00:00.000Z'

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

async function readyProviderRuntime(options?: {
  credential?: boolean
  provider?: boolean
}) {
  const vault = new CredentialVault()
  const credentialRef =
    options?.credential === false
      ? null
      : await vault.storeSession(
          {
            providerConfigId: 'provider:sync',
            endpointOrigin: 'https://sync.example'
          },
          'sync-token'
        )
  const providers = new ProviderRegistry(
    options?.provider === false
      ? []
      : [
          providerDescriptorSchema.parse({
            schemaVersion: 1,
            providerConfigId: 'provider:sync',
            displayName: 'Private sync endpoint',
            kind: 'user-proxy',
            execution: 'cloud',
            endpointOrigin: 'https://sync.example',
            credentialMode: credentialRef ? 'session-only' : 'none',
            credentialRef,
            policyUrl: 'https://sync.example/privacy',
            policyReviewedAt: at,
            createdAt: at,
            updatedAt: at,
            status: credentialRef ? 'ready' : 'unconfigured'
          })
        ]
  )
  return {
    state: 'ready',
    providers,
    vault
  } as unknown as ServiceWorkerProviderRuntime
}

const connectInput = {
  providerConfigId: 'provider:sync',
  endpointPath: '/contentlens.json',
  remoteObjectId: 'contentlens.json',
  scheduleMinutes: 15,
  retention: 'User controlled',
  revocation: 'Delete the token',
  consentedAt: at
}

describe('service worker sync runtime', () => {
  it('keeps startup, empty recovery and unrelated alarms side-effect bounded', async () => {
    const store = await database('sync-runtime-idle')
    const alarms = {
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined)
    }
    const runtime = createServiceWorkerSyncRuntime({
      alarms,
      database: store,
      providers: readyProviderRuntime(),
      hasPermission: vi.fn(async () => true)
    })

    await expect(runtime.status()).resolves.toMatchObject({
      enabled: false,
      runtimeState: 'disconnected'
    })
    await expect(runtime.start()).resolves.toMatchObject({ enabled: false })
    expect(alarms.clear).toHaveBeenCalledWith(CONTENT_LENS_SYNC_ALARM)
    expect(alarms.create).not.toHaveBeenCalled()
    await expect(runtime.conflict()).resolves.toBeNull()
    await expect(runtime.recoveries()).resolves.toEqual([])
    await expect(runtime.handleAlarm({ name: 'another-alarm' })).resolves.toBe(
      undefined
    )
    store.close()
  })

  it('maps unavailable providers, missing credentials and denied origins to safe states', async () => {
    for (const scenario of [
      {
        name: 'unavailable',
        providers: Promise.resolve({
          state: 'unavailable',
          code: 'provider-state-unreadable'
        } as const),
        permission: true,
        code: 'remote-unavailable'
      },
      {
        name: 'missing-provider',
        providers: readyProviderRuntime({ provider: false }),
        permission: true,
        code: 'authentication-required'
      },
      {
        name: 'missing-credential',
        providers: readyProviderRuntime({ credential: false }),
        permission: true,
        code: 'authentication-required'
      },
      {
        name: 'permission-denied',
        providers: readyProviderRuntime(),
        permission: false,
        code: 'permission-required'
      }
    ]) {
      const store = await database(`sync-runtime-${scenario.name}`)
      const runtime = createServiceWorkerSyncRuntime({
        alarms: { create: vi.fn() },
        database: store,
        providers: scenario.providers,
        hasPermission: vi.fn(async () => scenario.permission)
      })
      await expect(runtime.connect(connectInput)).resolves.toMatchObject({
        state: 'degraded',
        connection: { lastErrorCode: scenario.code }
      })
      store.close()
    }
  })

  it('connects, schedules, synchronizes and deletes one user-owned remote', async () => {
    const store = await database('sync-runtime-complete')
    const alarms = {
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined)
    }
    let remote: unknown
    let version = 0
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') {
          if (!remote) {
            return new Response(null, { status: 404 })
          }
          const body = JSON.stringify(remote)
          return new Response(body, {
            status: 200,
            headers: {
              'content-length': String(new TextEncoder().encode(body).length),
              etag: `"version:${version}"`
            }
          })
        }
        if (init?.method === 'PUT') {
          remote = JSON.parse(String(init.body))
          version += 1
          return new Response(null, {
            status: 200,
            headers: { etag: `"version:${version}"` }
          })
        }
        if (init?.method === 'DELETE') {
          remote = undefined
          version += 1
          return new Response(null, { status: 200 })
        }
        return new Response(null, { status: 500 })
      }
    )
    vi.stubGlobal('fetch', fetchMock)
    const hasPermission = vi.fn(async () => true)
    const runtime = createServiceWorkerSyncRuntime({
      alarms,
      database: store,
      providers: readyProviderRuntime(),
      hasPermission
    })

    await expect(runtime.connect(connectInput)).resolves.toMatchObject({
      state: 'connected'
    })
    expect(alarms.create).toHaveBeenCalledWith(CONTENT_LENS_SYNC_ALARM, {
      delayInMinutes: 15,
      periodInMinutes: 15
    })
    expect(hasPermission).toHaveBeenCalledWith({
      endpointOrigin: 'https://sync.example',
      execution: 'cloud'
    })
    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          new Headers(init?.headers).get('authorization') ===
          'Bearer sync-token'
      )
    ).toBe(true)

    await expect(runtime.start()).resolves.toMatchObject({ enabled: true })
    await expect(runtime.updateSchedule(30)).resolves.toMatchObject({
      scheduleMinutes: 30
    })
    await expect(runtime.syncNow(at)).resolves.toMatchObject({
      state: 'confirmed'
    })
    await expect(
      runtime.handleAlarm({ name: CONTENT_LENS_SYNC_ALARM })
    ).resolves.toMatchObject({ state: 'confirmed' })
    await expect(
      runtime.deleteRemote({
        at,
        confirmedRemoteObjectId: 'contentlens.json'
      })
    ).resolves.toMatchObject({ state: 'deleted' })
    expect(remote).toBeUndefined()
    await expect(runtime.disconnect(at)).resolves.toMatchObject({
      enabled: false,
      runtimeState: 'disconnected'
    })
    vi.unstubAllGlobals()
    store.close()
  })

  it('disconnects before delegating a reviewed recovery restore', async () => {
    const store = await database('sync-runtime-restore')
    const restore = vi
      .spyOn(store, 'restoreSyncRecoverySnapshot')
      .mockResolvedValue({
        state: 'restored',
        revision: 2,
        automaticPush: false
      })
    const runtime = createServiceWorkerSyncRuntime({
      alarms: { create: vi.fn() },
      database: store,
      providers: readyProviderRuntime(),
      hasPermission: vi.fn(async () => true)
    })

    await expect(
      runtime.restoreRecovery({
        snapshotId: 'recovery:1',
        operationId: 'operation:restore',
        at
      })
    ).resolves.toMatchObject({ state: 'restored', automaticPush: false })
    expect(restore).toHaveBeenCalledWith('recovery:1', {
      operationId: 'operation:restore',
      at
    })
    await expect(runtime.status()).resolves.toMatchObject({ enabled: false })
    store.close()
  })
})
