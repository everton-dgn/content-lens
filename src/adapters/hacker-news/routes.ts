import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  hasExactOrigin,
  normalizeRoutePath,
  routeUnsupported
} from '@/adapters/shared/routes'
import type { PlatformSurface } from '@/core/content/surfaces'

const hackerNewsOrigin = 'https://news.ycombinator.com'
const routeSurfaces: Readonly<Record<string, PlatformSurface>> = {
  '/': 'hacker-news:front-page',
  '/ask': 'hacker-news:ask',
  '/best': 'hacker-news:best',
  '/jobs': 'hacker-news:jobs',
  '/news': 'hacker-news:front-page',
  '/newest': 'hacker-news:new',
  '/show': 'hacker-news:show'
}

export function matchHackerNewsLocation(url: URL): AdapterRouteMatch {
  if (!hasExactOrigin(url, hackerNewsOrigin)) {
    return routeUnsupported('origin-mismatch')
  }

  const path = normalizeRoutePath(url.pathname)
  const surface = routeSurfaces[path]
  if (surface) {
    return { state: 'supported', surface }
  }
  if (
    path === '/item' &&
    /^[1-9][0-9]*$/u.test(url.searchParams.get('id') ?? '')
  ) {
    return { state: 'supported', surface: 'hacker-news:item' }
  }
  return routeUnsupported()
}
