import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'
import { inferredRelationSchema } from '@/core/content/relations'
import { type Provenance, provenanceSchema } from '@/core/evidence/provenance'

const MAX_SIGNAL_ENTRIES = 128
const MAX_EVIDENCE_REFS = 16

const evidenceRefsSchema = z
  .array(nonEmptyStringSchema.max(256))
  .max(MAX_EVIDENCE_REFS)

const scoredSignalSchema = z.strictObject({
  topicId: nonEmptyStringSchema.max(128),
  score: z.number().finite().min(0).max(1),
  evidenceRefs: evidenceRefsSchema
})

const archetypeSignalSchema = z.strictObject({
  archetypeId: nonEmptyStringSchema.max(128),
  score: z.number().finite().min(0).max(1),
  evidenceRefs: evidenceRefsSchema
})

const semanticRuleMatchSchema = z.strictObject({
  ruleId: nonEmptyStringSchema.max(256),
  score: z.number().finite().min(0).max(1),
  evidenceRefs: evidenceRefsSchema
})

const qualityScoreSchema = z.number().finite().min(0).max(1)
const safeSourceRefSchema = nonEmptyStringSchema
  .max(256)
  .refine(value => !value.includes('?') && !value.includes('#'), {
    message: 'Signal source references must not contain query or fragment data'
  })

export const signalEvidenceSchema = z.strictObject({
  evidenceId: nonEmptyStringSchema.max(256),
  label: nonEmptyStringSchema.max(256),
  sourceRef: safeSourceRefSchema.optional()
})

export const ABSTENTION_CODE_VALUES = [
  'insufficient-input',
  'unsupported-language',
  'unsupported-input',
  'unsupported-media',
  'low-confidence',
  'conflicting-signals',
  'resource-limit',
  'cost-limit',
  'provider-unavailable',
  'timeout',
  'cancelled',
  'refused',
  'content-filtered',
  'truncated',
  'invalid-output',
  'policy-required'
] as const

export const abstentionSchema = z.strictObject({
  code: z.enum(ABSTENTION_CODE_VALUES),
  detailCode: nonEmptyStringSchema.max(128).optional()
})

export const classificationSignalsSchema = z.strictObject({
  schemaVersion: nonEmptyStringSchema.max(64),
  topics: z.array(scoredSignalSchema).max(MAX_SIGNAL_ENTRIES),
  archetypes: z.array(archetypeSignalSchema).max(MAX_SIGNAL_ENTRIES),
  quality: z.strictObject({
    technicalDepth: qualityScoreSchema.optional(),
    originality: qualityScoreSchema.optional(),
    novelty: qualityScoreSchema.optional(),
    educationalValue: qualityScoreSchema.optional(),
    evidence: qualityScoreSchema.optional(),
    trustworthiness: qualityScoreSchema.optional(),
    clickbait: qualityScoreSchema.optional(),
    noise: qualityScoreSchema.optional(),
    aiGenerated: qualityScoreSchema.optional(),
    personalRelevance: qualityScoreSchema.optional()
  }),
  semanticRuleMatches: z.array(semanticRuleMatchSchema).max(MAX_SIGNAL_ENTRIES),
  relations: z.array(inferredRelationSchema).max(MAX_SIGNAL_ENTRIES),
  evidence: z.array(signalEvidenceSchema).max(MAX_SIGNAL_ENTRIES),
  confidence: z.number().finite().min(0).max(1).nullable(),
  abstention: abstentionSchema.nullable(),
  provenance: provenanceSchema,
  classifierVersion: nonEmptyStringSchema.max(128),
  modelVersion: nonEmptyStringSchema.max(128)
})

export type ClassificationSignals = z.infer<typeof classificationSignalsSchema>

export function emptyClassificationSignals(input: {
  provenance: Provenance
  classifierVersion: string
  modelVersion: string
}): ClassificationSignals {
  return classificationSignalsSchema.parse({
    schemaVersion: '1',
    topics: [],
    archetypes: [],
    quality: {},
    semanticRuleMatches: [],
    relations: [],
    evidence: [],
    confidence: null,
    abstention: null,
    provenance: input.provenance,
    classifierVersion: input.classifierVersion,
    modelVersion: input.modelVersion
  })
}
