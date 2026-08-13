import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema,
  surfaceSchema
} from '@/core/content/contracts'

export const MAX_RULE_DESCRIPTION_BYTES = 8 * 1024

const ruleDescriptionSchema = nonEmptyStringSchema.refine(
  value =>
    new TextEncoder().encode(value).byteLength <= MAX_RULE_DESCRIPTION_BYTES,
  {
    message: `Description must not exceed ${MAX_RULE_DESCRIPTION_BYTES} UTF-8 bytes`
  }
)

export const ruleExampleSchema = nonEmptyStringSchema

export const ruleScopeSchema = z.strictObject({
  platforms: z.array(platformSchema).optional(),
  surfaces: z.array(surfaceSchema).optional()
})

const baseRuleShape = {
  id: nonEmptyStringSchema,
  enabled: z.boolean(),
  scope: ruleScopeSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
}

export const identityRuleSchema = z.strictObject({
  ...baseRuleShape,
  kind: z.literal('identity'),
  effect: z.enum(['block', 'allow', 'promote']),
  platform: platformSchema,
  identityType: z.enum(['author', 'channel']),
  identityId: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema.optional()
})

export const exactRuleSchema = z.strictObject({
  ...baseRuleShape,
  kind: z.literal('exact'),
  effect: z.enum(['block', 'allow']),
  field: z.enum(['title', 'body', 'domain']),
  value: nonEmptyStringSchema,
  caseSensitive: z.boolean()
})

export const semanticRuleSchema = z.strictObject({
  ...baseRuleShape,
  kind: z.literal('semantic'),
  effect: z.enum(['block', 'reduce', 'allow', 'promote']),
  description: ruleDescriptionSchema,
  examples: z.array(ruleExampleSchema),
  exclusions: z.array(nonEmptyStringSchema),
  threshold: z.number().min(0).max(1)
})

export const preferenceRuleSchema = z.strictObject({
  ...baseRuleShape,
  kind: z.literal('preference'),
  target: z.enum(['topic', 'archetype', 'quality']),
  targetId: nonEmptyStringSchema,
  weight: z.number()
})

export const ruleSchema = z.discriminatedUnion('kind', [
  identityRuleSchema,
  exactRuleSchema,
  semanticRuleSchema,
  preferenceRuleSchema
])

export type RuleExample = z.infer<typeof ruleExampleSchema>
export type RuleScope = z.infer<typeof ruleScopeSchema>
export type IdentityRule = z.infer<typeof identityRuleSchema>
export type ExactRule = z.infer<typeof exactRuleSchema>
export type SemanticRule = z.infer<typeof semanticRuleSchema>
export type PreferenceRule = z.infer<typeof preferenceRuleSchema>
export type Rule = z.infer<typeof ruleSchema>
