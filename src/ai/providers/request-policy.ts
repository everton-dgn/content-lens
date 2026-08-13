import type {
  ProviderAuthentication,
  ProviderRequestPlan
} from '@/ai/providers/adapters/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { normalizeEndpointOrigin } from '@/ai/providers/contracts'
import type { CredentialVault } from '@/security/credentials/vault'

export const MAX_PROVIDER_JSON_BYTES = 1024 * 1024
export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000

type ProviderExecution = 'local' | 'cloud' | 'browser'
const SAFE_ADAPTER_HEADER_NAMES = new Set(['anthropic-version'])
const SAFE_PROVIDER_QUERY_NAMES = new Set([
  'after_id',
  'limit',
  'pageSize',
  'pageToken'
])

function requestUrl(
  endpointOrigin: string,
  path: string,
  execution: ProviderExecution
) {
  const origin = normalizeEndpointOrigin(endpointOrigin, execution)
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new TypeError('Invalid provider request path')
  }
  const url = new URL(path, `${origin}/`)
  if (url.origin !== origin) {
    throw new TypeError('Invalid provider request path')
  }
  return url
}

function combinedSignal(external: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)
  return external ? AbortSignal.any([external, timeout]) : timeout
}

export async function executeProviderJsonRequest(input: {
  endpointOrigin: string
  execution?: ProviderExecution
  path: string
  authorization?: string
  credential?: {
    authentication: Exclude<ProviderAuthentication, 'none'>
    value: string
  }
  headers?: Readonly<Record<string, string>>
  body: unknown
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<unknown> {
  const url = requestUrl(
    input.endpointOrigin,
    input.path,
    input.execution ?? 'cloud'
  )
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json'
  })
  if (input.authorization) {
    headers.set('authorization', input.authorization)
  }
  if (input.credential) {
    let headerName: string
    switch (input.credential.authentication) {
      case 'authorization-bearer':
        headerName = 'authorization'
        break
      case 'x-api-key':
        headerName = 'x-api-key'
        break
      case 'x-goog-api-key':
        headerName = 'x-goog-api-key'
        break
    }
    const value =
      input.credential.authentication === 'authorization-bearer'
        ? `Bearer ${input.credential.value}`
        : input.credential.value
    headers.set(headerName, value)
  }
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const normalized = name.toLowerCase()
    if (!SAFE_ADAPTER_HEADER_NAMES.has(normalized)) {
      throw new Error('provider-request-header-rejected')
    }
    headers.set(normalized, value)
  }
  const response = await (input.fetchImpl ?? fetch)(url, {
    body: JSON.stringify(input.body),
    credentials: 'omit',
    headers,
    method: 'POST',
    redirect: 'manual',
    referrerPolicy: 'no-referrer',
    signal: combinedSignal(input.signal)
  })

  if (
    response.redirected ||
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new Error('provider-redirect-rejected')
  }
  if (!response.ok) {
    throw new Error(`provider-http-${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new Error('provider-response-content-type-invalid')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_JSON_BYTES
  ) {
    throw new Error('provider-response-too-large')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PROVIDER_JSON_BYTES) {
    throw new Error('provider-response-too-large')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('provider-response-json-invalid')
  }
}

export async function executeProviderJsonGet(input: {
  endpointOrigin: string
  execution?: ProviderExecution
  path: string
  credential?: {
    authentication: Exclude<ProviderAuthentication, 'none'>
    value: string
  }
  headers?: Readonly<Record<string, string>>
  query?: Readonly<Record<string, string>>
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<unknown> {
  const url = requestUrl(
    input.endpointOrigin,
    input.path,
    input.execution ?? 'cloud'
  )
  for (const [name, value] of Object.entries(input.query ?? {})) {
    if (
      !SAFE_PROVIDER_QUERY_NAMES.has(name) ||
      value.length === 0 ||
      value.length > 2_048
    ) {
      throw new Error('provider-request-query-rejected')
    }
    url.searchParams.set(name, value)
  }
  const headers = new Headers({ accept: 'application/json' })
  if (input.credential) {
    const headerName =
      input.credential.authentication === 'authorization-bearer'
        ? 'authorization'
        : input.credential.authentication
    const value =
      input.credential.authentication === 'authorization-bearer'
        ? `Bearer ${input.credential.value}`
        : input.credential.value
    headers.set(headerName, value)
  }
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const normalized = name.toLowerCase()
    if (!SAFE_ADAPTER_HEADER_NAMES.has(normalized)) {
      throw new Error('provider-request-header-rejected')
    }
    headers.set(normalized, value)
  }
  const response = await (input.fetchImpl ?? fetch)(url, {
    credentials: 'omit',
    headers,
    method: 'GET',
    redirect: 'manual',
    referrerPolicy: 'no-referrer',
    signal: combinedSignal(input.signal)
  })
  if (
    response.redirected ||
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new Error('provider-redirect-rejected')
  }
  if (!response.ok) {
    throw new Error(`provider-http-${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new Error('provider-response-content-type-invalid')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_JSON_BYTES
  ) {
    throw new Error('provider-response-too-large')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PROVIDER_JSON_BYTES) {
    throw new Error('provider-response-too-large')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('provider-response-json-invalid')
  }
}

function adapterMatchesProvider(
  adapterKind: ProviderRequestPlan['adapterKind'],
  providerKind: ProviderDescriptor['kind']
) {
  if (adapterKind === 'openai-compatible') {
    return (
      providerKind === 'openai-compatible' ||
      providerKind === 'user-proxy' ||
      providerKind === 'custom'
    )
  }
  return adapterKind === providerKind
}

function validateProviderRequestPlan(
  provider: ProviderDescriptor,
  plan: ProviderRequestPlan,
  purpose: 'inference' | 'connection-test'
) {
  const statusAllowed =
    purpose === 'inference'
      ? provider.status === 'ready'
      : provider.status !== 'revoked'
  if (
    !statusAllowed ||
    provider.execution === 'browser' ||
    !adapterMatchesProvider(plan.adapterKind, provider.kind)
  ) {
    throw new Error('provider-request-unavailable')
  }
  for (const name of Object.keys(plan.headers)) {
    if (!SAFE_ADAPTER_HEADER_NAMES.has(name.toLowerCase())) {
      throw new Error('provider-request-header-rejected')
    }
  }
}

type ProviderPlanExecutionInput = {
  provider: ProviderDescriptor
  plan: ProviderRequestPlan
  vault: CredentialVault
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

async function executeValidatedProviderRequestPlan(
  input: ProviderPlanExecutionInput,
  purpose: 'inference' | 'connection-test'
) {
  validateProviderRequestPlan(input.provider, input.plan, purpose)
  const request = (
    credential:
      | {
          authentication: Exclude<ProviderAuthentication, 'none'>
          value: string
        }
      | undefined
  ) =>
    executeProviderJsonRequest({
      endpointOrigin: input.provider.endpointOrigin,
      execution: input.provider.execution,
      path: input.plan.path,
      body: input.plan.body,
      headers: input.plan.headers,
      ...(credential ? { credential } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
    })

  const authentication = input.plan.authentication
  if (authentication === 'none') {
    return request(undefined)
  }
  if (
    input.provider.credentialMode === 'none' ||
    !input.provider.credentialRef
  ) {
    throw new Error('credential-unavailable')
  }
  return input.vault.use(
    input.provider.credentialRef,
    {
      providerConfigId: input.provider.providerConfigId,
      endpointOrigin: input.provider.endpointOrigin
    },
    async value =>
      request({
        authentication,
        value
      })
  )
}

export async function executeProviderRequestPlan(
  input: ProviderPlanExecutionInput
) {
  return executeValidatedProviderRequestPlan(input, 'inference')
}

export async function executeProviderConnectionTestPlan(
  input: ProviderPlanExecutionInput
) {
  return executeValidatedProviderRequestPlan(input, 'connection-test')
}
