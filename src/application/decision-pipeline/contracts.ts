import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'

export type DecisionWorkPriority =
  | 'committed-intent'
  | 'deterministic-visible'
  | 'optional-visible'
  | 'optional-offscreen'

export const decisionWorkBindingSchema = z.strictObject({
  contentId: nonEmptyStringSchema,
  pageInstanceId: nonEmptyStringSchema,
  profileRevision: z.int().nonnegative(),
  capabilityVersion: nonEmptyStringSchema,
  adapterVersion: nonEmptyStringSchema,
  policyVersion: nonEmptyStringSchema
})

export type DecisionWorkBinding = z.infer<typeof decisionWorkBindingSchema>

export const operationStateSchema = z.enum([
  'pending',
  'committed',
  'partial',
  'cancelled',
  'unavailable',
  'failed'
])

export type DecisionWorkCheckpoint = {
  workId: string
  operationId?: string
  capability: string
  optional: boolean
  priority: DecisionWorkPriority
  binding: DecisionWorkBinding
  attempt: number
}

export type DecisionWorkInput<Value> = Omit<
  DecisionWorkCheckpoint,
  'attempt'
> & {
  attempt?: number
  run(signal: AbortSignal): Value | Promise<Value>
}

export type DecisionWorkOutcome<Value> =
  | {
      state: 'committed'
      value: Value
      attempts: number
    }
  | {
      state: 'cancelled'
      committedEffects: readonly string[]
    }
  | {
      state: 'shed'
      reason: 'overload'
      attempts: number
    }
  | {
      state: 'discarded'
      reason: 'stale-binding'
      attempts: number
    }
  | {
      state: 'failed'
      code: string
      retryable: boolean
      attempts: number
    }

export type DecisionWorkFailureKind = 'transient' | 'permanent'

export type OperationState = z.infer<typeof operationStateSchema>

export class DecisionWorkError extends Error {
  readonly kind: DecisionWorkFailureKind
  readonly code: string

  constructor(kind: DecisionWorkFailureKind, code: string) {
    super(code)
    this.name = 'DecisionWorkError'
    this.kind = kind
    this.code = code
  }
}
