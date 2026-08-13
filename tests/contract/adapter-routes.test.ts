import { describe, expect, it } from 'vitest'

import { matchHackerNewsLocation } from '@/adapters/hacker-news/routes'
import { matchLinkedInLocation } from '@/adapters/linkedin/routes'
import { matchRedditLocation } from '@/adapters/reddit/routes'
import { validateRssSubscriptionUrl } from '@/adapters/rss/routes'
import { matchXLocation } from '@/adapters/x/routes'
import { matchYouTubeLocation } from '@/adapters/youtube/routes'

const httpsUrl = (...parts: string[]): string =>
  ['https', '://', ...parts].join('')
const httpUrl = (...parts: string[]): string =>
  ['http', '://', ...parts].join('')

describe('platform route contracts', () => {
  it.each([
    ['/', 'youtube:home'],
    ['/results?search_query=typescript', 'youtube:search'],
    ['/watch?v=abcdef12345', 'youtube:recommendations'],
    ['/feed/subscriptions', 'youtube:subscriptions'],
    ['/shorts/abcdef12345', 'youtube:shorts'],
    ['/channel/UCabcdef12345', 'youtube:channel'],
    ['/@contentlens', 'youtube:channel'],
    ['/c/contentlens', 'youtube:channel'],
    ['/user/contentlens', 'youtube:channel'],
    ['/playlist?list=PLabcdef12345', 'youtube:playlist']
  ])('maps a supported YouTube route %s', (path, surface) => {
    expect(
      matchYouTubeLocation(new URL(path, 'https://www.youtube.com'))
    ).toEqual({
      state: 'supported',
      surface
    })
  })

  it('rejects YouTube lookalike origins, invalid collections and unknown routes', () => {
    expect(
      matchYouTubeLocation(
        new URL(
          '/watch?v=abcdef12345',
          'https://www.youtube.com.attacker.example'
        )
      )
    ).toEqual({
      state: 'unsupported',
      code: 'origin-mismatch'
    })
    expect(
      matchYouTubeLocation(new URL('https://www.youtube.com/playlist'))
    ).toEqual({
      state: 'unsupported',
      code: 'route-unsupported'
    })
    expect(
      matchYouTubeLocation(new URL('https://www.youtube.com/account'))
    ).toEqual({
      state: 'unsupported',
      code: 'route-unsupported'
    })
  })

  it('maps LinkedIn feed and leaves collection-only surfaces degraded', () => {
    expect(
      matchLinkedInLocation(new URL('https://www.linkedin.com/feed/'))
    ).toEqual({
      state: 'supported',
      surface: 'linkedin:feed'
    })
    expect(
      matchLinkedInLocation(
        new URL('https://www.linkedin.com/feed/update/urn:li:activity:1')
      )
    ).toEqual({
      state: 'degraded',
      surface: 'linkedin:feed',
      code: 'collection-detection-required'
    })
    expect(
      matchLinkedInLocation(new URL('https://www.linkedin.com/jobs/'))
    ).toEqual({
      state: 'unsupported',
      code: 'route-unsupported'
    })
  })

  it('maps X routes without inventing the selected home timeline', () => {
    expect(matchXLocation(new URL('https://x.com/home'))).toEqual({
      state: 'degraded',
      surface: 'x:for-you',
      code: 'timeline-detection-required'
    })
    expect(
      matchXLocation(new URL('https://x.com/contentlens/with_replies'))
    ).toEqual({
      state: 'supported',
      surface: 'x:replies'
    })
    expect(
      matchXLocation(new URL('https://x.com/contentlens/status/1234567890'))
    ).toEqual({
      state: 'supported',
      surface: 'x:threads'
    })
    expect(matchXLocation(new URL(httpsUrl('twitter.com/home')))).toEqual({
      state: 'unsupported',
      code: 'origin-mismatch'
    })
  })

  it.each([
    ['/', 'reddit:home'],
    ['/r/popular/', 'reddit:popular'],
    ['/r/all/', 'reddit:all'],
    ['/r/typescript/', 'reddit:subreddit'],
    ['/search/?q=typescript', 'reddit:search'],
    ['/r/typescript/comments/abc123/example/', 'reddit:comments'],
    ['/comments/abc123/example/', 'reddit:comments']
  ])('maps a supported Reddit route %s', (path, surface) => {
    expect(
      matchRedditLocation(new URL(path, 'https://www.reddit.com'))
    ).toEqual({
      state: 'supported',
      surface
    })
  })

  it.each([
    ['/', 'hacker-news:front-page'],
    ['/news', 'hacker-news:front-page'],
    ['/newest', 'hacker-news:new'],
    ['/best', 'hacker-news:best'],
    ['/ask', 'hacker-news:ask'],
    ['/show', 'hacker-news:show'],
    ['/jobs', 'hacker-news:jobs'],
    ['/item?id=123', 'hacker-news:item']
  ])('maps a supported Hacker News route %s', (path, surface) => {
    expect(
      matchHackerNewsLocation(new URL(path, 'https://news.ycombinator.com'))
    ).toEqual({
      state: 'supported',
      surface
    })
  })

  it('requires a numeric item ID for Hacker News detail routes', () => {
    expect(
      matchHackerNewsLocation(
        new URL('/item?id=invalid', 'https://news.ycombinator.com')
      )
    ).toEqual({
      state: 'unsupported',
      code: 'route-unsupported'
    })
  })
})

describe('RSS subscription URL contract', () => {
  it('accepts an HTTPS URL and returns its exact permission origin', () => {
    expect(
      validateRssSubscriptionUrl(
        new URL('/news.xml?edition=br', 'https://feeds.example')
      )
    ).toEqual({
      state: 'supported',
      origin: 'https://feeds.example',
      url: ['https://feeds.example/news.xml', '?edition=br'].join('')
    })
  })

  it.each([
    [httpUrl('feeds.example/news.xml'), 'https-required'],
    [httpsUrl('user:pass', '@feeds.example/news.xml'), 'userinfo-forbidden'],
    [httpsUrl('local', 'host/news.xml'), 'local-host-forbidden'],
    [httpsUrl('127', '.0.0.1/news.xml'), 'local-host-forbidden'],
    [httpsUrl('[::', '1]/news.xml'), 'local-host-forbidden'],
    [httpsUrl('feed', '.local/news.xml'), 'local-host-forbidden']
  ])('rejects unsafe RSS subscription %s', (value, code) => {
    expect(validateRssSubscriptionUrl(new URL(value))).toEqual({
      state: 'unsupported',
      code
    })
  })
})
