import { hackerNewsSelectors } from '@/adapters/hacker-news/selectors'
import type {
  HackerNewsCandidate,
  HackerNewsSurface
} from '@/adapters/hacker-news/types'
import { MAX_CONTENT_TITLE_LENGTH } from '@/core/content/contracts'

type ListSurface = Exclude<HackerNewsSurface, 'item'>

type HackerNewsCandidateSource = Omit<
  HackerNewsCandidate,
  'domId' | 'durableItemActions' | 'identity' | 'pageInstanceId' | 'surface'
> & {
  itemId: string | null
  itemReason: 'not-exposed' | 'invalid'
}

const itemIdPattern = /^[1-9][0-9]*$/u

const parseNumber = (value: string | undefined): number | undefined => {
  const match = value?.match(/[0-9]+/u)?.[0]
  if (!match) {
    return undefined
  }
  const parsed = Number(match)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

const destinationFrom = (
  href: string | null
): { destinationHost?: string; destinationUrl?: string } => {
  if (!href) {
    return {}
  }
  try {
    const url = new URL(href, 'https://news.ycombinator.com')
    if (!['http:', 'https:'].includes(url.protocol)) {
      return {}
    }
    return {
      destinationHost: url.hostname,
      destinationUrl: url.href
    }
  } catch {
    return {}
  }
}

export function readHackerNewsCandidateSource(
  element: Element
): HackerNewsCandidateSource {
  const rawItemId = element.getAttribute('data-id')
  const itemId = rawItemId && itemIdPattern.test(rawItemId) ? rawItemId : null
  const titleLink = element.querySelector<HTMLAnchorElement>(
    hackerNewsSelectors.title
  )
  const subtext = element.nextElementSibling
  const author =
    subtext?.querySelector(hackerNewsSelectors.author)?.textContent?.trim() ??
    ''
  const age =
    subtext?.querySelector(hackerNewsSelectors.age)?.textContent?.trim() ?? ''
  const points = parseNumber(
    subtext?.querySelector(hackerNewsSelectors.points)?.textContent ?? undefined
  )
  const commentCount = parseNumber(
    [...(subtext?.querySelectorAll(hackerNewsSelectors.comments) ?? [])]
      .at(-1)
      ?.textContent?.trim()
  )
  return {
    ...(age ? { age: age.slice(0, 128) } : {}),
    ...(author ? { authorDisplayName: author.slice(0, 256) } : {}),
    ...(commentCount !== undefined ? { commentCount } : {}),
    ...destinationFrom(titleLink?.getAttribute('href') ?? null),
    itemId,
    itemReason: rawItemId ? 'invalid' : 'not-exposed',
    ...(points !== undefined ? { points } : {}),
    title: (titleLink?.textContent?.trim() ?? '').slice(
      0,
      MAX_CONTENT_TITLE_LENGTH
    )
  }
}

export const hackerNewsCandidateFingerprint = (
  source: HackerNewsCandidateSource
): string => JSON.stringify(source)

export function extractHackerNewsCandidate(
  surface: ListSurface,
  _element: Element,
  pageInstanceId: string,
  domId: string,
  source: HackerNewsCandidateSource
): HackerNewsCandidate {
  return {
    ...(source.age ? { age: source.age } : {}),
    ...(source.authorDisplayName
      ? { authorDisplayName: source.authorDisplayName }
      : {}),
    ...(source.commentCount !== undefined
      ? { commentCount: source.commentCount }
      : {}),
    ...(source.destinationHost
      ? { destinationHost: source.destinationHost }
      : {}),
    ...(source.destinationUrl ? { destinationUrl: source.destinationUrl } : {}),
    domId,
    durableItemActions: source.itemId !== null,
    identity: source.itemId
      ? { status: 'stable', platformContentId: source.itemId }
      : {
          status: 'ephemeral',
          pageInstanceId,
          reason: source.itemReason
        },
    pageInstanceId,
    ...(source.points !== undefined ? { points: source.points } : {}),
    surface,
    title: source.title
  }
}
