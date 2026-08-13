import type { HackerNewsCandidate } from '@/adapters/hacker-news/types'
import type { ContentItem } from '@/core/content/contracts'

const hackerNewsOrigin = 'https://news.ycombinator.com'

export function normalizeHackerNewsCandidate(
  candidate: HackerNewsCandidate,
  observedAt: string
): ContentItem {
  const itemId =
    candidate.identity.status === 'stable'
      ? candidate.identity.platformContentId
      : undefined
  const canonicalUrl = itemId ? new URL('/item', hackerNewsOrigin) : undefined
  canonicalUrl?.searchParams.set('id', itemId ?? '')

  return {
    id: itemId
      ? `hacker-news:story:${itemId}`
      : `hacker-news:page:${candidate.pageInstanceId}`,
    platform: 'hacker-news',
    identity: candidate.identity,
    ...(canonicalUrl ? { canonicalUrl: canonicalUrl.href } : {}),
    surface: `hacker-news:${candidate.surface}`,
    ...(candidate.title ? { title: candidate.title } : {}),
    media: [],
    observedAt,
    context: {
      age: candidate.age ?? '',
      authorDisplayName: candidate.authorDisplayName ?? '',
      commentCount: candidate.commentCount ?? 0,
      destinationHost: candidate.destinationHost ?? '',
      destinationUrl: candidate.destinationUrl ?? '',
      durableItemActions: candidate.durableItemActions,
      points: candidate.points ?? 0
    }
  }
}
