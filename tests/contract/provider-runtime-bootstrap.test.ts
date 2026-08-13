import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import { ConsentRepository } from '@/ai/providers/consent'
import { providerDescriptorSchema } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import type { DecisionRequestMessage } from '@/application/messages/contracts'
import { createLocalProfile } from '@/application/profile/local-profile'
import type {
  ProviderRuntimeState,
  ProviderStateWriter
} from '@/application/provider-management/persistence'
import { ProviderStatePersistence } from '@/application/provider-management/persistence'
import { bootstrapServiceWorkerProviderRuntime } from '@/extension/service-worker/provider-runtime'
import { createServiceWorkerRuntime } from '@/extension/service-worker/runtime'
import { CredentialVault } from '@/security/credentials/vault'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const now = '2026-07-31T07:10:00.000Z'

function state(): ProviderRuntimeState {
  return {
    providers: new ProviderRegistry([
      providerDescriptorSchema.parse({
        schemaVersion: 1,
        providerConfigId: 'provider:restored',
        displayName: 'Restored provider',
        kind: 'openai',
        execution: 'cloud',
        endpointOrigin: 'https://api.openai.com',
        credentialMode: 'session-only',
        credentialRef: null,
        policyUrl: 'https://openai.com/policies/privacy-policy/',
        policyReviewedAt: now,
        createdAt: now,
        updatedAt: now,
        status: 'locked'
      })
    ]),
    catalog: new ModelCatalog(),
    consents: new ConsentRepository(),
    vault: new CredentialVault()
  }
}

describe('service-worker provider runtime bootstrap', () => {
  it('rehydrates the shared provider services without writing during worker startup', async () => {
    const restored = state()
    const persistence = {
      load: vi.fn(async () => restored),
      save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
    }

    const boot = await bootstrapServiceWorkerProviderRuntime({
      persistence,
      permissions: {
        has: vi.fn(async () => true),
        remove: vi.fn(async () => true)
      }
    })

    expect(boot.state).toBe('ready')
    if (boot.state !== 'ready') {
      throw new Error('Expected provider runtime to be ready')
    }
    expect(boot.providers).toBe(restored.providers)
    expect(boot.catalog).toBe(restored.catalog)
    expect(boot.consents).toBe(restored.consents)
    expect(boot.vault).toBe(restored.vault)
    expect(boot.management.snapshot().providers).toEqual(
      restored.providers.list()
    )
    expect(persistence.load).toHaveBeenCalledOnce()
    expect(persistence.save).not.toHaveBeenCalled()
  })

  it('fails closed with one redacted code when persisted provider state is unreadable', async () => {
    const persistence = {
      load: vi.fn(async (): Promise<ProviderRuntimeState> => {
        throw new Error('indexed-db-secret-detail')
      }),
      save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
    }

    const boot = await bootstrapServiceWorkerProviderRuntime({
      persistence,
      permissions: {
        has: vi.fn(async () => true),
        remove: vi.fn(async () => true)
      }
    })

    expect(boot).toEqual({
      state: 'unavailable',
      code: 'provider-state-unreadable'
    })
    expect(JSON.stringify(boot)).not.toContain('secret-detail')
    expect(persistence.save).not.toHaveBeenCalled()
  })

  it('composes the worker with one database and rehydrates providers without an async background main', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-provider-runtime-bootstrap'
    })
    await new ProviderStatePersistence(database).save(state())
    const runtime = createServiceWorkerRuntime({
      alarmsApi: {
        create: vi.fn(async () => undefined)
      },
      browser: 'chrome',
      database,
      permissionApi: {
        contains: vi.fn(async () => true),
        getAll: vi.fn(async () => ({ origins: [], permissions: [] })),
        remove: vi.fn(async () => true),
        request: vi.fn(async () => true)
      },
      scriptingApi: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    })

    const providers = await runtime.providers

    expect(providers.state).toBe('ready')
    if (providers.state !== 'ready') {
      throw new Error('Expected provider runtime to be ready')
    }
    expect(providers.providers.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerConfigId: 'provider:restored',
          status: 'locked'
        })
      ])
    )
    expect(runtime.decisions).toBeDefined()
    database.close()
  })

  it('reconciles adapters, evaluates a default decision and persists assistance suppression through the composed worker', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-service-worker-composed-callbacks'
    })
    await database.saveProfile(
      createLocalProfile({ at: now, profileId: 'profile:worker-callbacks' })
    )
    const registerContentScripts = vi.fn(async () => undefined)
    const runtime = createServiceWorkerRuntime({
      alarmsApi: { create: vi.fn(async () => undefined) },
      browser: 'chrome',
      database,
      permissionApi: {
        contains: vi.fn(async () => true),
        getAll: vi.fn(async () => ({ origins: [], permissions: [] })),
        remove: vi.fn(async () => true),
        request: vi.fn(async () => true)
      },
      scriptingApi: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts,
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    })

    await expect(runtime.reconcileAdapterActivation()).resolves.toMatchObject({
      enabledSurfaces: {
        youtube: expect.arrayContaining(['youtube:home', 'youtube:search']),
        reddit: []
      },
      results: expect.arrayContaining([
        expect.objectContaining({ state: 'active', platform: 'youtube' }),
        expect.objectContaining({
          state: 'inactive',
          platform: 'reddit',
          code: 'adapter-disabled'
        })
      ])
    })
    expect(registerContentScripts).toHaveBeenCalled()

    const message: DecisionRequestMessage = {
      namespace: 'contentlens.runtime.v1',
      version: 1,
      type: 'decision.request',
      platform: 'youtube',
      requestId: 'request:worker-callbacks',
      pageInstanceId: 'page:worker-callbacks',
      item: {
        id: 'youtube:video:worker-callbacks',
        platform: 'youtube',
        identity: { status: 'stable', platformContentId: 'worker-callbacks' },
        surface: 'youtube:home',
        title: 'Visible by default',
        media: [],
        observedAt: now,
        context: {}
      }
    }
    await expect(runtime.decisions.decide(message)).resolves.toMatchObject({
      action: 'show',
      reasonCode: 'default-show'
    })

    await expect(
      runtime.assistanceSuppression.dismiss({
        fingerprint: 'proposal:worker-callbacks',
        evidenceVersion: 'evidence@1',
        at: now
      })
    ).resolves.toMatchObject({ dismissalCount: 1 })
    await expect(
      runtime.assistanceSuppression.status({
        fingerprint: 'proposal:worker-callbacks',
        evidenceVersion: 'evidence@1',
        at: '2026-08-01T07:10:00.000Z'
      })
    ).resolves.toMatchObject({ state: 'cooldown', dismissalCount: 1 })
    database.close()
  })

  it('fails closed when the composed suppression cache cannot persist one record', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-service-worker-cache-failure'
    })
    database.putCacheEntries = vi.fn(async () => ({
      state: 'invalid' as const
    }))
    const runtime = createServiceWorkerRuntime({
      alarmsApi: { create: vi.fn(async () => undefined) },
      browser: 'chrome',
      database,
      permissionApi: {
        contains: vi.fn(async () => true),
        getAll: vi.fn(async () => ({ origins: [], permissions: [] })),
        remove: vi.fn(async () => true),
        request: vi.fn(async () => true)
      },
      scriptingApi: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    })
    await expect(
      runtime.assistanceSuppression.reactivate({
        fingerprint: 'proposal:failure',
        evidenceVersion: 'evidence@1',
        at: now
      })
    ).rejects.toThrow('assistance-suppression-write-failed')
    database.close()
  })
})
