import {
  normalizeEndpointOrigin,
  type ProviderDescriptor,
  providerDescriptorSchema
} from '@/ai/providers/contracts'

const POLICY_REVIEWED_AT = '2026-07-31T00:00:00.000Z'

export type ProviderTemplate = {
  templateId: ProviderDescriptor['kind']
  kind: ProviderDescriptor['kind']
  displayName: string
  execution: ProviderDescriptor['execution']
  suggestedEndpointOrigin: string | null
  credentialModes: ReadonlyArray<ProviderDescriptor['credentialMode']>
  policyUrl: string | null
  policyReviewedAt: string | null
}

const PROVIDER_TEMPLATES = [
  {
    templateId: 'browser-built-in',
    kind: 'browser-built-in',
    displayName: 'Browser built-in AI',
    execution: 'browser',
    suggestedEndpointOrigin: 'https://browser-ai.contentlens.invalid',
    credentialModes: ['none'],
    policyUrl: null,
    policyReviewedAt: null
  },
  {
    templateId: 'anthropic',
    kind: 'anthropic',
    displayName: 'Anthropic',
    execution: 'cloud',
    suggestedEndpointOrigin: 'https://api.anthropic.com',
    credentialModes: ['session-only', 'passphrase-wrapped', 'external-vault'],
    policyUrl: 'https://privacy.anthropic.com/en/',
    policyReviewedAt: POLICY_REVIEWED_AT
  },
  {
    templateId: 'custom',
    kind: 'custom',
    displayName: 'Custom provider',
    execution: 'cloud',
    suggestedEndpointOrigin: null,
    credentialModes: [
      'none',
      'session-only',
      'passphrase-wrapped',
      'external-vault'
    ],
    policyUrl: null,
    policyReviewedAt: null
  },
  {
    templateId: 'gemini',
    kind: 'gemini',
    displayName: 'Google Gemini',
    execution: 'cloud',
    suggestedEndpointOrigin: 'https://generativelanguage.googleapis.com',
    credentialModes: ['session-only', 'passphrase-wrapped', 'external-vault'],
    policyUrl: 'https://policies.google.com/privacy',
    policyReviewedAt: POLICY_REVIEWED_AT
  },
  {
    templateId: 'ollama',
    kind: 'ollama',
    displayName: 'Ollama',
    execution: 'local',
    suggestedEndpointOrigin: 'http://127.0.0.1:11434',
    credentialModes: ['none'],
    policyUrl: null,
    policyReviewedAt: null
  },
  {
    templateId: 'openai',
    kind: 'openai',
    displayName: 'OpenAI',
    execution: 'cloud',
    suggestedEndpointOrigin: 'https://api.openai.com',
    credentialModes: ['session-only', 'passphrase-wrapped', 'external-vault'],
    policyUrl: 'https://openai.com/policies/privacy-policy/',
    policyReviewedAt: POLICY_REVIEWED_AT
  },
  {
    templateId: 'openai-compatible',
    kind: 'openai-compatible',
    displayName: 'OpenAI-compatible',
    execution: 'cloud',
    suggestedEndpointOrigin: null,
    credentialModes: ['session-only', 'passphrase-wrapped', 'external-vault'],
    policyUrl: null,
    policyReviewedAt: null
  },
  {
    templateId: 'user-proxy',
    kind: 'user-proxy',
    displayName: 'User-owned proxy',
    execution: 'cloud',
    suggestedEndpointOrigin: null,
    credentialModes: ['external-vault', 'session-only', 'passphrase-wrapped'],
    policyUrl: null,
    policyReviewedAt: null
  }
] as const satisfies readonly ProviderTemplate[]

export function listProviderTemplates(): ProviderTemplate[] {
  return PROVIDER_TEMPLATES.map(template => structuredClone(template))
}

export function createProviderFromTemplate(input: {
  templateId: ProviderTemplate['templateId']
  providerConfigId: string
  displayName: string
  endpointOrigin?: string
  execution?: ProviderDescriptor['execution']
  policyUrl?: string | null
  policyReviewedAt?: string | null
  at: string
}): ProviderDescriptor {
  const template = PROVIDER_TEMPLATES.find(
    ({ templateId }) => templateId === input.templateId
  )
  if (!template) {
    throw new TypeError('Unknown provider template')
  }
  const execution = input.execution ?? template.execution
  const endpointInput = input.endpointOrigin ?? template.suggestedEndpointOrigin
  if (!endpointInput) {
    throw new TypeError('Provider endpoint is required')
  }
  return providerDescriptorSchema.parse({
    schemaVersion: 1,
    providerConfigId: input.providerConfigId,
    displayName: input.displayName,
    kind: template.kind,
    execution,
    endpointOrigin: normalizeEndpointOrigin(endpointInput, execution),
    credentialMode: 'none',
    credentialRef: null,
    policyUrl: input.policyUrl ?? template.policyUrl,
    policyReviewedAt: input.policyReviewedAt ?? template.policyReviewedAt,
    createdAt: input.at,
    updatedAt: input.at,
    status: 'unconfigured'
  })
}
