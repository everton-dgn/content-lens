import type { XCandidate } from '@/adapters/x/types'
import type { ContentItem } from '@/core/content/contracts'

export function normalizeXCandidate(
  candidate: XCandidate,
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
      ? `x:post:${stablePostId}`
      : `x:page:${candidate.pageInstanceId}`,
    platform: 'x',
    identity: candidate.identity,
    ...(candidate.canonicalUrl ? { canonicalUrl: candidate.canonicalUrl } : {}),
    surface: `x:${candidate.surface}`,
    ...(candidate.text ? { body: candidate.text } : {}),
    ...(stableAuthorId && candidate.authorDisplayName
      ? {
          author: {
            platform: 'x',
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
      promoted: candidate.promoted,
      relationCount: candidate.relations.length,
      relationCodes: candidate.relations
        .map(({ kind, targetId }) => `${kind}:${targetId}`)
        .join(','),
      textPartial: candidate.textPartial
    }
  }
}
