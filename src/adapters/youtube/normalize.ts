import type { YouTubeCandidate } from '@/adapters/youtube/types'
import type { ContentItem } from '@/core/content/contracts'

const youtubeWatchOrigin = 'https://www.youtube.com/watch'

export function normalizeYouTubeCandidate(
  candidate: YouTubeCandidate,
  observedAt: string
): ContentItem {
  const stableVideoId =
    candidate.videoIdentity.status === 'stable'
      ? candidate.videoIdentity.platformContentId
      : undefined
  const stableChannelId =
    candidate.channelIdentity.status === 'stable'
      ? candidate.channelIdentity.channelId
      : undefined

  return {
    id: stableVideoId
      ? `youtube:video:${stableVideoId}`
      : `youtube:page:${candidate.pageInstanceId}`,
    platform: 'youtube',
    identity: candidate.videoIdentity,
    ...(stableVideoId
      ? { canonicalUrl: `${youtubeWatchOrigin}?v=${stableVideoId}` }
      : {}),
    surface: `youtube:${candidate.surface}`,
    ...(candidate.title ? { title: candidate.title } : {}),
    ...(stableChannelId
      ? {
          channel: {
            platform: 'youtube',
            channelId: stableChannelId,
            displayName: stableChannelId
          }
        }
      : {}),
    media: [],
    observedAt,
    context: {
      durableChannelActions: candidate.durableChannelActions,
      durableVideoActions: candidate.durableVideoActions,
      policyScope: candidate.policyScope
    }
  }
}
