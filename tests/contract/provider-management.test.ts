import { describe, expect, it, vi } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import { modelDescriptorSchema } from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  normalizeConsentKey,
  type ProviderDescriptor
} from '@/ai/providers/contracts'
import { ProviderHealthTracker } from '@/ai/providers/health'
import { ProviderRegistry } from '@/ai/providers/registry'
import type { ProviderStateWriter } from '@/application/provider-management/persistence'
import { ProviderManagementService } from '@/application/provider-management/service'
import { CredentialVault } from '@/security/credentials/vault'

const now = '2026-07-31T00:00:00.000Z'

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

describe('provider management lifecycle', () => {
  it('persists provider, manual model and exact consent through one service', async () => {
    const registry = new ProviderRegistry()
    const catalog = new ModelCatalog()
    const consents = new ConsentRepository()
    const persistence = {
      save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
    }
    const service = new ProviderManagementService({
      registry,
      catalog,
      consents,
      vault: new CredentialVault(),
      permissions: { remove: vi.fn(async () => true) },
      persistence
    })
    const configuredProvider = provider({
      credentialMode: 'none',
      execution: 'cloud',
      endpointOrigin: 'https://provider.example',
      kind: 'custom',
      status: 'ready'
    })
    const configuredModel = modelDescriptorSchema.parse({
      providerConfigId: configuredProvider.providerConfigId,
      modelId: 'local-text',
      displayName: 'Local text',
      declaredVersion: null,
      executionKind: 'cloud',
      catalogSource: 'user',
      lastCheckedAt: null,
      status: 'available',
      capabilities: [
        {
          task: 'classification-text',
          modalities: ['text'],
          languages: ['en', 'pt', 'es'],
          imageMimeTypes: [],
          maxInputBytes: 128_000,
          maxOutputBytes: 16_000,
          structuredOutput: true,
          evidence: 'declared',
          source: 'user',
          verifiedAt: null
        }
      ]
    })
    const consent = {
      key: normalizeConsentKey({
        providerConfigId: configuredProvider.providerConfigId,
        endpointOrigin: 'https://provider.example',
        task: 'classification-text',
        platform: 'youtube',
        categories: ['title'],
        includeImages: false,
        consentSchemaVersion: 1
      }),
      providerKind: configuredProvider.kind,
      policyUrl: null,
      policyReviewedAt: null,
      estimatedFrequency: 'per visible item',
      declaredRetention: null,
      consentedAt: now
    } as const

    await expect(service.registerProvider(configuredProvider)).resolves.toEqual(
      configuredProvider
    )
    await expect(service.registerModel(configuredModel)).resolves.toEqual(
      configuredModel
    )
    await expect(service.grantConsent(consent)).resolves.toEqual(consent)
    expect(service.snapshot()).toMatchObject({
      providers: [configuredProvider],
      models: [configuredModel],
      consents: [consent]
    })
    expect(persistence.save).toHaveBeenCalledTimes(3)
  })

  it('rotates a credential without exposing it and revokes dependent state', async () => {
    const registry = new ProviderRegistry([provider()])
    const vault = new CredentialVault()
    const consents = new ConsentRepository()
    const removePermission = vi.fn(async () => true)
    const service = new ProviderManagementService({
      registry,
      vault,
      consents,
      permissions: { remove: removePermission }
    })
    consents.grant({
      key: normalizeConsentKey({
        providerConfigId: 'provider:fixture',
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

    const first = await service.setSessionCredential(
      'provider:fixture',
      'credential-canary-first',
      now
    )
    const second = await service.setSessionCredential(
      'provider:fixture',
      'credential-canary-second',
      now
    )

    expect(first.credentialRef).not.toBe(second.credentialRef)
    expect(JSON.stringify(service.snapshot())).not.toContain(
      'credential-canary'
    )
    await expect(
      vault.use(
        first.credentialRef ?? '',
        {
          providerConfigId: 'provider:fixture',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).rejects.toThrow('credential-unavailable')
    expect(consents.hasForProvider('provider:fixture')).toBe(false)
    expect(second.status).toBe('locked')
  })

  it('edits provider identity and invalidates endpoint-bound state', async () => {
    const registry = new ProviderRegistry([provider()])
    const vault = new CredentialVault()
    const consents = new ConsentRepository()
    const removePermission = vi.fn(async () => true)
    const service = new ProviderManagementService({
      registry,
      vault,
      consents,
      permissions: { remove: removePermission }
    })
    await service.setSessionCredential(
      'provider:fixture',
      'endpoint-bound-canary',
      now
    )
    consents.grant({
      key: normalizeConsentKey({
        providerConfigId: 'provider:fixture',
        endpointOrigin: 'https://provider.example',
        task: 'classification-text',
        platform: 'youtube',
        categories: ['title'],
        includeImages: false,
        consentSchemaVersion: 1
      }),
      providerKind: 'openai-compatible',
      policyUrl: null,
      policyReviewedAt: null,
      estimatedFrequency: 'per visible item',
      declaredRetention: null,
      consentedAt: now
    })

    const renamed = await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Renamed provider',
        endpointOrigin: 'https://provider.example'
      },
      now
    )
    expect(renamed).toMatchObject({
      displayName: 'Renamed provider',
      credentialRef: expect.stringMatching(/^credential:/),
      status: 'locked'
    })
    expect(removePermission).not.toHaveBeenCalled()

    const rebound = await service.updateProvider(
      'provider:fixture',
      {
        displayName: 'Rebound provider',
        endpointOrigin: 'https://new-provider.example'
      },
      now
    )
    expect(rebound).toMatchObject({
      displayName: 'Rebound provider',
      endpointOrigin: 'https://new-provider.example',
      credentialRef: null,
      status: 'unconfigured'
    })
    expect(service.snapshot().credentials).toEqual([])
    expect(consents.hasForProvider('provider:fixture')).toBe(false)
    expect(removePermission).toHaveBeenCalledWith('https://provider.example')
    expect(JSON.stringify(service.snapshot())).not.toContain(
      'endpoint-bound-canary'
    )
  })

  it('removes a provider together with its models and durable state', async () => {
    const configuredProvider = provider({
      credentialMode: 'none',
      kind: 'custom',
      status: 'ready'
    })
    const registry = new ProviderRegistry([configuredProvider])
    const catalog = new ModelCatalog([
      modelDescriptorSchema.parse({
        providerConfigId: configuredProvider.providerConfigId,
        modelId: 'fixture-model',
        displayName: 'Fixture model',
        declaredVersion: null,
        executionKind: 'cloud',
        catalogSource: 'user',
        lastCheckedAt: null,
        status: 'available',
        capabilities: []
      })
    ])
    const persistence = {
      save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
    }
    const removePermission = vi.fn(async () => true)
    const service = new ProviderManagementService({
      registry,
      catalog,
      consents: new ConsentRepository(),
      vault: new CredentialVault(),
      permissions: { remove: removePermission },
      persistence
    })

    const removed = await service.removeProvider('provider:fixture')

    expect(removed.provider).toEqual(configuredProvider)
    expect(removed.removedModels).toEqual([
      expect.objectContaining({ modelId: 'fixture-model' })
    ])
    expect(service.snapshot()).toMatchObject({ providers: [], models: [] })
    expect(persistence.save).toHaveBeenCalledOnce()
    expect(removePermission).toHaveBeenCalledWith('https://provider.example')
  })

  it('persists only a wrapped envelope and records the selected mode', async () => {
    const registry = new ProviderRegistry([provider()])
    const vault = new CredentialVault()
    const service = new ProviderManagementService({
      registry,
      vault,
      consents: new ConsentRepository(),
      permissions: { remove: vi.fn(async () => true) }
    })

    const updated = await service.setWrappedCredential(
      'provider:fixture',
      'wrapped-credential-canary',
      ['fixture', 'passphrase'].join('-'),
      now
    )

    expect(updated).toMatchObject({
      credentialMode: 'passphrase-wrapped',
      credentialRef: expect.stringMatching(/^credential:/),
      status: 'locked'
    })
    expect(service.snapshot().credentials).toEqual([
      expect.objectContaining({
        mode: 'passphrase-wrapped',
        locked: true
      })
    ])
    expect(JSON.stringify(service.snapshot())).not.toContain(
      'wrapped-credential-canary'
    )
  })

  it('keeps the provider key external and treats an optional proxy token as write-only', async () => {
    const registry = new ProviderRegistry([provider()])
    const vault = new CredentialVault()
    const service = new ProviderManagementService({
      registry,
      vault,
      consents: new ConsentRepository(),
      permissions: { remove: vi.fn(async () => true) }
    })
    const proxyToken = 'proxy-token-canary'

    const withToken = await service.setExternalVault(
      'provider:fixture',
      {
        externalReference: 'user-proxy:primary',
        proxyCredential: {
          mode: 'session-only',
          value: proxyToken
        }
      },
      now
    )

    expect(withToken).toMatchObject({
      credentialMode: 'external-vault',
      credentialRef: expect.stringMatching(/^credential:/),
      status: 'locked'
    })
    expect(service.snapshot().credentials).toEqual([
      expect.objectContaining({
        mode: 'external-vault',
        externalReference: 'user-proxy:primary',
        proxyCredentialMode: 'session-only',
        locked: false
      })
    ])
    expect(JSON.stringify(service.snapshot())).not.toContain(proxyToken)
    await expect(
      vault.use(
        withToken.credentialRef ?? '',
        {
          providerConfigId: 'provider:fixture',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).resolves.toBe(proxyToken)

    const withoutToken = await service.setExternalVault(
      'provider:fixture',
      { externalReference: 'user-proxy:rotated' },
      now
    )
    expect(service.snapshot().credentials).toEqual([
      expect.objectContaining({
        mode: 'external-vault',
        externalReference: 'user-proxy:rotated',
        proxyCredentialMode: 'none',
        locked: false
      })
    ])
    await expect(
      vault.use(
        withToken.credentialRef ?? '',
        {
          providerConfigId: 'provider:fixture',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).rejects.toThrow('credential-unavailable')
    await expect(
      vault.use(
        withoutToken.credentialRef ?? '',
        {
          providerConfigId: 'provider:fixture',
          endpointOrigin: 'https://provider.example'
        },
        async value => value
      )
    ).rejects.toThrow('credential-unavailable')
  })

  it('keeps a wrapped proxy token locked until explicit unlock', async () => {
    const registry = new ProviderRegistry([provider()])
    const vault = new CredentialVault()
    const service = new ProviderManagementService({
      registry,
      vault,
      consents: new ConsentRepository(),
      permissions: { remove: vi.fn(async () => true) }
    })
    const passphrase = ['external', 'proxy', 'fixture'].join('-')
    const updated = await service.setExternalVault(
      'provider:fixture',
      {
        externalReference: 'user-proxy:wrapped',
        proxyCredential: {
          mode: 'passphrase-wrapped',
          value: 'wrapped-proxy-token-canary',
          passphrase
        }
      },
      now
    )
    const reference = updated.credentialRef ?? ''
    const binding = {
      providerConfigId: 'provider:fixture',
      endpointOrigin: 'https://provider.example'
    }

    expect(service.snapshot().credentials).toEqual([
      expect.objectContaining({
        mode: 'external-vault',
        proxyCredentialMode: 'passphrase-wrapped',
        locked: true
      })
    ])
    await expect(
      vault.use(reference, binding, async value => value)
    ).rejects.toThrow('credential-locked')

    await vault.unlock(reference, binding, passphrase)
    await expect(
      vault.use(reference, binding, async value => value)
    ).resolves.toBe('wrapped-proxy-token-canary')
  })

  it('disconnects locally and removes a shared permission only for the last user', async () => {
    const registry = new ProviderRegistry([
      provider(),
      provider({
        providerConfigId: 'provider:second',
        displayName: 'Second provider'
      })
    ])
    const vault = new CredentialVault()
    const consents = new ConsentRepository()
    const removePermission = vi.fn(async () => true)
    const service = new ProviderManagementService({
      registry,
      vault,
      consents,
      permissions: { remove: removePermission }
    })
    await service.setSessionCredential(
      'provider:fixture',
      'credential-canary-first',
      now
    )
    await service.setSessionCredential(
      'provider:second',
      'credential-canary-second',
      now
    )

    await service.disconnect('provider:fixture', now)
    expect(removePermission).not.toHaveBeenCalled()
    await service.disconnect('provider:second', now)
    expect(removePermission).toHaveBeenCalledOnce()
    expect(removePermission).toHaveBeenCalledWith('https://provider.example')
    expect(registry.get('provider:fixture')).toMatchObject({
      status: 'revoked',
      credentialRef: null
    })
  })

  it('refreshes and persists the provider catalog through the management service', async () => {
    const registry = new ProviderRegistry([
      provider({ kind: 'openai', status: 'ready' })
    ])
    const catalog = new ModelCatalog()
    const vault = new CredentialVault()
    const persistence = {
      save: vi.fn<ProviderStateWriter['save']>(async () => undefined)
    }
    const permissionProbe = vi.fn(async () => true)
    const service = new ProviderManagementService({
      registry,
      catalog,
      vault,
      consents: new ConsentRepository(),
      permissions: {
        has: permissionProbe,
        remove: vi.fn(async () => true)
      },
      persistence
    })
    await service.setSessionCredential(
      'provider:fixture',
      'catalog-service-canary',
      now
    )
    persistence.save.mockClear()

    await expect(
      service.refreshCatalog('provider:fixture', {
        checkedAt: now,
        userInitiated: true,
        fetchImpl: vi.fn(async (_request, init) => {
          expect(new Headers(init?.headers).get('authorization')).toBe(
            'Bearer catalog-service-canary'
          )
          return new Response(
            JSON.stringify({ data: [{ id: 'gpt-service' }] }),
            { headers: { 'content-type': 'application/json' } }
          )
        })
      })
    ).resolves.toMatchObject([
      {
        providerConfigId: 'provider:fixture',
        modelId: 'gpt-service',
        lastCheckedAt: now
      }
    ])
    expect(catalog.list()).toMatchObject([
      { modelId: 'gpt-service', catalogSource: 'provider' }
    ])
    expect(persistence.save).toHaveBeenCalledOnce()
    expect(permissionProbe).toHaveBeenCalledOnce()
    expect(JSON.stringify(service.snapshot())).not.toContain(
      'catalog-service-canary'
    )
  })

  it('tracks health by provider and task without endpoint or content', () => {
    const health = new ProviderHealthTracker()
    health.record({
      providerConfigId: 'provider:fixture',
      task: 'classification-text',
      status: 'degraded',
      code: 'provider-timeout',
      latencyMs: 1500,
      at: now
    })

    expect(health.snapshot()).toEqual([
      {
        providerConfigId: 'provider:fixture',
        task: 'classification-text',
        status: 'degraded',
        code: 'provider-timeout',
        latencyMs: 1500,
        updatedAt: now,
        consecutiveFailures: 1
      }
    ])
    expect(JSON.stringify(health.snapshot())).not.toContain('provider.example')
  })
})
