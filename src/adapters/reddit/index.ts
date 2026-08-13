export {
  extractRedditCandidate,
  readRedditCandidateSource,
  redditCandidateFingerprint
} from '@/adapters/reddit/extract'
export { redditNativeFeedbackAddendum } from '@/adapters/reddit/native-feedback'
export { normalizeRedditCandidate } from '@/adapters/reddit/normalize'
export { observeRedditCandidates } from '@/adapters/reddit/observe'
export { matchRedditLocation } from '@/adapters/reddit/routes'
export { redditCandidateSelector } from '@/adapters/reddit/selectors'
export {
  REDDIT_SURFACES,
  type RedditCandidate,
  type RedditRelation,
  type RedditStableIdentity,
  type RedditSurface
} from '@/adapters/reddit/types'

import { REDDIT_SURFACES } from '@/adapters/reddit/types'

export const redditAdapterCapabilities = {
  fields: [
    'identity',
    'title',
    'body',
    'author',
    'channel',
    'media',
    'relations',
    'traits'
  ],
  platform: 'reddit',
  surfaces: REDDIT_SURFACES
} as const
