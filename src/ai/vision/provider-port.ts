import { createProviderAdapterFor } from '@/ai/providers/adapters/factory'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { executeProviderRequestPlan } from '@/ai/providers/request-policy'
import {
  VisualModelFailure,
  type VisualModelPort
} from '@/ai/vision/classifier'
import type { CredentialVault } from '@/security/credentials/vault'

export type ExecuteVisualProviderPlan = (
  input: Parameters<typeof executeProviderRequestPlan>[0]
) => Promise<unknown>

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    )
  }
  return btoa(binary)
}

function mappedFailure(error: unknown, signal: AbortSignal | undefined) {
  if (error instanceof VisualModelFailure) {
    return error
  }
  if (signal?.aborted) {
    return new VisualModelFailure('cancelled')
  }
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return new VisualModelFailure('cancelled')
    }
    if (error.name === 'TimeoutError') {
      return new VisualModelFailure('timeout')
    }
  }
  if (!(error instanceof Error)) {
    return new VisualModelFailure('provider-unavailable')
  }
  switch (error.message) {
    case 'provider-output-invalid':
    case 'provider-response-json-invalid':
      return new VisualModelFailure('invalid-output')
    case 'provider-refused':
      return new VisualModelFailure('refused')
    case 'provider-content-filtered':
      return new VisualModelFailure('content-filtered')
    case 'provider-truncated':
      return new VisualModelFailure('truncated')
    case 'provider-response-too-large':
    case 'provider-http-413':
      return new VisualModelFailure('resource-limit')
    case 'provider-http-400':
    case 'provider-http-415':
    case 'provider-http-422':
      return new VisualModelFailure('unsupported-media')
    case 'provider-http-402':
      return new VisualModelFailure('cost-limit')
    case 'provider-http-408':
    case 'provider-http-504':
      return new VisualModelFailure('timeout')
    default:
      return new VisualModelFailure('provider-unavailable')
  }
}

export function createProviderVisualModelPort(input: {
  provider: ProviderDescriptor
  modelId: string
  vault: CredentialVault
  execute?: ExecuteVisualProviderPlan
}): VisualModelPort {
  const adapter = createProviderAdapterFor(input.provider)
  const execute = input.execute ?? executeProviderRequestPlan
  return {
    async classify(request) {
      if (request.signal?.aborted) {
        throw new VisualModelFailure('cancelled')
      }
      try {
        const response = await execute({
          provider: input.provider,
          plan: adapter.buildRequest({
            modelId: input.modelId,
            prompt: request.prompt,
            task: request.task,
            image: {
              mimeType: request.image.mimeType,
              dataBase64: bytesToBase64(request.image.bytes)
            }
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
