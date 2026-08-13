import type { ProviderDescriptor } from '@/ai/providers/contracts'

export const catalogRefreshKinds = new Set<ProviderDescriptor['kind']>([
  'openai',
  'openai-compatible',
  'anthropic',
  'gemini',
  'ollama'
])
