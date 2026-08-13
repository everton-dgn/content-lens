import { describe, expect, it } from 'vitest'

import {
  ADAPTER_CAPABILITY_IDS,
  ADAPTER_CONTRACT_VERSION,
  type AdapterCapabilityMap,
  type AdapterDescriptor,
  type AdapterRouteMatch
} from '@/adapters/contracts'
import { AdapterRegistry, AdapterRegistryError } from '@/adapters/registry'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import {
  PLATFORM_SURFACES,
  type PlatformSurface
} from '@/core/content/surfaces'

const origins = {
  youtube: 'https://www.youtube.com',
  linkedin: 'https://www.linkedin.com',
  x: 'https://x.com',
  reddit: 'https://www.reddit.com',
  'hacker-news': 'https://news.ycombinator.com',
  rss: 'https://feeds.example'
} as const satisfies Record<Platform, string>

const paths = {
  youtube: '/',
  linkedin: '/feed/',
  x: '/home',
  reddit: '/',
  'hacker-news': '/news',
  rss: '/feed.xml'
} as const satisfies Record<Platform, string>

function capabilityMap(
  state: 'supported' | 'degraded' | 'disabled' | 'unsupported' = 'supported'
): AdapterCapabilityMap {
  return Object.fromEntries(
    ADAPTER_CAPABILITY_IDS.map(capability => [
      capability,
      {
        state,
        code: `${capability}-${state}`
      }
    ])
  ) as AdapterCapabilityMap
}

function firstSurface(platform: Platform): PlatformSurface {
  return `${platform}:${PLATFORM_SURFACES[platform][0]}` as PlatformSurface
}

function descriptor(
  platform: Platform,
  overrides: Partial<AdapterDescriptor> = {}
): AdapterDescriptor {
  const origin = origins[platform]
  const surface = firstSurface(platform)

  return {
    platform,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    origins: [origin],
    surfaces: [surface],
    relations: [],
    traits: [],
    extractableFields: ['title'],
    visualActions: ['show', 'hide'],
    permissionRequirements: [
      {
        kind: 'host',
        origin,
        optional: true
      }
    ],
    testedBrowsers: [
      {
        browser: 'chrome',
        minimumVersion: '149'
      },
      {
        browser: 'firefox',
        minimumVersion: '151.0'
      }
    ],
    lastLiveSmokeAt: null,
    capabilities: capabilityMap(),
    spaEvents: [],
    matchLocation(url): AdapterRouteMatch {
      if (url.origin !== origin) {
        return {
          state: 'unsupported',
          code: 'origin-mismatch'
        }
      }
      if (url.pathname !== paths[platform]) {
        return {
          state: 'unsupported',
          code: 'route-unsupported'
        }
      }
      return {
        state: 'supported',
        surface
      }
    },
    create: () => ({
      disconnect() {},
      restoreAll: () => 0
    }),
    ...overrides
  }
}

describe('adapter registry contract', () => {
  it('registers the six platforms with qualified surfaces and exact origins', () => {
    const registry = new AdapterRegistry(
      PLATFORM_VALUES.map(platform => descriptor(platform))
    )

    expect(registry.platforms()).toEqual(PLATFORM_VALUES)
    for (const platform of PLATFORM_VALUES) {
      expect(registry.get(platform)).toMatchObject({
        platform,
        contractVersion: ADAPTER_CONTRACT_VERSION,
        origins: [origins[platform]],
        surfaces: [firstSurface(platform)]
      })
      expect(registry.platformForOrigin(origins[platform])).toBe(platform)
    }
  })

  it('returns an explicit unsupported result without creating an adapter', () => {
    let creates = 0
    const registry = new AdapterRegistry([
      descriptor('youtube', {
        create: () => {
          creates += 1
          return {
            disconnect() {},
            restoreAll: () => 0
          }
        }
      })
    ])

    expect(registry.match(new URL('https://unknown.example/feed'))).toEqual({
      state: 'unsupported',
      code: 'origin-not-registered'
    })
    expect(registry.match(new URL('https://www.youtube.com/unknown'))).toEqual({
      state: 'unsupported',
      code: 'route-unsupported',
      platform: 'youtube'
    })
    expect(creates).toBe(0)
  })

  it('preserves supported and degraded route states without a default surface', () => {
    const registry = new AdapterRegistry([
      descriptor('youtube'),
      descriptor('reddit', {
        matchLocation: url =>
          url.pathname === '/'
            ? {
                state: 'degraded',
                surface: 'reddit:home',
                code: 'variant-unverified'
              }
            : {
                state: 'unsupported',
                code: 'route-unsupported'
              }
      })
    ])

    expect(registry.match(new URL('https://www.youtube.com/'))).toMatchObject({
      state: 'supported',
      platform: 'youtube',
      surface: 'youtube:home'
    })
    expect(registry.match(new URL('https://www.reddit.com/'))).toMatchObject({
      state: 'degraded',
      platform: 'reddit',
      surface: 'reddit:home',
      code: 'variant-unverified'
    })
  })

  it('rejects duplicate platform and origin ownership', () => {
    expect(
      () => new AdapterRegistry([descriptor('youtube'), descriptor('youtube')])
    ).toThrowError(new AdapterRegistryError('duplicate-platform', 'youtube'))
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube'),
          descriptor('reddit', {
            origins: [origins.youtube],
            permissionRequirements: [
              {
                kind: 'host',
                origin: origins.youtube,
                optional: true
              }
            ]
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('duplicate-origin', origins.youtube)
    )
  })

  it('rejects duplicate or cross-platform surfaces, relations and traits', () => {
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            surfaces: ['youtube:home', 'youtube:home']
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('duplicate-surface', 'youtube:home')
    )
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            surfaces: ['reddit:home']
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('surface-platform-mismatch', 'reddit:home')
    )
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            relations: ['reply', 'reply']
          })
        ])
    ).toThrowError(new AdapterRegistryError('duplicate-relation', 'reply'))
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            traits: ['live', 'live']
          })
        ])
    ).toThrowError(new AdapterRegistryError('duplicate-trait', 'live'))
  })

  it('rejects an incompatible contract version and unsafe origin shape', () => {
    const insecureOrigin = ['http:', '', 'www.youtube.com'].join('/')

    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            contractVersion: '2.0.0'
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('incompatible-contract-version', '2.0.0')
    )
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            origins: ['https://www.youtube.com/feed']
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('invalid-origin', 'https://www.youtube.com/feed')
    )
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            origins: [insecureOrigin]
          })
        ])
    ).toThrowError(new AdapterRegistryError('invalid-origin', insecureOrigin))
  })

  it('requires every capability and the closed four-state vocabulary', () => {
    const missing = Object.fromEntries(
      Object.entries(capabilityMap()).filter(
        ([capability]) => capability !== 'render-review'
      )
    ) as AdapterCapabilityMap

    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            capabilities: missing
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('missing-capability', 'render-review')
    )
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            capabilities: {
              ...capabilityMap(),
              'extract-content': {
                state: 'maybe' as 'supported',
                code: 'extract-maybe'
              }
            }
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('invalid-capability-state', 'maybe')
    )
  })

  it('rejects unsafe diagnostic codes and undeclared route surfaces', () => {
    expect(
      () =>
        new AdapterRegistry([
          descriptor('youtube', {
            capabilities: {
              ...capabilityMap(),
              'extract-content': {
                state: 'degraded',
                code: 'Bearer secret'
              }
            }
          })
        ])
    ).toThrowError(
      new AdapterRegistryError('invalid-diagnostic-code', 'Bearer secret')
    )

    const registry = new AdapterRegistry([
      descriptor('youtube', {
        matchLocation: () => ({
          state: 'supported',
          surface: 'youtube:search'
        })
      })
    ])
    expect(() =>
      registry.match(new URL('https://www.youtube.com/'))
    ).toThrowError(
      new AdapterRegistryError('undeclared-route-surface', 'youtube:search')
    )
  })
})
