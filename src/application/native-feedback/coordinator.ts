import { NativeFeedbackCircuitBreaker } from '@/application/native-feedback/circuit-breaker'
import {
  isTrustedUserGesture,
  type TrustedUserGesture
} from '@/application/native-feedback/gesture'
import {
  NATIVE_MINIMUM_COOLDOWN_MS,
  type NativeFeedbackActivation,
  type NativeFeedbackAttempt,
  type NativeFeedbackCapability,
  type NativeFeedbackRevalidation,
  nativeFeedbackAttemptSchema,
  nativeFeedbackReviewSchema
} from '@/core/feedback/native-contracts'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'

export type NativeFeedbackAttemptStore = {
  get(attemptId: string): Promise<NativeFeedbackAttempt | undefined>
  put(attempt: NativeFeedbackAttempt): Promise<void>
  cancelPending?(at: string): Promise<number>
  list?(at: string): Promise<NativeFeedbackAttempt[]>
}

export type NativeFeedbackAdapterPort = {
  capability(input: {
    platform: NativeFeedbackAttempt['platform']
    surface: string
    actionType: NativeFeedbackAttempt['actionType']
  }): NativeFeedbackCapability
  revalidate(
    attempt: NativeFeedbackAttempt
  ): Promise<NativeFeedbackRevalidation>
  activate(attempt: NativeFeedbackAttempt): Promise<NativeFeedbackActivation>
}

type OfferInput = {
  localCommitState: 'committed'
  operationId: string
  attemptId: string
  platform: NativeFeedbackAttempt['platform']
  surface: string
  platformContentId: string
  pageInstanceId: string
  actionType: NativeFeedbackAttempt['actionType']
  actionLabel: string
  scope: string
  consequence: string
  targetFingerprint: string
  now: string
  priorAttemptId?: string
}

const circuitKey = (
  attempt: Pick<NativeFeedbackAttempt, 'platform' | 'surface' | 'actionType'>
) => `${attempt.platform}\u0000${attempt.surface}\u0000${attempt.actionType}`

const latencyBucket = (
  elapsedMs: number
): NativeFeedbackAttempt['latencyBucket'] =>
  elapsedMs < 25
    ? 'under-25ms'
    : elapsedMs <= 50
      ? '25-50ms'
      : elapsedMs <= 100
        ? '51-100ms'
        : 'over-100ms'

export class NativeFeedbackCoordinator {
  readonly #store: NativeFeedbackAttemptStore
  readonly #adapter: NativeFeedbackAdapterPort
  readonly #breaker: NativeFeedbackCircuitBreaker
  readonly #inFlight = new Map<string, Promise<NativeFeedbackAttempt>>()
  #enabled: boolean

  constructor(input: {
    store: NativeFeedbackAttemptStore
    adapter: NativeFeedbackAdapterPort
    breaker?: NativeFeedbackCircuitBreaker
    enabled?: boolean
  }) {
    this.#store = input.store
    this.#adapter = input.adapter
    this.#breaker = input.breaker ?? new NativeFeedbackCircuitBreaker()
    this.#enabled = input.enabled ?? false
  }

  async offer(input: OfferInput): Promise<NativeFeedbackAttempt> {
    if (input.localCommitState !== 'committed') {
      throw new TypeError(
        'Native feedback requires a committed local operation'
      )
    }
    const existing = await this.#store.get(input.attemptId)
    if (existing) return existing
    const capability = this.#adapter.capability(input)
    const review = nativeFeedbackReviewSchema.parse({
      platform: input.platform,
      surface: input.surface,
      platformContentId: input.platformContentId,
      pageInstanceId: input.pageInstanceId,
      actionType: input.actionType,
      actionLabel: input.actionLabel,
      scope: input.scope,
      consequence: input.consequence,
      reversibility: capability.reversibility,
      targetFingerprint: input.targetFingerprint,
      reviewedAt: input.now
    })
    const capabilityMatches =
      capability.platform === input.platform &&
      capability.surface === input.surface &&
      capability.actionType === input.actionType &&
      capability.actionLabelPatterns.includes(input.actionLabel)
    const allowed =
      this.#enabled &&
      capabilityMatches &&
      capability.state === 'supported' &&
      capability.lastLiveSmokeAt !== null &&
      this.#breaker.allow(circuitKey(input), capability.adapterVersion)
    const state = allowed
      ? 'pending-review'
      : capability.state === 'cooldown'
        ? 'cooldown'
        : 'unavailable'
    const attempt = nativeFeedbackAttemptSchema.parse({
      attemptId: input.attemptId,
      operationId: input.operationId,
      platform: input.platform,
      surface: input.surface,
      platformContentId: input.platformContentId,
      pageInstanceId: input.pageInstanceId,
      actionType: input.actionType,
      targetFingerprint: input.targetFingerprint,
      adapterVersion: capability.adapterVersion,
      addendumVersion: capability.addendumVersion,
      state,
      review,
      createdAt: input.now,
      updatedAt: input.now,
      ...(input.priorAttemptId ? { priorAttemptId: input.priorAttemptId } : {}),
      ...(!allowed ? { terminalReason: capability.code } : {})
    })
    await this.#store.put(attempt)
    return attempt
  }

  async reviewFingerprint(attemptId: string): Promise<string | undefined> {
    const attempt = await this.#store.get(attemptId)
    return attempt ? fingerprintPortableValue(attempt.review) : undefined
  }

  async submit(
    attemptId: string,
    gesture: TrustedUserGesture | unknown,
    now: string
  ): Promise<NativeFeedbackAttempt> {
    const active = this.#inFlight.get(attemptId)
    if (active) return active
    const execution = this.#submitOnce(attemptId, gesture, now).finally(() => {
      this.#inFlight.delete(attemptId)
    })
    this.#inFlight.set(attemptId, execution)
    return execution
  }

  async #submitOnce(
    attemptId: string,
    gesture: TrustedUserGesture | unknown,
    now: string
  ) {
    const attempt = await this.#store.get(attemptId)
    if (!attempt) throw new Error('Native feedback attempt was not found')
    if (attempt.state === 'submitting') {
      return this.#finish(attempt, 'uncertain', now, 'worker-interrupted')
    }
    if (attempt.state !== 'pending-review') return attempt
    const reviewFingerprint = await fingerprintPortableValue(attempt.review)
    if (
      !this.#enabled ||
      !isTrustedUserGesture(gesture) ||
      gesture.attemptId !== attemptId ||
      gesture.reviewFingerprint !== reviewFingerprint ||
      Date.parse(gesture.occurredAt) < Date.parse(attempt.review.reviewedAt)
    ) {
      return this.#finish(attempt, 'rejected', now, 'trusted-gesture-required')
    }
    const capability = this.#adapter.capability(attempt)
    const key = circuitKey(attempt)
    if (
      capability.state !== 'supported' ||
      capability.lastLiveSmokeAt === null ||
      !this.#breaker.allow(key, attempt.adapterVersion)
    ) {
      return this.#finish(attempt, 'unavailable', now, 'capability-unavailable')
    }
    const submitting = {
      ...attempt,
      state: 'submitting' as const,
      updatedAt: now
    }
    await this.#store.put(submitting)
    let revalidation: NativeFeedbackRevalidation
    try {
      revalidation = await this.#adapter.revalidate(submitting)
    } catch {
      return this.#finish(
        submitting,
        'uncertain',
        now,
        'revalidation-interrupted'
      )
    }
    if (revalidation.state === 'invalid') {
      this.#breaker.contractFailure(
        key,
        attempt.adapterVersion,
        revalidation.code,
        Date.parse(now)
      )
      const terminal =
        revalidation.code === 'timeout' ? 'uncertain' : 'cancelled'
      return this.#finish(
        { ...submitting, latencyBucket: latencyBucket(revalidation.elapsedMs) },
        terminal,
        now,
        revalidation.code
      )
    }
    const matches =
      revalidation.platform === attempt.platform &&
      revalidation.surface === attempt.surface &&
      revalidation.platformContentId === attempt.platformContentId &&
      revalidation.pageInstanceId === attempt.pageInstanceId &&
      revalidation.actionType === attempt.actionType &&
      revalidation.actionLabel === attempt.review.actionLabel &&
      revalidation.targetFingerprint === attempt.targetFingerprint
    if (!matches) {
      this.#breaker.contractFailure(
        key,
        attempt.adapterVersion,
        'review-changed',
        Date.parse(now)
      )
      return this.#finish(submitting, 'cancelled', now, 'review-changed')
    }
    this.#breaker.contractSuccess(key, attempt.adapterVersion)
    let result: NativeFeedbackActivation
    try {
      result = await this.#adapter.activate(submitting)
    } catch {
      return this.#finish(
        submitting,
        'uncertain',
        now,
        'activation-interrupted'
      )
    }
    const base = {
      ...submitting,
      latencyBucket: latencyBucket(revalidation.elapsedMs),
      activatedAt: now
    }
    if (result.state === 'verified') {
      return this.#finish(
        {
          ...base,
          verificationMethod: result.verificationMethod,
          evidenceAt: result.evidenceAt
        },
        'submitted',
        now,
        'positive-evidence'
      )
    }
    if (result.state === 'cooldown') {
      const duration = Math.max(
        NATIVE_MINIMUM_COOLDOWN_MS,
        result.retryAfterMs ?? 0
      )
      return this.#finish(
        {
          ...base,
          cooldownUntil: new Date(Date.parse(now) + duration).toISOString()
        },
        'cooldown',
        now,
        result.code
      )
    }
    return this.#finish(base, result.state, now, result.code)
  }

  async #finish(
    attempt: NativeFeedbackAttempt,
    state: Extract<
      NativeFeedbackAttempt['state'],
      | 'submitted'
      | 'rejected'
      | 'unavailable'
      | 'uncertain'
      | 'cancelled'
      | 'cooldown'
    >,
    at: string,
    reason: string
  ) {
    const terminal = nativeFeedbackAttemptSchema.parse({
      ...attempt,
      state,
      updatedAt: at,
      terminalReason: reason
    })
    await this.#store.put(terminal)
    return terminal
  }

  async setEnabled(enabled: boolean, at: string) {
    this.#enabled = enabled
    if (enabled) return
    await this.#store.cancelPending?.(at)
    // Durable stores implement bulk cancellation; callers can also cancel loaded offers.
    const pending = [...this.#inFlight.keys()]
    await Promise.all(
      pending.map(async attemptId => {
        const attempt = await this.#store.get(attemptId)
        if (attempt?.state === 'pending-review') {
          await this.#finish(attempt, 'cancelled', at, 'feature-disabled')
        }
      })
    )
  }

  async recoverInterrupted(at: string) {
    const attempts = (await this.#store.list?.(at)) ?? []
    let recovered = 0
    for (const attempt of attempts) {
      if (attempt.state !== 'submitting') continue
      await this.#finish(attempt, 'uncertain', at, 'worker-interrupted')
      recovered += 1
    }
    return recovered
  }

  async retryOffer(
    priorAttemptId: string,
    input: Omit<OfferInput, 'priorAttemptId'>
  ) {
    const prior = await this.#store.get(priorAttemptId)
    if (
      !prior ||
      !['rejected', 'unavailable', 'uncertain', 'cooldown'].includes(
        prior.state
      ) ||
      input.attemptId === priorAttemptId
    ) {
      throw new TypeError(
        'Manual retry requires a terminal prior attempt and a new attempt ID'
      )
    }
    return this.offer({ ...input, priorAttemptId })
  }
}
