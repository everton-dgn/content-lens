import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SyncEnvelope } from '@/sync/contracts'
import { IndexedDbSyncStore } from '@/sync/indexed-db-store'
import { createSyncJournal } from '@/sync/journal'
import {
  type SyncProvider,
  SyncProviderError
} from '@/sync/providers/contracts'
import { UserOwnedSyncService } from '@/sync/service'

const at = '2026-07-31T12:00:00.000Z'

function providerState() {
  let remote: SyncEnvelope | undefined
  let version = 0
  const provider: SyncProvider = {
    metadata: {
      providerConfigId: 'provider:sync',
      displayName: 'Sync test',
      endpointOrigin: 'https://sync.example',
      policyUrl: 'https://sync.example/privacy',
      retention: 'User controlled',
      revocation: 'Delete the token',
      casMethod: 'test CAS',
      maxBytes: 10 * 1024 * 1024
    },
    connect: vi.fn(async () => ({ state: 'idle' as const })),
    disconnect: vi.fn(async () => undefined),
    getStatus: vi.fn(() => ({ state: 'idle' as const })),
    read: vi.fn(async () => {
      if (!remote) {
        throw new SyncProviderError({
          code: 'remote-missing',
          retryable: false
        })
      }
      return {
        envelope: remote,
        versionToken: `"version:${version}"`,
        byteLength: JSON.stringify(remote).length
      }
    }),
    initialize: vi.fn(async envelope => {
      if (remote) {
        return { state: 'mismatch' as const }
      }
      remote = envelope
      version += 1
      return {
        state: 'committed' as const,
        versionToken: `"version:${version}"`
      }
    }),
    compareAndSwap: vi.fn(async ({ expectedVersionToken, envelope }) => {
      if (expectedVersionToken !== `"version:${version}"`) {
        return { state: 'mismatch' as const }
      }
      remote = envelope
      version += 1
      return {
        state: 'committed' as const,
        versionToken: `"version:${version}"`
      }
    }),
    deleteRemote: vi.fn(async ({ expectedVersionToken }) => {
      if (expectedVersionToken !== `"version:${version}"`) {
        return { state: 'mismatch' as const }
      }
      remote = undefined
      version += 1
      return { state: 'deleted' as const }
    }),
    confirm: vi.fn(async ({ expectedDigest, expectedVersionToken }) =>
      remote?.digest === expectedDigest &&
      expectedVersionToken === `"version:${version}"`
        ? {
            state: 'confirmed' as const,
            versionToken: expectedVersionToken
          }
        : { state: 'mismatch' as const }
    )
  }
  return { provider, remote: () => remote }
}

describe('user-owned sync service', () => {
  it('makes no provider request before opt-in, initializes safely and disconnects', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-user-owned-sync'
    })
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:user-owned-sync' })
    )
    const remote = providerState()
    const providerFactory = vi.fn(async () => remote.provider)
    const service = new UserOwnedSyncService({
      repository: database,
      providerFactory,
      storeFactory: ({ connection, operationId, at: operationAt }) =>
        new IndexedDbSyncStore({
          database,
          providerConfigId: connection.providerConfigId ?? '',
          remoteObjectId: connection.remoteObjectId ?? '',
          operationId,
          at: operationAt
        })
    })

    await expect(service.status()).resolves.toMatchObject({
      runtimeState: 'disconnected'
    })
    expect(providerFactory).not.toHaveBeenCalled()
    await expect(
      service.connect({
        providerConfigId: 'provider:sync',
        endpointPath: '/contentlens.json',
        remoteObjectId: 'contentlens.json',
        scheduleMinutes: 15,
        retention: 'User controlled',
        revocation: 'Delete the provider token',
        consentedAt: at
      })
    ).resolves.toMatchObject({ state: 'connected' })
    expect(remote.provider.initialize).toHaveBeenCalledOnce()
    expect(remote.remote()).toBeDefined()

    await expect(service.syncNow(at)).resolves.toMatchObject({
      state: 'confirmed'
    })
    const identity = await database.ensureSyncIdentity()
    const base = await database.readSyncBase(identity.syncProfileId)
    if (!base) {
      throw new Error('Expected a confirmed sync base')
    }
    await database.writeSyncJournal(
      createSyncJournal({
        operationId: 'sync-operation:interrupted',
        syncProfileId: identity.syncProfileId,
        baseDigest: base.confirmedDigest,
        at
      })
    )
    await expect(service.resumeIncomplete(at)).resolves.toMatchObject({
      state: 'resumed',
      decision: 'restart-from-base',
      result: { state: 'confirmed' }
    })
    providerFactory.mockRejectedValueOnce(
      new Error('synthetic provider failure')
    )
    await expect(service.syncNow(at)).resolves.toEqual({
      state: 'degraded',
      attempts: 0,
      code: 'provider-error'
    })

    const journalUnavailable = new UserOwnedSyncService({
      repository: {
        readSyncConnection: () => database.readSyncConnection(),
        writeSyncConnection: connection =>
          database.writeSyncConnection(connection)
      },
      providerFactory,
      storeFactory: ({ connection, operationId, at: operationAt }) =>
        new IndexedDbSyncStore({
          database,
          providerConfigId: connection.providerConfigId ?? '',
          remoteObjectId: connection.remoteObjectId ?? '',
          operationId,
          at: operationAt
        })
    })
    await expect(journalUnavailable.resumeIncomplete(at)).resolves.toEqual({
      state: 'idle',
      reason: 'journal-unavailable'
    })
    await service.disconnect(at)
    await expect(service.resumeIncomplete(at)).resolves.toEqual({
      state: 'idle',
      reason: 'disconnected'
    })
    const readsBefore = vi.mocked(remote.provider.read).mock.calls.length
    await expect(service.syncNow(at)).resolves.toEqual({
      state: 'disconnected'
    })
    expect(remote.provider.read).toHaveBeenCalledTimes(readsBefore)
    await expect(
      service.deleteRemote({
        at,
        confirmedRemoteObjectId: 'wrong.json'
      })
    ).resolves.toEqual({ state: 'invalid-confirmation' })
    const deleteRemote = remote.provider.deleteRemote
    if (!deleteRemote) {
      throw new Error('Remote delete fixture is missing')
    }
    vi.mocked(deleteRemote).mockResolvedValueOnce({
      state: 'mismatch'
    })
    await expect(
      service.deleteRemote({
        at,
        confirmedRemoteObjectId: 'contentlens.json'
      })
    ).resolves.toEqual({ state: 'conflict', code: 'stale-remote' })
    vi.mocked(deleteRemote).mockResolvedValueOnce({
      state: 'deleted'
    })
    await expect(
      service.deleteRemote({
        at,
        confirmedRemoteObjectId: 'contentlens.json'
      })
    ).resolves.toEqual({
      state: 'degraded',
      code: 'delete-confirmation-mismatch'
    })
    await expect(
      service.deleteRemote({
        at,
        confirmedRemoteObjectId: 'contentlens.json'
      })
    ).resolves.toMatchObject({ state: 'deleted' })
    expect(remote.remote()).toBeUndefined()
  })

  it('fails closed when remote initialization cannot be confirmed', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-user-owned-sync-confirmation-mismatch'
    })
    await database.saveProfile(
      createLocalProfile({
        at,
        profileId: 'profile:sync-confirmation-mismatch'
      })
    )
    const remote = providerState()
    vi.mocked(remote.provider.confirm).mockResolvedValue({
      state: 'mismatch' as const
    })
    const service = new UserOwnedSyncService({
      repository: database,
      providerFactory: vi.fn(async () => remote.provider),
      storeFactory: ({ connection, operationId, at: operationAt }) =>
        new IndexedDbSyncStore({
          database,
          providerConfigId: connection.providerConfigId ?? '',
          remoteObjectId: connection.remoteObjectId ?? '',
          operationId,
          at: operationAt
        })
    })

    await expect(
      service.connect({
        providerConfigId: 'provider:sync',
        endpointPath: '/contentlens.json',
        remoteObjectId: 'contentlens.json',
        scheduleMinutes: null,
        retention: 'User controlled',
        revocation: 'Delete the token',
        consentedAt: at
      })
    ).resolves.toMatchObject({
      state: 'degraded',
      code: 'confirmation-mismatch'
    })
    await expect(service.conflictDraft()).resolves.toBeUndefined()
    await expect(
      service.resolveConflict({ at, resolutions: [] })
    ).resolves.toEqual({ state: 'disconnected' })
    database.close()
  })

  it('redacts unexpected provider connection errors into one stable code', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-user-owned-sync-provider-error'
    })
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:sync-provider-error' })
    )
    const remote = providerState()
    vi.mocked(remote.provider.read).mockRejectedValue(
      new Error('provider secret detail')
    )
    const service = new UserOwnedSyncService({
      repository: database,
      providerFactory: vi.fn(async () => remote.provider),
      storeFactory: ({ connection, operationId, at: operationAt }) =>
        new IndexedDbSyncStore({
          database,
          providerConfigId: connection.providerConfigId ?? '',
          remoteObjectId: connection.remoteObjectId ?? '',
          operationId,
          at: operationAt
        })
    })

    const result = await service.connect({
      providerConfigId: 'provider:sync',
      endpointPath: '/contentlens.json',
      remoteObjectId: 'contentlens.json',
      scheduleMinutes: 30,
      retention: 'User controlled',
      revocation: 'Delete the token',
      consentedAt: at
    })
    expect(result).toMatchObject({
      state: 'degraded',
      code: 'connection-failed'
    })
    expect(JSON.stringify(result)).not.toContain('secret detail')
    database.close()
  })

  it('keeps conflict and remote-delete operations explicit when no artifact exists', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-user-owned-sync-empty-conflict'
    })
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:sync-empty-conflict' })
    )
    const remote = providerState()
    const provider = { ...remote.provider, deleteRemote: undefined }
    const service = new UserOwnedSyncService({
      repository: database,
      providerFactory: vi.fn(async () => provider),
      storeFactory: ({ connection, operationId, at: operationAt }) =>
        new IndexedDbSyncStore({
          database,
          providerConfigId: connection.providerConfigId ?? '',
          remoteObjectId: connection.remoteObjectId ?? '',
          operationId,
          at: operationAt
        })
    })
    await service.connect({
      providerConfigId: 'provider:sync',
      endpointPath: '/contentlens.json',
      remoteObjectId: 'contentlens.json',
      scheduleMinutes: 15,
      retention: 'User controlled',
      revocation: 'Delete the token',
      consentedAt: at
    })

    await expect(service.conflictDraft()).resolves.toBeUndefined()
    await expect(
      service.resolveConflict({ at, resolutions: [] })
    ).resolves.toEqual({ state: 'unavailable' })
    await expect(
      service.deleteRemote({
        at,
        confirmedRemoteObjectId: 'contentlens.json'
      })
    ).resolves.toEqual({
      state: 'unavailable',
      code: 'remote-delete-unavailable'
    })
    database.close()
  })
})
