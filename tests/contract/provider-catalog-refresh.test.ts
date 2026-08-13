import { describe, expect, it, vi } from 'vitest'

import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { refreshProviderCatalog } from '@/application/provider-management/catalog-refresh'
import { CredentialVault } from '@/security/credentials/vault'

const checkedAt = '2026-07-31T12:00:00.000Z'

function provider(
  kind: ProviderDescriptor['kind'],
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor {
  return {
    schemaVersion: 1,
    providerConfigId: `provider:${kind}`,
    displayName: kind,
    kind,
    execution: kind === 'ollama' ? 'local' : 'cloud',
    endpointOrigin:
      kind === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.example',
    credentialMode: kind === 'ollama' ? 'none' : 'session-only',
    credentialRef: null,
    policyUrl: null,
    policyReviewedAt: null,
    createdAt: checkedAt,
    updatedAt: checkedAt,
    status: 'ready',
    ...overrides
  }
}

async function withCredential(input: ProviderDescriptor, value: string) {
  const vault = new CredentialVault()
  const credentialRef = await vault.storeSession(
    {
      providerConfigId: input.providerConfigId,
      endpointOrigin: input.endpointOrigin
    },
    value
  )
  return { provider: { ...input, credentialRef }, vault }
}

function permissions() {
  return { has: vi.fn(async () => true) }
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  })
}

describe('provider catalog refresh', () => {
  it('lists OpenAI models with a bearer credential only in the header', async () => {
    const credential = 'openai-catalog-canary'
    const configured = await withCredential(provider('openai'), credential)
    const permissionProbe = permissions()
    const fetchImpl = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        expect(request.toString()).toBe('https://api.example/v1/models')
        expect(request.toString()).not.toContain(credential)
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${credential}`
        )
        return json({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] })
      }
    )

    await expect(
      refreshProviderCatalog({
        checkedAt,
        fetchImpl,
        permissions: permissionProbe,
        provider: configured.provider,
        userInitiated: true,
        vault: configured.vault
      })
    ).resolves.toMatchObject([
      { modelId: 'gpt-a', capabilities: [], catalogSource: 'provider' },
      { modelId: 'gpt-b', capabilities: [], catalogSource: 'provider' }
    ])
    expect(permissionProbe.has).toHaveBeenCalledWith(
      {
        endpointOrigin: 'https://api.example',
        execution: 'cloud'
      },
      ['authenticationInfo']
    )
  })

  it('paginates Anthropic models with an opaque cursor', async () => {
    const configured = await withCredential(
      provider('anthropic'),
      'anthropic-catalog-canary'
    )
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (request, init) => {
        const url = new URL(request.toString())
        expect(url.searchParams.get('limit')).toBe('1000')
        expect(url.searchParams.has('after_id')).toBe(false)
        expect(new Headers(init?.headers).get('x-api-key')).toBe(
          'anthropic-catalog-canary'
        )
        expect(new Headers(init?.headers).get('anthropic-version')).toBe(
          '2023-06-01'
        )
        return json({
          data: [{ id: 'claude-a', display_name: 'Claude A' }],
          has_more: true,
          last_id: 'cursor-a'
        })
      })
      .mockImplementationOnce(async request => {
        const url = new URL(request.toString())
        expect(url.searchParams.get('after_id')).toBe('cursor-a')
        return json({
          data: [{ id: 'claude-b', display_name: 'Claude B' }],
          has_more: false,
          last_id: 'claude-b'
        })
      })

    await expect(
      refreshProviderCatalog({
        checkedAt,
        fetchImpl,
        permissions: permissions(),
        provider: configured.provider,
        userInitiated: true,
        vault: configured.vault
      })
    ).resolves.toMatchObject([
      { modelId: 'claude-a', displayName: 'Claude A' },
      { modelId: 'claude-b', displayName: 'Claude B' }
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('paginates Gemini models without putting its API key in the URL', async () => {
    const credential = 'gemini-catalog-canary'
    const configured = await withCredential(provider('gemini'), credential)
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (request, init) => {
        const url = new URL(request.toString())
        expect(url.searchParams.get('pageSize')).toBe('1000')
        expect(url.href).not.toContain(credential)
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(
          credential
        )
        return json({
          models: [
            {
              name: 'models/gemini-a-001',
              baseModelId: 'gemini-a',
              version: '001',
              displayName: 'Gemini A'
            }
          ],
          nextPageToken: 'page-b'
        })
      })
      .mockImplementationOnce(async request => {
        const url = new URL(request.toString())
        expect(url.searchParams.get('pageToken')).toBe('page-b')
        return json({
          models: [{ name: 'models/gemini-b-002', version: '002' }]
        })
      })

    await expect(
      refreshProviderCatalog({
        checkedAt,
        fetchImpl,
        permissions: permissions(),
        provider: configured.provider,
        userInitiated: true,
        vault: configured.vault
      })
    ).resolves.toMatchObject([
      { modelId: 'gemini-a', declaredVersion: '001' },
      { modelId: 'gemini-b-002', declaredVersion: '002' }
    ])
  })

  it('lists local Ollama models without requesting authentication data', async () => {
    const permissionProbe = permissions()
    const fetchImpl = vi.fn(async (_request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      return json({ models: [{ name: 'gemma3:latest', model: 'gemma3' }] })
    })
    await expect(
      refreshProviderCatalog({
        checkedAt,
        fetchImpl,
        permissions: permissionProbe,
        provider: provider('ollama'),
        userInitiated: true,
        vault: new CredentialVault()
      })
    ).resolves.toMatchObject([
      { modelId: 'gemma3', displayName: 'gemma3:latest' }
    ])
    expect(permissionProbe.has).toHaveBeenCalledWith(
      {
        endpointOrigin: 'http://127.0.0.1:11434',
        execution: 'local'
      },
      []
    )
  })

  it('requires an explicit gesture, permission and a supported provider', async () => {
    const configured = await withCredential(
      provider('openai-compatible'),
      'catalog-canary'
    )
    await expect(
      refreshProviderCatalog({
        checkedAt,
        permissions: permissions(),
        provider: configured.provider,
        userInitiated: false,
        vault: configured.vault
      })
    ).rejects.toThrow('provider-catalog-refresh-user-gesture-required')
    await expect(
      refreshProviderCatalog({
        checkedAt,
        permissions: { has: vi.fn(async () => false) },
        provider: configured.provider,
        userInitiated: true,
        vault: configured.vault
      })
    ).rejects.toThrow('provider-catalog-refresh-permission-denied')
    await expect(
      refreshProviderCatalog({
        checkedAt,
        permissions: permissions(),
        provider: provider('custom', {
          credentialMode: 'none',
          credentialRef: null
        }),
        userInitiated: true,
        vault: new CredentialVault()
      })
    ).rejects.toThrow('provider-catalog-refresh-unsupported')
  })
})
