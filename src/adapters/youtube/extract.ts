import { youtubeSelectors } from '@/adapters/youtube/selectors'
import type {
  YouTubeCandidate,
  YouTubeChannelIdentity,
  YouTubeExtractionContext,
  YouTubeIdentityReason,
  YouTubeVideoIdentity
} from '@/adapters/youtube/types'
import { MAX_CONTENT_TITLE_LENGTH } from '@/core/content/contracts'

const youtubeOrigin = 'https://www.youtube.com'
const stableIdPattern = /^[A-Za-z0-9_-]{6,64}$/u
const channelIdPattern = /^UC[A-Za-z0-9_-]{6,64}$/u
const anonymousCandidateIds = new WeakMap<Element, string>()
let anonymousCandidateSequence = 0

interface CandidateSource {
  channelId: string | null
  channelReason: YouTubeIdentityReason
  title: string
  videoId: string | null
  videoReason: YouTubeIdentityReason
}

const readHref = (element: Element, selector: string): string | null =>
  element.querySelector<HTMLAnchorElement>(selector)?.getAttribute('href') ??
  null

const parseVideoId = (
  href: string | null
): { id: string | null; reason: YouTubeIdentityReason } => {
  if (!href) {
    return { id: null, reason: 'not-exposed' }
  }

  try {
    const url = new URL(href, youtubeOrigin)
    if (url.origin !== youtubeOrigin) {
      return { id: null, reason: 'invalid' }
    }
    const shortMatch = url.pathname.match(/^\/shorts\/([^/]+)\/?$/u)
    const value =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (shortMatch?.[1] ?? null)
    return value && stableIdPattern.test(value)
      ? { id: value, reason: 'not-exposed' }
      : { id: null, reason: 'invalid' }
  } catch {
    return { id: null, reason: 'invalid' }
  }
}

const parseChannelId = (
  href: string | null
): { id: string | null; reason: YouTubeIdentityReason } => {
  if (!href) {
    return { id: null, reason: 'not-exposed' }
  }

  try {
    const url = new URL(href, youtubeOrigin)
    if (url.origin !== youtubeOrigin) {
      return { id: null, reason: 'invalid' }
    }
    const path = url.pathname
    const match = path.match(/^\/channel\/([^/]+)\/?$/u)
    const value = match?.[1] ?? null
    return value && channelIdPattern.test(value)
      ? { id: value, reason: 'not-exposed' }
      : { id: null, reason: 'invalid' }
  } catch {
    return { id: null, reason: 'invalid' }
  }
}

export const readCandidateSource = (
  element: Element,
  context: YouTubeExtractionContext
): CandidateSource => {
  const selectors = youtubeSelectors[context.surface]
  const video = parseVideoId(readHref(element, selectors.videoLink))
  const channel = parseChannelId(readHref(element, selectors.channelLink))
  const title =
    element.querySelector(selectors.title)?.textContent?.trim() ?? ''

  return {
    channelId: channel.id,
    channelReason: channel.reason,
    title: title.slice(0, MAX_CONTENT_TITLE_LENGTH),
    videoId: video.id,
    videoReason: video.reason
  }
}

export const candidateFingerprint = (source: CandidateSource): string =>
  [
    source.videoId ?? source.videoReason,
    source.channelId ?? source.channelReason,
    source.title
  ].join(':')

const channelIdentityFor = (source: CandidateSource): YouTubeChannelIdentity =>
  source.channelId
    ? { status: 'stable', channelId: source.channelId }
    : { status: 'ephemeral', reason: source.channelReason }

const videoIdentityFor = (
  source: CandidateSource,
  pageInstanceId: string
): YouTubeVideoIdentity =>
  source.videoId
    ? { status: 'stable', platformContentId: source.videoId }
    : {
        status: 'ephemeral',
        pageInstanceId,
        reason: source.videoReason
      }

const diagnosticReasonFor = (
  source: CandidateSource
): YouTubeCandidate['diagnosticReason'] => {
  if (!source.videoId) {
    return source.videoReason === 'invalid'
      ? 'video-id-invalid'
      : 'video-id-not-exposed'
  }
  if (!source.channelId) {
    return source.channelReason === 'invalid'
      ? 'channel-id-invalid'
      : 'channel-id-not-exposed'
  }
  return undefined
}

export const extractYouTubeCandidate = (
  element: Element,
  context: YouTubeExtractionContext,
  pageInstanceId: string,
  domId: string,
  source: CandidateSource = readCandidateSource(element, context)
): YouTubeCandidate => {
  const diagnosticReason = diagnosticReasonFor(source)

  return {
    channelIdentity: channelIdentityFor(source),
    ...(diagnosticReason ? { diagnosticReason } : {}),
    domId,
    durableChannelActions: source.channelId !== null,
    durableVideoActions: source.videoId !== null,
    pageInstanceId,
    policyScope:
      context.surface === 'search'
        ? 'explicit-search'
        : 'passive-recommendation',
    surface: context.surface,
    title: source.title,
    videoIdentity: videoIdentityFor(source, pageInstanceId)
  }
}

const candidateDomId = (element: Element): string => {
  if (element.id) {
    return element.id
  }

  const existing = anonymousCandidateIds.get(element)
  if (existing) {
    return existing
  }

  anonymousCandidateSequence += 1
  const generated = `candidate-${anonymousCandidateSequence}`
  anonymousCandidateIds.set(element, generated)
  return generated
}

export const extractYouTubeCandidates = (
  root: ParentNode,
  context: YouTubeExtractionContext
): YouTubeCandidate[] => {
  const selector = youtubeSelectors[context.surface].candidate
  return [...root.querySelectorAll(selector)].map(element => {
    const domId = candidateDomId(element)
    const pageInstanceId = `${context.pageInstanceId}:${domId}`
    return extractYouTubeCandidate(element, context, pageInstanceId, domId)
  })
}
