import type { BudgetPolicy } from '@/ai/models/contracts'

type Reservation = {
  reservationId: string
  providerConfigId: string
  executionKind: 'local' | 'browser' | 'cloud'
  at: number
  estimatedCost: number
  periodKey: string
}

type ReserveInput = {
  providerConfigId: string
  executionKind: 'local' | 'browser' | 'cloud'
  at: number
  estimatedCost?: number
  priceVerifiedAt?: number
}

type BudgetBlockCode =
  | 'global-concurrency'
  | 'provider-concurrency'
  | 'provider-rate'
  | 'provider-daily-quota'
  | 'monetary-budget-disabled'
  | 'monetary-budget-exhausted'
  | 'price-unavailable'
  | 'price-stale'

export class RoutingBudget {
  readonly #policy: BudgetPolicy
  readonly #timeZone: string
  readonly #reservations = new Map<string, Reservation>()
  readonly #minuteRequests = new Map<string, number[]>()
  readonly #dailyRequests = new Map<string, number>()
  readonly #dailySpend = new Map<string, number>()
  #sequence = 0

  constructor(policy: BudgetPolicy, options: { timeZone: string }) {
    this.#policy = structuredClone(policy)
    this.#timeZone = options.timeZone
    new Intl.DateTimeFormat('en-CA', { timeZone: this.#timeZone }).format(0)
  }

  reserve(
    input: ReserveInput
  ):
    | { state: 'reserved'; reservationId: string }
    | { state: 'blocked'; code: BudgetBlockCode } {
    const periodKey = this.#periodKey(input.at)
    const providerPeriodKey = `${input.providerConfigId}\u0000${periodKey}`
    if (input.executionKind === 'cloud') {
      const monetary = this.#monetaryCheck(input, providerPeriodKey)
      if (monetary) {
        return monetary
      }
    }

    if (this.#reservations.size >= this.#policy.maxConcurrentGlobal) {
      return { state: 'blocked', code: 'global-concurrency' }
    }
    const activeForProvider = [...this.#reservations.values()].filter(
      reservation => reservation.providerConfigId === input.providerConfigId
    ).length
    if (activeForProvider >= this.#policy.maxConcurrentByProvider) {
      return { state: 'blocked', code: 'provider-concurrency' }
    }

    const recent = (
      this.#minuteRequests.get(input.providerConfigId) ?? []
    ).filter(requestedAt => input.at - requestedAt < 60_000)
    this.#minuteRequests.set(input.providerConfigId, recent)
    if (recent.length >= this.#policy.requestsPerMinuteByProvider) {
      return { state: 'blocked', code: 'provider-rate' }
    }
    if (
      (this.#dailyRequests.get(providerPeriodKey) ?? 0) >=
      this.#policy.requestsPerDayByProvider
    ) {
      return { state: 'blocked', code: 'provider-daily-quota' }
    }

    const reservationId = `budget:${++this.#sequence}`
    this.#reservations.set(reservationId, {
      reservationId,
      providerConfigId: input.providerConfigId,
      executionKind: input.executionKind,
      at: input.at,
      estimatedCost: input.estimatedCost ?? 0,
      periodKey
    })
    return { state: 'reserved', reservationId }
  }

  commit(reservationId: string) {
    const reservation = this.#reservations.get(reservationId)
    if (!reservation) {
      return false
    }
    this.#reservations.delete(reservationId)
    const providerPeriodKey = `${reservation.providerConfigId}\u0000${reservation.periodKey}`
    const recent = this.#minuteRequests.get(reservation.providerConfigId) ?? []
    recent.push(reservation.at)
    this.#minuteRequests.set(reservation.providerConfigId, recent)
    this.#dailyRequests.set(
      providerPeriodKey,
      (this.#dailyRequests.get(providerPeriodKey) ?? 0) + 1
    )
    this.#dailySpend.set(
      providerPeriodKey,
      (this.#dailySpend.get(providerPeriodKey) ?? 0) + reservation.estimatedCost
    )
    return true
  }

  release(reservationId: string) {
    return this.#reservations.delete(reservationId)
  }

  #monetaryCheck(
    input: ReserveInput,
    providerPeriodKey: string
  ): { state: 'blocked'; code: BudgetBlockCode } | undefined {
    const monetary = this.#policy.monetaryBudget
    if (!monetary.enabled || monetary.limit === 0) {
      return { state: 'blocked', code: 'monetary-budget-disabled' }
    }
    if (
      input.estimatedCost === undefined ||
      input.priceVerifiedAt === undefined
    ) {
      return { state: 'blocked', code: 'price-unavailable' }
    }
    const priceAge = input.at - input.priceVerifiedAt
    if (priceAge > monetary.priceMaxAgeHours * 60 * 60 * 1_000) {
      return { state: 'blocked', code: 'price-stale' }
    }
    if (
      (this.#dailySpend.get(providerPeriodKey) ?? 0) + input.estimatedCost >
      monetary.limit
    ) {
      return { state: 'blocked', code: 'monetary-budget-exhausted' }
    }
    return undefined
  }

  #periodKey(at: number) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(at)
    const value = Object.fromEntries(
      parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value])
    )
    return `${value.year}-${value.month}-${value.day}@${this.#timeZone}`
  }
}
