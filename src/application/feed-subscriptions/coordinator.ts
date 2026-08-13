import type {
  RssAcquisitionResult,
  RssRuntimeState,
  RssSubscription
} from '@/adapters/rss'
import {
  nextRssAttemptAt,
  type RssAcquisitionQueue
} from '@/application/feed-subscriptions/schedule'

export type RssRuntimePersistence = {
  read(): Promise<RssRuntimeState[]>
  write(state: RssRuntimeState): Promise<void>
}

export class RssRuntimeCoordinator {
  readonly #queue: RssAcquisitionQueue
  readonly #persistence: RssRuntimePersistence
  readonly #now: () => Date
  readonly #jitter: () => number

  constructor(options: {
    queue: RssAcquisitionQueue
    persistence: RssRuntimePersistence
    now?: () => Date
    jitter?: () => number
  }) {
    this.#queue = options.queue
    this.#persistence = options.persistence
    this.#now = options.now ?? (() => new Date())
    this.#jitter = options.jitter ?? Math.random
  }

  async run(subscription: RssSubscription): Promise<RssAcquisitionResult> {
    if (subscription.state === 'paused') {
      return {
        state: 'skipped',
        feedId: subscription.feedId,
        code: 'subscription-paused',
        durationMs: 0
      }
    }
    const attemptedAt = this.#now()
    const previous = (await this.#persistence.read()).find(
      ({ feedId }) => feedId === subscription.feedId
    )
    await this.#persistence.write({
      schemaVersion: 1,
      feedId: subscription.feedId,
      state: 'fetching',
      consecutiveFailures: previous?.consecutiveFailures ?? 0,
      updatedAt: attemptedAt.toISOString(),
      lastAttemptAt: attemptedAt.toISOString()
    })
    const result = await this.#queue.schedule({ subscription })
    await this.#persistence.write(
      this.#stateAfter(subscription, previous, result, attemptedAt)
    )
    return result
  }

  cancel(feedId: string) {
    return this.#queue.cancel(feedId)
  }

  async runDue(subscriptions: readonly RssSubscription[]) {
    const now = this.#now()
    const states = new Map(
      (await this.#persistence.read()).map(state => [state.feedId, state])
    )
    const due = subscriptions.filter(subscription => {
      if (subscription.state !== 'active') {
        return false
      }
      const nextAttemptAt = states.get(subscription.feedId)?.nextAttemptAt
      return !nextAttemptAt || Date.parse(nextAttemptAt) <= now.getTime()
    })
    return Promise.all(due.map(subscription => this.run(subscription)))
  }

  #stateAfter(
    subscription: RssSubscription,
    previous: RssRuntimeState | undefined,
    result: RssAcquisitionResult,
    attemptedAt: Date
  ): RssRuntimeState {
    const updatedAt = this.#now()
    if (result.state === 'ready') {
      return {
        schemaVersion: 1,
        feedId: subscription.feedId,
        state: 'ready',
        consecutiveFailures: 0,
        updatedAt: updatedAt.toISOString(),
        lastAttemptAt: attemptedAt.toISOString(),
        nextAttemptAt: nextRssAttemptAt({
          consecutiveFailures: 0,
          intervalMinutes: subscription.intervalMinutes,
          now: updatedAt,
          jitter: this.#jitter
        }),
        statusClass: '2xx'
      }
    }
    if (result.state === 'unavailable') {
      return {
        schemaVersion: 1,
        feedId: subscription.feedId,
        state: 'unavailable',
        consecutiveFailures: previous?.consecutiveFailures ?? 0,
        updatedAt: updatedAt.toISOString(),
        lastAttemptAt: attemptedAt.toISOString(),
        nextAttemptAt: nextRssAttemptAt({
          consecutiveFailures: 0,
          intervalMinutes: subscription.intervalMinutes,
          now: updatedAt,
          jitter: this.#jitter
        }),
        code: result.code
      }
    }
    if (result.state === 'skipped') {
      return {
        schemaVersion: 1,
        feedId: subscription.feedId,
        state: 'idle',
        consecutiveFailures: previous?.consecutiveFailures ?? 0,
        updatedAt: updatedAt.toISOString()
      }
    }
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1
    return {
      schemaVersion: 1,
      feedId: subscription.feedId,
      state: 'failed',
      consecutiveFailures,
      updatedAt: updatedAt.toISOString(),
      lastAttemptAt: attemptedAt.toISOString(),
      nextAttemptAt: nextRssAttemptAt({
        consecutiveFailures,
        intervalMinutes: subscription.intervalMinutes,
        now: updatedAt,
        ...(result.retryAfterMs !== undefined
          ? { retryAfterMs: result.retryAfterMs }
          : {}),
        jitter: this.#jitter
      }),
      code: result.code,
      ...(result.retryAfterMs !== undefined
        ? {
            retryAfterUntil: new Date(
              updatedAt.getTime() + result.retryAfterMs
            ).toISOString()
          }
        : {}),
      ...(result.statusClass ? { statusClass: result.statusClass } : {})
    }
  }
}
