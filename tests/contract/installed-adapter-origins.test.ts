import { describe, expect, it } from 'vitest'

import {
  INSTALLED_ADAPTER_ORIGINS,
  installedAdapterOriginMap,
  installedContentMatches,
  youtubeContentMatches
} from '@/adapters/registry'

describe('installed adapter origin contract', () => {
  it('owns only the five exact DOM adapter origins', () => {
    expect(INSTALLED_ADAPTER_ORIGINS).toEqual([
      { origin: 'https://www.youtube.com', platform: 'youtube' },
      { origin: 'https://www.linkedin.com', platform: 'linkedin' },
      { origin: 'https://x.com', platform: 'x' },
      { origin: 'https://www.reddit.com', platform: 'reddit' },
      { origin: 'https://news.ycombinator.com', platform: 'hacker-news' }
    ])
    expect(installedContentMatches).toEqual(
      INSTALLED_ADAPTER_ORIGINS.map(({ origin }) => `${origin}/*`)
    )
    expect(youtubeContentMatches).toEqual(['https://www.youtube.com/*'])
  })

  it('rejects lookalike, insecure and arbitrary RSS origins', () => {
    expect(
      installedAdapterOriginMap.platformFor('https://www.reddit.com/r/all')
    ).toBe('reddit')
    expect(
      installedAdapterOriginMap.platformFor('https://www.reddit.com.evil.test')
    ).toBeUndefined()
    expect(
      installedAdapterOriginMap.platformFor('http://www.reddit.com/r/all')
    ).toBeUndefined()
    expect(
      installedAdapterOriginMap.platformFor('https://feeds.example/feed.xml')
    ).toBeUndefined()
  })
})
