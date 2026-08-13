import { createProviderAdapterFor } from '@/ai/providers/adapters'
import {
  PROVIDER_CONNECTION_CODE_VALUES,
  type ProviderConnectionCode,
  type ProviderConnectionResult,
  type ProviderDescriptor,
  providerConnectionResultSchema
} from '@/ai/providers/contracts'
import { executeProviderConnectionTestPlan } from '@/ai/providers/request-policy'
import type { CredentialVault } from '@/security/credentials/vault'

export { PROVIDER_CONNECTION_CODE_VALUES }

export const SYNTHETIC_CONNECTION_PROMPT = [
  'ContentLens synthetic connection test.',
  'No page, feed, profile, rule or user content is included.',
  'Return a valid empty classification-model-output response.'
].join(' ')

export type ProviderPermissionProbe = {
  has(
    binding: {
      endpointOrigin: string
      execution: ProviderDescriptor['execution']
    },
    dataCollection: readonly ('authenticationInfo' | 'websiteContent')[]
  ): Promise<boolean>
}

type ConnectionFailureContext = {
  checkedAt: string
  latencyMs: number
  currentStatus: ProviderDescriptor['status']
  signal?: AbortSignal
  online?: boolean
}

const FAILURE_CODES = new Set<ProviderConnectionCode>(
  PROVIDER_CONNECTION_CODE_VALUES.filter(
    code => code !== 'provider-connection-ready'
  )
)

export class ProviderConnectionFailure extends Error {
  readonly code: Exclude<ProviderConnectionCode, 'provider-connection-ready'>

  constructor(
    code: Exclude<ProviderConnectionCode, 'provider-connection-ready'>
  ) {
    if (!FAILURE_CODES.has(code)) {
      throw new TypeError('Invalid provider connection failure code')
    }
    super('provider-connection-failed')
    this.name = 'ProviderConnectionFailure'
    this.code = code
  }
}

function statusForFailure(
  code: Exclude<ProviderConnectionCode, 'provider-connection-ready'>,
  currentStatus: ProviderDescriptor['status']
): ProviderDescriptor['status'] {
  switch (code) {
    case 'provider-connection-authentication-failed':
    case 'provider-connection-authorization-failed':
      return 'unauthorized'
    case 'provider-connection-rate-limited':
    case 'provider-connection-quota-exhausted':
      return 'rate-limited'
    case 'provider-connection-permission-denied':
    case 'provider-connection-credential-locked':
    case 'provider-connection-credential-unavailable':
      return 'locked'
    case 'provider-connection-cancelled':
      return currentStatus
    case 'provider-connection-tls-failed':
    case 'provider-connection-host-unreachable':
    case 'provider-connection-model-unavailable':
    case 'provider-connection-schema-invalid':
    case 'provider-connection-protocol-invalid':
    case 'provider-connection-timeout':
    case 'provider-connection-offline':
      return 'degraded'
  }
}

function codeFromError(
  error: unknown,
  context: Pick<ConnectionFailureContext, 'online' | 'signal'>
): Exclude<ProviderConnectionCode, 'provider-connection-ready'> {
  if (error instanceof ProviderConnectionFailure) {
    return error.code
  }
  if (context.signal?.aborted) {
    return 'provider-connection-cancelled'
  }
  if (context.online === false) {
    return 'provider-connection-offline'
  }
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return 'provider-connection-cancelled'
    }
    if (error.name === 'TimeoutError') {
      return 'provider-connection-timeout'
    }
  }
  if (!(error instanceof Error)) {
    return 'provider-connection-protocol-invalid'
  }
  switch (error.message) {
    case 'credential-locked':
      return 'provider-connection-credential-locked'
    case 'credential-unavailable':
      return 'provider-connection-credential-unavailable'
    case 'provider-http-401':
      return 'provider-connection-authentication-failed'
    case 'provider-http-402':
      return 'provider-connection-quota-exhausted'
    case 'provider-http-403':
      return 'provider-connection-authorization-failed'
    case 'provider-http-404':
      return 'provider-connection-model-unavailable'
    case 'provider-http-408':
    case 'provider-http-504':
      return 'provider-connection-timeout'
    case 'provider-http-429':
      return 'provider-connection-rate-limited'
    case 'provider-output-invalid':
      return 'provider-connection-schema-invalid'
    case 'provider-redirect-rejected':
    case 'provider-response-content-type-invalid':
    case 'provider-response-json-invalid':
    case 'provider-response-too-large':
    case 'provider-request-header-rejected':
    case 'provider-request-unavailable':
      return 'provider-connection-protocol-invalid'
  }
  return error instanceof TypeError
    ? 'provider-connection-host-unreachable'
    : 'provider-connection-protocol-invalid'
}

export function classifyProviderConnectionFailure(
  error: unknown,
  context: ConnectionFailureContext
): ProviderConnectionResult {
  const code = codeFromError(error, context)
  return providerConnectionResultSchema.parse({
    outcome: code === 'provider-connection-cancelled' ? 'cancelled' : 'failure',
    code,
    checkedAt: context.checkedAt,
    latencyMs: context.latencyMs,
    providerStatus: statusForFailure(code, context.currentStatus)
  })
}

export type ProviderConnectionTestInput = {
  provider: ProviderDescriptor
  vault: CredentialVault
  permissions: ProviderPermissionProbe
  modelId: string
  userInitiated: boolean
  quotaAcknowledged: boolean
  checkedAt: string
  monotonicNow?: () => number
  online?: () => boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function runProviderConnectionTest(
  input: ProviderConnectionTestInput
): Promise<ProviderConnectionResult> {
  if (!input.userInitiated) {
    throw new Error('provider-connection-user-gesture-required')
  }
  if (!input.quotaAcknowledged) {
    throw new Error('provider-connection-quota-acknowledgment-required')
  }

  const monotonicNow = input.monotonicNow ?? (() => performance.now())
  const startedAt = monotonicNow()
  try {
    const adapter = createProviderAdapterFor(input.provider)
    const plan = adapter.buildRequest({
      modelId: input.modelId,
      prompt: SYNTHETIC_CONNECTION_PROMPT,
      task: 'classification-text'
    })
    const authenticationData =
      plan.authentication === 'none' ? [] : (['authenticationInfo'] as const)
    const permitted = await input.permissions.has(
      {
        endpointOrigin: input.provider.endpointOrigin,
        execution: input.provider.execution
      },
      authenticationData
    )
    if (!permitted) {
      throw new ProviderConnectionFailure(
        'provider-connection-permission-denied'
      )
    }
    const response = await executeProviderConnectionTestPlan({
      provider: input.provider,
      plan,
      vault: input.vault,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
    })
    adapter.parseModelOutput(response)
    return providerConnectionResultSchema.parse({
      outcome: 'success',
      code: 'provider-connection-ready',
      checkedAt: input.checkedAt,
      latencyMs: Math.max(0, monotonicNow() - startedAt),
      providerStatus: 'ready'
    })
  } catch (error) {
    return classifyProviderConnectionFailure(error, {
      checkedAt: input.checkedAt,
      latencyMs: Math.max(0, monotonicNow() - startedAt),
      currentStatus: input.provider.status,
      ...(input.signal ? { signal: input.signal } : {}),
      online:
        input.online?.() ??
        (typeof navigator === 'undefined' ? true : navigator.onLine)
    })
  }
}
