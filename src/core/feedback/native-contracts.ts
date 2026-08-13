import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema
} from '@/core/content/contracts'

export const NATIVE_FEEDBACK_STATES = [
  'pending-review',
  'submitting',
  'submitted',
  'rejected',
  'unavailable',
  'uncertain',
  'cancelled',
  'cooldown'
] as const

export const NATIVE_FEEDBACK_ACTIONS = [
  'youtube:not-interested',
  'youtube:do-not-recommend-channel',
  'linkedin:reduce-similar',
  'x:not-interested-post',
  'reddit:show-less-similar'
] as const

export const nativeFeedbackStateSchema = z.enum(NATIVE_FEEDBACK_STATES)
export const nativeFeedbackActionSchema = z.enum(NATIVE_FEEDBACK_ACTIONS)

export const nativeFeedbackReversibilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('irreversible') }),
  z.strictObject({
    kind: z.literal('reversible'),
    undoLabelPattern: nonEmptyStringSchema
  })
])

export const nativeFeedbackReviewSchema = z.strictObject({
  platform: platformSchema,
  surface: nonEmptyStringSchema,
  platformContentId: nonEmptyStringSchema,
  pageInstanceId: nonEmptyStringSchema,
  actionType: nativeFeedbackActionSchema,
  actionLabel: nonEmptyStringSchema,
  scope: nonEmptyStringSchema,
  consequence: nonEmptyStringSchema,
  reversibility: nativeFeedbackReversibilitySchema,
  targetFingerprint: nonEmptyStringSchema,
  reviewedAt: isoTimestampSchema
})

export const nativeFeedbackAttemptSchema = z.strictObject({
  attemptId: nonEmptyStringSchema,
  operationId: nonEmptyStringSchema,
  platform: platformSchema,
  surface: nonEmptyStringSchema,
  platformContentId: nonEmptyStringSchema,
  pageInstanceId: nonEmptyStringSchema,
  actionType: nativeFeedbackActionSchema,
  targetFingerprint: nonEmptyStringSchema,
  adapterVersion: nonEmptyStringSchema,
  addendumVersion: nonEmptyStringSchema,
  state: nativeFeedbackStateSchema,
  review: nativeFeedbackReviewSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  priorAttemptId: nonEmptyStringSchema.optional(),
  terminalReason: nonEmptyStringSchema.optional(),
  verificationMethod: nonEmptyStringSchema.optional(),
  latencyBucket: z
    .enum(['under-25ms', '25-50ms', '51-100ms', 'over-100ms'])
    .optional(),
  activatedAt: isoTimestampSchema.optional(),
  evidenceAt: isoTimestampSchema.optional(),
  cooldownUntil: isoTimestampSchema.optional()
})

export const nativeFeedbackCapabilitySchema = z.strictObject({
  state: z.enum(['supported', 'unsupported', 'unavailable', 'cooldown']),
  platform: platformSchema,
  surface: nonEmptyStringSchema,
  actionType: nativeFeedbackActionSchema.optional(),
  adapterVersion: nonEmptyStringSchema,
  addendumVersion: nonEmptyStringSchema,
  code: nonEmptyStringSchema,
  actionLabelPatterns: z.array(nonEmptyStringSchema).max(8),
  targetIdentity: nonEmptyStringSchema,
  positiveEvidence: nonEmptyStringSchema,
  timeoutMs: z.int().positive().max(30_000),
  cooldownMs: z.int().positive(),
  reversibility: nativeFeedbackReversibilitySchema,
  selectors: z.array(nonEmptyStringSchema).max(16),
  fixtureVersion: nonEmptyStringSchema,
  lastLiveSmokeAt: isoTimestampSchema.nullable()
})

export const nativeFeedbackRevalidationSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('valid'),
    platform: platformSchema,
    surface: nonEmptyStringSchema,
    platformContentId: nonEmptyStringSchema,
    pageInstanceId: nonEmptyStringSchema,
    actionType: nativeFeedbackActionSchema,
    actionLabel: nonEmptyStringSchema,
    targetFingerprint: nonEmptyStringSchema,
    visible: z.literal(true),
    enabled: z.literal(true),
    nodeConnected: z.literal(true),
    elapsedMs: z.number().nonnegative()
  }),
  z.strictObject({
    state: z.literal('invalid'),
    code: z.enum([
      'identity-changed',
      'node-detached',
      'surface-changed',
      'label-changed',
      'control-hidden',
      'control-disabled',
      'page-instance-changed',
      'timeout'
    ]),
    elapsedMs: z.number().nonnegative()
  })
])

export const nativeFeedbackActivationSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('verified'),
    verificationMethod: nonEmptyStringSchema,
    evidenceAt: isoTimestampSchema
  }),
  z.strictObject({
    state: z.literal('rejected'),
    code: nonEmptyStringSchema
  }),
  z.strictObject({
    state: z.literal('cooldown'),
    code: nonEmptyStringSchema,
    retryAfterMs: z.int().positive().optional()
  }),
  z.strictObject({
    state: z.literal('uncertain'),
    code: nonEmptyStringSchema
  })
])

export const nativeFeedbackDiagnosticSchema = z.strictObject({
  platform: platformSchema,
  surface: nonEmptyStringSchema,
  actionType: nativeFeedbackActionSchema,
  adapterVersion: nonEmptyStringSchema,
  status: nativeFeedbackStateSchema,
  latencyBucket: z.enum(['under-25ms', '25-50ms', '51-100ms', 'over-100ms']),
  verificationMethod: nonEmptyStringSchema,
  circuitState: z.enum(['closed', 'open'])
})

export type NativeFeedbackAction = z.infer<typeof nativeFeedbackActionSchema>
export type NativeFeedbackAttempt = z.infer<typeof nativeFeedbackAttemptSchema>
export type NativeFeedbackCapability = z.infer<
  typeof nativeFeedbackCapabilitySchema
>
export type NativeFeedbackReview = z.infer<typeof nativeFeedbackReviewSchema>
export type NativeFeedbackRevalidation = z.infer<
  typeof nativeFeedbackRevalidationSchema
>
export type NativeFeedbackActivation = z.infer<
  typeof nativeFeedbackActivationSchema
>
export type NativeFeedbackDiagnostic = z.infer<
  typeof nativeFeedbackDiagnosticSchema
>

export const MAX_NATIVE_FEEDBACK_ATTEMPTS = 1_000
export const NATIVE_PENDING_RETENTION_MS = 24 * 60 * 60 * 1_000
export const NATIVE_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
export const NATIVE_MINIMUM_COOLDOWN_MS = 24 * 60 * 60 * 1_000
