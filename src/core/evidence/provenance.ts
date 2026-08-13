import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema
} from '@/core/content/contracts'
import { platformSurfaceSchema } from '@/core/content/surfaces'

export const PROVENANCE_SOURCE_KIND_VALUES = [
  'deterministic-rule',
  'adapter-observation',
  'text-model',
  'vision-model',
  'embedding',
  'content-graph',
  'user-feedback'
] as const

const safeEvidenceRefSchema = nonEmptyStringSchema
  .max(256)
  .refine(value => !value.includes('?') && !value.includes('#'), {
    message: 'Evidence references must not contain query or fragment data'
  })

export const provenanceScopeSchema = z.strictObject({
  platform: platformSchema,
  surface: platformSurfaceSchema,
  contentId: nonEmptyStringSchema,
  task: z
    .enum([
      'classification-text',
      'classification-vision',
      'embedding',
      'assistance-draft',
      'assistance-explain'
    ])
    .optional()
})

export const provenanceSchema = z.strictObject({
  sourceKind: z.enum(PROVENANCE_SOURCE_KIND_VALUES),
  sourceId: nonEmptyStringSchema.max(256),
  sourceVersion: nonEmptyStringSchema.max(128),
  observedAt: isoTimestampSchema,
  inputFingerprint: nonEmptyStringSchema.max(256),
  scope: provenanceScopeSchema,
  confidence: z.number().finite().min(0).max(1).optional(),
  evidenceRefs: z.array(safeEvidenceRefSchema).max(64)
})

export type Provenance = z.infer<typeof provenanceSchema>
