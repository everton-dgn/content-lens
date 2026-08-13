import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'

export const ASSISTANCE_DISMISS_COOLDOWN_DAYS = 30
export const ASSISTANCE_SUPPRESSION_THRESHOLD = 3

export const proposalSuppressionRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fingerprint: nonEmptyStringSchema.max(256),
  evidenceVersion: nonEmptyStringSchema.max(128),
  dismissalCount: z.int().nonnegative(),
  lastDismissedAt: isoTimestampSchema.nullable(),
  cooldownUntil: isoTimestampSchema.nullable(),
  suppressed: z.boolean(),
  reactivatedAt: isoTimestampSchema.nullable()
})

export type ProposalSuppressionRecord = z.infer<
  typeof proposalSuppressionRecordSchema
>

export type ProposalSuppressionRepository = {
  read(fingerprint: string): Promise<unknown | undefined>
  write(record: ProposalSuppressionRecord): Promise<void>
}

function cooldownUntil(at: Date) {
  return new Date(
    at.getTime() + ASSISTANCE_DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1_000
  ).toISOString()
}

export class ProposalSuppressionService {
  readonly #repository: ProposalSuppressionRepository

  constructor(repository: ProposalSuppressionRepository) {
    this.#repository = repository
  }

  async status(input: {
    fingerprint: string
    evidenceVersion: string
    at: string
  }) {
    const at = isoTimestampSchema.parse(input.at)
    const current = proposalSuppressionRecordSchema.safeParse(
      await this.#repository.read(input.fingerprint)
    )
    if (
      !current.success ||
      current.data.evidenceVersion !== input.evidenceVersion
    ) {
      return { state: 'allowed' as const, dismissalCount: 0 }
    }
    if (current.data.suppressed) {
      return {
        state: 'suppressed' as const,
        dismissalCount: current.data.dismissalCount
      }
    }
    if (
      current.data.cooldownUntil &&
      Date.parse(current.data.cooldownUntil) > Date.parse(at)
    ) {
      return {
        state: 'cooldown' as const,
        dismissalCount: current.data.dismissalCount,
        until: current.data.cooldownUntil
      }
    }
    return {
      state: 'allowed' as const,
      dismissalCount: current.data.dismissalCount
    }
  }

  async dismiss(input: {
    fingerprint: string
    evidenceVersion: string
    at: string
  }) {
    const at = new Date(isoTimestampSchema.parse(input.at))
    const current = proposalSuppressionRecordSchema.safeParse(
      await this.#repository.read(input.fingerprint)
    )
    const previousCount =
      current.success &&
      current.data.evidenceVersion === input.evidenceVersion &&
      !current.data.reactivatedAt
        ? current.data.dismissalCount
        : 0
    const dismissalCount = previousCount + 1
    const record = proposalSuppressionRecordSchema.parse({
      schemaVersion: 1,
      fingerprint: input.fingerprint,
      evidenceVersion: input.evidenceVersion,
      dismissalCount,
      lastDismissedAt: at.toISOString(),
      cooldownUntil: cooldownUntil(at),
      suppressed: dismissalCount >= ASSISTANCE_SUPPRESSION_THRESHOLD,
      reactivatedAt: null
    })
    await this.#repository.write(record)
    return structuredClone(record)
  }

  async reactivate(input: {
    fingerprint: string
    evidenceVersion: string
    at: string
  }) {
    const record = proposalSuppressionRecordSchema.parse({
      schemaVersion: 1,
      fingerprint: input.fingerprint,
      evidenceVersion: input.evidenceVersion,
      dismissalCount: 0,
      lastDismissedAt: null,
      cooldownUntil: null,
      suppressed: false,
      reactivatedAt: input.at
    })
    await this.#repository.write(record)
    return structuredClone(record)
  }
}
