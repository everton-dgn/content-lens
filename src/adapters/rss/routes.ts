const forbiddenHostSuffixes = ['.local', '.localhost']

export type RssSubscriptionUrlResult =
  | {
      state: 'supported'
      origin: string
      url: string
    }
  | {
      state: 'unsupported'
      code: 'https-required' | 'userinfo-forbidden' | 'local-host-forbidden'
    }

type Ipv4Octets = readonly [number, number, number, number]

const parseIpv4 = (hostname: string): Ipv4Octets | undefined => {
  const parts = hostname.split('.')
  if (
    parts.length !== 4 ||
    parts.some(part => !/^(?:0|[1-9][0-9]{0,2})$/u.test(part))
  ) {
    return undefined
  }
  const octets = parts.map(Number)
  return octets.every(octet => octet <= 255)
    ? (octets as unknown as Ipv4Octets)
    : undefined
}

const isForbiddenIpv4 = ([first, second]: Ipv4Octets): boolean =>
  first === 0 ||
  first === 10 ||
  first === 127 ||
  (first === 100 && second >= 64 && second <= 127) ||
  (first === 169 && second === 254) ||
  (first === 172 && second >= 16 && second <= 31) ||
  (first === 192 && second === 168) ||
  first >= 224

const isForbiddenIpv6 = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  if (!normalized.includes(':')) {
    return false
  }
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff')
  ) {
    return true
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  const octets = mappedIpv4 ? parseIpv4(mappedIpv4) : undefined
  return octets ? isForbiddenIpv4(octets) : false
}

export const isForbiddenRssHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    forbiddenHostSuffixes.some(suffix => normalized.endsWith(suffix))
  ) {
    return true
  }
  const ipv4 = parseIpv4(normalized)
  return ipv4 ? isForbiddenIpv4(ipv4) : isForbiddenIpv6(normalized)
}

export function validateRssSubscriptionUrl(
  input: URL
): RssSubscriptionUrlResult {
  const url = new URL(input.href)
  if (url.protocol !== 'https:') {
    return { state: 'unsupported', code: 'https-required' }
  }
  if (url.username || url.password) {
    return { state: 'unsupported', code: 'userinfo-forbidden' }
  }
  if (isForbiddenRssHostname(url.hostname)) {
    return { state: 'unsupported', code: 'local-host-forbidden' }
  }
  url.hash = ''
  return {
    state: 'supported',
    origin: url.origin,
    url: url.href
  }
}
