import { xSelectors } from '@/adapters/x/selectors'
import type {
  XAuthorIdentity,
  XCandidate,
  XRelation,
  XSurface
} from '@/adapters/x/types'
import {
  MAX_CONTENT_BODY_LENGTH,
  type MediaReference
} from '@/core/content/contracts'

const xOrigin = 'https://x.com'
const postIdPattern = /^[1-9][0-9]{0,31}$/u
const authorIdPattern = /^[1-9][0-9]{0,31}$/u
type XCandidateSource = {
  authorDisplayName?: string
  authorId: string | null
  authorProfileUrl?: string
  authorReason: 'not-exposed' | 'invalid'
  canonicalUrl?: string
  media: MediaReference[]
  postId: string | null
  postReason: 'not-exposed' | 'invalid'
  promoted: boolean
  relations: XRelation[]
  surface: XSurface
  text: string
  textPartial: boolean
}

const validXUrl = (value: string | null): URL | undefined => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value, xOrigin)
    return url.origin === xOrigin && url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

const postIdFromUrl = (url: URL | undefined): string | null => {
  const match = url?.pathname.match(
    /^\/[A-Za-z0-9_]{1,64}\/status\/([0-9]{1,32})(?:\/.*)?$/u
  )
  const id = match?.[1] ?? null
  return id && postIdPattern.test(id) ? id : null
}

const relationAttributes = [
  ['data-contentlens-reply-to', 'reply'],
  ['data-contentlens-quote-of', 'quote'],
  ['data-contentlens-repost-of', 'repost'],
  ['data-contentlens-thread-parent', 'thread-parent'],
  ['data-contentlens-thread-root', 'thread-root']
] as const

const relationsFrom = (element: Element): XRelation[] =>
  relationAttributes.flatMap(([attribute, kind]) => {
    const targetId = element.getAttribute(attribute)
    return targetId && postIdPattern.test(targetId) ? [{ kind, targetId }] : []
  })

const quoteRelationFromLinks = (
  element: Element,
  ownPostId: string | null
): XRelation[] => {
  if (!ownPostId) {
    return []
  }
  const statusIds = new Set<string>()
  for (const link of element.querySelectorAll<HTMLAnchorElement>(
    xSelectors.canonicalLink
  )) {
    const id = postIdFromUrl(validXUrl(link.getAttribute('href')))
    if (id && id !== ownPostId) {
      statusIds.add(id)
    }
  }
  const quotedId = statusIds.values().next().value
  return quotedId ? [{ kind: 'quote', targetId: quotedId }] : []
}

const mediaFrom = (element: Element): MediaReference[] => {
  const media: MediaReference[] = []
  for (const image of element.querySelectorAll<HTMLImageElement>(
    xSelectors.image
  )) {
    try {
      const url = new URL(image.getAttribute('src') ?? '', xOrigin)
      if (url.protocol === 'https:' && !url.username && !url.password) {
        media.push({ kind: 'image', url: url.href })
      }
    } catch {
      // Invalid media stays inside the platform boundary.
    }
  }
  for (const video of element.querySelectorAll<HTMLVideoElement>(
    xSelectors.video
  )) {
    try {
      const url = new URL(video.getAttribute('poster') ?? '', xOrigin)
      if (url.protocol === 'https:' && !url.username && !url.password) {
        media.push({ kind: 'video-preview', url: url.href })
      }
    } catch {
      // Invalid media stays inside the platform boundary.
    }
  }
  return media
}

export function readXCandidateSource(
  element: Element,
  surface: XSurface
): XCandidateSource {
  const canonicalUrl = validXUrl(
    element
      .querySelector<HTMLAnchorElement>(xSelectors.canonicalLink)
      ?.getAttribute('href') ?? null
  )
  const postId = postIdFromUrl(canonicalUrl)
  const authorElement = element.querySelector(xSelectors.author)
  const rawAuthorId =
    authorElement?.getAttribute('data-contentlens-author-id') ?? null
  const authorId =
    rawAuthorId && authorIdPattern.test(rawAuthorId) ? rawAuthorId : null
  const visibleAuthorProfile = element.querySelector<HTMLAnchorElement>(
    xSelectors.authorProfile
  )
  const authorProfileUrl = validXUrl(
    authorElement?.getAttribute('href') ??
      visibleAuthorProfile?.getAttribute('href') ??
      null
  )
  const authorDisplayName =
    authorElement?.getAttribute('data-contentlens-author-name') ??
    element.querySelector(xSelectors.authorDisplay)?.textContent?.trim() ??
    undefined
  const textElement = element.querySelector(xSelectors.text)
  const rawText = textElement?.textContent?.trim() ?? ''

  const relations = [
    ...relationsFrom(element),
    ...quoteRelationFromLinks(element, postId)
  ]
  const inferredSurface = relations.some(({ kind }) => kind === 'quote')
    ? 'quoted-posts'
    : relations.some(({ kind }) => kind === 'reply')
      ? 'replies'
      : relations.some(
            ({ kind }) => kind === 'thread-parent' || kind === 'thread-root'
          )
        ? 'threads'
        : surface

  return {
    ...(authorDisplayName
      ? {
          authorDisplayName: authorDisplayName.slice(0, 256)
        }
      : {}),
    authorId,
    ...(authorProfileUrl ? { authorProfileUrl: authorProfileUrl.href } : {}),
    authorReason: rawAuthorId ? 'invalid' : 'not-exposed',
    ...(canonicalUrl ? { canonicalUrl: canonicalUrl.href } : {}),
    media: mediaFrom(element),
    postId,
    postReason: canonicalUrl ? 'invalid' : 'not-exposed',
    promoted: element.getAttribute('data-contentlens-promoted') === 'true',
    relations,
    surface: inferredSurface,
    text: rawText.slice(0, MAX_CONTENT_BODY_LENGTH),
    textPartial:
      textElement?.getAttribute('data-contentlens-expanded') === 'false' ||
      rawText.length > MAX_CONTENT_BODY_LENGTH
  }
}

export const xCandidateFingerprint = (source: XCandidateSource): string =>
  JSON.stringify(source)

const authorIdentityFrom = (source: XCandidateSource): XAuthorIdentity =>
  source.authorId
    ? { status: 'stable', authorId: source.authorId }
    : { status: 'ephemeral', reason: source.authorReason }

export function extractXCandidate(
  _element: Element,
  pageInstanceId: string,
  domId: string,
  source: XCandidateSource
): XCandidate {
  return {
    ...(source.authorDisplayName
      ? { authorDisplayName: source.authorDisplayName }
      : {}),
    authorIdentity: authorIdentityFrom(source),
    ...(source.authorProfileUrl
      ? { authorProfileUrl: source.authorProfileUrl }
      : {}),
    ...(source.canonicalUrl ? { canonicalUrl: source.canonicalUrl } : {}),
    domId,
    durableAuthorActions: source.authorId !== null,
    durablePostActions: source.postId !== null,
    identity: source.postId
      ? { status: 'stable', platformContentId: source.postId }
      : {
          status: 'ephemeral',
          pageInstanceId,
          reason: source.postReason
        },
    media: source.media,
    pageInstanceId,
    promoted: source.promoted,
    relations: source.relations,
    surface: source.surface,
    text: source.text,
    textPartial: source.textPartial
  }
}
