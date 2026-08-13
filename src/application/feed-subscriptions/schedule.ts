import {
  MAX_RSS_GLOBAL_CONCURRENCY,
  type RssAcquisitionResult,
  type RssSubscription
} from '@/adapters/rss'

const MINIMUM_FAILURE_BACKOFF_MS = 15 * 60 * 1_000
const MAXIMUM_FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1_000

export function nextRssAttemptAt(input: {
  consecutiveFailures: number
  intervalMinutes: number
  now: Date
  retryAfterMs?: number
  jitter?: () => number
}): string {
  const jitter = Math.min(1, Math.max(0, input.jitter?.() ?? 0.5))
  const localDelay =
    input.consecutiveFailures === 0
      ? input.intervalMinutes * 60 * 1_000
      : Math.min(
          MAXIMUM_FAILURE_BACKOFF_MS,
          MINIMUM_FAILURE_BACKOFF_MS *
            2 ** Math.min(16, input.consecutiveFailures - 1)
        ) *
        (0.9 + jitter * 0.2)
  const delay = Math.max(localDelay, input.retryAfterMs ?? 0)
  return new Date(input.now.getTime() + delay).toISOString()
}

export type RssScheduledAcquisition = {
  subscription: RssSubscription
  signal?: AbortSignal
}

type Acquire = (input: RssScheduledAcquisition) => Promise<RssAcquisitionResult>

export class RssAcquisitionQueue {
  readonly #acquire: Acquire
  readonly #concurrency: number
  readonly #pending: Array<{
    controller: AbortController
    input: RssScheduledAcquisition
    resolve(result: RssAcquisitionResult): void
  }> = []
  readonly #inflight = new Map<string, Promise<RssAcquisitionResult>>()
  readonly #activeControllers = new Map<string, AbortController>()
  #active = 0

  constructor(options: { acquire: Acquire; concurrency?: number }) {
    this.#acquire = options.acquire
    this.#concurrency = options.concurrency ?? MAX_RSS_GLOBAL_CONCURRENCY
    if (
      this.#concurrency < 1 ||
      this.#concurrency > MAX_RSS_GLOBAL_CONCURRENCY
    ) {
      throw new RangeError('RSS concurrency is outside the supported range')
    }
  }

  schedule(input: RssScheduledAcquisition): Promise<RssAcquisitionResult> {
    const existing = this.#inflight.get(input.subscription.feedId)
    if (existing) {
      return existing
    }
    let resolvePromise: (result: RssAcquisitionResult) => void = () => undefined
    const completion = new Promise<RssAcquisitionResult>(resolve => {
      resolvePromise = resolve
    })
    const controller = new AbortController()
    this.#inflight.set(input.subscription.feedId, completion)
    this.#pending.push({ controller, input, resolve: resolvePromise })
    this.#drain()
    return completion
  }

  cancel(feedId: string) {
    const pendingIndex = this.#pending.findIndex(
      ({ input }) => input.subscription.feedId === feedId
    )
    if (pendingIndex >= 0) {
      const [work] = this.#pending.splice(pendingIndex, 1)
      this.#inflight.delete(feedId)
      work?.resolve({
        state: 'failed',
        feedId,
        code: 'aborted',
        durationMs: 0
      })
      return true
    }
    const controller = this.#activeControllers.get(feedId)
    if (!controller) {
      return false
    }
    controller.abort()
    return true
  }

  snapshot() {
    return {
      active: this.#active,
      pending: this.#pending.length,
      inflight: this.#inflight.size
    }
  }

  #drain() {
    while (this.#active < this.#concurrency && this.#pending.length > 0) {
      const work = this.#pending.shift()
      if (!work) {
        break
      }
      this.#active += 1
      const feedId = work.input.subscription.feedId
      this.#activeControllers.set(feedId, work.controller)
      void this.#acquire({ ...work.input, signal: work.controller.signal })
        .catch(
          (): RssAcquisitionResult => ({
            state: 'failed',
            feedId: work.input.subscription.feedId,
            code: 'unexpected-failure',
            durationMs: 0
          })
        )
        .then(work.resolve)
        .finally(() => {
          this.#active -= 1
          this.#activeControllers.delete(feedId)
          this.#inflight.delete(feedId)
          this.#drain()
        })
    }
  }
}
