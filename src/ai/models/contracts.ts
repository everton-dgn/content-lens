import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema
} from '@/core/content/contracts'

export const MODEL_TASK_VALUES = [
  'classification-text',
  'classification-vision',
  'embedding',
  'assistance-draft',
  'assistance-explain'
] as const

export const modelTaskSchema = z.enum(MODEL_TASK_VALUES)

export const modelRefSchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256)
})

export const modelCapabilitySchema = z
  .strictObject({
    task: modelTaskSchema,
    modalities: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .max(2),
    languages: z.array(nonEmptyStringSchema.max(32)).max(64),
    imageMimeTypes: z.array(nonEmptyStringSchema.max(128)).max(32),
    maxInputBytes: z.int().positive(),
    maxOutputBytes: z.int().positive(),
    structuredOutput: z.boolean(),
    evidence: z.enum(['declared', 'probe-verified', 'benchmark-accepted']),
    source: z.enum(['provider', 'user', 'built-in', 'probe']),
    verifiedAt: z.iso.datetime({ offset: true }).nullable()
  })
  .superRefine((capability, context) => {
    if (new Set(capability.modalities).size !== capability.modalities.length) {
      context.addIssue({
        code: 'custom',
        message: 'Model modalities must be unique',
        path: ['modalities']
      })
    }
    if (
      !capability.modalities.includes('image') &&
      capability.imageMimeTypes.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Text-only capability cannot declare image MIME types',
        path: ['imageMimeTypes']
      })
    }
    if (
      capability.modalities.includes('image') &&
      (capability.imageMimeTypes.length === 0 ||
        capability.imageMimeTypes.includes('*/*'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Image capability requires explicit image MIME types',
        path: ['imageMimeTypes']
      })
    }
    if (
      capability.task === 'classification-vision' &&
      !capability.modalities.includes('image')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Vision classification requires the image modality',
        path: ['modalities']
      })
    }
    if (
      new Set(capability.languages).size !== capability.languages.length ||
      new Set(capability.imageMimeTypes).size !==
        capability.imageMimeTypes.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Capability languages and MIME types must be unique'
      })
    }
  })

export const modelPricingSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  unit: z.literal('per-1m-tokens'),
  inputPrice: z.number().finite().nonnegative(),
  outputPrice: z.number().finite().nonnegative(),
  verifiedAt: isoTimestampSchema,
  version: nonEmptyStringSchema.max(128),
  sourceUrl: z.url({ protocol: /^https$/ })
})

export const modelDescriptorSchema = z
  .strictObject({
    providerConfigId: nonEmptyStringSchema.max(256),
    modelId: nonEmptyStringSchema.max(256),
    displayName: nonEmptyStringSchema.max(256),
    declaredVersion: nonEmptyStringSchema.max(128).nullable(),
    executionKind: z.enum(['local', 'browser', 'cloud']),
    catalogSource: z.enum(['provider', 'user', 'built-in']),
    lastCheckedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(['available', 'unavailable', 'invalid']),
    pricing: modelPricingSchema.optional(),
    capabilities: z.array(modelCapabilitySchema).max(32)
  })
  .superRefine((model, context) => {
    const tasks = model.capabilities.map(capability => capability.task)
    if (new Set(tasks).size !== tasks.length) {
      context.addIssue({
        code: 'custom',
        message: 'Model capabilities must contain at most one entry per task',
        path: ['capabilities']
      })
    }
    if (model.pricing && model.executionKind !== 'cloud') {
      context.addIssue({
        code: 'custom',
        message: 'Only cloud models can declare token pricing',
        path: ['pricing']
      })
    }
  })

const routeShape = {
  state: z.literal('route'),
  primary: modelRefSchema,
  fallbacks: z.array(modelRefSchema).max(3),
  allowCloudFallback: z.boolean(),
  allowHigherCostFallback: z.boolean()
}

function modelRefKey(reference: z.infer<typeof modelRefSchema>) {
  return `${reference.providerConfigId}\u0000${reference.modelId}`
}

const routeSelectionSchema = z
  .strictObject(routeShape)
  .superRefine((route, context) => {
    const primary = modelRefKey(route.primary)
    const fallbackKeys = route.fallbacks.map(modelRefKey)
    if (
      fallbackKeys.includes(primary) ||
      new Set(fallbackKeys).size !== fallbackKeys.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fallback chain contains a cycle or duplicate',
        path: ['fallbacks']
      })
    }
  })

export const globalRouteSelectionSchema = z.union([
  z.strictObject({ state: z.literal('disabled') }),
  routeSelectionSchema
])

export const platformRouteSelectionSchema = z.union([
  z.strictObject({ state: z.literal('inherit') }),
  z.strictObject({ state: z.literal('disabled') }),
  routeSelectionSchema
])

export const budgetPolicySchema = z.strictObject({
  maxConcurrentGlobal: z.int().min(1).max(8),
  maxConcurrentByProvider: z.int().min(1).max(4),
  requestsPerMinuteByProvider: z.int().min(1).max(600),
  requestsPerDayByProvider: z.int().min(1).max(100_000),
  monetaryBudget: z.strictObject({
    enabled: z.boolean(),
    limit: z.number().finite().nonnegative(),
    currency: nonEmptyStringSchema.max(8),
    priceMaxAgeHours: z.number().finite().positive()
  })
})

export const DEFAULT_BUDGET_POLICY = Object.freeze({
  maxConcurrentGlobal: 2,
  maxConcurrentByProvider: 1,
  requestsPerMinuteByProvider: 30,
  requestsPerDayByProvider: 500,
  monetaryBudget: {
    enabled: false,
    limit: 0,
    currency: 'USD',
    priceMaxAgeHours: 24
  }
}) satisfies z.infer<typeof budgetPolicySchema>

export const modelRoutingSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  globalRoutes: z.partialRecord(modelTaskSchema, globalRouteSelectionSchema),
  platformOverrides: z.partialRecord(
    platformSchema,
    z.partialRecord(modelTaskSchema, platformRouteSelectionSchema)
  ),
  budgets: budgetPolicySchema
})

export type ModelTask = z.infer<typeof modelTaskSchema>
export type ModelRef = z.infer<typeof modelRefSchema>
export type ModelCapability = z.infer<typeof modelCapabilitySchema>
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>
export type ModelPricing = z.infer<typeof modelPricingSchema>
export type GlobalRouteSelection = z.infer<typeof globalRouteSelectionSchema>
export type PlatformRouteSelection = z.infer<
  typeof platformRouteSelectionSchema
>
export type BudgetPolicy = z.infer<typeof budgetPolicySchema>
export type ModelRoutingSettings = z.infer<typeof modelRoutingSettingsSchema>
