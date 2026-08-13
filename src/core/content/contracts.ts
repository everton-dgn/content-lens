import { z } from 'zod'

import { platformSurfaceSchema } from '@/core/content/surfaces'

export const PLATFORM_VALUES = [
  'youtube',
  'linkedin',
  'x',
  'reddit',
  'hacker-news',
  'rss'
] as const

export const MAX_CONTENT_BODY_LENGTH = 16_384
export const MAX_CONTENT_CONTEXT_ENTRIES = 64
export const MAX_CONTENT_CONTEXT_KEY_LENGTH = 128
export const MAX_CONTENT_CONTEXT_STRING_LENGTH = 4_096
export const MAX_CONTENT_TITLE_LENGTH = 4_096

export const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine(value => value.trim().length > 0, {
    message: 'String must contain a non-whitespace character'
  })

export const isoTimestampSchema = z.iso.datetime({ offset: true })

export const webUrlSchema = z.url({ protocol: /^https?$/ })

export const platformSchema = z.enum(PLATFORM_VALUES)

export const surfaceSchema = platformSurfaceSchema

export const contentIdentitySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('stable'),
    platformContentId: nonEmptyStringSchema
  }),
  z.strictObject({
    status: z.literal('ephemeral'),
    pageInstanceId: nonEmptyStringSchema,
    reason: z.enum(['not-exposed', 'invalid'])
  })
])

export const authorSchema = z.strictObject({
  platform: platformSchema,
  authorId: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema,
  profileUrl: webUrlSchema.optional()
})

export const channelSchema = z.strictObject({
  platform: platformSchema,
  channelId: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema,
  channelUrl: webUrlSchema.optional()
})

export const mediaReferenceSchema = z.strictObject({
  kind: z.enum(['thumbnail', 'image', 'video-preview']),
  url: webUrlSchema,
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  fingerprint: nonEmptyStringSchema.optional()
})

const contextKeySchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_CONTEXT_KEY_LENGTH)
  .refine(value => value.trim().length > 0, {
    message: 'Context key must contain a non-whitespace character'
  })

const contextValueSchema = z.union([
  z.string().max(MAX_CONTENT_CONTEXT_STRING_LENGTH),
  z.number(),
  z.boolean()
])

const contentContextSchema = z
  .record(contextKeySchema, contextValueSchema)
  .refine(
    context => Object.keys(context).length <= MAX_CONTENT_CONTEXT_ENTRIES,
    {
      message: 'Content context has too many entries'
    }
  )

export const contentItemSchema = z.strictObject({
  id: nonEmptyStringSchema,
  platform: platformSchema,
  identity: contentIdentitySchema,
  canonicalUrl: webUrlSchema.optional(),
  surface: surfaceSchema,
  title: z.string().max(MAX_CONTENT_TITLE_LENGTH).optional(),
  body: z.string().max(MAX_CONTENT_BODY_LENGTH).optional(),
  author: authorSchema.optional(),
  channel: channelSchema.optional(),
  media: z.array(mediaReferenceSchema),
  publishedAt: isoTimestampSchema.optional(),
  observedAt: isoTimestampSchema,
  language: nonEmptyStringSchema.optional(),
  context: contentContextSchema
})

export type Platform = z.infer<typeof platformSchema>
export type Surface = z.infer<typeof surfaceSchema>
export type ContentIdentity = z.infer<typeof contentIdentitySchema>
export type Author = z.infer<typeof authorSchema>
export type Channel = z.infer<typeof channelSchema>
export type MediaReference = z.infer<typeof mediaReferenceSchema>
export type ContentItem = z.infer<typeof contentItemSchema>
