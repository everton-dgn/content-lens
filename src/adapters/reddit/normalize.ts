import type { RedditCandidate } from '@/adapters/reddit/types'
import type { ContentItem } from '@/core/content/contracts'

export function normalizeRedditCandidate(
  candidate: RedditCandidate,
  observedAt: string
): ContentItem {
  const itemId =
    candidate.identity.status === 'stable'
      ? candidate.identity.platformContentId
      : undefined
  const authorId =
    candidate.authorIdentity.status === 'stable'
      ? candidate.authorIdentity.value
      : undefined
  const subredditId =
    candidate.subredditIdentity.status === 'stable'
      ? candidate.subredditIdentity.value
      : undefined
  return {
    id: itemId
      ? `reddit:item:${itemId}`
      : `reddit:page:${candidate.pageInstanceId}`,
    platform: 'reddit',
    identity: candidate.identity,
    ...(candidate.canonicalUrl ? { canonicalUrl: candidate.canonicalUrl } : {}),
    surface: `reddit:${candidate.surface}`,
    ...(candidate.title ? { title: candidate.title } : {}),
    ...(candidate.body ? { body: candidate.body } : {}),
    ...(authorId && candidate.authorDisplayName
      ? {
          author: {
            platform: 'reddit',
            authorId,
            displayName: candidate.authorDisplayName
          }
        }
      : {}),
    ...(subredditId && candidate.subredditDisplayName
      ? {
          channel: {
            platform: 'reddit',
            channelId: subredditId,
            displayName: candidate.subredditDisplayName
          }
        }
      : {}),
    media: candidate.media,
    observedAt,
    context: {
      bodyPartial: candidate.bodyPartial,
      durableAuthorActions: candidate.durableAuthorActions,
      durableItemActions: candidate.durableItemActions,
      durableSubredditActions: candidate.durableSubredditActions,
      postFlair: candidate.postFlair ?? '',
      promoted: candidate.promoted,
      relationCodes: candidate.relations
        .map(({ kind, targetId }) => `${kind}:${targetId}`)
        .join(','),
      userFlair: candidate.userFlair ?? ''
    }
  }
}
