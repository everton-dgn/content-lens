export type NativeCircuitSnapshot = {
  state: 'closed' | 'open'
  failures: number
  adapterVersion: string
  openedAt?: number
  reason?: string
}

type CircuitRecord = NativeCircuitSnapshot & { failureTimes: number[] }

export class NativeFeedbackCircuitBreaker {
  readonly #records = new Map<string, CircuitRecord>()
  readonly #windowMs: number
  readonly #threshold: number

  constructor(options: { windowMs?: number; threshold?: number } = {}) {
    this.#windowMs = options.windowMs ?? 10 * 60 * 1_000
    this.#threshold = options.threshold ?? 3
  }

  allow(key: string, adapterVersion: string): boolean {
    const record = this.#records.get(key)
    if (!record) return true
    if (record.adapterVersion !== adapterVersion) {
      this.#records.delete(key)
      return true
    }
    return record.state === 'closed'
  }

  contractFailure(
    key: string,
    adapterVersion: string,
    reason: string,
    at: number
  ) {
    const prior = this.#records.get(key)
    const failureTimes =
      prior?.adapterVersion === adapterVersion
        ? prior.failureTimes.filter(time => at - time <= this.#windowMs)
        : []
    failureTimes.push(at)
    const open = failureTimes.length >= this.#threshold
    this.#records.set(key, {
      state: open ? 'open' : 'closed',
      failures: failureTimes.length,
      adapterVersion,
      failureTimes,
      ...(open ? { openedAt: at, reason } : {})
    })
  }

  contractSuccess(key: string, adapterVersion: string) {
    const record = this.#records.get(key)
    if (
      !record ||
      record.adapterVersion !== adapterVersion ||
      record.state === 'open'
    ) {
      return
    }
    this.#records.set(key, {
      state: 'closed',
      failures: 0,
      adapterVersion,
      failureTimes: []
    })
  }

  selfTestSucceeded(key: string, adapterVersion: string) {
    this.#records.set(key, {
      state: 'closed',
      failures: 0,
      adapterVersion,
      failureTimes: []
    })
  }

  snapshot(key: string, adapterVersion: string): NativeCircuitSnapshot {
    const record = this.#records.get(key)
    if (!record || record.adapterVersion !== adapterVersion) {
      return { state: 'closed', failures: 0, adapterVersion }
    }
    const { failureTimes: _failureTimes, ...snapshot } = record
    return structuredClone(snapshot)
  }
}
