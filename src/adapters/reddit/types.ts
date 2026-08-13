import type { ContentIdentity, MediaReference } from '@/core/content/contracts'

export const REDDIT_SURFACES = [
  'home',
  'popular',
  'all',
  'subreddit',
  'search',
  'comments'
] as const

export type RedditSurface = (typeof REDDIT_SURFACES)[number]

export type RedditRelation = {
  kind: 'crosspost' | 'reply' | 'thread-parent' | 'thread-root'
  targetId: string
}

export type RedditStableIdentity =
  | { status: 'stable'; value: string }
  | { status: 'ephemeral'; reason: 'not-exposed' | 'invalid' }

export type RedditCandidate = {
  authorDisplayName?: string
  authorIdentity: RedditStableIdentity
  body: string
  bodyPartial: boolean
  canonicalUrl?: string
  domId: string
  durableAuthorActions: boolean
  durableItemActions: boolean
  durableSubredditActions: boolean
  identity: ContentIdentity
  media: MediaReference[]
  pageInstanceId: string
  postFlair?: string
  promoted: boolean
  relations: RedditRelation[]
  subredditDisplayName?: string
  subredditIdentity: RedditStableIdentity
  surface: RedditSurface
  title?: string
  userFlair?: string
}
