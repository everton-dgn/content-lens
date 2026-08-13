import { createAnthropicAdapter } from '@/ai/providers/adapters/anthropic'
import type { ProviderAdapter } from '@/ai/providers/adapters/contracts'
import { createGeminiAdapter } from '@/ai/providers/adapters/gemini'
import { createOllamaAdapter } from '@/ai/providers/adapters/ollama'
import { createOpenAiAdapter } from '@/ai/providers/adapters/openai'
import { createOpenAiCompatibleAdapter } from '@/ai/providers/adapters/openai-compatible'
import type { ProviderDescriptor } from '@/ai/providers/contracts'

export function createProviderAdapterFor(
  provider: Pick<ProviderDescriptor, 'kind'>
): ProviderAdapter {
  switch (provider.kind) {
    case 'browser-built-in':
      throw new TypeError('Browser built-in provider has no network adapter')
    case 'openai':
      return createOpenAiAdapter()
    case 'anthropic':
      return createAnthropicAdapter()
    case 'gemini':
      return createGeminiAdapter()
    case 'ollama':
      return createOllamaAdapter()
    case 'openai-compatible':
    case 'user-proxy':
    case 'custom':
      return createOpenAiCompatibleAdapter()
  }
}
