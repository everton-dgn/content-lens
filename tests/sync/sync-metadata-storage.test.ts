import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { sealSyncEnvelope } from '@/sync/canonical'
import { createSyncConflictDraft } from '@/sync/conflict-draft'
import { emptySyncProfile } from '@/sync/contracts'
import { createSyncJournal } from '@/sync/journal'
import { buildLocalSyncEnvelope } from '@/sync/local-envelope'

const at = '2026-07-31T12:00:00.000Z'

async function envelope(value: number) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:metadata',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'same', value: { value } }]
    },
    tombstones: []
  })
}

describe('durable sync metadata', () => {
  it('round-trips validated conflict drafts and journals', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-sync-metadata'
    })
    const draft = await createSyncConflictDraft({
      base: await envelope(1),
      local: await envelope(2),
      remote: await envelope(3),
      remoteVersionToken: '"version:one"',
      at
    })
    const journal = createSyncJournal({
      operationId: 'sync-operation:metadata',
      syncProfileId: 'sync:metadata',
      baseDigest: draft.base.digest,
      at
    })

    await expect(database.writeSyncConflictDraft(draft)).resolves.toEqual({
      state: 'stored'
    })
    await expect(database.writeSyncJournal(journal)).resolves.toEqual({
      state: 'stored'
    })
    await expect(
      database.readSyncConflictDraft('sync:metadata')
    ).resolves.toMatchObject({ remoteVersionToken: '"version:one"' })
    await expect(database.readSyncJournal('sync:metadata')).resolves.toEqual(
      journal
    )

    await database.clearSyncConflictDraft('sync:metadata')
    await expect(
      database.readSyncConflictDraft('sync:metadata')
    ).resolves.toBeUndefined()
  })

  it('rejects malformed durable metadata', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-sync-metadata-rejection'
    })
    await expect(
      database.writeSyncConflictDraft({ bad: true })
    ).resolves.toEqual({ state: 'invalid' })
    await expect(database.writeSyncJournal({ bad: true })).resolves.toEqual({
      state: 'invalid'
    })
  })

  it('commits a local candidate with recovery, then advances base after confirmation', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-sync-candidate-commit'
    })
    const profile = createLocalProfile({ at, profileId: 'profile:sync' })
    await database.saveProfile(profile)
    const identity = await database.ensureSyncIdentity()
    const candidate = await buildLocalSyncEnvelope({
      generation: identity.generation,
      profile,
      providerState: await database.readProviderState(),
      syncProfileId: identity.syncProfileId
    })

    await expect(
      database.commitSyncCandidate(candidate, {
        at,
        operationId: 'sync-operation:commit'
      })
    ).resolves.toEqual({ state: 'committed', revision: 1 })
    await expect(database.readActiveSyncEnvelope()).resolves.toEqual(candidate)
    await expect(database.listSyncRecoverySnapshots()).resolves.toHaveLength(1)
    await expect(
      database.confirmSyncBase({
        envelope: candidate,
        providerConfigId: 'sync-provider:test',
        remoteObjectId: 'contentlens.json',
        versionToken: '"version:confirmed"',
        confirmedAt: at
      })
    ).resolves.toEqual({ state: 'confirmed' })
    await expect(
      database.readSyncBase(identity.syncProfileId)
    ).resolves.toMatchObject({ confirmedDigest: candidate.digest })
    await expect(
      database.readSyncTransportState(identity.syncProfileId)
    ).resolves.toMatchObject({
      versionToken: '"version:confirmed"',
      lastConfirmedDigest: candidate.digest
    })

    await expect(
      database.commitSyncCandidate(
        { ...candidate, digest: '0'.repeat(64) },
        { at, operationId: 'sync-operation:tampered' }
      )
    ).resolves.toEqual({ state: 'invalid' })
  })

  it('restores a recovery snapshot as a new local revision without pushing', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-sync-recovery-restore'
    })
    const profile = createLocalProfile({ at, profileId: 'profile:recovery' })
    await database.saveProfile(profile)
    const identity = await database.ensureSyncIdentity()
    const candidate = await buildLocalSyncEnvelope({
      generation: identity.generation,
      profile,
      providerState: await database.readProviderState(),
      syncProfileId: identity.syncProfileId
    })
    await database.commitSyncCandidate(candidate, {
      at,
      operationId: 'sync-operation:before-restore'
    })
    await database.saveProfile({
      ...profile,
      revision: 4,
      updatedAt: '2026-07-31T13:00:00.000Z',
      settings: { marker: 'changed' }
    })
    const [snapshot] = await database.listSyncRecoverySnapshots()
    if (!snapshot) {
      throw new Error('Expected a sync recovery snapshot')
    }

    await expect(
      database.restoreSyncRecoverySnapshot(snapshot.id, {
        at: '2026-07-31T14:00:00.000Z',
        operationId: 'sync-operation:restore'
      })
    ).resolves.toEqual({
      state: 'restored',
      revision: 5,
      automaticPush: false
    })
    await expect(database.exportProfile()).resolves.toMatchObject({
      revision: 5,
      settings: {}
    })
    await expect(database.listSyncRecoverySnapshots()).resolves.toHaveLength(2)
  })
})
