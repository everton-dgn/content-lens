import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DomRuntimeCandidate } from '@/extension/content-script/dom-runtime'
import {
  enabledInstalledRouteSurfaces,
  installedDomRuntimeDefinition
} from '@/extension/content-script/installed-runtime'

afterEach(() => {
  document.body.replaceChildren()
})

describe('installed DOM runtime', () => {
  it('activates only enabled surfaces from a compound route', () => {
    expect(
      enabledInstalledRouteSurfaces(
        'youtube:recommendations',
        new Set(['youtube:end-screen'])
      )
    ).toEqual(['youtube:end-screen'])
    expect(
      enabledInstalledRouteSurfaces(
        'linkedin:feed',
        new Set(['linkedin:promoted-posts', 'reddit:home'])
      )
    ).toEqual(['linkedin:promoted-posts'])
    expect(
      enabledInstalledRouteSurfaces('reddit:comments', new Set(['reddit:home']))
    ).toEqual([])
  })

  it('observes the enabled YouTube end screen without observing recommendations', () => {
    document.body.innerHTML = `
      <ytd-compact-video-renderer id="recommendation">
        <a id="thumbnail" href="/watch?v=RECOMMEND01"></a>
        <h3>Recommendation</h3>
      </ytd-compact-video-renderer>
      <div class="ytp-ce-video" id="end-screen">
        <a href="/watch?v=ENDSCREEN001"></a>
        <div class="ytp-ce-video-title">End screen</div>
      </div>
    `
    const candidates: DomRuntimeCandidate[] = []
    const definition = installedDomRuntimeDefinition('youtube')
    if (!definition) {
      throw new Error('Missing YouTube runtime definition')
    }

    const observation = definition.adapter.observe(document, {
      enabledSurfaces: ['youtube:end-screen'],
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'youtube-page',
      surface: 'youtube:recommendations'
    })
    observation.disconnect()

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ surface: 'end-screen' })
    const candidate = candidates[0]
    if (!candidate) throw new Error('Expected one YouTube candidate')
    expect(
      definition.adapter.normalize(candidate, '2026-07-31T12:00:00.000Z')
    ).toMatchObject({ platform: 'youtube', surface: 'youtube:end-screen' })
  })

  it('filters disabled LinkedIn sub-surfaces before the shared runtime sees them', () => {
    document.body.innerHTML = `
      <article id="feed" data-urn="urn:li:activity:1001">
        <div data-contentlens-text>Feed item</div>
      </article>
      <article id="promoted" data-urn="urn:li:activity:1002" data-contentlens-promoted="true">
        <div data-contentlens-text>Promoted item</div>
      </article>
    `
    const candidates: DomRuntimeCandidate[] = []
    const definition = installedDomRuntimeDefinition('linkedin')
    if (!definition) {
      throw new Error('Missing LinkedIn runtime definition')
    }

    const observation = definition.adapter.observe(document, {
      enabledSurfaces: ['linkedin:feed'],
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'linkedin-page',
      surface: 'linkedin:feed'
    })
    observation.disconnect()

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ surface: 'feed' })
    const candidate = candidates[0]
    if (!candidate) throw new Error('Expected one LinkedIn candidate')
    expect(
      definition.adapter.normalize(candidate, '2026-07-31T12:00:00.000Z')
    ).toMatchObject({ platform: 'linkedin', surface: 'linkedin:feed' })
  })

  it('fails open when the X active timeline cannot be identified', () => {
    document.body.innerHTML = `
      <div role="tab" aria-selected="true">Timeline inconnue</div>
      <article data-testid="tweet" id="tweet">
        <a href="/contentlens/status/12001"></a>
        <p data-testid="tweetText">Unknown timeline</p>
      </article>
    `
    const candidates: DomRuntimeCandidate[] = []
    const definition = installedDomRuntimeDefinition('x')
    if (!definition) {
      throw new Error('Missing X runtime definition')
    }

    const observation = definition.adapter.observe(document, {
      enabledSurfaces: ['x:following'],
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'x-page',
      surface: 'x:for-you'
    })
    observation.disconnect()

    expect(candidates).toEqual([])
  })

  it('observes and normalizes enabled X, Reddit and Hacker News surfaces through their installed definitions', async () => {
    const fixtures = [
      {
        platform: 'x' as const,
        name: 'following',
        surface: 'x:for-you' as const
      },
      {
        platform: 'reddit' as const,
        name: 'home',
        surface: 'reddit:home' as const
      },
      {
        platform: 'hacker-news' as const,
        name: 'front-page',
        surface: 'hacker-news:front-page' as const
      }
    ]
    for (const fixture of fixtures) {
      document.documentElement.innerHTML = await readFile(
        resolve('tests', 'fixtures', fixture.platform, `${fixture.name}.html`),
        'utf8'
      )
      const definition = installedDomRuntimeDefinition(fixture.platform)
      if (!definition) throw new Error(`Missing ${fixture.platform} definition`)
      const candidates: DomRuntimeCandidate[] = []
      const observation = definition.adapter.observe(document, {
        enabledSurfaces: [fixture.surface],
        onCandidate: candidate => candidates.push(candidate),
        pageInstanceId: `page:${fixture.platform}`,
        surface: fixture.surface
      })
      observation.scan()
      observation.disconnect()
      expect(candidates.length).toBeGreaterThan(0)
      const candidate = candidates[0]
      if (!candidate) throw new Error(`Missing ${fixture.platform} candidate`)
      expect(
        definition.adapter.normalize(candidate, '2026-07-31T12:00:00.000Z')
      ).toMatchObject({ platform: fixture.platform, surface: fixture.surface })
    }
  })

  it('exposes route definitions, rejects cross-platform surfaces and combines YouTube handles', () => {
    expect(installedDomRuntimeDefinition('rss')).toBeUndefined()
    expect(installedDomRuntimeDefinition('youtube')?.spaEvents).toEqual([
      'yt-navigate-finish'
    ])
    expect(
      installedDomRuntimeDefinition('reddit')?.matchLocation(
        new URL('https://www.reddit.com/r/typescript/')
      )
    ).toMatchObject({ state: 'supported' })
    expect(() =>
      installedDomRuntimeDefinition('reddit')?.adapter.observe(document, {
        enabledSurfaces: ['x:for-you'],
        onCandidate: vi.fn(),
        pageInstanceId: 'page:mismatch',
        surface: 'x:for-you'
      })
    ).toThrow('adapter-surface-platform-mismatch')

    document.body.innerHTML = `
      <ytd-compact-video-renderer id="recommendation">
        <a id="thumbnail" href="/watch?v=RECOMMEND01"></a><h3>Recommendation</h3>
      </ytd-compact-video-renderer>
      <div class="ytp-ce-video" id="end-screen">
        <a href="/watch?v=ENDSCREEN001"></a><div class="ytp-ce-video-title">End screen</div>
      </div>
    `
    const definition = installedDomRuntimeDefinition('youtube')
    if (!definition) throw new Error('Missing combined YouTube definition')
    const candidates: DomRuntimeCandidate[] = []
    const observation = definition.adapter.observe(document, {
      enabledSurfaces: ['youtube:recommendations', 'youtube:end-screen'],
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'page:combined',
      surface: 'youtube:recommendations'
    })
    expect(candidates).toHaveLength(2)
    const recommendation = document.getElementById('recommendation')
    const first = candidates[0]
    if (!recommendation || !first) {
      throw new Error('Combined YouTube fixtures are missing')
    }
    expect(observation.isCurrent(recommendation, first.pageInstanceId)).toBe(
      true
    )
    const apply = vi.fn()
    expect(
      observation.applyIfCurrent(recommendation, first.pageInstanceId, apply)
    ).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
    observation.scan()
    observation.disconnect()
  })
})
