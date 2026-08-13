import type { LinkedInCandidate } from '@/adapters/linkedin/types'
import type { ContentItem } from '@/core/content/contracts'

export function normalizeLinkedInCandidate(
  candidate: LinkedInCandidate,
  observedAt: string
): ContentItem {
  const stablePostId =
    candidate.identity.status === 'stable'
      ? candidate.identity.platformContentId
      : undefined
  const stableAuthorId =
    candidate.authorIdentity.status === 'stable'
      ? candidate.authorIdentity.authorId
      : undefined

  return {
    id: stablePostId
      ? `linkedin:post:${stablePostId}`
      : `linkedin:page:${candidate.pageInstanceId}`,
    platform: 'linkedin',
    identity: candidate.identity,
    ...(candidate.canonicalUrl ? { canonicalUrl: candidate.canonicalUrl } : {}),
    surface: `linkedin:${candidate.surface}`,
    ...(candidate.text ? { body: candidate.text } : {}),
    ...(stableAuthorId && candidate.authorDisplayName
      ? {
          author: {
            platform: 'linkedin',
            authorId: stableAuthorId,
            displayName: candidate.authorDisplayName,
            ...(candidate.authorProfileUrl
              ? { profileUrl: candidate.authorProfileUrl }
              : {})
          }
        }
      : {}),
    media: candidate.media,
    observedAt,
    context: {
      durableAuthorActions: candidate.durableAuthorActions,
      durablePostActions: candidate.durablePostActions,
      textPartial: candidate.textPartial,
      promoted: candidate.traits.includes('promoted'),
      ...(candidate.relationTargetId
        ? { repostTargetId: candidate.relationTargetId }
        : {})
    }
  }
}
