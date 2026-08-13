import {
  readRssSubscriptions,
  writeRssSubscriptions
} from '@/application/feed-subscriptions/profile'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type {
  OperationCommand,
  OperationResponse
} from '@/core/operations/journal'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'

type SubscriptionMutationResult = {
  feedId: string
}

const failure = (
  code: string,
  message: string,
  retryable = false
): OperationResponse<SubscriptionMutationResult> => ({
  state: 'failed',
  error: { code, message },
  retryable
})

export class FeedSubscriptionService {
  readonly #database: ContentLensDatabase

  constructor(options: { database: ContentLensDatabase }) {
    this.#database = options.database
  }

  async list() {
    const profile = await this.#database.exportProfile()
    return profile ? readRssSubscriptions(profile.settings) : []
  }

  async setPaused(input: {
    operationId: string
    expectedRevision: number
    feedId: string
    paused: boolean
    at: string
  }): Promise<OperationResponse<SubscriptionMutationResult>> {
    const operation = await this.#operation(input, 'rss.subscription.state', {
      expectedRevision: input.expectedRevision,
      feedId: input.feedId,
      paused: input.paused
    })
    const replay =
      await this.#database.readOperationResponse<SubscriptionMutationResult>(
        operation
      )
    if (replay) {
      return replay
    }
    const profile = await this.#database.exportProfile()
    if (
      !profile ||
      !readRssSubscriptions(profile.settings).some(
        ({ feedId }) => feedId === input.feedId
      )
    ) {
      return failure(
        'rss-subscription-not-found',
        'RSS subscription was not found'
      )
    }
    return this.#database.transactProfile(
      operation,
      input.expectedRevision,
      profile => ({
        profile: {
          ...profile,
          revision: profile.revision + 1,
          updatedAt: input.at,
          settings: writeRssSubscriptions(
            profile.settings,
            readRssSubscriptions(profile.settings).map(subscription =>
              subscription.feedId === input.feedId
                ? {
                    ...subscription,
                    state: input.paused ? 'paused' : 'active',
                    updatedAt: input.at
                  }
                : subscription
            )
          )
        },
        value: { feedId: input.feedId },
        effects: [
          { kind: 'rss.subscription.state-changed', targetId: input.feedId }
        ]
      })
    )
  }

  async remove(input: {
    operationId: string
    expectedRevision: number
    feedId: string
    confirmed: boolean
    at: string
  }): Promise<OperationResponse<SubscriptionMutationResult>> {
    if (!input.confirmed) {
      return failure(
        'rss-removal-confirmation-required',
        'RSS removal requires confirmation'
      )
    }
    const operation = await this.#operation(input, 'rss.subscription.remove', {
      expectedRevision: input.expectedRevision,
      feedId: input.feedId,
      confirmed: true
    })
    const replay =
      await this.#database.readOperationResponse<SubscriptionMutationResult>(
        operation
      )
    if (replay) {
      return replay
    }
    const profile = await this.#database.exportProfile()
    if (
      !profile ||
      !readRssSubscriptions(profile.settings).some(
        ({ feedId }) => feedId === input.feedId
      )
    ) {
      return failure(
        'rss-subscription-not-found',
        'RSS subscription was not found'
      )
    }
    const response = await this.#database.transactProfile(
      operation,
      input.expectedRevision,
      profile => ({
        profile: {
          ...profile,
          revision: profile.revision + 1,
          updatedAt: input.at,
          settings: writeRssSubscriptions(
            profile.settings,
            readRssSubscriptions(profile.settings).filter(
              ({ feedId }) => feedId !== input.feedId
            )
          )
        },
        value: { feedId: input.feedId },
        effects: [{ kind: 'rss.subscription.removed', targetId: input.feedId }]
      })
    )
    if (response.state === 'committed') {
      await this.#database.clearRssFeedData(input.feedId, input.at)
    }
    return response
  }

  async #operation(
    input: { operationId: string; at: string },
    type: string,
    target: unknown
  ): Promise<OperationCommand> {
    return {
      operationId: input.operationId,
      type,
      targetFingerprint: await fingerprintPortableValue(target),
      at: input.at
    }
  }
}
