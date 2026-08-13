import { createProviderAdapterFor } from '@/ai/providers/adapters/factory'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { executeProviderRequestPlan } from '@/ai/providers/request-policy'
import { TextModelFailure, type TextModelPort } from '@/ai/text/classifier'
import type { CredentialVault } from '@/security/credentials/vault'

export type ExecuteProviderPlan = (
  input: Parameters<typeof executeProviderRequestPlan>[0]
) => Promise<unknown>

function mappedFailure(error: unknown, signal: AbortSignal | undefined) {
  if (error instanceof TextModelFailure) {
    return error
  }
  if (signal?.aborted) {
    return new TextModelFailure('cancelled')
  }
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return new TextModelFailure('cancelled')
    }
    if (error.name === 'TimeoutError') {
      return new TextModelFailure('timeout')
    }
  }
  if (!(error instanceof Error)) {
    return new TextModelFailure('provider-unavailable')
  }
  switch (error.message) {
    case 'provider-output-invalid':
    case 'provider-response-json-invalid':
      return new TextModelFailure('invalid-output')
    case 'provider-refused':
      return new TextModelFailure('refused')
    case 'provider-content-filtered':
      return new TextModelFailure('content-filtered')
    case 'provider-truncated':
      return new TextModelFailure('truncated')
    case 'provider-response-too-large':
    case 'provider-http-413':
      return new TextModelFailure('resource-limit')
    case 'provider-http-400':
    case 'provider-http-422':
      return new TextModelFailure('unsupported-input')
    case 'provider-http-402':
      return new TextModelFailure('cost-limit')
    case 'provider-http-408':
    case 'provider-http-504':
      return new TextModelFailure('timeout')
    default:
      return new TextModelFailure('provider-unavailable')
  }
}

export function createProviderTextModelPort(input: {
  provider: ProviderDescriptor
  modelId: string
  vault: CredentialVault
  execute?: ExecuteProviderPlan
}): TextModelPort {
  const adapter = createProviderAdapterFor(input.provider)
  const execute = input.execute ?? executeProviderRequestPlan
  return {
    async classify(request) {
      if (request.signal?.aborted) {
        throw new TextModelFailure('cancelled')
      }
      try {
        const response = await execute({
          provider: input.provider,
          plan: adapter.buildRequest({
            modelId: input.modelId,
            prompt: request.prompt,
            task: request.task
          }),
          vault: input.vault,
          ...(request.signal ? { signal: request.signal } : {})
        })
        return adapter.parseModelOutput(response)
      } catch (error) {
        throw mappedFailure(error, request.signal)
      }
    }
  }
}
