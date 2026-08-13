export {
  extractHackerNewsCandidate,
  hackerNewsCandidateFingerprint,
  readHackerNewsCandidateSource
} from '@/adapters/hacker-news/extract'
export { hackerNewsNativeFeedbackAddendum } from '@/adapters/hacker-news/native-feedback'
export { normalizeHackerNewsCandidate } from '@/adapters/hacker-news/normalize'
export { observeHackerNewsCandidates } from '@/adapters/hacker-news/observe'
export { matchHackerNewsLocation } from '@/adapters/hacker-news/routes'
export {
  HACKER_NEWS_SURFACES,
  type HackerNewsCandidate,
  type HackerNewsSurface
} from '@/adapters/hacker-news/types'

import { HACKER_NEWS_SURFACES } from '@/adapters/hacker-news/types'

export const hackerNewsAdapterCapabilities = {
  fields: ['identity', 'title', 'author', 'context'],
  nativeFeedback: 'unavailable',
  platform: 'hacker-news',
  surfaces: HACKER_NEWS_SURFACES
} as const
