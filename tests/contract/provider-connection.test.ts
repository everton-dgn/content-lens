import { describe, expect, it, vi } from 'vitest'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import { ModelCatalog } from '@/ai/models/catalog'
import { ConsentRepository } from '@/ai/providers/consent'
import {
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { executeProviderRequestPlan } from '@/ai/providers/request-policy'
import {
  createProviderFromTemplate,
  listProviderTemplates
} from '@/ai/providers/templates'
import {
  BrowserPermissionPort,
  type BrowserPermissionsApi
} from '@/application/provider-management/browser-permissions'
import {
  classifyProviderConnectionFailure,
  PROVIDER_CONNECTION_CODE_VALUES,
  ProviderConnectionFailure,
  runProviderConnectionTest,
  SYNTHETIC_CONNECTION_PROMPT
} from '@/application/provider-management/connection-test'
import { ProviderManagementService } from '@/application/provider-management/service'
import { CredentialVault } from '@/security/credentials/vault'

const now = '2026-07-31T06:50:00.000Z'

function cloudProvider(
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId: 'provider:connection',
    displayName: 'Connection fixture',
    kind: 'openai-compatible',
    execution: 'cloud',
    endpointOrigin: 'https://provider.example',
    credentialMode: 'session-only',
    credentialRef: null,
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    createdAt: now,
    updatedAt: now,
    status: 'locked',
    ...overrides
  })
}

function validModelOutput(): ClassificationModelOutput {
  return {
    schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
    topics: [],
    archetypes: [],
    quality: {},
    semanticRuleMatches: [],
    evidence: [],
    confidence: null,
    abstention: null
  }
}

function permissionApi(): BrowserPermissionsApi {
  return {
    contains: vi.fn(async () => true),
    getAll: vi.fn(async () => ({
      origins: ['https://api.openai.com/*'],
      permissions: [],
      data_collection: [
        'authenticationInfo',
        'websiteContent'
      ] as const as unknown as Array<'authenticationInfo' | 'websiteContent'>
    })),
    remove: vi.fn(async () => true),
    request: vi.fn(async () => true)
  }
}

describe('provider templates', () => {
  it('covers every supported provider kind with reviewed known endpoints', () => {
    const templates = listProviderTemplates()

    expect(templates.map(({ templateId }) => templateId)).toEqual([
      'browser-built-in',
      'anthropic',
      'custom',
      'gemini',
      'ollama',
      'openai',
      'openai-compatible',
      'user-proxy'
    ])
    expect(
      templates.filter(
        ({ kind }) =>
          kind === 'openai' || kind === 'anthropic' || kind === 'gemini'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          execution: 'cloud',
          policyUrl: expect.stringMatching(/^https:/),
          policyReviewedAt: expect.stringMatching(/^2026-07-31T/),
          suggestedEndpointOrigin: expect.stringMatching(/^https:/)
        })
      ])
    )
    expect(
      templates.find(({ templateId }) => templateId === 'browser-built-in')
    ).toMatchObject({
      credentialModes: ['none'],
      execution: 'browser',
      suggestedEndpointOrigin: 'https://browser-ai.contentlens.invalid'
    })
    expect(
      templates.find(({ templateId }) => templateId === 'ollama')
    ).toMatchObject({
      credentialModes: ['none'],
      execution: 'local',
      suggestedEndpointOrigin: 'http://127.0.0.1:11434'
    })
  })

  it('creates a strict provider descriptor without enabling network traffic', () => {
    expect(
      createProviderFromTemplate({
        templateId: 'openai',
        providerConfigId: 'provider:openai',
        displayName: 'OpenAI',
        at: now
      })
    ).toMatchObject({
      providerConfigId: 'provider:openai',
      endpointOrigin: 'https://api.openai.com',
      credentialMode: 'none',
      credentialRef: null,
      status: 'unconfigured'
    })
    expect(() =>
      createProviderFromTemplate({
        templateId: 'custom',
        providerConfigId: 'provider:custom',
        displayName: 'Unsafe custom',
        endpointOrigin: 'http://remote.example',
        execution: 'cloud',
        at: now
      })
    ).toThrow('Invalid provider endpoint')
  })
})

describe('provider connection test', () => {
  it('uses an authenticated synthetic payload, validates the provider schema and records no feed content', async () => {
    const vault = new CredentialVault()
    const provider = cloudProvider()
    const credentialRef = await vault.storeSession(
      {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      },
      'connection-credential-canary'
    )
    const permissions = {
      has: vi.fn(async () => true)
    }
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const serialized = JSON.stringify(init)
        expect(serialized).toContain(SYNTHETIC_CONNECTION_PROMPT)
        expect(serialized).not.toContain('real-feed-content-canary')
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer connection-credential-canary'
        )
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: JSON.stringify(validModelOutput())
                }
              }
            ]
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      }
    )

    await expect(
      runProviderConnectionTest({
        provider: { ...provider, credentialRef },
        vault,
        permissions,
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: true,
        checkedAt: now,
        monotonicNow: vi
          .fn<() => number>()
          .mockReturnValueOnce(10)
          .mockReturnValueOnce(34),
        fetchImpl
      })
    ).resolves.toEqual({
      outcome: 'success',
      code: 'provider-connection-ready',
      checkedAt: now,
      latencyMs: 24,
      providerStatus: 'ready'
    })
    expect(permissions.has).toHaveBeenCalledWith(
      {
        endpointOrigin: 'https://provider.example',
        execution: 'cloud'
      },
      ['authenticationInfo']
    )
    expect(
      JSON.stringify(await fetchImpl.mock.results[0]?.value)
    ).not.toContain('connection-credential-canary')
  })

  it('rejects missing gesture or quota acknowledgment before permission, vault or network access', async () => {
    const provider = cloudProvider()
    const vault = new CredentialVault()
    const permissions = { has: vi.fn(async () => true) }
    const fetchImpl = vi.fn()

    await expect(
      runProviderConnectionTest({
        provider,
        vault,
        permissions,
        modelId: 'fixture-model',
        userInitiated: false,
        quotaAcknowledged: true,
        checkedAt: now,
        fetchImpl
      })
    ).rejects.toThrow('provider-connection-user-gesture-required')
    await expect(
      runProviderConnectionTest({
        provider,
        vault,
        permissions,
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: false,
        checkedAt: now,
        fetchImpl
      })
    ).rejects.toThrow('provider-connection-quota-acknowledgment-required')
    expect(permissions.has).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when the exact host permission is absent or the credential is locked', async () => {
    const provider = cloudProvider()
    const deniedFetch = vi.fn()

    await expect(
      runProviderConnectionTest({
        provider,
        vault: new CredentialVault(),
        permissions: { has: vi.fn(async () => false) },
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: true,
        checkedAt: now,
        fetchImpl: deniedFetch
      })
    ).resolves.toMatchObject({
      outcome: 'failure',
      code: 'provider-connection-permission-denied',
      providerStatus: 'locked'
    })
    expect(deniedFetch).not.toHaveBeenCalled()

    const vault = new CredentialVault()
    const credentialRef = await vault.storeWrapped(
      {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      },
      'locked-credential-canary',
      'fixture-passphrase'
    )
    const lockedFetch = vi.fn()
    await expect(
      runProviderConnectionTest({
        provider: {
          ...provider,
          credentialMode: 'passphrase-wrapped',
          credentialRef
        },
        vault,
        permissions: { has: vi.fn(async () => true) },
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: true,
        checkedAt: now,
        fetchImpl: lockedFetch
      })
    ).resolves.toMatchObject({
      outcome: 'failure',
      code: 'provider-connection-credential-locked',
      providerStatus: 'locked'
    })
    expect(lockedFetch).not.toHaveBeenCalled()
  })

  it('exposes only the finite redacted result catalog required by settings', () => {
    expect(PROVIDER_CONNECTION_CODE_VALUES).toEqual([
      'provider-connection-ready',
      'provider-connection-authentication-failed',
      'provider-connection-authorization-failed',
      'provider-connection-tls-failed',
      'provider-connection-host-unreachable',
      'provider-connection-rate-limited',
      'provider-connection-quota-exhausted',
      'provider-connection-model-unavailable',
      'provider-connection-schema-invalid',
      'provider-connection-protocol-invalid',
      'provider-connection-timeout',
      'provider-connection-offline',
      'provider-connection-cancelled',
      'provider-connection-permission-denied',
      'provider-connection-credential-locked',
      'provider-connection-credential-unavailable'
    ])

    const failureCodes = PROVIDER_CONNECTION_CODE_VALUES.filter(
      (
        code
      ): code is ConstructorParameters<typeof ProviderConnectionFailure>[0] =>
        code !== 'provider-connection-ready'
    )
    for (const code of failureCodes) {
      const result = classifyProviderConnectionFailure(
        new ProviderConnectionFailure(code),
        {
          checkedAt: now,
          latencyMs: 7,
          currentStatus: 'ready'
        }
      )
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(result.code).toBe(code)
      expect(Object.keys(result).sort()).toEqual([
        'checkedAt',
        'code',
        'latencyMs',
        'outcome',
        'providerStatus'
      ])
    }
  })

  it.each([
    [
      new Error('provider-http-401'),
      'provider-connection-authentication-failed',
      true
    ],
    [
      new Error('provider-http-403'),
      'provider-connection-authorization-failed',
      true
    ],
    [
      new ProviderConnectionFailure('provider-connection-tls-failed'),
      'provider-connection-tls-failed',
      true
    ],
    [
      new TypeError('network-secret-detail'),
      'provider-connection-host-unreachable',
      true
    ],
    [new Error('provider-http-429'), 'provider-connection-rate-limited', true],
    [
      new Error('provider-http-402'),
      'provider-connection-quota-exhausted',
      true
    ],
    [
      new Error('provider-http-404'),
      'provider-connection-model-unavailable',
      true
    ],
    [
      new Error('provider-output-invalid'),
      'provider-connection-schema-invalid',
      true
    ],
    [
      new Error('provider-response-content-type-invalid'),
      'provider-connection-protocol-invalid',
      true
    ],
    [
      new DOMException('timeout-secret-detail', 'TimeoutError'),
      'provider-connection-timeout',
      true
    ],
    [
      new TypeError('offline-secret-detail'),
      'provider-connection-offline',
      false
    ],
    [
      new DOMException('cancel-secret-detail', 'AbortError'),
      'provider-connection-cancelled',
      true
    ]
  ] as const)(
    'maps a transport outcome to the stable redacted code %s',
    (error, expectedCode, online) => {
      const result = classifyProviderConnectionFailure(error, {
        checkedAt: now,
        latencyMs: 4,
        currentStatus: 'ready',
        online
      })

      expect(result.code).toBe(expectedCode)
      expect(JSON.stringify(result)).not.toContain('secret-detail')
    }
  )

  it('keeps the production inference executor ready-only', async () => {
    const fetchImpl = vi.fn()

    await expect(
      executeProviderRequestPlan({
        provider: cloudProvider({ status: 'locked' }),
        plan: {
          adapterKind: 'openai-compatible',
          method: 'POST',
          path: '/v1/chat/completions',
          authentication: 'authorization-bearer',
          headers: {},
          body: { prompt: SYNTHETIC_CONNECTION_PROMPT }
        },
        vault: new CredentialVault(),
        fetchImpl
      })
    ).rejects.toThrow('provider-request-unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('persists only the last redacted result and does not promote on cancellation', () => {
    const registry = new ProviderRegistry([cloudProvider({ status: 'ready' })])

    const cancelled = registry.recordConnectionTest('provider:connection', {
      outcome: 'cancelled',
      code: 'provider-connection-cancelled',
      checkedAt: now,
      latencyMs: 3,
      providerStatus: 'ready'
    })

    expect(cancelled).toMatchObject({
      status: 'ready',
      lastConnectionTest: {
        outcome: 'cancelled',
        code: 'provider-connection-cancelled',
        checkedAt: now,
        latencyMs: 3
      }
    })
    expect(JSON.stringify(cancelled)).not.toContain('fixture-model')
    expect(JSON.stringify(cancelled)).not.toContain('secret')
  })

  it('commits a connection result transactionally and keeps live state unchanged when persistence fails', async () => {
    const registry = new ProviderRegistry([cloudProvider()])
    const vault = new CredentialVault()
    const credentialRef = await vault.storeSession(
      {
        providerConfigId: 'provider:connection',
        endpointOrigin: 'https://provider.example'
      },
      'transaction-credential-canary'
    )
    registry.setCredential(
      'provider:connection',
      credentialRef,
      'session-only',
      now
    )
    const persistence = {
      save: vi.fn(async (): Promise<void> => {
        throw new Error('indexed-db-write-failed')
      })
    }
    const service = new ProviderManagementService({
      registry,
      vault,
      consents: new ConsentRepository(),
      permissions: {
        has: vi.fn(async () => true),
        remove: vi.fn(async () => true)
      },
      catalog: new ModelCatalog(),
      persistence
    })
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: JSON.stringify(validModelOutput())
                }
              }
            ]
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
    )

    await expect(
      service.testConnection('provider:connection', {
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: true,
        checkedAt: now,
        fetchImpl
      })
    ).rejects.toThrow('indexed-db-write-failed')
    expect(registry.get('provider:connection')).toMatchObject({
      status: 'locked'
    })
    expect(registry.get('provider:connection')).not.toHaveProperty(
      'lastConnectionTest'
    )

    persistence.save.mockImplementation(async () => undefined)
    await expect(
      service.testConnection('provider:connection', {
        modelId: 'fixture-model',
        userInitiated: true,
        quotaAcknowledged: true,
        checkedAt: now,
        fetchImpl
      })
    ).resolves.toMatchObject({
      provider: {
        status: 'ready',
        lastConnectionTest: {
          code: 'provider-connection-ready',
          checkedAt: now
        }
      },
      result: {
        code: 'provider-connection-ready',
        providerStatus: 'ready'
      }
    })
    expect(registry.get('provider:connection')).toMatchObject({
      status: 'ready',
      lastConnectionTest: {
        code: 'provider-connection-ready',
        checkedAt: now
      }
    })
    expect(JSON.stringify(service.snapshot())).not.toContain(
      'transaction-credential-canary'
    )
  })
})

describe('browser provider permissions', () => {
  it('requests only the exact normalized origin inside an explicit user gesture', async () => {
    const api = permissionApi()
    const permissions = new BrowserPermissionPort({
      api,
      browser: 'firefox'
    })

    await expect(
      permissions.request(
        {
          endpointOrigin: 'https://api.openai.com',
          execution: 'cloud'
        },
        {
          userInitiated: true,
          dataCollection: ['authenticationInfo', 'websiteContent']
        }
      )
    ).resolves.toBe(true)
    expect(api.request).toHaveBeenCalledWith({
      origins: ['https://api.openai.com/*'],
      data_collection: ['authenticationInfo', 'websiteContent']
    })
  })

  it('rejects permission requests outside a user gesture before invoking the browser', async () => {
    const api = permissionApi()
    const permissions = new BrowserPermissionPort({
      api,
      browser: 'chrome'
    })

    await expect(
      permissions.request(
        {
          endpointOrigin: 'https://provider.example',
          execution: 'cloud'
        },
        { userInitiated: false, dataCollection: [] }
      )
    ).rejects.toThrow('provider-permission-user-gesture-required')
    expect(api.request).not.toHaveBeenCalled()
  })

  it('checks host and Firefox data consent and removes only the exact origin', async () => {
    const api = permissionApi()
    const permissions = new BrowserPermissionPort({
      api,
      browser: 'firefox'
    })
    const binding = {
      endpointOrigin: 'https://api.openai.com',
      execution: 'cloud' as const
    }

    await expect(
      permissions.has(binding, ['authenticationInfo', 'websiteContent'])
    ).resolves.toBe(true)
    expect(api.contains).toHaveBeenCalledWith({
      origins: ['https://api.openai.com/*']
    })
    await expect(permissions.remove('https://api.openai.com')).resolves.toBe(
      true
    )
    expect(api.remove).toHaveBeenCalledWith({
      origins: ['https://api.openai.com/*']
    })
  })

  it('omits Firefox-only data categories on Chrome', async () => {
    const api = permissionApi()
    const permissions = new BrowserPermissionPort({
      api,
      browser: 'chrome'
    })

    await permissions.request(
      {
        endpointOrigin: 'http://127.0.0.1:11434',
        execution: 'local'
      },
      {
        userInitiated: true,
        dataCollection: ['authenticationInfo']
      }
    )

    expect(api.request).toHaveBeenCalledWith({
      origins: ['http://127.0.0.1:11434/*']
    })
  })
})
