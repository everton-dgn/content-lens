export {
  extractYouTubeCandidate,
  extractYouTubeCandidates
} from '@/adapters/youtube/extract'
export { youtubeNativeFeedbackAddendum } from '@/adapters/youtube/native-feedback'
export { normalizeYouTubeCandidate } from '@/adapters/youtube/normalize'
export { observeYouTubeCandidates } from '@/adapters/youtube/observe'
export { matchYouTubeLocation } from '@/adapters/youtube/routes'
export type {
  YouTubeAdapterCapabilities,
  YouTubeCandidate,
  YouTubeChannelIdentity,
  YouTubeExtractionContext,
  YouTubeObservationError,
  YouTubeObservationHandle,
  YouTubeObservationOptions,
  YouTubePolicyScope,
  YouTubeSurface,
  YouTubeSurfaceCapability,
  YouTubeVideoIdentity
} from '@/adapters/youtube/types'

import type {
  YouTubeAdapterCapabilities,
  YouTubeSurface,
  YouTubeSurfaceCapability
} from '@/adapters/youtube/types'
import { YOUTUBE_SURFACES } from '@/adapters/youtube/types'

export const youtubeAdapterCapabilities = {
  fields: ['videoId', 'channelId', 'title'],
  platform: 'youtube',
  surfaces: YOUTUBE_SURFACES
} as const satisfies YouTubeAdapterCapabilities

export const youtubeSurfaceCapabilities = {
  home: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  search: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'explicit-search'
  },
  recommendations: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  subscriptions: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  shorts: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  channel: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  playlist: {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  },
  'end-screen': {
    durableIdentityActions: ['video', 'channel'],
    fields: ['videoId', 'channelId', 'title'],
    policyScope: 'passive-recommendation'
  }
} as const satisfies Record<YouTubeSurface, YouTubeSurfaceCapability>
