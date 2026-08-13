import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import type { ModelDescriptor } from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  normalizeConsentKey,
  type ProviderDescriptor
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { ProviderStatePersistence } from '@/application/provider-management/persistence'
import { ProviderManagementService } from '@/application/provider-management/service'
import { CredentialVault } from '@/security/credentials/vault'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const now = '2026-07-31T06:40:00.000Z'
const passphrase = ['provider', 'state', 'fixture'].join('-')

function provider(
  providerConfigId: string,
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return {
    schemaVersion: 1,
    providerConfigId,
    displayName: providerConfigId,
    kind: 'openai-compatible',
    execution: 'cloud',
    endpointOrigin: 'https://provider.example',
    credentialMode: 'none',
    credentialRef: null,
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    createdAt: now,
    updatedAt: now,
    status: 'unconfigured',
    ...overrides
  }
}

function model(providerConfigId: string): ModelDescriptor {
  return {
    providerConfigId,
    modelId: 'fixture-text',
    displayName: 'Fixture text',
    declaredVersion: '1',
    executionKind: 'cloud',
    catalogSource: 'provider',
    lastCheckedAt: now,
    status: 'available',
    capabilities: [
      {
        task: 'classification-text',
        modalities: ['text'],
        languages: ['pt'],
        imageMimeTypes: [],
        maxInputBytes: 16_384,
        maxOutputBytes: 4_096,
        structuredOutput: true,
        evidence: 'declared',
        source: 'provider',
        verifiedAt: null
      }
    ]
  }
}

describe('durable provider state', () => {
  it('rehydrates descriptors, catalog, receipts and envelopes without session plaintext', async () => {
    const factory = new IDBFactory()
    const databaseName = 'contentlens-provider-state-roundtrip'
    const database = new ContentLensDatabase({ factory, databaseName })
    const providers = new ProviderRegistry([
      provider('provider:session'),
      provider('provider:wrapped'),
      provider('provider:external')
    ])
    const catalog = new ModelCatalog([model('provider:wrapped')])
    const consents = new ConsentRepository()
    const vault = new CredentialVault()
    const sessionValue = ['session', 'credential', 'canary'].join('-')
    const wrappedValue = ['wrapped', 'credential', 'canary'].join('-')
    const externalValue = ['external', 'proxy', 'canary'].join('-')

    const sessionRef = await vault.storeSession(
      {
        providerConfigId: 'provider:session',
        endpointOrigin: 'https://provider.example'
      },
      sessionValue
    )
    const wrappedRef = await vault.storeWrapped(
      {
        providerConfigId: 'provider:wrapped',
        endpointOrigin: 'https://provider.example'
      },
      wrappedValue,
      passphrase
    )
    const externalRef = await vault.storeExternal(
      {
        providerConfigId: 'provider:external',
        endpointOrigin: 'https://provider.example'
      },
      {
        externalReference: 'user-proxy:fixture',
        proxyCredential: {
          mode: 'passphrase-wrapped',
          value: externalValue,
          passphrase
        }
      }
    )
    providers.setCredential('provider:session', sessionRef, 'session-only', now)
    providers.setCredential(
      'provider:wrapped',
      wrappedRef,
      'passphrase-wrapped',
      now
    )
    providers.setCredential(
      'provider:external',
      externalRef,
      'external-vault',
      now
    )
    consents.grant({
      key: normalizeConsentKey({
        providerConfigId: 'provider:wrapped',
        endpointOrigin: 'https://provider.example',
        task: 'classification-text',
        platform: 'youtube',
        categories: ['title'],
        includeImages: false,
        consentSchemaVersion: 1
      }),
      providerKind: 'openai-compatible',
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: now,
      estimatedFrequency: 'per visible item',
      declaredRetention: 'none',
      consentedAt: now
    })
    await vault.unlock(
      wrappedRef,
      {
        providerConfigId: 'provider:wrapped',
        endpointOrigin: 'https://provider.example'
      },
      passphrase
    )

    await new ProviderStatePersistence(database).save({
      providers,
      catalog,
      consents,
      vault
    })

    const serialized = JSON.stringify(await database.readProviderState())
    expect(serialized).not.toContain(sessionValue)
    expect(serialized).not.toContain(wrappedValue)
    expect(serialized).not.toContain(externalValue)
    expect(serialized).not.toContain(passphrase)
    expect(await database.counts()).toMatchObject({
      providers: 3,
      models: 1,
      consents: 1,
      credentials: 3
    })
    expect(await database.exportProfile()).toBeUndefined()
    database.close()

    const reopened = new ContentLensDatabase({ factory, databaseName })
    const restored = await new ProviderStatePersistence(reopened).load()

    expect(restored.providers.list()).toEqual(providers.list())
    expect(restored.catalog.list()).toEqual(catalog.list())
    expect(restored.consents.snapshot()).toEqual(consents.snapshot())
    expect(restored.vault.metadata()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: sessionRef,
          mode: 'session-only',
          locked: true
        }),
        expect.objectContaining({
          reference: wrappedRef,
          mode: 'passphrase-wrapped',
          locked: true
        }),
        expect.objectContaining({
          reference: externalRef,
          mode: 'external-vault',
          proxyCredentialMode: 'passphrase-wrapped',
          locked: true
        })
      ])
    )
    await expect(
      restored.vault.use(
        sessionRef,
        {
          providerConfigId: 'provider:session',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).rejects.toThrow('credential-unavailable')
    await expect(
      restored.vault.use(
        wrappedRef,
        {
          providerConfigId: 'provider:wrapped',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).rejects.toThrow('credential-locked')

    await restored.vault.unlock(
      wrappedRef,
      {
        providerConfigId: 'provider:wrapped',
        endpointOrigin: 'https://provider.example'
      },
      passphrase
    )
    await expect(
      restored.vault.use(
        wrappedRef,
        {
          providerConfigId: 'provider:wrapped',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).resolves.toBe(wrappedValue)
    // Passphrase wrapping derives a key at the documented iteration count,
    // which the coverage instrumentation stretches past the default timeout.
  }, 30_000)

  it('removes the dedicated provider stores with the all-data scope', async () => {
    const factory = new IDBFactory()
    const databaseName = 'contentlens-provider-state-delete-all'
    const database = new ContentLensDatabase({ factory, databaseName })

    await new ProviderStatePersistence(database).save({
      providers: new ProviderRegistry([provider('provider:local')]),
      catalog: new ModelCatalog([model('provider:local')]),
      consents: new ConsentRepository(),
      vault: new CredentialVault()
    })
    await database.clear('all', { at: now })

    expect(await factory.databases()).toEqual([])
  })

  it('clears provider state without deleting the database', async () => {
    const factory = new IDBFactory()
    const databaseName = 'contentlens-provider-state-clear-scope'
    const database = new ContentLensDatabase({ factory, databaseName })
    const providers = new ProviderRegistry([provider('provider:clear')])

    await new ProviderStatePersistence(database).save({
      providers,
      catalog: new ModelCatalog([model('provider:clear')]),
      consents: new ConsentRepository(),
      vault: new CredentialVault()
    })

    expect(await database.clear('provider-state', { at: now })).toEqual({
      state: 'cleared'
    })
    expect(await database.readProviderState()).toEqual({
      schemaVersion: 1,
      providers: [],
      models: [],
      consents: [],
      credentials: []
    })
    expect(await factory.databases()).toEqual([
      expect.objectContaining({ name: databaseName })
    ])
  })

  it('commits credential replacement and disconnect atomically to durable state', async () => {
    const factory = new IDBFactory()
    const databaseName = 'contentlens-provider-state-lifecycle'
    const database = new ContentLensDatabase({ factory, databaseName })
    const providers = new ProviderRegistry([provider('provider:lifecycle')])
    const catalog = new ModelCatalog([model('provider:lifecycle')])
    const consents = new ConsentRepository()
    const vault = new CredentialVault()
    const persistence = new ProviderStatePersistence(database)
    const service = new ProviderManagementService({
      registry: providers,
      catalog,
      consents,
      vault,
      persistence,
      permissions: { remove: vi.fn(async () => true) }
    })
    await persistence.save({ providers, catalog, consents, vault })

    const configured = await service.setWrappedCredential(
      'provider:lifecycle',
      ['lifecycle', 'credential', 'canary'].join('-'),
      passphrase,
      now
    )
    consents.grant({
      key: normalizeConsentKey({
        providerConfigId: 'provider:lifecycle',
        endpointOrigin: 'https://provider.example',
        task: 'classification-text',
        platform: 'youtube',
        categories: ['title'],
        includeImages: false,
        consentSchemaVersion: 1
      }),
      providerKind: 'openai-compatible',
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: now,
      estimatedFrequency: 'per visible item',
      declaredRetention: 'none',
      consentedAt: now
    })
    await persistence.save({ providers, catalog, consents, vault })

    expect(await database.readProviderState()).toMatchObject({
      providers: [
        expect.objectContaining({
          credentialRef: configured.credentialRef,
          credentialMode: 'passphrase-wrapped'
        })
      ],
      credentials: [
        expect.objectContaining({ reference: configured.credentialRef })
      ],
      consents: [expect.any(Object)]
    })

    await service.disconnect('provider:lifecycle', now)
    database.close()
    const restored = await new ProviderStatePersistence(
      new ContentLensDatabase({ factory, databaseName })
    ).load()

    expect(restored.providers.get('provider:lifecycle')).toMatchObject({
      status: 'revoked',
      credentialRef: null
    })
    expect(restored.vault.metadata()).toEqual([])
    expect(restored.consents.snapshot()).toEqual([])
    expect(restored.catalog.list()).toEqual(catalog.list())
  })

  it('keeps the live state unchanged when durable persistence fails', async () => {
    const providers = new ProviderRegistry([provider('provider:failure')])
    const catalog = new ModelCatalog([model('provider:failure')])
    const consents = new ConsentRepository()
    const vault = new CredentialVault()
    const service = new ProviderManagementService({
      registry: providers,
      catalog,
      consents,
      vault,
      persistence: {
        save: vi.fn(async () => {
          throw new Error('synthetic-write-failure')
        })
      },
      permissions: { remove: vi.fn(async () => true) }
    })
    const before = service.snapshot()

    await expect(
      service.setSessionCredential(
        'provider:failure',
        ['failed', 'write', 'canary'].join('-'),
        now
      )
    ).rejects.toThrow('synthetic-write-failure')

    expect(service.snapshot()).toEqual(before)
    expect(providers.get('provider:failure')).toEqual(
      provider('provider:failure')
    )
  })
})
