const FAILURE_WINDOW_MS = 5 * 60 * 1_000
const OPEN_DURATION_MS = 60 * 1_000
const FAILURE_THRESHOLD = 5

type CircuitState = {
  failures: number[]
  openedAt?: number
  probeInFlight: boolean
}

export class RouteCircuitBreaker {
  readonly #states = new Map<string, CircuitState>()

  recordTemporaryFailure(routeKey: string, at: number) {
    const current = this.#states.get(routeKey) ?? {
      failures: [],
      probeInFlight: false
    }
    const failures = current.failures.filter(
      failureAt => at - failureAt <= FAILURE_WINDOW_MS
    )
    failures.push(at)
    const openedAt =
      failures.length >= FAILURE_THRESHOLD ? at : current.openedAt
    this.#states.set(routeKey, {
      failures,
      ...(openedAt === undefined ? {} : { openedAt }),
      probeInFlight: false
    })
  }

  recordSuccess(routeKey: string) {
    this.#states.delete(routeKey)
  }

  acquire(
    routeKey: string,
    at: number
  ):
    | { allowed: true; state: 'closed'; probe: false }
    | { allowed: true; state: 'half-open'; probe: true }
    | {
        allowed: false
        state: 'open' | 'half-open'
        retryAt?: number
      } {
    const current = this.#states.get(routeKey)
    if (!current?.openedAt) {
      return { allowed: true, state: 'closed', probe: false }
    }
    const retryAt = current.openedAt + OPEN_DURATION_MS
    if (at < retryAt) {
      return { allowed: false, state: 'open', retryAt }
    }
    if (current.probeInFlight) {
      return { allowed: false, state: 'half-open' }
    }
    current.probeInFlight = true
    return { allowed: true, state: 'half-open', probe: true }
  }
}
