import {
  AssistanceModelFailure,
  type AssistanceModelPort
} from '@/ai/assistance/service'
import {
  buildStructuredTextRequest,
  parseStructuredTextResponse,
  type StructuredProviderKind
} from '@/ai/providers/adapters/structured'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { executeProviderRequestPlan } from '@/ai/providers/request-policy'
import type { CredentialVault } from '@/security/credentials/vault'

export type ExecuteAssistanceProviderPlan = (
  input: Parameters<typeof executeProviderRequestPlan>[0]
) => Promise<unknown>

function structuredKind(
  kind: ProviderDescriptor['kind']
): StructuredProviderKind {
  if (kind === 'browser-built-in') {
    throw new TypeError('Browser built-in provider has no network adapter')
  }
  return kind === 'user-proxy' || kind === 'custom' ? 'openai-compatible' : kind
}

function mappedFailure(error: unknown, signal: AbortSignal) {
  if (error instanceof AssistanceModelFailure) {
    return error
  }
  if (signal.aborted) {
    return new AssistanceModelFailure('cancelled')
  }
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return new AssistanceModelFailure('cancelled')
    }
    if (error.name === 'TimeoutError') {
      return new AssistanceModelFailure('timeout')
    }
  }
  if (!(error instanceof Error)) {
    return new AssistanceModelFailure('provider-unavailable')
  }
  switch (error.message) {
    case 'provider-output-invalid':
    case 'provider-response-json-invalid':
      return new AssistanceModelFailure('invalid-output')
    case 'provider-refused':
      return new AssistanceModelFailure('refused')
    case 'provider-content-filtered':
      return new AssistanceModelFailure('content-filtered')
    case 'provider-truncated':
      return new AssistanceModelFailure('truncated')
    case 'provider-http-408':
    case 'provider-http-504':
      return new AssistanceModelFailure('timeout')
    default:
      return new AssistanceModelFailure('provider-unavailable')
  }
}

export function createProviderAssistanceModelPort(input: {
  provider: ProviderDescriptor
  modelId: string
  vault: CredentialVault
  execute?: ExecuteAssistanceProviderPlan
}): AssistanceModelPort {
  const kind = structuredKind(input.provider.kind)
  const execute = input.execute ?? executeProviderRequestPlan

  const invoke = async (request: {
    task: 'assistance-draft' | 'assistance-explain'
    prompt: string
    outputSchema: Readonly<Record<string, unknown>>
    signal: AbortSignal
  }) => {
    if (request.signal.aborted) {
      throw new AssistanceModelFailure('cancelled')
    }
    try {
      const response = await execute({
        provider: input.provider,
        plan: buildStructuredTextRequest({
          kind,
          modelId: input.modelId,
          prompt: request.prompt,
          schemaName:
            request.task === 'assistance-draft'
              ? 'assistance_draft_model_output'
              : 'assistance_explanation_model_output',
          schema: request.outputSchema
        }),
        vault: input.vault,
        signal: request.signal
      })
      return parseStructuredTextResponse(kind, response)
    } catch (error) {
      throw mappedFailure(error, request.signal)
    }
  }

  return {
    generateDraft: request => invoke(request),
    explain: request => invoke(request)
  }
}
