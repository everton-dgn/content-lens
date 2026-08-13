import { describe, expect, it, vi } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import { ConditionalHttpSyncProvider } from '@/sync/providers/conditional-http'
import { SyncProviderError } from '@/sync/providers/contracts'

const metadata = {
  providerConfigId: 'sync-provider:test',
  displayName: 'Conditional test endpoint',
  endpointOrigin: 'https://sync.example',
  policyUrl: 'https://sync.example/privacy',
  retention: 'User controlled',
  revocation: 'Remove the access token at the provider',
  casMethod: 'Strong ETag with If-Match',
  maxBytes: 10 * 1024 * 1024
}

async function envelope() {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:test',
    generation: 0,
    profile: emptySyncProfile(),
    tombstones: []
  })
}

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { etag: '"version:1"', ...init.headers },
    ...init
  })

describe('conditional HTTP sync provider', () => {
  it('reads a strong ETag, sends the exact If-Match and confirms by re-reading', async () => {
    const remote = await envelope()
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(remote))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { etag: '"version:2"' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(remote, { headers: { etag: '"version:2"' } })
      )
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: request,
      now: () => Date.parse('2026-07-31T12:00:00.000Z')
    })

    await expect(provider.read()).resolves.toMatchObject({
      versionToken: '"version:1"'
    })
    await expect(
      provider.compareAndSwap({
        expectedVersionToken: '"version:1"',
        envelope: remote
      })
    ).resolves.toEqual({ state: 'committed', versionToken: '"version:2"' })
    const put = request.mock.calls[1]?.[1] as RequestInit
    expect(put.redirect).toBe('manual')
    expect(put.credentials).toBe('omit')
    expect(put.headers).toMatchObject({ 'if-match': '"version:1"' })
    await expect(
      provider.confirm({
        expectedDigest: remote.digest,
        expectedVersionToken: '"version:2"'
      })
    ).resolves.toEqual({ state: 'confirmed', versionToken: '"version:2"' })
  })

  it('maps 412 to mismatch and blocks weak tokens and redirects', async () => {
    const remote = await envelope()
    const mismatch = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => new Response(null, { status: 412 }))
    })
    await expect(
      mismatch.compareAndSwap({
        expectedVersionToken: '"version:1"',
        envelope: remote
      })
    ).resolves.toEqual({ state: 'mismatch' })

    const weak = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () =>
        jsonResponse(remote, { headers: { etag: 'W/"weak"' } })
      )
    })
    await expect(weak.read()).rejects.toMatchObject({
      code: 'version-token-invalid'
    })

    const redirect = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => new Response(null, { status: 307 }))
    })
    await expect(redirect.read()).rejects.toMatchObject({
      code: 'redirect-blocked'
    })
  })

  it('initializes an empty remote only with If-None-Match star', async () => {
    const remote = await envelope()
    const request = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(null, {
          status: 201,
          headers: { etag: '"version:created"' }
        })
    )
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: request
    })

    await expect(provider.initialize(remote)).resolves.toEqual({
      state: 'committed',
      versionToken: '"version:created"'
    })
    const call = request.mock.calls[0]
    if (!call) {
      throw new Error('Initialization request was not sent')
    }
    expect((call[1] as RequestInit).headers).toMatchObject({
      'if-none-match': '*'
    })
  })

  it('deletes only with the exact remote token and treats 412 as a conflict', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: request
    })

    await expect(
      provider.deleteRemote({ expectedVersionToken: '"version:1"' })
    ).resolves.toEqual({ state: 'mismatch' })
    await expect(
      provider.deleteRemote({ expectedVersionToken: '"version:2"' })
    ).resolves.toEqual({ state: 'deleted' })
    const deletion = request.mock.calls[1]?.[1]
    if (!deletion) {
      throw new Error('Remote deletion request was not sent')
    }
    expect((deletion as RequestInit).headers).toMatchObject({
      'if-match': '"version:2"'
    })
    expect((deletion as RequestInit).method).toBe('DELETE')
  })

  it('rejects insecure, credential-bearing and cross-origin endpoints', () => {
    for (const endpoint of [
      'http://sync.example/contentlens.json',
      'https://user:secret@sync.example/contentlens.json',
      'https://other.example/contentlens.json'
    ]) {
      expect(
        () =>
          new ConditionalHttpSyncProvider({
            metadata,
            endpoint,
            authorization: 'Bearer redacted'
          })
      ).toThrow(TypeError)
    }
    expect(SyncProviderError).toBeDefined()
  })

  it('tracks connect, degraded and disconnected states', async () => {
    const remote = await envelope()
    const connected = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => jsonResponse(remote))
    })
    expect(connected.getStatus()).toEqual({ state: 'disconnected' })
    await expect(connected.connect()).resolves.toEqual({ state: 'idle' })
    expect(connected.getStatus()).toEqual({ state: 'idle' })
    await connected.disconnect()
    expect(connected.getStatus()).toEqual({ state: 'disconnected' })

    const degraded = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => new Response(null, { status: 401 }))
    })
    await expect(degraded.connect()).rejects.toMatchObject({
      code: 'authentication-required'
    })
    expect(degraded.getStatus()).toEqual({
      state: 'degraded',
      code: 'authentication-required'
    })

    const unknown = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => {
        throw new Error('network')
      })
    })
    await expect(unknown.connect()).rejects.toThrow('network')
    expect(unknown.getStatus()).toEqual({ state: 'degraded' })
  })

  it.each([
    [401, 'authentication-required', false],
    [403, 'permission-required', false],
    [404, 'remote-missing', false],
    [429, 'rate-limited', true],
    [500, 'remote-unavailable', true],
    [503, 'remote-unavailable', true],
    [418, 'remote-unavailable', false]
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status,
            headers: status === 429 ? { 'retry-after': '2' } : {}
          })
      ),
      now: () => 1_000
    })
    await expect(provider.read()).rejects.toMatchObject({ code, retryable })
  })

  it('rejects missing tokens, oversized declarations, oversized bodies and malformed JSON', async () => {
    const remote = await envelope()
    const cases: Array<{
      response: Response
      code: string
      maxBytes?: number
    }> = [
      {
        response: new Response(JSON.stringify(remote), { status: 200 }),
        code: 'version-token-missing'
      },
      {
        response: jsonResponse(remote, {
          headers: { 'content-length': '100', etag: '"version:1"' }
        }),
        code: 'payload-too-large',
        maxBytes: 10
      },
      {
        response: jsonResponse(remote),
        code: 'payload-too-large',
        maxBytes: 10
      },
      {
        response: new Response('{bad-json', {
          status: 200,
          headers: { etag: '"version:1"' }
        }),
        code: 'schema-rejected'
      }
    ]
    for (const current of cases) {
      const provider = new ConditionalHttpSyncProvider({
        metadata: {
          ...metadata,
          maxBytes: current.maxBytes ?? metadata.maxBytes
        },
        endpoint: 'https://sync.example/contentlens.json',
        authorization: 'Bearer redacted',
        fetch: vi.fn(async () => current.response)
      })
      await expect(provider.read()).rejects.toMatchObject({
        code: current.code
      })
    }
  })

  it('guards conditional writes and all initialize outcomes', async () => {
    const remote = await envelope()
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 412 }))
        .mockResolvedValueOnce(new Response(null, { status: 403 }))
    })
    await expect(provider.initialize(remote)).resolves.toEqual({
      state: 'mismatch'
    })
    await expect(provider.initialize(remote)).rejects.toMatchObject({
      code: 'permission-required'
    })
    await expect(
      provider.compareAndSwap({
        expectedVersionToken: 'weak',
        envelope: remote
      })
    ).rejects.toMatchObject({ code: 'version-token-invalid' })

    const tiny = new ConditionalHttpSyncProvider({
      metadata: { ...metadata, maxBytes: 1 },
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi.fn()
    })
    await expect(tiny.initialize(remote)).rejects.toMatchObject({
      code: 'payload-too-large'
    })
    await expect(
      tiny.compareAndSwap({
        expectedVersionToken: '"version:1"',
        envelope: remote
      })
    ).rejects.toMatchObject({ code: 'payload-too-large' })
  })

  it('confirms only an exact token and digest pair', async () => {
    const remote = await envelope()
    const bodies: unknown[] = [null, {}, { digest: 'wrong' }, remote]
    const request = vi.fn()
    for (const body of bodies) {
      request.mockResolvedValueOnce(
        jsonResponse(body, { headers: { etag: '"version:other"' } })
      )
    }
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: request
    })
    for (const _body of bodies) {
      await expect(
        provider.confirm({
          expectedDigest: remote.digest,
          expectedVersionToken: '"version:expected"'
        })
      ).resolves.toEqual({ state: 'mismatch' })
    }
  })

  it('rejects invalid deletion tokens, accepts missing remotes and maps delete errors', async () => {
    const provider = new ConditionalHttpSyncProvider({
      metadata,
      endpoint: 'https://sync.example/contentlens.json',
      authorization: 'Bearer redacted',
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
    })
    await expect(
      provider.deleteRemote({ expectedVersionToken: 'weak' })
    ).rejects.toMatchObject({ code: 'version-token-invalid' })
    await expect(
      provider.deleteRemote({ expectedVersionToken: '"version:1"' })
    ).resolves.toEqual({ state: 'deleted' })
    await expect(
      provider.deleteRemote({ expectedVersionToken: '"version:2"' })
    ).rejects.toMatchObject({ code: 'remote-unavailable' })
  })

  it('allows an HTTP loopback endpoint for a declared loopback origin', async () => {
    const loopbackOrigin = ['http', '://127', '.0.0.1:8787'].join('')
    const provider = new ConditionalHttpSyncProvider({
      metadata: { ...metadata, endpointOrigin: loopbackOrigin },
      endpoint: `${loopbackOrigin}/contentlens.json`,
      authorization: 'Bearer redacted',
      fetch: vi.fn(async () => new Response(null, { status: 404 }))
    })
    await expect(provider.read()).rejects.toMatchObject({
      code: 'remote-missing'
    })
  })
})
