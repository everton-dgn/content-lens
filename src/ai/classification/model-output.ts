import { z } from 'zod'

import { ABSTENTION_CODE_VALUES } from '@/core/decisions/signals'

export const CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION =
  'classification-model-output@1'

const nonEmptyBoundedString = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(value => value.trim().length > 0)
const safeSourceRefSchema = nonEmptyBoundedString(256).refine(
  value => !value.includes('?') && !value.includes('#')
)
const evidenceRefsSchema = z.array(nonEmptyBoundedString(256)).max(16)
const scoreSchema = z.number().finite().min(0).max(1)

export const classificationModelOutputSchema = z
  .strictObject({
    schemaVersion: z.literal(CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION),
    topics: z
      .array(
        z.strictObject({
          topicId: nonEmptyBoundedString(128),
          score: scoreSchema,
          evidenceRefs: evidenceRefsSchema
        })
      )
      .max(128),
    archetypes: z
      .array(
        z.strictObject({
          archetypeId: nonEmptyBoundedString(128),
          score: scoreSchema,
          evidenceRefs: evidenceRefsSchema
        })
      )
      .max(128),
    quality: z.strictObject({
      technicalDepth: scoreSchema.optional(),
      originality: scoreSchema.optional(),
      novelty: scoreSchema.optional(),
      educationalValue: scoreSchema.optional(),
      evidence: scoreSchema.optional(),
      trustworthiness: scoreSchema.optional(),
      clickbait: scoreSchema.optional(),
      noise: scoreSchema.optional(),
      aiGenerated: scoreSchema.optional(),
      personalRelevance: scoreSchema.optional()
    }),
    semanticRuleMatches: z
      .array(
        z.strictObject({
          ruleId: nonEmptyBoundedString(256),
          score: scoreSchema,
          evidenceRefs: evidenceRefsSchema
        })
      )
      .max(128),
    evidence: z
      .array(
        z.strictObject({
          evidenceId: nonEmptyBoundedString(256),
          label: nonEmptyBoundedString(256),
          sourceRef: safeSourceRefSchema.optional()
        })
      )
      .max(128),
    confidence: scoreSchema.nullable(),
    abstention: z
      .strictObject({
        code: z.enum(ABSTENTION_CODE_VALUES),
        detailCode: nonEmptyBoundedString(128).optional()
      })
      .nullable()
  })
  .superRefine((output, context) => {
    const uniquenessChecks: Array<{
      values: string[]
      path: string
    }> = [
      {
        values: output.topics.map(topic => topic.topicId),
        path: 'topics'
      },
      {
        values: output.archetypes.map(archetype => archetype.archetypeId),
        path: 'archetypes'
      },
      {
        values: output.semanticRuleMatches.map(match => match.ruleId),
        path: 'semanticRuleMatches'
      },
      {
        values: output.evidence.map(evidence => evidence.evidenceId),
        path: 'evidence'
      }
    ]
    for (const check of uniquenessChecks) {
      if (new Set(check.values).size !== check.values.length) {
        context.addIssue({
          code: 'custom',
          message: `${check.path} IDs must be unique`,
          path: [check.path]
        })
      }
    }

    const evidenceIds = new Set(
      output.evidence.map(evidence => evidence.evidenceId)
    )
    const referencedEvidence = [
      ...output.topics.flatMap(topic => topic.evidenceRefs),
      ...output.archetypes.flatMap(archetype => archetype.evidenceRefs),
      ...output.semanticRuleMatches.flatMap(match => match.evidenceRefs)
    ]
    if (referencedEvidence.some(evidenceRef => !evidenceIds.has(evidenceRef))) {
      context.addIssue({
        code: 'custom',
        message: 'Signal evidence references must resolve inside the output',
        path: ['evidence']
      })
    }

    if (
      output.abstention &&
      (output.topics.length > 0 ||
        output.archetypes.length > 0 ||
        Object.keys(output.quality).length > 0 ||
        output.semanticRuleMatches.length > 0 ||
        output.evidence.length > 0 ||
        output.confidence !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'An abstention output cannot also contain classification signals',
        path: ['abstention']
      })
    }
  })

const stringSchema = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '\\S'
})
const jsonScoreSchema = { type: 'number', minimum: 0, maximum: 1 }
const jsonEvidenceRefsSchema = {
  type: 'array',
  maxItems: 16,
  items: stringSchema(256)
}

export const CLASSIFICATION_MODEL_OUTPUT_JSON_SCHEMA = {
  $id: 'classification_model_output',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'topics',
    'archetypes',
    'quality',
    'semanticRuleMatches',
    'evidence',
    'confidence',
    'abstention'
  ],
  properties: {
    schemaVersion: {
      type: 'string',
      const: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION
    },
    topics: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topicId', 'score', 'evidenceRefs'],
        properties: {
          topicId: stringSchema(128),
          score: jsonScoreSchema,
          evidenceRefs: jsonEvidenceRefsSchema
        }
      }
    },
    archetypes: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['archetypeId', 'score', 'evidenceRefs'],
        properties: {
          archetypeId: stringSchema(128),
          score: jsonScoreSchema,
          evidenceRefs: jsonEvidenceRefsSchema
        }
      }
    },
    quality: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        [
          'technicalDepth',
          'originality',
          'novelty',
          'educationalValue',
          'evidence',
          'trustworthiness',
          'clickbait',
          'noise',
          'aiGenerated',
          'personalRelevance'
        ].map(field => [field, jsonScoreSchema])
      )
    },
    semanticRuleMatches: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ruleId', 'score', 'evidenceRefs'],
        properties: {
          ruleId: stringSchema(256),
          score: jsonScoreSchema,
          evidenceRefs: jsonEvidenceRefsSchema
        }
      }
    },
    evidence: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['evidenceId', 'label'],
        properties: {
          evidenceId: stringSchema(256),
          label: stringSchema(256),
          sourceRef: {
            ...stringSchema(256),
            pattern: '^[^?#]*\\S[^?#]*$'
          }
        }
      }
    },
    confidence: {
      anyOf: [jsonScoreSchema, { type: 'null' }]
    },
    abstention: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: {
            code: { type: 'string', enum: ABSTENTION_CODE_VALUES },
            detailCode: stringSchema(128)
          }
        },
        { type: 'null' }
      ]
    }
  }
} as const

export type ClassificationModelOutput = z.infer<
  typeof classificationModelOutputSchema
>
