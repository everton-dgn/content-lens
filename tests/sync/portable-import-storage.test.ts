import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'

const at = '2026-07-31T12:00:00.000Z'
const importedAt = '2026-07-31T13:00:00.000Z'
const restoredAt = '2026-07-31T14:00:00.000Z'

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

async function portableEnvelope() {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:portable',
    generation: 0,
    profile: emptySyncProfile(),
    tombstones: []
  })
}

describe('portable import IndexedDB transaction', () => {
  it('atomically replaces profile and provider state, then restores both', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-portable-import-transaction'
    })
    const currentProfile = createLocalProfile({
      at,
      profileId: 'profile:local'
    })
    await database.saveProfile(currentProfile)
    await database.replaceProviderState({
      schemaVersion: 1,
      providers: [
        {
          ...providerBase,
          credentialMode: 'external-vault',
          credentialRef: 'credential:local',
          status: 'ready'
        }
      ],
      models: [],
      consents: [],
      credentials: [
        {
          schemaVersion: 1,
          reference: 'credential:local',
          mode: 'external-vault',
          binding: {
            providerConfigId: providerBase.providerConfigId,
            endpointOrigin: providerBase.endpointOrigin
          },
          externalReference: 'vault:item:local',
          proxyCredentialMode: 'none'
        }
      ]
    })
    const importedProfile = {
      ...currentProfile,
      revision: 1,
      updatedAt: importedAt,
      settings: { imported: true }
    }
    const importedState = {
      schemaVersion: 1 as const,
      providers: [
        {
          ...providerBase,
          credentialMode: 'session-only' as const,
          credentialRef: null,
          status: 'locked' as const
        }
      ],
      models: [],
      consents: [],
      credentials: []
    }
    const envelope = await portableEnvelope()

    await expect(
      database.replacePortableConfiguration(
        {
          mode: 'replace',
          profile: importedProfile,
          providerState: importedState,
          activeEnvelope: envelope,
          baseEnvelope: envelope
        },
        { at: importedAt, operationId: 'operation:portable:import' }
      )
    ).resolves.toEqual({ state: 'imported', revision: 1 })
    expect(await database.exportProfile()).toMatchObject({
      revision: 1,
      settings: { imported: true }
    })
    expect(await database.readProviderState()).toMatchObject({
      providers: [{ status: 'locked', credentialRef: null }],
      credentials: []
    })
    expect(await database.readPortableImportSnapshot()).toMatchObject({
      profile: { revision: 0 },
      providerState: {
        providers: [{ status: 'ready', credentialRef: 'credential:local' }],
        credentials: [{ reference: 'credential:local' }]
      }
    })

    await expect(
      database.restorePortableImportSnapshot({
        at: restoredAt,
        operationId: 'operation:portable:restore'
      })
    ).resolves.toEqual({ state: 'restored', revision: 2 })
    expect(await database.exportProfile()).toMatchObject({
      revision: 2,
      settings: currentProfile.settings
    })
    expect(await database.readProviderState()).toMatchObject({
      providers: [{ status: 'ready', credentialRef: 'credential:local' }],
      credentials: [{ reference: 'credential:local' }]
    })
  })

  it('rejects any portable provider state carrying local secrets', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-portable-import-secret-rejection'
    })
    const profile = createLocalProfile({ at, profileId: 'profile:local' })
    await database.saveProfile(profile)
    const envelope = await portableEnvelope()

    await expect(
      database.replacePortableConfiguration(
        {
          mode: 'replace',
          profile,
          providerState: {
            schemaVersion: 1,
            providers: [
              {
                ...providerBase,
                credentialMode: 'external-vault',
                credentialRef: 'credential:forbidden',
                status: 'ready'
              }
            ],
            models: [],
            consents: [],
            credentials: [
              {
                schemaVersion: 1,
                reference: 'credential:forbidden',
                mode: 'external-vault',
                binding: {
                  providerConfigId: providerBase.providerConfigId,
                  endpointOrigin: providerBase.endpointOrigin
                },
                externalReference: 'vault:item:forbidden',
                proxyCredentialMode: 'none'
              }
            ]
          },
          activeEnvelope: envelope,
          baseEnvelope: envelope
        },
        { at: importedAt, operationId: 'operation:portable:unsafe' }
      )
    ).resolves.toEqual({
      state: 'invalid',
      code: 'invalid-portable-state'
    })
    expect(await database.exportProfile()).toEqual(profile)
  })
})
