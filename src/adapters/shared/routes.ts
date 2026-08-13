import type { AdapterRouteMatch } from '@/adapters/contracts'

export const routeUnsupported = (
  code: string = 'route-unsupported'
): AdapterRouteMatch => ({
  state: 'unsupported',
  code
})

export const hasExactOrigin = (url: URL, origin: string): boolean =>
  url.protocol === 'https:' && url.origin === origin

export const normalizeRoutePath = (pathname: string): string => {
  if (pathname === '/') {
    return pathname
  }
  return pathname.replace(/\/+$/u, '')
}
