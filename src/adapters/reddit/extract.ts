import { redditSelectors } from '@/adapters/reddit/selectors'
import type {
  RedditCandidate,
  RedditRelation,
  RedditStableIdentity,
  RedditSurface
} from '@/adapters/reddit/types'
import {
  MAX_CONTENT_BODY_LENGTH,
  MAX_CONTENT_TITLE_LENGTH,
  type MediaReference
} from '@/core/content/contracts'

const redditOrigin = 'https://www.reddit.com'
const itemIdPattern = /^t[13]_[A-Za-z0-9]{1,16}$/u
const actorIdPattern = /^t2_[A-Za-z0-9]{1,32}$/u
const subredditIdPattern = /^t5_[A-Za-z0-9]{1,32}$/u
type RedditCandidateSource = Omit<
  RedditCandidate,
  | 'authorIdentity'
  | 'domId'
  | 'durableAuthorActions'
  | 'durableItemActions'
  | 'durableSubredditActions'
  | 'identity'
  | 'pageInstanceId'
  | 'subredditIdentity'
> & {
  authorId: string | null
  authorReason: 'not-exposed' | 'invalid'
  itemId: string | null
  itemReason: 'not-exposed' | 'invalid'
  subredditId: string | null
  subredditReason: 'not-exposed' | 'invalid'
}

const validUrl = (value: string | null): URL | undefined => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value, redditOrigin)
    return url.protocol === 'https:' && url.origin === redditOrigin
      ? url
      : undefined
  } catch {
    return undefined
  }
}

const firstAttribute = (
  element: Element,
  names: readonly string[]
): string | null => {
  for (const name of names) {
    const value = element.getAttribute(name)
    if (value) {
      return value
    }
  }
  return null
}

const relationAttributes = [
  [['data-contentlens-crosspost-of', 'crosspost-root-id'], 'crosspost'],
  [['data-contentlens-reply-to', 'parentid'], 'reply'],
  [['data-contentlens-thread-parent'], 'thread-parent'],
  [['data-contentlens-thread-root', 'postid'], 'thread-root']
] as const

const relationsFrom = (element: Element): RedditRelation[] =>
  relationAttributes.flatMap(([attributes, kind]) => {
    const targetId = firstAttribute(element, attributes)
    return targetId && itemIdPattern.test(targetId) ? [{ kind, targetId }] : []
  })

const mediaFrom = (element: Element): MediaReference[] => {
  const media: MediaReference[] = []
  for (const image of element.querySelectorAll<HTMLImageElement>(
    redditSelectors.image
  )) {
    try {
      const url = new URL(image.getAttribute('src') ?? '', redditOrigin)
      if (url.protocol === 'https:' && !url.username && !url.password) {
        media.push({ kind: 'image', url: url.href })
      }
    } catch {
      // Invalid media stays inside the platform boundary.
    }
  }
  for (const video of element.querySelectorAll<HTMLVideoElement>(
    redditSelectors.video
  )) {
    try {
      const url = new URL(video.getAttribute('poster') ?? '', redditOrigin)
      if (url.protocol === 'https:' && !url.username && !url.password) {
        media.push({ kind: 'video-preview', url: url.href })
      }
    } catch {
      // Invalid media stays inside the platform boundary.
    }
  }
  return media
}

export function readRedditCandidateSource(
  element: Element,
  surface: RedditSurface
): RedditCandidateSource {
  const rawItemId =
    firstAttribute(element, ['data-contentlens-item-id', 'thingid']) ??
    (element.tagName === 'SHREDDIT-POST' ? element.getAttribute('id') : null)
  const itemId = rawItemId && itemIdPattern.test(rawItemId) ? rawItemId : null
  const authorElement = element.querySelector(redditSelectors.author)
  const rawAuthorId =
    authorElement?.getAttribute('data-contentlens-author-id') ??
    element.getAttribute('author-id')
  const authorId =
    rawAuthorId && actorIdPattern.test(rawAuthorId) ? rawAuthorId : null
  const subredditElement = element.querySelector(redditSelectors.subreddit)
  const rawSubredditId =
    subredditElement?.getAttribute('data-contentlens-subreddit-id') ??
    element.getAttribute('subreddit-id')
  const subredditId =
    rawSubredditId && subredditIdPattern.test(rawSubredditId)
      ? rawSubredditId
      : null
  const title =
    element.getAttribute('post-title')?.trim() ??
    element.querySelector(redditSelectors.title)?.textContent?.trim() ??
    ''
  const bodyElement = element.querySelector(redditSelectors.body)
  const rawBody = bodyElement?.textContent?.trim() ?? ''
  const canonicalUrl = validUrl(
    element.getAttribute('permalink') ??
      element
        .querySelector<HTMLAnchorElement>(redditSelectors.canonicalLink)
        ?.getAttribute('href') ??
      null
  )
  const authorDisplayName =
    authorElement?.getAttribute('data-contentlens-author-name') ??
    element.getAttribute('author')
  const postFlair =
    element.getAttribute('data-contentlens-post-flair') ??
    element.querySelector('shreddit-post-flair')?.textContent?.trim() ??
    null
  const subredditDisplayName =
    subredditElement?.getAttribute('data-contentlens-subreddit-name') ??
    element.getAttribute('subreddit-prefixed-name') ??
    element.getAttribute('subreddit-name')
  const userFlair =
    element.getAttribute('data-contentlens-user-flair') ??
    element.getAttribute('author-flair-text')

  return {
    ...(authorDisplayName
      ? { authorDisplayName: authorDisplayName.slice(0, 256) }
      : {}),
    authorId,
    authorReason: rawAuthorId ? 'invalid' : 'not-exposed',
    body: rawBody.slice(0, MAX_CONTENT_BODY_LENGTH),
    bodyPartial:
      bodyElement?.getAttribute('data-contentlens-expanded') === 'false' ||
      rawBody.length > MAX_CONTENT_BODY_LENGTH,
    ...(canonicalUrl ? { canonicalUrl: canonicalUrl.href } : {}),
    itemId,
    itemReason: rawItemId ? 'invalid' : 'not-exposed',
    media: mediaFrom(element),
    ...(postFlair ? { postFlair } : {}),
    promoted:
      element.getAttribute('data-contentlens-promoted') === 'true' ||
      element.hasAttribute('is-promoted'),
    relations: relationsFrom(element),
    ...(subredditDisplayName ? { subredditDisplayName } : {}),
    subredditId,
    subredditReason: rawSubredditId ? 'invalid' : 'not-exposed',
    surface,
    ...(title ? { title: title.slice(0, MAX_CONTENT_TITLE_LENGTH) } : {}),
    ...(userFlair ? { userFlair } : {})
  }
}

export const redditCandidateFingerprint = (
  source: RedditCandidateSource
): string => JSON.stringify(source)

const identityFrom = (
  value: string | null,
  reason: 'not-exposed' | 'invalid'
): RedditStableIdentity =>
  value ? { status: 'stable', value } : { status: 'ephemeral', reason }

export function extractRedditCandidate(
  _element: Element,
  pageInstanceId: string,
  domId: string,
  source: RedditCandidateSource
): RedditCandidate {
  return {
    ...(source.authorDisplayName
      ? { authorDisplayName: source.authorDisplayName }
      : {}),
    authorIdentity: identityFrom(source.authorId, source.authorReason),
    body: source.body,
    bodyPartial: source.bodyPartial,
    ...(source.canonicalUrl ? { canonicalUrl: source.canonicalUrl } : {}),
    domId,
    durableAuthorActions: source.authorId !== null,
    durableItemActions: source.itemId !== null,
    durableSubredditActions: source.subredditId !== null,
    identity: source.itemId
      ? { status: 'stable', platformContentId: source.itemId }
      : {
          status: 'ephemeral',
          pageInstanceId,
          reason: source.itemReason
        },
    media: source.media,
    pageInstanceId,
    ...(source.postFlair ? { postFlair: source.postFlair } : {}),
    promoted: source.promoted,
    relations: source.relations,
    ...(source.subredditDisplayName
      ? { subredditDisplayName: source.subredditDisplayName }
      : {}),
    subredditIdentity: identityFrom(source.subredditId, source.subredditReason),
    surface: source.surface,
    ...(source.title ? { title: source.title } : {}),
    ...(source.userFlair ? { userFlair: source.userFlair } : {})
  }
}
