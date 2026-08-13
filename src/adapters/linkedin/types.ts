import type { ContentIdentity, MediaReference } from '@/core/content/contracts'

export const LINKEDIN_SURFACES = [
  'feed',
  'reposts',
  'promoted-posts',
  'comment-preview'
] as const

export type LinkedInSurface = (typeof LINKEDIN_SURFACES)[number]

export type LinkedInAuthorIdentity =
  | {
      status: 'stable'
      authorId: string
    }
  | {
      status: 'ephemeral'
      reason: 'not-exposed' | 'invalid'
    }

export type LinkedInCandidate = {
  authorDisplayName?: string
  authorIdentity: LinkedInAuthorIdentity
  authorProfileUrl?: string
  canonicalUrl?: string
  domId: string
  durableAuthorActions: boolean
  durablePostActions: boolean
  identity: ContentIdentity
  media: MediaReference[]
  pageInstanceId: string
  relationTargetId?: string
  surface: LinkedInSurface
  text: string
  textPartial: boolean
  traits: Array<'promoted'>
}

export type LinkedInObservationError = {
  reason: 'candidate-consumer-failed' | 'candidate-extraction-failed'
  surface: `linkedin:${LinkedInSurface}`
}
