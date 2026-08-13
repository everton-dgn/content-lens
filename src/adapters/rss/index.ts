export { rssNativeFeedbackAddendum } from '@/adapters/rss/native-feedback'
export { parseRssFeed, RssParseError } from '@/adapters/rss/parser'
export {
  isForbiddenRssHostname,
  type RssSubscriptionUrlResult,
  validateRssSubscriptionUrl
} from '@/adapters/rss/routes'
export {
  DEFAULT_RSS_INTERVAL_MINUTES,
  MAX_RSS_ENTRIES_PER_RESPONSE,
  MAX_RSS_FEEDS,
  MAX_RSS_GLOBAL_CONCURRENCY,
  MAX_RSS_RECENT_ENTRIES_PER_FEED,
  MAX_RSS_RESPONSE_BYTES,
  MAX_RSS_TOTAL_ENTRIES,
  MINIMUM_RSS_INTERVAL_MINUTES,
  type ParsedRssFeed,
  RSS_ACQUISITION_ERROR_CODES,
  type RssAcquisitionErrorCode,
  type RssAcquisitionResult,
  type RssFeedFormat,
  type RssRuntimeState,
  type RssSubscription,
  rssFeedIdSchema,
  rssRuntimeStateSchema,
  rssSubscriptionSchema
} from '@/adapters/rss/types'

export const rssAdapterCapabilities = {
  fields: ['identity', 'title', 'body', 'media', 'published-at', 'context'],
  nativeFeedback: 'unavailable',
  platform: 'rss',
  surfaces: ['feed-entry']
} as const
