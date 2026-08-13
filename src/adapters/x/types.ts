import type { ContentIdentity, MediaReference } from '@/core/content/contracts'

export const X_SURFACES = [
  'following',
  'for-you',
  'replies',
  'quoted-posts',
  'threads'
] as const

export type XSurface = (typeof X_SURFACES)[number]

export type XRelation = {
  kind: 'reply' | 'quote' | 'repost' | 'thread-parent' | 'thread-root'
  targetId: string
}

export type XAuthorIdentity =
  | { status: 'stable'; authorId: string }
  | { status: 'ephemeral'; reason: 'not-exposed' | 'invalid' }

export type XCandidate = {
  authorDisplayName?: string
  authorIdentity: XAuthorIdentity
  authorProfileUrl?: string
  canonicalUrl?: string
  domId: string
  durableAuthorActions: boolean
  durablePostActions: boolean
  identity: ContentIdentity
  media: MediaReference[]
  pageInstanceId: string
  promoted: boolean
  relations: XRelation[]
  surface: XSurface
  text: string
  textPartial: boolean
}
