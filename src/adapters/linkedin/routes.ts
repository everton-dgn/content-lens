import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  hasExactOrigin,
  normalizeRoutePath,
  routeUnsupported
} from '@/adapters/shared/routes'

const linkedInOrigin = 'https://www.linkedin.com'

export function matchLinkedInLocation(url: URL): AdapterRouteMatch {
  if (!hasExactOrigin(url, linkedInOrigin)) {
    return routeUnsupported('origin-mismatch')
  }

  const path = normalizeRoutePath(url.pathname)
  if (path === '/feed') {
    return { state: 'supported', surface: 'linkedin:feed' }
  }
  if (path.startsWith('/feed/update/')) {
    return {
      state: 'degraded',
      surface: 'linkedin:feed',
      code: 'collection-detection-required'
    }
  }
  return routeUnsupported()
}
