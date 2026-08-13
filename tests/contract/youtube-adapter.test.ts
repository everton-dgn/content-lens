import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

const adapterPath = resolve('src', 'adapters', 'youtube', 'index.ts')
const fixtureNames = [
  'home',
  'search',
  'related',
  'subscriptions',
  'shorts',
  'channel',
  'playlist',
  'end-screen'
] as const
const fixtureVersions = {
  home: 1,
  search: 1,
  related: 3,
  subscriptions: 1,
  shorts: 1,
  channel: 1,
  playlist: 1,
  'end-screen': 1
} as const

type FixtureName = (typeof fixtureNames)[number]
type YouTubeSurface =
  | 'home'
  | 'search'
  | 'recommendations'
  | 'subscriptions'
  | 'shorts'
  | 'channel'
  | 'playlist'
  | 'end-screen'
type PolicyScope = 'explicit-search' | 'passive-recommendation'

type VideoIdentity =
  | {
      status: 'stable'
      platformContentId: string
    }
  | {
      status: 'ephemeral'
      pageInstanceId: string
      reason: 'not-exposed' | 'invalid'
    }

type ChannelIdentity =
  | {
      status: 'stable'
      channelId: string
    }
  | {
      status: 'ephemeral'
      reason: 'not-exposed' | 'invalid'
    }

interface ExpectedCandidate {
  channelIdentity: ChannelIdentity
  diagnosticReason?: 'channel-id-not-exposed' | 'video-id-not-exposed'
  domId: string
  durableChannelActions: boolean
  durableVideoActions: boolean
  pageInstanceId: string
  policyScope: PolicyScope
  surface: YouTubeSurface
  title: string
  videoIdentity: VideoIdentity
}

interface FixtureMetadata {
  expectedCandidates: ExpectedCandidate[]
  fixtureVersion: number
  language: string
  license: string
  pageInstanceId: string
  schemaVersion: number
  source: { kind: 'synthetic' }
  surface: string
  synthetic: true
}

interface Fixture {
  html: string
  metadata: FixtureMetadata
  name: FixtureName
}

interface YouTubeAdapterModule {
  extractYouTubeCandidates(
    root: ParentNode,
    context: {
      pageInstanceId: string
      surface: YouTubeSurface
    }
  ): ExpectedCandidate[] | Promise<ExpectedCandidate[]>
  observeYouTubeCandidates(
    root: Node & ParentNode,
    options: {
      pageInstanceId: string
      surface: YouTubeSurface
      onCandidate(candidate: ExpectedCandidate): void
    }
  ): { disconnect(): void }
  youtubeAdapterCapabilities: {
    fields: readonly string[]
    platform: string
    surfaces: readonly string[]
  }
  youtubeSurfaceCapabilities: Record<
    YouTubeSurface,
    {
      durableIdentityActions: readonly string[]
      fields: readonly string[]
      policyScope: PolicyScope
    }
  >
}

const readFixture = async (name: FixtureName): Promise<Fixture> => {
  const basePath = resolve('tests', 'fixtures', 'youtube', name)
  const [html, metadata] = await Promise.all([
    readFile(`${basePath}.html`, 'utf8'),
    readFile(`${basePath}.fixture.json`, 'utf8').then(
      content => JSON.parse(content) as FixtureMetadata
    )
  ])

  return { html, metadata, name }
}

const loadAdapter = async (): Promise<YouTubeAdapterModule | null> => {
  if (!existsSync(adapterPath)) {
    return null
  }

  return import(
    /* @vite-ignore */ pathToFileURL(adapterPath).href
  ) as Promise<YouTubeAdapterModule>
}

const requireAdapter = (
  adapter: YouTubeAdapterModule | null
): YouTubeAdapterModule => {
  expect(adapter).not.toBeNull()
  if (!adapter) {
    throw new Error('YouTube adapter module is unavailable')
  }
  return adapter
}

const extractFixture = async (
  adapter: YouTubeAdapterModule,
  fixture: Fixture
): Promise<ExpectedCandidate[]> => {
  document.documentElement.innerHTML = fixture.html
  const surface = fixture.metadata.expectedCandidates[0]?.surface
  if (!surface) {
    throw new Error(`Fixture ${fixture.name} has no expected surface.`)
  }

  const candidates: ExpectedCandidate[] = []
  const observation = adapter.observeYouTubeCandidates(document, {
    pageInstanceId: fixture.metadata.pageInstanceId,
    surface,
    onCandidate: candidate => candidates.push(candidate)
  })
  observation.disconnect()
  return candidates
}

describe('YouTube adapter fixture contract', () => {
  let adapter: YouTubeAdapterModule | null
  let fixtures: Fixture[]

  beforeAll(async () => {
    ;[adapter, fixtures] = await Promise.all([
      loadAdapter(),
      Promise.all(fixtureNames.map(readFixture))
    ])
  })

  it('keeps one explicit synthetic fixture per declared surface', () => {
    expect(fixtures.map(({ name }) => name)).toEqual([
      'home',
      'search',
      'related',
      'subscriptions',
      'shorts',
      'channel',
      'playlist',
      'end-screen'
    ])

    for (const fixture of fixtures) {
      expect(fixture.metadata).toMatchObject({
        fixtureVersion: fixtureVersions[fixture.name],
        language: 'en',
        license: 'CC0-1.0',
        schemaVersion: 1,
        source: { kind: 'synthetic' },
        synthetic: true
      })
      expect(fixture.metadata.expectedCandidates.length).toBeGreaterThan(0)

      document.documentElement.innerHTML = fixture.html
      for (const candidate of fixture.metadata.expectedCandidates) {
        expect(document.getElementById(candidate.domId)).not.toBeNull()
      }
    }
  })

  it('declares the supported surfaces and identity fields', () => {
    const implementation = requireAdapter(adapter)

    expect(implementation.youtubeAdapterCapabilities).toEqual({
      fields: ['videoId', 'channelId', 'title'],
      platform: 'youtube',
      surfaces: [
        'home',
        'search',
        'recommendations',
        'subscriptions',
        'shorts',
        'channel',
        'playlist',
        'end-screen'
      ]
    })
    expect(implementation.youtubeSurfaceCapabilities).toEqual({
      home: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      search: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'explicit-search'
      },
      recommendations: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      subscriptions: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      shorts: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      channel: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      playlist: {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      },
      'end-screen': {
        durableIdentityActions: ['video', 'channel'],
        fields: ['videoId', 'channelId', 'title'],
        policyScope: 'passive-recommendation'
      }
    })
  })

  it('extracts every fixture candidate exactly', async () => {
    const implementation = requireAdapter(adapter)

    for (const fixture of fixtures) {
      const actual = await extractFixture(implementation, fixture)
      expect(actual).toEqual(fixture.metadata.expectedCandidates)
    }
  })

  it('represents missing identities explicitly and leaves cards visible', async () => {
    const implementation = requireAdapter(adapter)

    for (const fixture of fixtures) {
      const actual = await extractFixture(implementation, fixture)
      const expectedReduced = fixture.metadata.expectedCandidates.filter(
        ({ channelIdentity, videoIdentity }) =>
          channelIdentity.status === 'ephemeral' ||
          videoIdentity.status === 'ephemeral'
      )

      for (const expected of expectedReduced) {
        expect(actual).toContainEqual(expected)
        const element = document.getElementById(expected.domId)
        expect(element?.hasAttribute('hidden')).toBe(false)
        expect((element as HTMLElement | null)?.style.display).not.toBe('none')
      }
      expect(
        document.querySelector('[data-contentlens-placeholder]')
      ).toBeNull()
    }
  })

  it('keeps explicit search separate from passive recommendations', async () => {
    const implementation = requireAdapter(adapter)
    const scopes = new Map<FixtureName, Set<PolicyScope>>()

    for (const fixture of fixtures) {
      const candidates = await extractFixture(implementation, fixture)
      scopes.set(
        fixture.name,
        new Set(candidates.map(({ policyScope }) => policyScope))
      )
    }

    expect(scopes.get('search')).toEqual(new Set(['explicit-search']))
    expect(scopes.get('home')).toEqual(new Set(['passive-recommendation']))
    expect(scopes.get('related')).toEqual(new Set(['passive-recommendation']))
  })
})
