import { z } from 'zod'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput,
  classificationModelOutputSchema
} from '@/ai/classification/model-output'
import {
  nonEmptyStringSchema,
  platformSchema,
  surfaceSchema
} from '@/core/content/contracts'

export const TEXT_CLASSIFICATION_INPUT_SCHEMA_VERSION = 1
export const TEXT_MODEL_OUTPUT_SCHEMA_VERSION =
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION
export const MAX_TEXT_CONTEXT_ENTRIES = 32
export const MAX_TEXT_RULES = 32
export const MAX_TEXT_RULE_DETAILS = 16

export const textLanguageSchema = z.enum(['pt_BR', 'en', 'es', 'unknown'])

const textContextValueSchema = z.union([
  z.string().max(1_024),
  z.number().finite(),
  z.boolean()
])

const textContextSchema = z
  .record(nonEmptyStringSchema.max(128), textContextValueSchema)
  .refine(context => Object.keys(context).length <= MAX_TEXT_CONTEXT_ENTRIES, {
    message: 'Text context has too many entries'
  })

const textSemanticRuleSchema = z.strictObject({
  ruleId: nonEmptyStringSchema.max(256),
  description: nonEmptyStringSchema.max(8_192),
  examples: z.array(nonEmptyStringSchema.max(4_096)).max(MAX_TEXT_RULE_DETAILS),
  exclusions: z
    .array(nonEmptyStringSchema.max(4_096))
    .max(MAX_TEXT_RULE_DETAILS)
})

export const textClassificationInputSchema = z
  .strictObject({
    schemaVersion: z.literal(TEXT_CLASSIFICATION_INPUT_SCHEMA_VERSION),
    task: z.literal('classification-text'),
    platform: platformSchema,
    surface: surfaceSchema,
    language: textLanguageSchema,
    content: z.strictObject({
      title: z.string().max(4_096).optional(),
      body: z.string().max(16_384).optional(),
      sourceLabel: z.string().max(256).optional(),
      context: textContextSchema
    }),
    semanticRules: z.array(textSemanticRuleSchema).max(MAX_TEXT_RULES),
    truncation: z.strictObject({
      title: z.boolean(),
      body: z.boolean(),
      sourceLabel: z.boolean(),
      contextKeys: z
        .array(nonEmptyStringSchema.max(128))
        .max(MAX_TEXT_CONTEXT_ENTRIES),
      semanticRuleDetails: z.boolean()
    })
  })
  .superRefine((input, context) => {
    if (!input.surface.startsWith(`${input.platform}:`)) {
      context.addIssue({
        code: 'custom',
        message: 'Text input surface does not belong to its platform',
        path: ['surface']
      })
    }
  })

export const textModelOutputSchema = classificationModelOutputSchema

export type TextLanguage = z.infer<typeof textLanguageSchema>
export type TextClassificationInput = z.infer<
  typeof textClassificationInputSchema
>
export type TextModelOutput = ClassificationModelOutput
