import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'
import { decisionActionSchema } from '@/core/decisions/contracts'
import { ruleSchema } from '@/core/rules/contracts/rule'

export const MAX_PORTABLE_PROFILE_BYTES = 5 * 1024 * 1024
export const MAX_RULES = 10_000
export const MAX_FEEDBACK_EXAMPLES = 5_000
export const MAX_PROFILE_DEPTH = 32
export const SUPPORTED_PROFILE_SCHEMA_MAJOR = 1

export type PortableJsonValue =
  | string
  | number
  | boolean
  | null
  | PortableJsonValue[]
  | { [key: string]: PortableJsonValue }

export type PortableSettings = Record<string, PortableJsonValue>

export const portableJsonValueSchema: z.ZodType<PortableJsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(portableJsonValueSchema),
      z.record(nonEmptyStringSchema, portableJsonValueSchema)
    ])
)

export const portableSettingsSchema: z.ZodType<PortableSettings> = z.record(
  nonEmptyStringSchema,
  portableJsonValueSchema
)

export const feedbackActionSchema = z.enum([
  'show-item',
  'hide-item',
  'show-less',
  'hide-similar',
  'always-allow',
  'block-identity',
  'prioritize-identity',
  'correct-classification'
])

export const feedbackExampleSchema = z.strictObject({
  id: nonEmptyStringSchema,
  contentId: nonEmptyStringSchema,
  action: feedbackActionSchema,
  correction: z
    .strictObject({
      topics: z.array(nonEmptyStringSchema).optional(),
      archetypes: z.array(nonEmptyStringSchema).optional(),
      desiredAction: decisionActionSchema.optional()
    })
    .optional(),
  createdAt: isoTimestampSchema
})

export const schemaVersionSchema = z.strictObject({
  major: z.int().nonnegative(),
  minor: z.int().nonnegative()
})

export const profileEnvelopeSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    profileId: nonEmptyStringSchema,
    revision: z.int().nonnegative(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    rules: z.array(ruleSchema).max(MAX_RULES),
    feedbackExamples: z.array(feedbackExampleSchema).max(MAX_FEEDBACK_EXAMPLES),
    settings: portableSettingsSchema,
    extensions: z
      .record(nonEmptyStringSchema, portableJsonValueSchema)
      .optional()
  })
  .refine(
    profile => profile.schemaVersion.major === SUPPORTED_PROFILE_SCHEMA_MAJOR,
    {
      message: `Unsupported profile schema major; expected ${SUPPORTED_PROFILE_SCHEMA_MAJOR}`,
      path: ['schemaVersion', 'major']
    }
  )

export type FeedbackAction = z.infer<typeof feedbackActionSchema>
export type FeedbackExample = z.infer<typeof feedbackExampleSchema>
export type SchemaVersion = z.infer<typeof schemaVersionSchema>
export type ProfileEnvelope = z.infer<typeof profileEnvelopeSchema>

export type ProfileEnvelopeParseFailureCode =
  | 'invalid-json'
  | 'invalid-profile'
  | 'maximum-depth-exceeded'
  | 'payload-too-large'
  | 'secret-field-forbidden'

export type ProfileEnvelopeParseResult =
  | {
      success: true
      data: ProfileEnvelope
    }
  | {
      success: false
      code: ProfileEnvelopeParseFailureCode
      issues: string[]
    }

type PortableInspection =
  | { valid: true }
  | {
      valid: false
      code: 'invalid-profile' | 'maximum-depth-exceeded' | 'payload-too-large'
      issue: string
    }

function inspectPortableDepth(input: unknown): PortableInspection {
  if (input === null || typeof input !== 'object') {
    return { valid: true }
  }

  const activePath = new WeakSet<object>()
  const pending: Array<{
    value: object
    depth: number
    phase: 'enter' | 'exit'
  }> = [{ value: input, depth: 1, phase: 'enter' }]
  const encoder = new TextEncoder()
  let logicalBytes = 0

  const addLogicalBytes = (bytes: number) => {
    logicalBytes += bytes
    return logicalBytes <= MAX_PORTABLE_PROFILE_BYTES
  }

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) {
      break
    }

    if (current.phase === 'exit') {
      activePath.delete(current.value)
      continue
    }
    if (current.depth > MAX_PROFILE_DEPTH) {
      return {
        valid: false,
        code: 'maximum-depth-exceeded',
        issue: `Profile exceeds maximum depth ${MAX_PROFILE_DEPTH}`
      }
    }
    if (activePath.has(current.value)) {
      return {
        valid: false,
        code: 'invalid-profile',
        issue: 'Profile contains a circular reference'
      }
    }
    activePath.add(current.value)
    pending.push({
      value: current.value,
      depth: current.depth,
      phase: 'exit'
    })

    const entries = Object.entries(current.value)
    if (!addLogicalBytes(2)) {
      return {
        valid: false,
        code: 'payload-too-large',
        issue: `Profile exceeds ${MAX_PORTABLE_PROFILE_BYTES} UTF-8 bytes`
      }
    }
    let serializedEntries = 0
    for (const [key, value] of entries) {
      const isObject = value !== null && typeof value === 'object'
      const serialized = isObject ? '' : JSON.stringify(value)
      if (!isObject && serialized === undefined) {
        continue
      }
      const prefixBytes = Array.isArray(current.value)
        ? serializedEntries === 0
          ? 0
          : 1
        : (serializedEntries === 0 ? 0 : 1) +
          encoder.encode(JSON.stringify(key)).byteLength +
          1
      const valueBytes = isObject
        ? 0
        : encoder.encode(
            serialized ?? (Array.isArray(current.value) ? 'null' : '')
          ).byteLength
      if (!addLogicalBytes(prefixBytes + valueBytes)) {
        return {
          valid: false,
          code: 'payload-too-large',
          issue: `Profile exceeds ${MAX_PORTABLE_PROFILE_BYTES} UTF-8 bytes`
        }
      }
      serializedEntries += 1
      if (isObject) {
        pending.push({
          value,
          depth: current.depth + 1,
          phase: 'enter'
        })
      }
    }
  }

  return { valid: true }
}

function failure(
  code: ProfileEnvelopeParseFailureCode,
  issues: string[]
): ProfileEnvelopeParseResult {
  return { success: false, code, issues }
}

const forbiddenPortableFieldNames = new Set([
  'apikey',
  'authorization',
  'credential',
  'password',
  'secret',
  'token'
])

function normalizedPortableFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findForbiddenSecretField(input: unknown): string | undefined {
  if (input === null || typeof input !== 'object') {
    return undefined
  }
  const pending: Array<{ value: object; path: string }> = [
    { value: input, path: '<root>' }
  ]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current.value)) {
      continue
    }
    visited.add(current.value)
    for (const [key, value] of Object.entries(current.value)) {
      const path = Array.isArray(current.value)
        ? `${current.path}[${key}]`
        : `${current.path}.${key}`
      if (forbiddenPortableFieldNames.has(normalizedPortableFieldName(key))) {
        return path
      }
      if (value !== null && typeof value === 'object') {
        pending.push({ value, path })
      }
    }
  }
  return undefined
}

export function parseProfileEnvelope(input: string | unknown) {
  let candidate = input
  const encoder = new TextEncoder()

  if (typeof input === 'string') {
    if (encoder.encode(input).byteLength > MAX_PORTABLE_PROFILE_BYTES) {
      return failure('payload-too-large', [
        `Profile exceeds ${MAX_PORTABLE_PROFILE_BYTES} UTF-8 bytes`
      ])
    }

    try {
      candidate = JSON.parse(input)
    } catch {
      return failure('invalid-json', ['Profile is not valid JSON'])
    }
  }

  const inspection = inspectPortableDepth(candidate)
  if (!inspection.valid) {
    return failure(inspection.code, [inspection.issue])
  }
  const forbiddenSecretField = findForbiddenSecretField(candidate)
  if (forbiddenSecretField) {
    return failure('secret-field-forbidden', [
      `${forbiddenSecretField}: secret fields are forbidden in portable profiles`
    ])
  }

  const parsed = profileEnvelopeSchema.safeParse(candidate)
  if (!parsed.success) {
    return failure(
      'invalid-profile',
      parsed.error.issues.map(
        issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`
      )
    )
  }

  if (typeof input !== 'string') {
    const encoded = JSON.stringify(parsed.data)
    if (encoder.encode(encoded).byteLength > MAX_PORTABLE_PROFILE_BYTES) {
      return failure('payload-too-large', [
        `Profile exceeds ${MAX_PORTABLE_PROFILE_BYTES} UTF-8 bytes`
      ])
    }
  }

  return {
    success: true,
    data: parsed.data
  } satisfies ProfileEnvelopeParseResult
}
