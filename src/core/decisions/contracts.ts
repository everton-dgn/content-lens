import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'

export const decisionActionSchema = z.enum([
  'show',
  'promote',
  'reduce',
  'hide',
  'review'
])

export const evidenceSchema = z.strictObject({
  source: z.enum([
    'deterministic-rule',
    'adapter-observation',
    'text-model',
    'vision-model',
    'embedding',
    'content-graph',
    'user-feedback'
  ]),
  label: nonEmptyStringSchema,
  score: z.number().min(0).max(1).optional(),
  ruleId: nonEmptyStringSchema.optional(),
  excerpt: nonEmptyStringSchema.optional()
})

export const decisionSchema = z.strictObject({
  contentId: nonEmptyStringSchema,
  action: decisionActionSchema,
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasons: z.array(evidenceSchema),
  matchedRuleIds: z.array(nonEmptyStringSchema),
  decidedAt: isoTimestampSchema,
  classifierVersion: nonEmptyStringSchema,
  policyVersion: nonEmptyStringSchema,
  profileRevision: z.int().nonnegative()
})

export type DecisionAction = z.infer<typeof decisionActionSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type Decision = z.infer<typeof decisionSchema>
