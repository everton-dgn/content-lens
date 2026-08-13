import { z } from 'zod'

import { type ContentItem, isoTimestampSchema } from '@/core/content/contracts'

export const MAX_RSS_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_RSS_ENTRIES_PER_RESPONSE = 500
export const MAX_RSS_FEEDS = 100
export const MAX_RSS_RECENT_ENTRIES_PER_FEED = 100
export const MAX_RSS_TOTAL_ENTRIES = 10_000
export const DEFAULT_RSS_INTERVAL_MINUTES = 60
export const MINIMUM_RSS_INTERVAL_MINUTES = 15
export const MAX_RSS_GLOBAL_CONCURRENCY = 5

export const rssFeedIdSchema = z
  .string()
  .regex(
    /^rss-feed:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  )

export const rssSubscriptionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  feedId: rssFeedIdSchema,
  url: z.url({ protocol: /^https$/u }),
  origin: z.url({ protocol: /^https$/u }),
  state: z.enum(['active', 'paused']),
  intervalMinutes: z
    .int()
    .min(MINIMUM_RSS_INTERVAL_MINUTES)
    .max(24 * 60),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  lastValidatedAt: isoTimestampSchema.optional()
})

export type RssSubscription = z.infer<typeof rssSubscriptionSchema>

export type RssAcquisitionErrorCode =
  | 'aborted'
  | 'active-xml-forbidden'
  | 'content-type-unsupported'
  | 'dns-address-forbidden'
  | 'dns-api-unavailable'
  | 'dns-validation-failed'
  | 'document-too-large'
  | 'host-permission-missing'
  | 'invalid-xml'
  | 'redirect-invalid'
  | 'redirect-limit'
  | 'response-too-large'
  | 'status-failed'
  | 'unexpected-failure'
  | 'unsupported-feed'
  | 'url-invalid'

export const RSS_ACQUISITION_ERROR_CODES = [
  'aborted',
  'active-xml-forbidden',
  'content-type-unsupported',
  'dns-address-forbidden',
  'dns-api-unavailable',
  'dns-validation-failed',
  'document-too-large',
  'host-permission-missing',
  'invalid-xml',
  'redirect-invalid',
  'redirect-limit',
  'response-too-large',
  'status-failed',
  'unexpected-failure',
  'unsupported-feed',
  'url-invalid'
] as const satisfies readonly RssAcquisitionErrorCode[]

export const rssRuntimeStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  feedId: rssFeedIdSchema,
  state: z.enum([
    'idle',
    'scheduled',
    'fetching',
    'ready',
    'failed',
    'unavailable',
    'removed'
  ]),
  consecutiveFailures: z.int().nonnegative(),
  updatedAt: isoTimestampSchema,
  lastAttemptAt: isoTimestampSchema.optional(),
  nextAttemptAt: isoTimestampSchema.optional(),
  code: z.enum(RSS_ACQUISITION_ERROR_CODES).optional(),
  retryAfterUntil: isoTimestampSchema.optional(),
  statusClass: z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']).optional()
})

export type RssRuntimeState = z.infer<typeof rssRuntimeStateSchema>

export type RssAcquisitionResult =
  | {
      state: 'ready'
      feedId: string
      entries: number
      format: RssFeedFormat
      redirects: number
      truncated: boolean
      durationMs: number
      statusClass: '2xx'
    }
  | {
      state: 'failed' | 'unavailable'
      feedId: string
      code: RssAcquisitionErrorCode
      durationMs: number
      retryAfterMs?: number
      statusClass?: `${1 | 2 | 3 | 4 | 5}xx`
    }
  | {
      state: 'skipped'
      feedId: string
      code: 'subscription-paused'
      durationMs: 0
    }

export type RssFeedFormat = 'atom' | 'rdf' | 'rss'

export type ParsedRssFeed = {
  entries: ContentItem[]
  format: RssFeedFormat
  truncated: boolean
}
