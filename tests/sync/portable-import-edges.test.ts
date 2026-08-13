import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'

const at = '2026-07-31T12:00:00.000Z'
const importedAt = '2026-07-31T13:00:00.000Z'
const restoredAt = '2026-07-31T14:00:00.000Z'

const emptyProviderState = {
  schemaVersion: 1 as const,
  providers: [],
  models: [],
  consents: [],
  credentials: []
}

const providerBase = {
  schemaVersion: 1 as const,
  providerConfigId: 'provider:portable',
  displayName: 'Portable provider',
  kind: 'openai-compatible' as const,
  execution: 'cloud' as const,
  endpointOrigin: 'https://provider.example',
  policyUrl: null,
  policyReviewedAt: null,
  createdAt: at,
  updatedAt: at
}

const localCredential = {
  schemaVersion: 1 as const,
  reference: 'credential:local',
  mode: 'external-vault' as const,
  binding: {
    providerConfigId: providerBase.providerConfigId,
    endpointOrigin: providerBase.endpointOrigin
  },
  externalReference: 'vault:item:local',
  proxyCredentialMode: 'none' as const
}

const envelope = (
  overrides: { generation?: number; syncProfileId?: string } = {}
) =>
  sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: overrides.syncProfileId ?? 'sync:portable',
    generation: overrides.generation ?? 0,
    profile: emptySyncProfile(),
    tombstones: []
  })

async function database(name: string, options: { profile?: boolean } = {}) {
  const instance = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName: `contentlens-portable-edges-${name}`
  })
  if (options.profile !== false) {
    await instance.saveProfile(
      createLocalProfile({ at, profileId: 'profile:local' })
    )
  }
  return instance
}

async function payload(
  overrides: Partial<
    Parameters<ContentLensDatabase['replacePortableConfiguration']>[0]
  > = {}
) {
  const sealed = await envelope()
  return {
    mode: 'replace' as const,
    profile: createLocalProfile({ at, profileId: 'profile:local' }),
    providerState: emptyProviderState,
    activeEnvelope: sealed,
    baseEnvelope: sealed,
    ...overrides
  }
}

describe('portable import refusal', () => {
  it('refuses a profile the schema does not accept', async () => {
    const store = await database('invalid-profile')

    await expect(
      store.replacePortableConfiguration(
        await payload({ profile: { profileId: 'profile:local' } as never }),
        { at: importedAt, operationId: 'operation:invalid-profile' }
      )
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })

  it('refuses envelopes that describe different sync profiles', async () => {
    const store = await database('profile-mismatch')

    await expect(
      store.replacePortableConfiguration(
        await payload({
          baseEnvelope: await envelope({ syncProfileId: 'sync:other' })
        }),
        { at: importedAt, operationId: 'operation:profile-mismatch' }
      )
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })

  it('refuses envelopes that sit on different generations', async () => {
    const store = await database('generation-mismatch')

    await expect(
      store.replacePortableConfiguration(
        await payload({ baseEnvelope: await envelope({ generation: 1 }) }),
        { at: importedAt, operationId: 'operation:generation-mismatch' }
      )
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })

  it('refuses a timestamp that is not an ISO instant', async () => {
    const store = await database('timestamp')

    await expect(
      store.replacePortableConfiguration(await payload(), {
        at: 'yesterday',
        operationId: 'operation:timestamp'
      })
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })

  it('refuses an operation with no identifier', async () => {
    const store = await database('operation-id')

    await expect(
      store.replacePortableConfiguration(await payload(), {
        at: importedAt,
        operationId: ''
      })
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-operation' })
  })

  it('refuses to import over a database that holds no profile', async () => {
    const store = await database('no-profile', { profile: false })

    await expect(
      store.replacePortableConfiguration(await payload(), {
        at: importedAt,
        operationId: 'operation:no-profile'
      })
    ).resolves.toEqual({ state: 'failed', code: 'profile-unavailable' })
  })
})

describe('portable import merge mode', () => {
  const localProvider = {
    ...providerBase,
    credentialMode: 'external-vault' as const,
    credentialRef: 'credential:local',
    status: 'ready' as const
  }
  const localState = {
    ...emptyProviderState,
    providers: [localProvider],
    credentials: [localCredential]
  }

  it('keeps an import that leaves every local secret in place', async () => {
    const store = await database('merge-preserving')
    await store.replaceProviderState(localState)

    await expect(
      store.replacePortableConfiguration(
        await payload({ mode: 'merge', providerState: localState }),
        { at: importedAt, operationId: 'operation:merge-preserving' }
      )
    ).resolves.toMatchObject({ state: 'imported' })
  })

  it('refuses a merge that rebinds a local credential', async () => {
    const store = await database('merge-rebinding')
    await store.replaceProviderState(localState)

    await expect(
      store.replacePortableConfiguration(
        await payload({
          mode: 'merge',
          providerState: {
            ...localState,
            providers: [{ ...localProvider, status: 'locked' as const }]
          }
        }),
        { at: importedAt, operationId: 'operation:merge-rebinding' }
      )
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })

  it('refuses a merge that brings a credential the database never held', async () => {
    const store = await database('merge-foreign-credential')
    await store.replaceProviderState(localState)

    await expect(
      store.replacePortableConfiguration(
        await payload({
          mode: 'merge',
          providerState: {
            ...localState,
            credentials: [
              { ...localCredential, externalReference: 'vault:item:foreign' }
            ]
          }
        }),
        { at: importedAt, operationId: 'operation:merge-foreign-credential' }
      )
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-portable-state' })
  })
})

describe('portable import replay', () => {
  it('answers a repeated import with the revision it already committed', async () => {
    const store = await database('import-replay')
    const input = await payload()
    const options = { at: importedAt, operationId: 'operation:import-replay' }
    const first = await store.replacePortableConfiguration(input, options)

    expect(first).toMatchObject({ state: 'imported' })
    await expect(
      store.replacePortableConfiguration(input, options)
    ).resolves.toEqual(first)
  })

  it('refuses to reuse an operation identifier for different content', async () => {
    const store = await database('import-conflict')
    const options = {
      at: importedAt,
      operationId: 'operation:import-conflict'
    }
    await store.replacePortableConfiguration(await payload(), options)

    await expect(
      store.replacePortableConfiguration(
        await payload({
          profile: {
            ...createLocalProfile({ at, profileId: 'profile:local' }),
            settings: { changed: true }
          }
        }),
        options
      )
    ).resolves.toEqual({ state: 'failed', code: 'operation-id-conflict' })
  })
})

describe('portable import restore', () => {
  it.each([
    { field: 'at', options: { at: 'yesterday', operationId: 'operation:one' } },
    { field: 'operationId', options: { at: restoredAt, operationId: '' } }
  ])('refuses a restore with an unusable $field', async ({ options }) => {
    const store = await database(`restore-${options.operationId || 'empty'}`)

    await expect(store.restorePortableImportSnapshot(options)).resolves.toEqual(
      { state: 'failed', code: 'invalid-operation' }
    )
  })

  it('reports no snapshot when nothing was imported', async () => {
    const store = await database('restore-missing')

    await expect(
      store.restorePortableImportSnapshot({
        at: restoredAt,
        operationId: 'operation:restore-missing'
      })
    ).resolves.toEqual({ state: 'snapshot-unavailable' })
  })

  it('answers a repeated restore with the revision it already committed', async () => {
    const store = await database('restore-replay')
    await store.replacePortableConfiguration(await payload(), {
      at: importedAt,
      operationId: 'operation:restore-replay-import'
    })
    const options = { at: restoredAt, operationId: 'operation:restore-replay' }
    const first = await store.restorePortableImportSnapshot(options)

    expect(first).toMatchObject({ state: 'restored' })
    await expect(store.restorePortableImportSnapshot(options)).resolves.toEqual(
      first
    )
  })

  it('refuses to reuse a restore identifier for another target', async () => {
    const store = await database('restore-conflict')
    await store.replacePortableConfiguration(await payload(), {
      at: importedAt,
      operationId: 'operation:restore-conflict'
    })

    // The import committed under this identifier, so the restore that reuses
    // it describes a different target under the same operation.
    await expect(
      store.restorePortableImportSnapshot({
        at: restoredAt,
        operationId: 'operation:restore-conflict'
      })
    ).resolves.toEqual({ state: 'failed', code: 'operation-id-conflict' })
  })

  it('puts the sync identity and base back the way the import found them', async () => {
    const store = await database('restore-sync-identity')
    const identity = await store.ensureSyncIdentity()
    const base = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: identity.syncProfileId,
      generation: identity.generation,
      profile: emptySyncProfile(),
      tombstones: []
    })
    await store.confirmSyncBase({
      envelope: base,
      providerConfigId: 'sync-provider:portable',
      remoteObjectId: 'contentlens.json',
      versionToken: '"version:base"',
      confirmedAt: at
    })
    await store.replacePortableConfiguration(await payload(), {
      at: importedAt,
      operationId: 'operation:restore-sync-identity-import'
    })

    await expect(
      store.restorePortableImportSnapshot({
        at: restoredAt,
        operationId: 'operation:restore-sync-identity'
      })
    ).resolves.toMatchObject({ state: 'restored' })
    expect(await store.readSyncIdentity()).toMatchObject({
      syncProfileId: identity.syncProfileId
    })
    expect(await store.readSyncBase(identity.syncProfileId)).toMatchObject({
      envelope: { digest: base.digest }
    })
  })
})
