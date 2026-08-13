import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import { IndexedDbSyncStore } from '@/sync/indexed-db-store'

const at = '2026-07-31T12:00:00.000Z'

describe('IndexedDB sync store', () => {
  it('atomically persists recovery, local candidate and journal before confirmation', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-indexeddb-sync-store'
    })
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:sync-store' })
    )
    const identity = await database.ensureSyncIdentity()
    const base = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: identity.syncProfileId,
      generation: identity.generation,
      profile: emptySyncProfile(),
      tombstones: []
    })
    await database.confirmSyncBase({
      envelope: base,
      providerConfigId: 'sync-provider:test',
      remoteObjectId: 'contentlens.json',
      versionToken: '"version:base"',
      confirmedAt: at
    })
    const store = new IndexedDbSyncStore({
      database,
      providerConfigId: 'sync-provider:test',
      remoteObjectId: 'contentlens.json',
      operationId: 'sync-operation:store',
      at
    })
    const local = await store.readLocal()
    await store.writeJournal({
      phase: 'started',
      candidateDigest: base.digest,
      attempt: 0,
      at
    })
    await store.writeJournal({
      phase: 'remote-read',
      remoteVersionToken: '"version:base"',
      attempt: 1,
      at
    })
    await store.writeJournal({
      phase: 'validated',
      remoteVersionToken: '"version:base"',
      attempt: 1,
      at
    })
    await store.commitLocal({
      candidate: local,
      recovery: local,
      remoteVersionToken: '"version:base"',
      attempt: 1,
      at
    })

    await expect(
      database.readSyncJournal(identity.syncProfileId)
    ).resolves.toMatchObject({
      phase: 'local-committed',
      candidateDigest: local.digest
    })
    await expect(database.listSyncRecoverySnapshots()).resolves.toHaveLength(1)
    await expect(database.readActiveSyncEnvelope()).resolves.toEqual(local)

    await store.confirmBase({
      envelope: local,
      versionToken: '"version:confirmed"',
      confirmedAt: at
    })
    await expect(store.readBase()).resolves.toEqual(local)

    const conflictingEnvelope = async (value: number) =>
      sealSyncEnvelope({
        schemaVersion: 1,
        syncProfileId: identity.syncProfileId,
        generation: identity.generation,
        profile: {
          ...emptySyncProfile(),
          exclusions: [{ id: 'same', value: { value } }]
        },
        tombstones: []
      })
    await store.writeConflictDraft({
      base: await conflictingEnvelope(1),
      local: await conflictingEnvelope(2),
      remote: await conflictingEnvelope(3),
      remoteVersionToken: '"version:conflict"',
      at
    })
    await expect(store.readConflictDraft()).resolves.toMatchObject({
      remoteVersionToken: '"version:conflict"',
      resolutions: []
    })
    await store.saveConflictResolutions(
      [{ entityType: 'exclusions', entityId: 'same', choice: 'local' }],
      '2026-07-31T12:01:00.000Z'
    )
    await expect(store.readConflictDraft()).resolves.toMatchObject({
      resolutions: [
        { entityType: 'exclusions', entityId: 'same', choice: 'local' }
      ],
      updatedAt: '2026-07-31T12:01:00.000Z'
    })
    await store.clearConflictDraft()
    await expect(store.readConflictDraft()).resolves.toBeUndefined()

    database.close()
  })

  it('returns no base before sync identity exists and records a degraded journal when startup was missing', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-indexeddb-sync-store-degraded'
    })
    const store = new IndexedDbSyncStore({
      database,
      providerConfigId: 'sync-provider:test',
      remoteObjectId: 'contentlens.json',
      operationId: 'sync-operation:degraded',
      at
    })
    await expect(store.readBase()).resolves.toBeUndefined()
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:sync-store-degraded' })
    )
    await store.writeJournal({
      phase: 'remote-read',
      remoteVersionToken: '"version:remote"',
      attempt: 1,
      at
    })
    const identity = await database.ensureSyncIdentity()
    await expect(
      database.readSyncJournal(identity.syncProfileId)
    ).resolves.toMatchObject({
      phase: 'degraded',
      remoteVersionToken: '"version:remote"'
    })
    database.close()
  })

  it('fails closed when required profile, journal, draft or durable writes are unavailable', async () => {
    const identity = { syncProfileId: 'sync:failure', generation: 0 }
    const database = {
      exportProfile: async () => undefined,
      readProviderState: async () => undefined,
      ensureSyncIdentity: async () => identity,
      readSyncIdentity: async () => identity,
      readActiveSyncEnvelope: async () => undefined,
      readSyncBase: async () => undefined,
      readSyncJournal: async () => undefined,
      readSyncConflictDraft: async () => undefined,
      commitSyncCandidate: async () => ({ state: 'conflict' }),
      confirmSyncBase: async () => ({ state: 'conflict' }),
      writeSyncConflictDraft: async () => ({ state: 'conflict' }),
      writeSyncJournal: async () => ({ state: 'conflict' }),
      clearSyncConflictDraft: async () => undefined
    } as unknown as ContentLensDatabase
    const store = new IndexedDbSyncStore({
      database,
      providerConfigId: 'sync-provider:test',
      remoteObjectId: 'contentlens.json',
      operationId: 'sync-operation:failure',
      at
    })
    await expect(store.readLocal()).rejects.toThrow(
      'Local profile is unavailable'
    )
    await expect(
      store.commitLocal({
        candidate: await sealSyncEnvelope({
          schemaVersion: 1,
          syncProfileId: identity.syncProfileId,
          generation: identity.generation,
          profile: emptySyncProfile(),
          tombstones: []
        }),
        recovery: await sealSyncEnvelope({
          schemaVersion: 1,
          syncProfileId: identity.syncProfileId,
          generation: identity.generation,
          profile: emptySyncProfile(),
          tombstones: []
        }),
        remoteVersionToken: '"version"',
        attempt: 1,
        at
      })
    ).rejects.toThrow('Sync journal is unavailable')
    await expect(store.saveConflictResolutions([], at)).rejects.toThrow(
      'Sync conflict draft is unavailable'
    )
    await expect(
      store.writeJournal({ phase: 'started', attempt: 0, at })
    ).rejects.toThrow('Unable to persist the sync journal')
  })
})
