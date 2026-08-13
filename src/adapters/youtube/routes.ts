import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  hasExactOrigin,
  normalizeRoutePath,
  routeUnsupported
} from '@/adapters/shared/routes'

const youtubeOrigin = 'https://www.youtube.com'
const nonEmptySegmentPattern = /^[^/?#]{1,128}$/u

export function matchYouTubeLocation(url: URL): AdapterRouteMatch {
  if (!hasExactOrigin(url, youtubeOrigin)) {
    return routeUnsupported('origin-mismatch')
  }

  const path = normalizeRoutePath(url.pathname)
  if (path === '/') {
    return { state: 'supported', surface: 'youtube:home' }
  }
  if (path === '/results') {
    return { state: 'supported', surface: 'youtube:search' }
  }
  if (path === '/watch') {
    return { state: 'supported', surface: 'youtube:recommendations' }
  }
  if (path === '/feed/subscriptions') {
    return { state: 'supported', surface: 'youtube:subscriptions' }
  }
  if (/^\/shorts\/[A-Za-z0-9_-]{6,64}$/u.test(path)) {
    return { state: 'supported', surface: 'youtube:shorts' }
  }
  if (
    /^\/channel\/UC[A-Za-z0-9_-]{6,64}$/u.test(path) ||
    /^\/@[A-Za-z0-9._-]{1,100}$/u.test(path) ||
    /^\/(?:c|user)\/[^/?#]{1,128}$/u.test(path)
  ) {
    return { state: 'supported', surface: 'youtube:channel' }
  }
  if (
    path === '/playlist' &&
    nonEmptySegmentPattern.test(url.searchParams.get('list') ?? '')
  ) {
    return { state: 'supported', surface: 'youtube:playlist' }
  }
  return routeUnsupported()
}
