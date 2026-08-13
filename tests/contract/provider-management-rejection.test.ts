import { describe, expect, it, vi } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  type ModelDescriptor,
  modelDescriptorSchema
} from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import type { ProviderStateWriter } from '@/application/provider-management/persistence'
import { ProviderManagementService } from '@/application/provider-management/service'
import { CredentialVault } from '@/security/credentials/vault'

const now = '2026-07-31T00:00:00.000Z'
const later = '2026-07-31T01:00:00.000Z'

function provider(
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return {
    schemaVersion: 1,
    providerConfigId: 'provider:fixture',
    displayName: 'Fixture provider',
    kind: 'openai-compatible',
    execution: 'cloud',
    endpointOrigin: 'https://provider.example',
    credentialMode: 'session-only',
    credentialRef: null,
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    createdAt: now,
    updatedAt: now,
    status: 'unconfigured',
    ...overrides
  }
}

function model(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return modelDescriptorSchema.parse({
    providerConfigId: 'provider:fixture',
    modelId: 'fixture-text',
    displayName: 'Fixture text',
    declaredVersion: '1',
    executionKind: 'cloud',
    catalogSource: 'user',
    lastCheckedAt: now,
    status: 'available',
    capabilities: [
      {
        task: 'classification-text',
        modalities: ['text'],
        languages: ['pt'],
        imageMimeTypes: [],
        maxInputBytes: 64_000,
        maxOutputBytes: 8_000,
        structuredOutput: true,
        evidence: 'declared',
        source: 'user',
        verifiedAt: null
      }
    ],
    ...overrides
  })
}

function environment(options: { withCatalog?: boolean } = {}) {
  const registry = new ProviderRegistry()
  const remove = vi.fn(async () => true)
  const catalog = new ModelCatalog()
  const persistence = {
    save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
  }
  const vault = new CredentialVault()
  const service = new ProviderManagementService({
    registry,
    consents: new ConsentRepository(),
    vault,
    permissions: { remove },
    ...(options.withCatalog === false ? {} : { catalog, persistence })
  })
  return { catalog, registry, remove, service, vault }
}

describe('provider management wiring', () => {
  it.each([
    { name: 'a catalog with no persistence', withCatalog: true },
    { name: 'persistence with no catalog', withCatalog: false }
  ])('refuses $name', ({ withCatalog }) => {
    expect(
      () =>
        new ProviderManagementService({
          registry: new ProviderRegistry(),
          consents: new ConsentRepository(),
          vault: new CredentialVault(),
          permissions: { remove: vi.fn(async () => true) },
          ...(withCatalog
            ? { catalog: new ModelCatalog() }
            : {
                persistence: {
                  save: vi.fn<ProviderStateWriter['save']>(
                    async () => undefined
                  )
                }
              })
        })
    ).toThrow('Provider persistence requires the shared model catalog')
  })
})

describe('provider management registration rejection', () => {
  it('refuses a second provider under the same configuration id', async () => {
    const { service } = environment()
    await service.registerProvider(provider())

    await expect(service.registerProvider(provider())).rejects.toThrow(
      'provider-configuration-already-exists'
    )
  })

  it('refuses a manual model with no catalog to hold it', async () => {
    const { service } = environment({ withCatalog: false })
    await service.registerProvider(provider())

    await expect(service.registerModel(model())).rejects.toThrow(
      'Provider model catalog is unavailable'
    )
  })

  it('refuses a model whose execution disagrees with its provider', async () => {
    const { service } = environment()
    await service.registerProvider(provider())

    await expect(
      service.registerModel(model({ executionKind: 'local' }))
    ).rejects.toThrow('model-provider-execution-mismatch')
  })

  it('refuses a model for a provider that was never registered', async () => {
    const { service } = environment()

    await expect(service.registerModel(model())).rejects.toThrow()
  })
})

describe('provider management immutability', () => {
  const builtIn = provider({
    providerConfigId: 'provider:built-in',
    displayName: 'Browser model',
    kind: 'browser-built-in',
    execution: 'browser',
    endpointOrigin: 'https://browser-runtime.invalid',
    credentialMode: 'none',
    policyUrl: null,
    policyReviewedAt: null
  })

  it('refuses to update the browser built-in provider', async () => {
    const { service } = environment()
    await service.registerProvider(builtIn)

    await expect(
      service.updateProvider(
        'provider:built-in',
        {
          displayName: 'Renamed',
          endpointOrigin: 'https://browser-runtime.invalid'
        },
        later
      )
    ).rejects.toThrow('built-in-provider-is-immutable')
  })

  it('refuses to remove the browser built-in provider', async () => {
    const { service } = environment()
    await service.registerProvider(builtIn)

    await expect(service.removeProvider('provider:built-in')).rejects.toThrow(
      'built-in-provider-is-immutable'
    )
  })
})

describe('provider management endpoint changes', () => {
  it('drops the stored credential and consent when the endpoint moves', async () => {
    const { service, vault } = environment()
    await service.registerProvider(provider())
    const configured = await service.setSessionCredential(
      'provider:fixture',
      'secret-value',
      now
    )
    expect(configured.credentialRef).not.toBeNull()

    const updated = await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Fixture provider',
        endpointOrigin: 'https://moved.example'
      },
      later
    )

    expect(updated).toMatchObject({
      endpointOrigin: 'https://moved.example',
      credentialRef: null,
      status: 'unconfigured'
    })
    expect(vault.metadata()).toEqual([])
  })

  it('keeps the last connection test when only the display name changes', async () => {
    const { registry, service } = environment()
    await service.registerProvider(provider())
    registry.recordConnectionTest('provider:fixture', {
      outcome: 'success',
      code: 'provider-connection-ready',
      checkedAt: now,
      latencyMs: 12,
      providerStatus: 'ready'
    })

    const updated = await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Renamed provider',
        endpointOrigin: 'https://provider.example'
      },
      later
    )

    expect(updated).toMatchObject({
      displayName: 'Renamed provider',
      lastConnectionTest: expect.objectContaining({ outcome: 'success' })
    })
  })

  it('keeps the host permission when another provider still uses the origin', async () => {
    const { remove, service } = environment()
    await service.registerProvider(provider())
    await service.registerProvider(
      provider({ providerConfigId: 'provider:neighbour' })
    )

    await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Fixture provider',
        endpointOrigin: 'https://moved.example'
      },
      later
    )

    expect(remove).not.toHaveBeenCalled()
  })

  it('releases the host permission when the last provider leaves the origin', async () => {
    const { remove, service } = environment()
    await service.registerProvider(provider())

    await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Fixture provider',
        endpointOrigin: 'https://moved.example'
      },
      later
    )

    expect(remove).toHaveBeenCalledWith('https://provider.example')
  })
})

describe('provider management removal', () => {
  it('reports no removed models when the service has no catalog', async () => {
    const { service } = environment({ withCatalog: false })
    await service.registerProvider(provider())

    expect(await service.removeProvider('provider:fixture')).toMatchObject({
      removedModels: []
    })
  })

  it('keeps the host permission when another provider still uses the origin', async () => {
    const { remove, service } = environment()
    await service.registerProvider(provider())
    await service.registerProvider(
      provider({ providerConfigId: 'provider:neighbour' })
    )

    await service.removeProvider('provider:fixture')

    expect(remove).not.toHaveBeenCalled()
  })
})
