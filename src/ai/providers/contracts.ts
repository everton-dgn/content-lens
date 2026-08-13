import { z } from 'zod'

import { type ModelTask, modelTaskSchema } from '@/ai/models/contracts'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type Platform,
  platformSchema
} from '@/core/content/contracts'

export const PROVIDER_KIND_VALUES = [
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'openai-compatible',
  'user-proxy',
  'custom',
  'browser-built-in'
] as const

export const PROVIDER_EXECUTION_VALUES = ['local', 'cloud', 'browser'] as const
export const CREDENTIAL_MODE_VALUES = [
  'none',
  'session-only',
  'passphrase-wrapped',
  'external-vault'
] as const

export const DATA_CATEGORY_VALUES = [
  'title',
  'body',
  'author',
  'context',
  'rule',
  'examples',
  'exclusions',
  'image',
  'intent',
  'decision'
] as const

export const PROVIDER_CONNECTION_CODE_VALUES = [
  'provider-connection-ready',
  'provider-connection-authentication-failed',
  'provider-connection-authorization-failed',
  'provider-connection-tls-failed',
  'provider-connection-host-unreachable',
  'provider-connection-rate-limited',
  'provider-connection-quota-exhausted',
  'provider-connection-model-unavailable',
  'provider-connection-schema-invalid',
  'provider-connection-protocol-invalid',
  'provider-connection-timeout',
  'provider-connection-offline',
  'provider-connection-cancelled',
  'provider-connection-permission-denied',
  'provider-connection-credential-locked',
  'provider-connection-credential-unavailable'
] as const

const providerExecutionSchema = z.enum(PROVIDER_EXECUTION_VALUES)
const providerStatusSchema = z.enum([
  'unconfigured',
  'locked',
  'ready',
  'degraded',
  'rate-limited',
  'unauthorized',
  'revoked'
])

export const providerConnectionRecordSchema = z.strictObject({
  outcome: z.enum(['success', 'failure', 'cancelled']),
  code: z.enum(PROVIDER_CONNECTION_CODE_VALUES),
  checkedAt: isoTimestampSchema,
  latencyMs: z.number().finite().nonnegative()
})

export const providerConnectionResultSchema =
  providerConnectionRecordSchema.extend({
    providerStatus: providerStatusSchema
  })

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') {
    return true
  }
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every(octet => /^\d{1,3}$/.test(octet))
  )
}

export function normalizeEndpointOrigin(
  input: string,
  execution: z.infer<typeof providerExecutionSchema>
) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError('Invalid provider endpoint')
  }

  const invalidShape =
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    input.includes('*')
  const secure = url.protocol === 'https:'
  const localHttp =
    execution === 'local' &&
    url.protocol === 'http:' &&
    isLoopbackHostname(url.hostname)
  if (invalidShape || (!secure && !localHttp)) {
    throw new TypeError('Invalid provider endpoint')
  }
  return url.origin
}

export const providerDescriptorSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    providerConfigId: nonEmptyStringSchema.max(256),
    displayName: nonEmptyStringSchema.max(256),
    kind: z.enum(PROVIDER_KIND_VALUES),
    execution: providerExecutionSchema,
    endpointOrigin: nonEmptyStringSchema.max(2_048),
    credentialMode: z.enum(CREDENTIAL_MODE_VALUES),
    credentialRef: nonEmptyStringSchema.max(256).nullable(),
    policyUrl: z.url({ protocol: /^https$/ }).nullable(),
    policyReviewedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    status: providerStatusSchema,
    lastConnectionTest: providerConnectionRecordSchema.nullable().optional()
  })
  .superRefine((provider, context) => {
    try {
      if (
        normalizeEndpointOrigin(provider.endpointOrigin, provider.execution) !==
        provider.endpointOrigin
      ) {
        throw new TypeError('Endpoint is not normalized')
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Invalid provider endpoint',
        path: ['endpointOrigin']
      })
    }
  })

export const consentKeySchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  endpointOrigin: nonEmptyStringSchema.max(2_048),
  task: modelTaskSchema,
  platform: platformSchema,
  categories: z
    .array(z.enum(DATA_CATEGORY_VALUES))
    .max(DATA_CATEGORY_VALUES.length),
  includeImages: z.boolean(),
  consentSchemaVersion: z.literal(1)
})

export const consentReceiptSchema = z.strictObject({
  key: consentKeySchema,
  providerKind: z.enum(PROVIDER_KIND_VALUES),
  policyUrl: z.url({ protocol: /^https$/ }).nullable(),
  policyReviewedAt: isoTimestampSchema.nullable(),
  estimatedFrequency: nonEmptyStringSchema.max(256),
  declaredRetention: nonEmptyStringSchema.max(256).nullable(),
  consentedAt: isoTimestampSchema
})

export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>
export type ProviderConnectionCode =
  (typeof PROVIDER_CONNECTION_CODE_VALUES)[number]
export type ProviderConnectionRecord = z.infer<
  typeof providerConnectionRecordSchema
>
export type ProviderConnectionResult = z.infer<
  typeof providerConnectionResultSchema
>
export type ConsentKey = z.infer<typeof consentKeySchema>
export type ConsentReceipt = z.infer<typeof consentReceiptSchema>
export type DataCategory = (typeof DATA_CATEGORY_VALUES)[number]

export function normalizeConsentKey(input: {
  providerConfigId: string
  endpointOrigin: string
  task: ModelTask
  platform: Platform
  categories: readonly DataCategory[]
  includeImages: boolean
  consentSchemaVersion: 1
}): ConsentKey {
  const order = new Map(
    DATA_CATEGORY_VALUES.map((category, index) => [category, index])
  )
  const categories = [...new Set(input.categories)].sort(
    (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)
  )
  return consentKeySchema.parse({
    ...input,
    endpointOrigin: normalizeEndpointOrigin(input.endpointOrigin, 'cloud'),
    categories
  })
}

export function consentKeyEquals(left: ConsentKey, right: ConsentKey) {
  const parsedLeft = consentKeySchema.safeParse(left)
  const parsedRight = consentKeySchema.safeParse(right)
  return (
    parsedLeft.success &&
    parsedRight.success &&
    JSON.stringify(parsedLeft.data) === JSON.stringify(parsedRight.data)
  )
}
