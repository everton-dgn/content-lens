import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'
import { provenanceSchema } from '@/core/evidence/provenance'

export const OBSERVED_RELATION_VALUES = [
  'reply-to',
  'quotes',
  'reposts',
  'crossposts',
  'thread-parent',
  'links-to',
  'published-by',
  'same-canonical-url'
] as const

export const INFERRED_RELATION_VALUES = [
  'similar-to',
  'near-duplicate',
  'duplicate-candidate',
  'derived-from-candidate',
  'primary-source-candidate'
] as const

const relationBase = {
  fromContentId: nonEmptyStringSchema,
  toContentId: nonEmptyStringSchema,
  provenance: provenanceSchema
}

export const observedRelationSchema = z.strictObject({
  ...relationBase,
  kind: z.literal('observed'),
  relation: z.enum(OBSERVED_RELATION_VALUES)
})

export const inferredRelationSchema = z.strictObject({
  ...relationBase,
  kind: z.literal('inferred'),
  relation: z.enum(INFERRED_RELATION_VALUES),
  score: z.number().finite().min(0).max(1)
})

export const contentRelationSchema = z.discriminatedUnion('kind', [
  observedRelationSchema,
  inferredRelationSchema
])

export type ObservedRelation = z.infer<typeof observedRelationSchema>
export type InferredRelation = z.infer<typeof inferredRelationSchema>
export type ContentRelation = z.infer<typeof contentRelationSchema>
