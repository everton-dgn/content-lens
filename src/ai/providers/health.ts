import { z } from 'zod'

import { modelTaskSchema } from '@/ai/models/contracts'
import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'

const healthRecordSchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  task: modelTaskSchema,
  status: z.enum([
    'ready',
    'degraded',
    'rate-limited',
    'unauthorized',
    'unavailable'
  ]),
  code: z.enum([
    'provider-ready',
    'provider-timeout',
    'provider-transport',
    'provider-rate-limited',
    'provider-unauthorized',
    'provider-output-invalid'
  ]),
  latencyMs: z.number().finite().nonnegative(),
  at: isoTimestampSchema
})

type HealthSnapshot = {
  providerConfigId: string
  task: z.infer<typeof modelTaskSchema>
  status: z.infer<typeof healthRecordSchema>['status']
  code: z.infer<typeof healthRecordSchema>['code']
  latencyMs: number
  updatedAt: string
  consecutiveFailures: number
}

function healthKey(providerConfigId: string, task: string) {
  return `${providerConfigId}\u0000${task}`
}

export class ProviderHealthTracker {
  readonly #health = new Map<string, HealthSnapshot>()

  record(input: z.input<typeof healthRecordSchema>) {
    const record = healthRecordSchema.parse(input)
    const key = healthKey(record.providerConfigId, record.task)
    const previous = this.#health.get(key)
    const snapshot: HealthSnapshot = {
      providerConfigId: record.providerConfigId,
      task: record.task,
      status: record.status,
      code: record.code,
      latencyMs: record.latencyMs,
      updatedAt: record.at,
      consecutiveFailures:
        record.status === 'ready' ? 0 : (previous?.consecutiveFailures ?? 0) + 1
    }
    this.#health.set(key, snapshot)
    return structuredClone(snapshot)
  }

  snapshot() {
    return [...this.#health.values()]
      .sort((left, right) =>
        healthKey(left.providerConfigId, left.task).localeCompare(
          healthKey(right.providerConfigId, right.task)
        )
      )
      .map(entry => structuredClone(entry))
  }
}
