import type { SyncEnvelope } from '@/sync/contracts'
import {
  type SyncProvider,
  SyncProviderError,
  type SyncProviderMetadata,
  type SyncProviderStatus
} from '@/sync/providers/contracts'
import { parseRetryAfter } from '@/sync/retry-policy'

const STRONG_ETAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type ConditionalHttpProviderOptions = {
  metadata: SyncProviderMetadata
  endpoint: string
  authorization: string
  fetch?: FetchLike
  now?: () => number
}

function validateEndpoint(endpoint: string, expectedOrigin: string) {
  const url = new URL(endpoint)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.origin !== expectedOrigin
  ) {
    throw new TypeError('Sync endpoint must use the declared secure origin')
  }
  if (url.username || url.password || url.hash) {
    throw new TypeError(
      'Sync endpoint cannot contain credentials or a fragment'
    )
  }
  return url.toString()
}

function versionToken(response: Response) {
  const token = response.headers.get('etag')
  if (!token) {
    throw new SyncProviderError({
      code: 'version-token-missing',
      retryable: false
    })
  }
  if (!STRONG_ETAG.test(token)) {
    throw new SyncProviderError({
      code: 'version-token-invalid',
      retryable: false
    })
  }
  return token
}

export class ConditionalHttpSyncProvider implements SyncProvider {
  readonly metadata: SyncProviderMetadata
  readonly #endpoint: string
  readonly #authorization: string
  readonly #fetch: FetchLike
  readonly #now: () => number
  #status: SyncProviderStatus = { state: 'disconnected' }

  constructor(options: ConditionalHttpProviderOptions) {
    this.metadata = options.metadata
    this.#endpoint = validateEndpoint(
      options.endpoint,
      options.metadata.endpointOrigin
    )
    this.#authorization = options.authorization
    this.#fetch = options.fetch ?? fetch
    this.#now = options.now ?? Date.now
  }

  async connect(input?: { signal?: AbortSignal }) {
    this.#status = { state: 'connecting' }
    try {
      await this.read(input)
      this.#status = { state: 'idle' }
      return this.#status
    } catch (error) {
      this.#status = {
        state: 'degraded',
        ...(error instanceof SyncProviderError ? { code: error.code } : {})
      }
      throw error
    }
  }

  async disconnect() {
    this.#status = { state: 'disconnected' }
  }

  getStatus() {
    return { ...this.#status }
  }

  async read(input?: { signal?: AbortSignal }) {
    this.#status = { state: 'pulling' }
    const response = await this.#request('GET', { signal: input?.signal })
    if (!response.ok) {
      throw this.#responseError(response)
    }
    const token = versionToken(response)
    const declaredLength = Number(response.headers.get('content-length'))
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.metadata.maxBytes
    ) {
      throw new SyncProviderError({
        code: 'payload-too-large',
        retryable: false
      })
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > this.metadata.maxBytes) {
      throw new SyncProviderError({
        code: 'payload-too-large',
        retryable: false
      })
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      )
    } catch {
      throw new SyncProviderError({
        code: 'schema-rejected',
        retryable: false
      })
    }
    this.#status = { state: 'idle' }
    return { envelope, versionToken: token, byteLength: bytes.byteLength }
  }

  async compareAndSwap(input: {
    expectedVersionToken: string
    envelope: SyncEnvelope
    signal?: AbortSignal
  }) {
    if (!STRONG_ETAG.test(input.expectedVersionToken)) {
      throw new SyncProviderError({
        code: 'version-token-invalid',
        retryable: false
      })
    }
    const body = JSON.stringify(input.envelope)
    if (new TextEncoder().encode(body).byteLength > this.metadata.maxBytes) {
      throw new SyncProviderError({
        code: 'payload-too-large',
        retryable: false
      })
    }
    this.#status = { state: 'pushing' }
    const response = await this.#request('PUT', {
      body,
      signal: input.signal,
      headers: {
        'content-type': 'application/json',
        'if-match': input.expectedVersionToken
      }
    })
    if (response.status === 412) {
      return { state: 'mismatch' as const }
    }
    if (!response.ok) {
      throw this.#responseError(response)
    }
    return {
      state: 'committed' as const,
      versionToken: versionToken(response)
    }
  }

  async initialize(envelope: SyncEnvelope, input?: { signal?: AbortSignal }) {
    const body = JSON.stringify(envelope)
    if (new TextEncoder().encode(body).byteLength > this.metadata.maxBytes) {
      throw new SyncProviderError({
        code: 'payload-too-large',
        retryable: false
      })
    }
    this.#status = { state: 'pushing' }
    const response = await this.#request('PUT', {
      body,
      signal: input?.signal,
      headers: {
        'content-type': 'application/json',
        'if-none-match': '*'
      }
    })
    if (response.status === 412) {
      return { state: 'mismatch' as const }
    }
    if (!response.ok) {
      throw this.#responseError(response)
    }
    return {
      state: 'committed' as const,
      versionToken: versionToken(response)
    }
  }

  async confirm(input: {
    expectedDigest: string
    expectedVersionToken: string
    signal?: AbortSignal
  }) {
    const current = await this.read({ signal: input.signal })
    if (
      current.versionToken !== input.expectedVersionToken ||
      typeof current.envelope !== 'object' ||
      current.envelope === null ||
      !('digest' in current.envelope) ||
      current.envelope.digest !== input.expectedDigest
    ) {
      return { state: 'mismatch' as const }
    }
    this.#status = {
      state: 'idle',
      lastConfirmedDigest: input.expectedDigest,
      lastConfirmedAt: new Date(this.#now()).toISOString()
    }
    return {
      state: 'confirmed' as const,
      versionToken: current.versionToken
    }
  }

  async deleteRemote(input: {
    expectedVersionToken: string
    signal?: AbortSignal
  }) {
    if (!STRONG_ETAG.test(input.expectedVersionToken)) {
      throw new SyncProviderError({
        code: 'version-token-invalid',
        retryable: false
      })
    }
    const response = await this.#request('DELETE', {
      signal: input.signal,
      headers: { 'if-match': input.expectedVersionToken }
    })
    if (response.status === 412) {
      return { state: 'mismatch' as const }
    }
    if (!response.ok && response.status !== 404) {
      throw this.#responseError(response)
    }
    this.#status = { state: 'disconnected' }
    return { state: 'deleted' as const }
  }

  #request(method: 'DELETE' | 'GET' | 'PUT', init?: RequestInit) {
    return this.#fetch(this.#endpoint, {
      ...init,
      method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        authorization: this.#authorization,
        ...init?.headers
      }
    })
  }

  #responseError(response: Response) {
    if (response.status >= 300 && response.status < 400) {
      return new SyncProviderError({
        code: 'redirect-blocked',
        retryable: false
      })
    }
    if (response.status === 401) {
      return new SyncProviderError({
        code: 'authentication-required',
        retryable: false
      })
    }
    if (response.status === 404) {
      return new SyncProviderError({
        code: 'remote-missing',
        retryable: false
      })
    }
    if (response.status === 403) {
      return new SyncProviderError({
        code: 'permission-required',
        retryable: false
      })
    }
    if (response.status === 429 || response.status === 503) {
      return new SyncProviderError({
        code: response.status === 429 ? 'rate-limited' : 'remote-unavailable',
        retryable: true,
        retryAfterMs: parseRetryAfter(
          response.headers.get('retry-after'),
          this.#now()
        )
      })
    }
    return new SyncProviderError({
      code: 'remote-unavailable',
      retryable: response.status >= 500
    })
  }
}
