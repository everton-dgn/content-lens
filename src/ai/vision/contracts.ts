import { z } from 'zod'

import type { DataCategory } from '@/ai/providers/contracts'
import {
  nonEmptyStringSchema,
  platformSchema,
  surfaceSchema
} from '@/core/content/contracts'
import type { SemanticRule } from '@/core/rules/contracts/rule'

export const MAX_VISUAL_IMAGE_COUNT = 1
export const MAX_VISUAL_ENCODED_BYTES = 5 * 1024 * 1024
export const MAX_VISUAL_DECODED_PIXELS = 16 * 1024 * 1024
export const MAX_VISUAL_EDGE = 1_024
export const VISION_PREPROCESSING_VERSION = 'vision-preprocessing@1'

export const VISUAL_MIME_TYPE_VALUES = [
  'image/jpeg',
  'image/png',
  'image/webp'
] as const

export const visualMimeTypeSchema = z.enum(VISUAL_MIME_TYPE_VALUES)

const visualSemanticRuleSchema = z.strictObject({
  ruleId: nonEmptyStringSchema.max(256),
  description: nonEmptyStringSchema.max(8_192),
  examples: z.array(nonEmptyStringSchema.max(4_096)).max(20),
  exclusions: z.array(nonEmptyStringSchema.max(4_096)).max(20)
})

export const visualClassificationInputSchema = z.strictObject({
  title: z.string().max(4_096).optional(),
  body: z.string().max(16_384).optional(),
  language: nonEmptyStringSchema.max(32),
  semanticRules: z.array(visualSemanticRuleSchema).max(128),
  candidateTopicIds: z.array(nonEmptyStringSchema.max(128)).max(128),
  candidateArchetypeIds: z.array(nonEmptyStringSchema.max(128)).max(128),
  candidateEvidenceCodes: z.array(nonEmptyStringSchema.max(128)).max(128),
  media: z.strictObject({
    kind: z.enum(['thumbnail', 'image', 'video-preview']),
    mimeType: visualMimeTypeSchema,
    width: z.int().positive().max(MAX_VISUAL_EDGE),
    height: z.int().positive().max(MAX_VISUAL_EDGE),
    fingerprint: nonEmptyStringSchema.max(256)
  })
})

export const visualBindingSchema = z.strictObject({
  contentId: nonEmptyStringSchema.max(512),
  pageInstanceId: nonEmptyStringSchema.max(512),
  platform: platformSchema,
  surface: surfaceSchema,
  profileRevision: z.int().nonnegative()
})

export type VisualMimeType = z.infer<typeof visualMimeTypeSchema>
export type VisualClassificationInput = z.infer<
  typeof visualClassificationInputSchema
>
export type VisualBinding = z.infer<typeof visualBindingSchema>

export type ResolvedMedia = {
  bytes: Uint8Array
  declaredMimeType: string
  width: number
  height: number
}

export type MinimizedImage = {
  bytes: Uint8Array
  mimeType: VisualMimeType
  width: number
  height: number
  fingerprint: string
}

export type ReadyVisualInput = {
  binding: VisualBinding
  input: VisualClassificationInput
  image: MinimizedImage
  inputBytes: number
  inputFingerprint: string
  dataCategories: DataCategory[]
}

export type VisualSemanticRule = Pick<
  SemanticRule,
  'id' | 'description' | 'examples' | 'exclusions'
>
