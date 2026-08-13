import { z } from 'zod'

import {
  MAX_NATIVE_FEEDBACK_ATTEMPTS,
  NATIVE_PENDING_RETENTION_MS,
  NATIVE_TERMINAL_RETENTION_MS,
  type NativeFeedbackAttempt,
  nativeFeedbackAttemptSchema
} from '@/core/feedback/native-contracts'

export const NATIVE_FEEDBACK_STORE_NAMES = {
  attempts: 'nativeFeedbackAttempts',
  runtime: 'nativeFeedbackRuntime'
} as const

export const nativeFeedbackAttemptListSchema = z
  .array(nativeFeedbackAttemptSchema)
  .max(MAX_NATIVE_FEEDBACK_ATTEMPTS)

export function retainNativeFeedbackAttempts(
  attempts: readonly NativeFeedbackAttempt[],
  now: string
): NativeFeedbackAttempt[] {
  const timestamp = Date.parse(now)
  return attempts
    .filter(attempt => {
      const age = timestamp - Date.parse(attempt.updatedAt)
      return attempt.state === 'pending-review'
        ? age <= NATIVE_PENDING_RETENTION_MS
        : age <= NATIVE_TERMINAL_RETENTION_MS
    })
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.attemptId.localeCompare(right.attemptId)
    )
    .slice(0, MAX_NATIVE_FEEDBACK_ATTEMPTS)
    .map(attempt => structuredClone(attempt))
}
