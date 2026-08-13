import { z } from 'zod'

import { modelTaskSchema } from '@/ai/models/contracts'
import { nonEmptyStringSchema } from '@/core/content/contracts'

export const MODEL_CACHE_SCHEMA_VERSION = 1

export const modelCacheKeyInputSchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  providerFingerprint: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256),
  modelVersion: nonEmptyStringSchema.max(128),
  capabilityVersion: nonEmptyStringSchema.max(128),
  task: modelTaskSchema,
  profileRevision: z.int().nonnegative(),
  contentFingerprint: nonEmptyStringSchema.max(256),
  routeVersion: nonEmptyStringSchema.max(128),
  promptVersion: nonEmptyStringSchema.max(128),
  outputSchemaVersion: nonEmptyStringSchema.max(128),
  preprocessingVersion: nonEmptyStringSchema.max(128),
  policyVersion: nonEmptyStringSchema.max(128)
})

export type ModelCacheKeyInput = z.infer<typeof modelCacheKeyInputSchema>

export function buildModelCacheKey(input: ModelCacheKeyInput) {
  const parsed = modelCacheKeyInputSchema.parse(input)
  return `model-cache:v${MODEL_CACHE_SCHEMA_VERSION}:${JSON.stringify(parsed)}`
}
