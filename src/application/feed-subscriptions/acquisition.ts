import {
  type RssAcquisitionResult,
  type RssSubscription,
  rssSubscriptionSchema
} from '@/adapters/rss'

export type RssAcquisitionServiceOptions = {
  now?: () => Date
}

export class RssAcquisitionService {
  readonly #options: RssAcquisitionServiceOptions

  constructor(options: RssAcquisitionServiceOptions) {
    this.#options = options
  }

  async acquire(input: {
    subscription: RssSubscription
  }): Promise<RssAcquisitionResult> {
    const subscription = rssSubscriptionSchema.parse(input.subscription)
    if (subscription.state === 'paused') {
      return {
        state: 'skipped',
        feedId: subscription.feedId,
        code: 'subscription-paused',
        durationMs: 0
      }
    }
    const startedAt = (this.#options.now?.() ?? new Date()).getTime()
    const durationMs = () =>
      Math.max(0, (this.#options.now?.() ?? new Date()).getTime() - startedAt)
    return {
      state: 'unavailable',
      feedId: subscription.feedId,
      code: 'dns-api-unavailable',
      durationMs: durationMs()
    }
  }
}
