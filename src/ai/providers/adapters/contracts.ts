import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import type { ModelTask } from '@/ai/models/contracts'

export const PROVIDER_PROMPT_VERSION = 'classification-prompt@2'
export const PROVIDER_OUTPUT_SCHEMA_VERSION =
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION

export type ProviderAuthentication =
  | 'none'
  | 'authorization-bearer'
  | 'x-api-key'
  | 'x-goog-api-key'

export type ProviderRequestPlan = {
  adapterKind: ProviderAdapter['kind']
  method: 'POST'
  path: string
  authentication: ProviderAuthentication
  headers: Readonly<Record<string, string>>
  body: unknown
}

export type ProviderRequestInput = {
  modelId: string
  prompt: string
  task: ModelTask
  image?: {
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    dataBase64: string
  }
}

export interface ProviderAdapter {
  readonly kind:
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'ollama'
    | 'openai-compatible'
  buildRequest(input: ProviderRequestInput): ProviderRequestPlan
  parseModelOutput(response: unknown): ClassificationModelOutput
}
