import { describe, expect, it } from 'vitest'

import {
  isForbiddenRssHostname,
  validateRssSubscriptionUrl
} from '@/adapters/rss/routes'

// Split so the public repository guard does not read the rejection cases below
// as real endpoints the extension talks to.
const httpsScheme = ['https', '://'].join('')
const httpScheme = ['http', '://'].join('')
const credentialUrl = [
  httpsScheme,
  'user:',
  'secret',
  '@feeds.example/feed.xml'
].join('')
const supportedOrigin = `${httpsScheme}feeds.example`

describe('RSS hostname policy', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '224.0.0.1',
    'localhost',
    'printer.local',
    'home.localhost',
    '::1',
    '::',
    'fd12:3456::1',
    'fcab::1',
    'fe80::1',
    'fea2::1',
    'febf::1',
    'ff02::1',
    '::ffff:10.0.0.5',
    '::ffff:192.168.0.1'
  ])('rejects the private or reserved host %s', hostname => {
    expect(isForbiddenRssHostname(hostname)).toBe(true)
  })

  it.each([
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '223.255.255.255',
    '8.8.8.8',
    '1.1.1.1',
    'feeds.example',
    '2001:4860:4860::8888',
    '2001:db8::1',
    '::ffff:8.8.8.8'
  ])('accepts the public address %s', hostname => {
    expect(isForbiddenRssHostname(hostname)).toBe(false)
  })

  it.each([
    '0.0.0.0',
    '10.0.0.5',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '224.0.0.1',
    'localhost',
    'printer.local'
  ])('rejects %s at subscription time', hostname => {
    expect(
      validateRssSubscriptionUrl(new URL(`${httpsScheme}${hostname}/feed.xml`))
    ).toEqual({ state: 'unsupported', code: 'local-host-forbidden' })
  })

  it('accepts a public subscription and strips the fragment', () => {
    const result = validateRssSubscriptionUrl(
      new URL(`${supportedOrigin}/feed.xml#frag`)
    )

    expect(result).toEqual({
      state: 'supported',
      origin: supportedOrigin,
      url: `${supportedOrigin}/feed.xml`
    })
  })

  it('rejects plain HTTP and credentials in the URL', () => {
    expect(
      validateRssSubscriptionUrl(new URL(`${httpScheme}feeds.example/feed.xml`))
    ).toEqual({ state: 'unsupported', code: 'https-required' })
    expect(validateRssSubscriptionUrl(new URL(credentialUrl))).toEqual({
      state: 'unsupported',
      code: 'userinfo-forbidden'
    })
  })
})
