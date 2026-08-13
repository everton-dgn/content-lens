export type CircuitBreakerOptions = {
  failureThreshold: number
  cooldownMs: number
}

export type CircuitSnapshot =
  | {
      state: 'closed'
      failures: number
      lastTransitionAt: number | null
    }
  | {
      state: 'open'
      failures: number
      reason: string
      retryAt: number
      retryCondition: 'cooldown-elapsed'
      lastTransitionAt: number
    }
  | {
      state: 'half-open'
      failures: number
      reason: string
      retryAt: number
      retryCondition: 'probe-success'
      lastTransitionAt: number
    }

type CircuitRecord = {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  reason?: string
  retryAt?: number
  lastTransitionAt: number | null
}

export class CapabilityCircuitBreaker {
  readonly #options: CircuitBreakerOptions
  readonly #circuits = new Map<string, CircuitRecord>()

  constructor(options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1 || options.cooldownMs < 1) {
      throw new Error('Circuit thresholds must be positive')
    }
    this.#options = options
  }

  allow(capability: string, at: number) {
    const circuit = this.#circuits.get(capability)
    if (!circuit || circuit.state === 'closed') {
      return true
    }
    if (circuit.state === 'half-open') {
      return false
    }
    if ((circuit.retryAt ?? Number.POSITIVE_INFINITY) > at) {
      return false
    }
    circuit.state = 'half-open'
    circuit.lastTransitionAt = at
    return true
  }

  success(capability: string, at: number) {
    const circuit = this.#circuits.get(capability)
    if (!circuit) {
      return
    }
    circuit.state = 'closed'
    circuit.failures = 0
    circuit.reason = undefined
    circuit.retryAt = undefined
    circuit.lastTransitionAt = at
  }

  failure(capability: string, reason: string, at: number) {
    const circuit = this.#circuits.get(capability) ?? {
      state: 'closed' as const,
      failures: 0,
      lastTransitionAt: null
    }
    circuit.failures += 1
    circuit.reason = reason
    if (
      circuit.state === 'half-open' ||
      circuit.failures >= this.#options.failureThreshold
    ) {
      circuit.state = 'open'
      circuit.retryAt = at + this.#options.cooldownMs
      circuit.lastTransitionAt = at
    }
    this.#circuits.set(capability, circuit)
  }

  incompleteProbe(capability: string, reason: string, at: number) {
    const circuit = this.#circuits.get(capability)
    if (circuit?.state !== 'half-open') {
      return
    }
    circuit.state = 'open'
    circuit.reason = reason
    circuit.retryAt = at + this.#options.cooldownMs
    circuit.lastTransitionAt = at
  }

  snapshot(capability: string): CircuitSnapshot {
    const circuit = this.#circuits.get(capability)
    if (!circuit || circuit.state === 'closed') {
      return {
        state: 'closed',
        failures: circuit?.failures ?? 0,
        lastTransitionAt: circuit?.lastTransitionAt ?? null
      }
    }
    if (circuit.state === 'half-open') {
      return {
        state: 'half-open',
        failures: circuit.failures,
        reason: circuit.reason ?? 'capability-failed',
        retryAt: circuit.retryAt ?? 0,
        retryCondition: 'probe-success',
        lastTransitionAt: circuit.lastTransitionAt ?? 0
      }
    }
    return {
      state: 'open',
      failures: circuit.failures,
      reason: circuit.reason ?? 'capability-failed',
      retryAt: circuit.retryAt ?? 0,
      retryCondition: 'cooldown-elapsed',
      lastTransitionAt: circuit.lastTransitionAt ?? 0
    }
  }
}
