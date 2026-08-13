import { describe, expect, it, vi } from 'vitest'

import { providerDescriptorSchema } from '@/ai/providers/contracts'
import {
  executeProviderJsonGet,
  executeProviderJsonRequest,
  executeProviderRequestPlan,
  MAX_PROVIDER_JSON_BYTES
} from '@/ai/providers/request-policy'
import { CredentialVault } from '@/security/credentials/vault'

describe('privileged provider request boundary', () => {
  it('pins catalog GET requests and keeps credentials out of the URL', async () => {
    const credential = 'catalog-credential-canary'
    const fetchImpl = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(request.toString())
        const headers = new Headers(init?.headers)
        expect(url.origin).toBe('https://provider.example')
        expect(url.pathname).toBe('/v1/models')
        expect(url.searchParams.get('limit')).toBe('1000')
        expect(url.href).not.toContain(credential)
        expect(headers.get('authorization')).toBe(`Bearer ${credential}`)
        expect(init).toMatchObject({
          credentials: 'omit',
          method: 'GET',
          redirect: 'manual',
          referrerPolicy: 'no-referrer'
        })
        return new Response(JSON.stringify({ data: [] }), {
          headers: { 'content-type': 'application/json' }
        })
      }
    )

    await expect(
      executeProviderJsonGet({
        endpointOrigin: 'https://provider.example',
        path: '/v1/models',
        query: { limit: '1000' },
        credential: {
          authentication: 'authorization-bearer',
          value: credential
        },
        fetchImpl
      })
    ).resolves.toEqual({ data: [] })
  })

  it('rejects unapproved catalog query parameters before fetch', async () => {
    const fetchImpl = vi.fn()
    await expect(
      executeProviderJsonGet({
        endpointOrigin: 'https://provider.example',
        path: '/v1/models',
        query: { key: 'credential-canary' },
        fetchImpl
      })
    ).rejects.toThrow('provider-request-query-rejected')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('applies redirect, content type and size limits to catalog GETs', async () => {
    const request = (fetchImpl: typeof fetch) =>
      executeProviderJsonGet({
        endpointOrigin: 'https://provider.example',
        path: '/v1/models',
        fetchImpl
      })
    await expect(
      request(
        vi.fn(
          async () =>
            new Response(null, {
              headers: { location: 'https://attacker.example/collect' },
              status: 302
            })
        )
      )
    ).rejects.toThrow('provider-redirect-rejected')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('plain text', {
              headers: { 'content-type': 'text/plain' }
            })
        )
      )
    ).rejects.toThrow('provider-response-content-type-invalid')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('{}', {
              headers: {
                'content-length': String(MAX_PROVIDER_JSON_BYTES + 1),
                'content-type': 'application/json'
              }
            })
        )
      )
    ).rejects.toThrow('provider-response-too-large')
  })

  it('pins the origin and applies the transport policy', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init).toMatchObject({
          credentials: 'omit',
          redirect: 'manual',
          referrerPolicy: 'no-referrer',
          method: 'POST'
        })
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      }
    )

    await expect(
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: '/v1/classify',
        authorization: 'Bearer credential-canary-fixture',
        body: { input: 'synthetic fixture' },
        fetchImpl
      })
    ).resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://provider.example/v1/classify'),
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer'
      })
    )
  })

  it('rejects page-controlled absolute paths and cross-origin redirects', async () => {
    await expect(
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: 'https://attacker.example/collect',
        authorization: 'Bearer fixture',
        body: {},
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow(/path/i)

    await expect(
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: '/v1/classify',
        authorization: 'Bearer fixture',
        body: {},
        fetchImpl: vi.fn(
          async () =>
            new Response(null, {
              headers: { location: 'https://attacker.example/collect' },
              status: 302
            })
        )
      })
    ).rejects.toThrow('provider-redirect-rejected')
  })

  it('enforces the JSON response limit before parsing', async () => {
    const oversized = 'x'.repeat(MAX_PROVIDER_JSON_BYTES + 1)

    await expect(
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: '/v1/classify',
        authorization: 'Bearer fixture',
        body: {},
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ oversized }), {
              headers: { 'content-type': 'application/json' }
            })
        )
      })
    ).rejects.toThrow('provider-response-too-large')
  })

  it('injects an opaque vault credential only inside the privileged request', async () => {
    const vault = new CredentialVault()
    const provider = providerDescriptorSchema.parse({
      schemaVersion: 1,
      providerConfigId: 'provider:fixture',
      displayName: 'Fixture provider',
      kind: 'openai-compatible',
      execution: 'cloud',
      endpointOrigin: 'https://provider.example',
      credentialMode: 'session-only',
      credentialRef: null,
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: '2026-07-31T00:00:00.000Z',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      status: 'ready'
    })
    const reference = await vault.storeSession(
      {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      },
      'credential-canary-fixture'
    )
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe(
          'Bearer credential-canary-fixture'
        )
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      }
    )

    await expect(
      executeProviderRequestPlan({
        provider: {
          ...provider,
          credentialRef: reference
        },
        plan: {
          adapterKind: 'openai-compatible',
          method: 'POST',
          path: '/v1/chat/completions',
          authentication: 'authorization-bearer',
          headers: {},
          body: { input: 'synthetic fixture' }
        },
        vault,
        fetchImpl
      })
    ).resolves.toEqual({ ok: true })
    expect(JSON.stringify(vault.metadata())).not.toContain(
      'credential-canary-fixture'
    )
  })

  it('uses only the optional proxy token for an external-vault provider', async () => {
    const vault = new CredentialVault()
    const provider = providerDescriptorSchema.parse({
      schemaVersion: 1,
      providerConfigId: 'provider:user-proxy',
      displayName: 'User proxy',
      kind: 'user-proxy',
      execution: 'cloud',
      endpointOrigin: 'https://proxy.example',
      credentialMode: 'external-vault',
      credentialRef: null,
      policyUrl: null,
      policyReviewedAt: null,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      status: 'ready'
    })
    const proxyToken = 'proxy-token-canary-fixture'
    const reference = await vault.storeExternal(
      {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      },
      {
        externalReference: 'user-proxy:primary',
        proxyCredential: {
          mode: 'session-only',
          value: proxyToken
        }
      }
    )
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe(`Bearer ${proxyToken}`)
        expect(JSON.stringify(init)).not.toContain('provider-key')
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      }
    )

    await expect(
      executeProviderRequestPlan({
        provider: {
          ...provider,
          credentialRef: reference
        },
        plan: {
          adapterKind: 'openai-compatible',
          method: 'POST',
          path: '/v1/chat/completions',
          authentication: 'authorization-bearer',
          headers: {},
          body: { input: 'synthetic fixture' }
        },
        vault,
        fetchImpl
      })
    ).resolves.toEqual({ ok: true })
    expect(JSON.stringify(vault.metadata())).not.toContain(proxyToken)
  })

  it('rejects adapter-supplied credential headers before fetch', async () => {
    const vault = new CredentialVault()
    const provider = providerDescriptorSchema.parse({
      schemaVersion: 1,
      providerConfigId: 'provider:fixture',
      displayName: 'Fixture provider',
      kind: 'anthropic',
      execution: 'cloud',
      endpointOrigin: 'https://provider.example',
      credentialMode: 'session-only',
      credentialRef: 'credential:opaque',
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: '2026-07-31T00:00:00.000Z',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      status: 'ready'
    })
    const fetchImpl = vi.fn()

    await expect(
      executeProviderRequestPlan({
        provider,
        plan: {
          adapterKind: 'anthropic',
          method: 'POST',
          path: '/v1/messages',
          authentication: 'x-api-key',
          headers: {
            authorization: ['credential', 'canary', 'attacker'].join('-')
          },
          body: {}
        },
        vault,
        fetchImpl
      })
    ).rejects.toThrow('provider-request-header-rejected')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['x-api-key' as const, 'x-api-key', 'key-one'],
    ['x-goog-api-key' as const, 'x-goog-api-key', 'key-two']
  ])(
    'maps the %s credential to its dedicated header',
    async (authentication, header, value) => {
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers)
          expect(headers.get(header)).toBe(value)
          expect(headers.get('anthropic-version')).toBe('2023-06-01')
          return new Response('{}', {
            headers: { 'content-type': 'application/json' }
          })
        }
      )

      await expect(
        executeProviderJsonRequest({
          endpointOrigin: 'https://provider.example',
          path: '/v1/classify',
          credential: { authentication, value },
          headers: { 'Anthropic-Version': '2023-06-01' },
          body: {},
          fetchImpl
        })
      ).resolves.toEqual({})
    }
  )

  it('rejects unsafe POST headers and malformed provider responses', async () => {
    const request = (
      fetchImpl: typeof fetch,
      headers?: Record<string, string>
    ) =>
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: '/v1/classify',
        headers,
        body: {},
        fetchImpl
      })

    await expect(
      request(vi.fn(), { 'x-credential': 'must-not-cross' })
    ).rejects.toThrow('provider-request-header-rejected')
    await expect(
      executeProviderJsonRequest({
        endpointOrigin: 'https://provider.example',
        path: '/\\attacker.example/collect',
        body: {},
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow('Invalid provider request path')
    await expect(
      request(vi.fn(async () => new Response('{}', { status: 503 })))
    ).rejects.toThrow('provider-http-503')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('plain', {
              headers: { 'content-type': 'text/plain' }
            })
        )
      )
    ).rejects.toThrow('provider-response-content-type-invalid')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('{}', {
              headers: {
                'content-length': String(MAX_PROVIDER_JSON_BYTES + 1),
                'content-type': 'application/json'
              }
            })
        )
      )
    ).rejects.toThrow('provider-response-too-large')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('not-json', {
              headers: { 'content-type': 'application/json' }
            })
        )
      )
    ).rejects.toThrow('provider-response-json-invalid')
  })

  it('rejects malformed catalog responses and unsafe catalog headers', async () => {
    const request = (
      fetchImpl: typeof fetch,
      headers?: Record<string, string>
    ) =>
      executeProviderJsonGet({
        endpointOrigin: 'https://provider.example',
        path: '/v1/models',
        headers,
        fetchImpl
      })

    await expect(
      request(vi.fn(), { authorization: ['must', 'not', 'cross'].join('-') })
    ).rejects.toThrow('provider-request-header-rejected')
    await expect(
      request(vi.fn(async () => new Response('{}', { status: 429 })))
    ).rejects.toThrow('provider-http-429')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('not-json', {
              headers: { 'content-type': 'application/json' }
            })
        )
      )
    ).rejects.toThrow('provider-response-json-invalid')
    await expect(
      request(
        vi.fn(
          async () =>
            new Response('x'.repeat(MAX_PROVIDER_JSON_BYTES + 1), {
              headers: { 'content-type': 'application/json' }
            })
        )
      )
    ).rejects.toThrow('provider-response-too-large')
  })

  it('supports credential-free plans and rejects a missing required credential', async () => {
    const vault = new CredentialVault()
    const loopbackOrigin = ['http', '://127', '.0.0.1:11434'].join('')
    const provider = providerDescriptorSchema.parse({
      schemaVersion: 1,
      providerConfigId: 'provider:no-auth',
      displayName: 'No auth provider',
      kind: 'openai-compatible',
      execution: 'local',
      endpointOrigin: loopbackOrigin,
      credentialMode: 'none',
      credentialRef: null,
      policyUrl: null,
      policyReviewedAt: null,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      status: 'ready'
    })
    const plan = {
      adapterKind: 'openai-compatible' as const,
      method: 'POST' as const,
      path: '/v1/chat/completions',
      authentication: 'none' as const,
      headers: {},
      body: {}
    }
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          headers: { 'content-type': 'application/json' }
        })
    )
    await expect(
      executeProviderRequestPlan({ provider, plan, vault, fetchImpl })
    ).resolves.toEqual({})
    await expect(
      executeProviderRequestPlan({
        provider,
        plan: { ...plan, authentication: 'authorization-bearer' },
        vault,
        fetchImpl
      })
    ).rejects.toThrow('credential-unavailable')
  })
})
