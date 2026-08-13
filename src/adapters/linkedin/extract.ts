import { linkedInSelectors } from '@/adapters/linkedin/selectors'
import type {
  LinkedInAuthorIdentity,
  LinkedInCandidate,
  LinkedInSurface
} from '@/adapters/linkedin/types'
import {
  MAX_CONTENT_BODY_LENGTH,
  type MediaReference
} from '@/core/content/contracts'

const linkedInOrigin = 'https://www.linkedin.com'
const postIdPattern = /^urn:li:(?:activity|share|ugcPost):[0-9]{1,32}$/u
const authorIdPattern = /^urn:li:(?:member|fsd_profile):[A-Za-z0-9_-]{1,128}$/u

type LinkedInCandidateSource = {
  authorDisplayName?: string
  authorId: string | null
  authorReason: 'not-exposed' | 'invalid'
  authorProfileUrl?: string
  canonicalUrl?: string
  media: MediaReference[]
  postId: string | null
  postReason: 'not-exposed' | 'invalid'
  relationTargetId?: string
  surface: LinkedInSurface
  text: string
  textPartial: boolean
  traits: Array<'promoted'>
}

const validLinkedInUrl = (value: string | null): URL | undefined => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value, linkedInOrigin)
    return url.origin === linkedInOrigin && url.protocol === 'https:'
      ? url
      : undefined
  } catch {
    return undefined
  }
}

const mediaFrom = (element: Element): MediaReference[] => {
  const media: MediaReference[] = []
  for (const image of element.querySelectorAll<HTMLImageElement>(
    linkedInSelectors.media
  )) {
    try {
      const url = new URL(image.getAttribute('src') ?? '', linkedInOrigin)
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== ''
      ) {
        continue
      }
      const width = Number(image.getAttribute('width'))
      const height = Number(image.getAttribute('height'))
      media.push({
        kind: 'image',
        url: url.href,
        ...(Number.isInteger(width) && width > 0 ? { width } : {}),
        ...(Number.isInteger(height) && height > 0 ? { height } : {})
      })
    } catch {
      // Invalid platform media stays inside the adapter boundary.
    }
  }
  return media
}

const surfaceFrom = (
  element: Element,
  defaultSurface: LinkedInSurface
): LinkedInSurface => {
  if (element.getAttribute('data-contentlens-surface') === 'comment-preview') {
    return 'comment-preview'
  }
  if (element.getAttribute('data-contentlens-promoted') === 'true') {
    return 'promoted-posts'
  }
  if (element.hasAttribute('data-contentlens-repost-of')) {
    return 'reposts'
  }
  return defaultSurface
}

export function readLinkedInCandidateSource(
  element: Element,
  defaultSurface: LinkedInSurface = 'feed'
): LinkedInCandidateSource {
  const rawPostId = element.getAttribute('data-urn')
  const postId = rawPostId && postIdPattern.test(rawPostId) ? rawPostId : null
  const authorElement = element.querySelector(linkedInSelectors.author)
  const rawAuthorId = authorElement?.getAttribute('data-author-id') ?? null
  const authorId =
    rawAuthorId && authorIdPattern.test(rawAuthorId) ? rawAuthorId : null
  const rawRelationTarget = element.getAttribute('data-contentlens-repost-of')
  const relationTargetId =
    rawRelationTarget && postIdPattern.test(rawRelationTarget)
      ? rawRelationTarget
      : undefined
  const textElement = element.querySelector(linkedInSelectors.text)
  const rawText = textElement?.textContent?.trim() ?? ''
  const canonical = validLinkedInUrl(
    element
      .querySelector<HTMLAnchorElement>(linkedInSelectors.canonicalLink)
      ?.getAttribute('href') ?? null
  )
  const authorProfile = validLinkedInUrl(
    authorElement?.getAttribute('href') ?? null
  )
  const promoted = element.getAttribute('data-contentlens-promoted') === 'true'

  return {
    ...(authorElement?.textContent?.trim()
      ? { authorDisplayName: authorElement.textContent.trim().slice(0, 256) }
      : {}),
    authorId,
    authorReason: rawAuthorId ? 'invalid' : 'not-exposed',
    ...(authorProfile ? { authorProfileUrl: authorProfile.href } : {}),
    ...(canonical ? { canonicalUrl: canonical.href } : {}),
    media: mediaFrom(element),
    postId,
    postReason: rawPostId ? 'invalid' : 'not-exposed',
    ...(relationTargetId ? { relationTargetId } : {}),
    surface: surfaceFrom(element, defaultSurface),
    text: rawText.slice(0, MAX_CONTENT_BODY_LENGTH),
    textPartial:
      textElement?.getAttribute('data-contentlens-expanded') === 'false' ||
      rawText.length > MAX_CONTENT_BODY_LENGTH,
    traits: promoted ? ['promoted'] : []
  }
}

export const linkedInCandidateFingerprint = (
  source: LinkedInCandidateSource
): string =>
  JSON.stringify([
    source.postId ?? source.postReason,
    source.authorId ?? source.authorReason,
    source.surface,
    source.text,
    source.textPartial,
    source.canonicalUrl,
    source.relationTargetId,
    source.traits,
    source.media
  ])

const authorIdentityFrom = (
  source: LinkedInCandidateSource
): LinkedInAuthorIdentity =>
  source.authorId
    ? { status: 'stable', authorId: source.authorId }
    : { status: 'ephemeral', reason: source.authorReason }

export function extractLinkedInCandidate(
  _element: Element,
  pageInstanceId: string,
  domId: string,
  source: LinkedInCandidateSource
): LinkedInCandidate {
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
    ...(source.relationTargetId
      ? { relationTargetId: source.relationTargetId }
      : {}),
    surface: source.surface,
    text: source.text,
    textPartial: source.textPartial,
    traits: source.traits
  }
}
