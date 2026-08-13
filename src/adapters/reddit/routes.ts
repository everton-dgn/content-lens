import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  hasExactOrigin,
  normalizeRoutePath,
  routeUnsupported
} from '@/adapters/shared/routes'

const redditOrigin = 'https://www.reddit.com'
const subredditName = '[A-Za-z0-9_]{2,64}'
const postId = '[A-Za-z0-9]{1,16}'
const subredditCommentsRoute = new RegExp(
  `^/r/${subredditName}/comments/${postId}(?:/[^/]+)?(?:/.*)?$`,
  'u'
)
const commentsRoute = new RegExp(
  `^/comments/${postId}(?:/[^/]+)?(?:/.*)?$`,
  'u'
)
const subredditRoute = new RegExp(`^/r/${subredditName}$`, 'u')

export function matchRedditLocation(url: URL): AdapterRouteMatch {
  if (!hasExactOrigin(url, redditOrigin)) {
    return routeUnsupported('origin-mismatch')
  }

  const path = normalizeRoutePath(url.pathname)
  if (path === '/') {
    return { state: 'supported', surface: 'reddit:home' }
  }
  if (path === '/r/popular') {
    return { state: 'supported', surface: 'reddit:popular' }
  }
  if (path === '/r/all') {
    return { state: 'supported', surface: 'reddit:all' }
  }
  if (subredditCommentsRoute.test(path) || commentsRoute.test(path)) {
    return { state: 'supported', surface: 'reddit:comments' }
  }
  if (path === '/search') {
    return { state: 'supported', surface: 'reddit:search' }
  }
  if (subredditRoute.test(path)) {
    return { state: 'supported', surface: 'reddit:subreddit' }
  }
  return routeUnsupported()
}
