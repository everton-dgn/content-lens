import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  hasExactOrigin,
  normalizeRoutePath,
  routeUnsupported
} from '@/adapters/shared/routes'

const xOrigin = 'https://x.com'
const accountSegment = '[A-Za-z0-9_]{1,64}'
const statusId = '[0-9]{1,32}'
const repliesRoute = new RegExp(`^/${accountSegment}/with_replies$`, 'u')
const statusRoute = new RegExp(
  `^/${accountSegment}/status/${statusId}(?:/photo/[0-9]+)?$`,
  'u'
)

export function matchXLocation(url: URL): AdapterRouteMatch {
  if (!hasExactOrigin(url, xOrigin)) {
    return routeUnsupported('origin-mismatch')
  }

  const path = normalizeRoutePath(url.pathname)
  if (path === '/home') {
    return {
      state: 'degraded',
      surface: 'x:for-you',
      code: 'timeline-detection-required'
    }
  }
  if (repliesRoute.test(path)) {
    return { state: 'supported', surface: 'x:replies' }
  }
  if (statusRoute.test(path)) {
    return { state: 'supported', surface: 'x:threads' }
  }
  return routeUnsupported()
}
