export const YOUTUBE_SURFACES = [
  'home',
  'search',
  'recommendations',
  'subscriptions',
  'shorts',
  'channel',
  'playlist',
  'end-screen'
] as const

export type YouTubeSurface = (typeof YOUTUBE_SURFACES)[number]

export type YouTubePolicyScope = 'explicit-search' | 'passive-recommendation'

export type YouTubeIdentityReason = 'not-exposed' | 'invalid'

export type YouTubeVideoIdentity =
  | {
      status: 'stable'
      platformContentId: string
    }
  | {
      status: 'ephemeral'
      pageInstanceId: string
      reason: YouTubeIdentityReason
    }

export type YouTubeChannelIdentity =
  | {
      status: 'stable'
      channelId: string
    }
  | {
      status: 'ephemeral'
      reason: YouTubeIdentityReason
    }

export interface YouTubeCandidate {
  channelIdentity: YouTubeChannelIdentity
  diagnosticReason?:
    | 'channel-id-not-exposed'
    | 'channel-id-invalid'
    | 'video-id-not-exposed'
    | 'video-id-invalid'
  domId: string
  durableChannelActions: boolean
  durableVideoActions: boolean
  pageInstanceId: string
  policyScope: YouTubePolicyScope
  surface: YouTubeSurface
  title: string
  videoIdentity: YouTubeVideoIdentity
}

export interface YouTubeExtractionContext {
  pageInstanceId: string
  surface: YouTubeSurface
}

export interface YouTubeAdapterCapabilities {
  fields: readonly ['videoId', 'channelId', 'title']
  platform: 'youtube'
  surfaces: typeof YOUTUBE_SURFACES
}

export interface YouTubeSurfaceCapability {
  durableIdentityActions: readonly ['video', 'channel']
  fields: readonly ['videoId', 'channelId', 'title']
  policyScope: YouTubePolicyScope
}

export type YouTubeObservationErrorReason =
  | 'candidate-consumer-failed'
  | 'candidate-extraction-failed'

export interface YouTubeObservationError {
  reason: YouTubeObservationErrorReason
  surface: YouTubeSurface
}

export interface YouTubeObservationOptions extends YouTubeExtractionContext {
  onCandidate(candidate: YouTubeCandidate, element: Element): void
  onError?(error: YouTubeObservationError): void
}

export interface YouTubeObservationHandle {
  applyIfCurrent(
    element: Element,
    pageInstanceId: string,
    apply: () => void
  ): boolean
  disconnect(): void
  isCurrent(element: Element, pageInstanceId: string): boolean
  scan(): void
}
