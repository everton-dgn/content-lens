import { z } from 'zod'

import {
  MAX_RSS_FEEDS,
  type RssSubscription,
  rssSubscriptionSchema
} from '@/adapters/rss'
import type { PortableSettings } from '@/storage/contracts/profile-envelope'

export const RSS_SUBSCRIPTIONS_SETTINGS_KEY = 'rssSubscriptions'

export const rssSubscriptionsSchema = z
  .array(rssSubscriptionSchema)
  .max(MAX_RSS_FEEDS)
  .superRefine((subscriptions, context) => {
    const feedIds = new Set<string>()
    const urls = new Set<string>()
    subscriptions.forEach((subscription, index) => {
      if (feedIds.has(subscription.feedId)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate RSS feed ID',
          path: [index, 'feedId']
        })
      }
      if (urls.has(subscription.url)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate RSS feed URL',
          path: [index, 'url']
        })
      }
      feedIds.add(subscription.feedId)
      urls.add(subscription.url)
    })
  })

export function readRssSubscriptions(
  settings: PortableSettings
): RssSubscription[] {
  const parsed = rssSubscriptionsSchema.safeParse(
    settings[RSS_SUBSCRIPTIONS_SETTINGS_KEY]
  )
  return parsed.success ? structuredClone(parsed.data) : []
}

export function writeRssSubscriptions(
  settings: PortableSettings,
  subscriptions: readonly RssSubscription[]
): PortableSettings {
  return {
    ...settings,
    [RSS_SUBSCRIPTIONS_SETTINGS_KEY]:
      rssSubscriptionsSchema.parse(subscriptions)
  }
}
