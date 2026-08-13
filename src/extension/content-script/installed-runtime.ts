import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  type HackerNewsCandidate,
  type HackerNewsSurface,
  matchHackerNewsLocation,
  normalizeHackerNewsCandidate,
  observeHackerNewsCandidates
} from '@/adapters/hacker-news'
import {
  type LinkedInCandidate,
  type LinkedInSurface,
  matchLinkedInLocation,
  normalizeLinkedInCandidate,
  observeLinkedInCandidates
} from '@/adapters/linkedin'
import {
  matchRedditLocation,
  normalizeRedditCandidate,
  observeRedditCandidates,
  type RedditCandidate,
  type RedditSurface
} from '@/adapters/reddit'
import type { DomObservationHandle } from '@/adapters/shared/observe'
import {
  matchXLocation,
  normalizeXCandidate,
  observeXCandidates,
  type XCandidate,
  type XSurface
} from '@/adapters/x'
import {
  matchYouTubeLocation,
  normalizeYouTubeCandidate,
  observeYouTubeCandidates,
  type YouTubeCandidate,
  type YouTubeSurface
} from '@/adapters/youtube'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'
import type {
  DomRuntimeAdapter,
  DomRuntimeCandidate
} from '@/extension/content-script/dom-runtime'

export type InstalledDomRuntimeDefinition = {
  adapter: DomRuntimeAdapter<DomRuntimeCandidate>
  matchLocation(url: URL): AdapterRouteMatch
  platform: Exclude<Platform, 'rss'>
  spaEvents: readonly string[]
}

const routeSurfaceFamilies: Readonly<
  Partial<Record<PlatformSurface, readonly PlatformSurface[]>>
> = {
  'youtube:recommendations': ['youtube:recommendations', 'youtube:end-screen'],
  'linkedin:feed': [
    'linkedin:feed',
    'linkedin:reposts',
    'linkedin:promoted-posts',
    'linkedin:comment-preview'
  ],
  'x:for-you': ['x:for-you', 'x:following', 'x:quoted-posts'],
  'x:replies': ['x:replies', 'x:quoted-posts'],
  'x:threads': ['x:threads', 'x:replies', 'x:quoted-posts']
}

export function enabledInstalledRouteSurfaces(
  routeSurface: PlatformSurface,
  enabledSurfaces: ReadonlySet<string>
): PlatformSurface[] {
  return (routeSurfaceFamilies[routeSurface] ?? [routeSurface]).filter(
    surface => enabledSurfaces.has(surface)
  )
}

const combineObservationHandles = (
  handles: readonly DomObservationHandle[]
): DomObservationHandle => ({
  applyIfCurrent: (element, pageInstanceId, apply) => {
    for (const handle of handles) {
      if (handle.applyIfCurrent(element, pageInstanceId, apply)) {
        return true
      }
    }
    return false
  },
  disconnect: () => {
    for (const handle of handles) {
      handle.disconnect()
    }
  },
  isCurrent: (element, pageInstanceId) =>
    handles.some(handle => handle.isCurrent(element, pageInstanceId)),
  scan: () => {
    for (const handle of handles) {
      handle.scan()
    }
  }
})

const enabledSetFor = (
  enabledSurfaces: readonly PlatformSurface[]
): ReadonlySet<PlatformSurface> => new Set(enabledSurfaces)

const localSurface = <Surface extends string>(
  qualified: PlatformSurface,
  platform: Exclude<Platform, 'rss'>
) => {
  const prefix = `${platform}:`
  if (!qualified.startsWith(prefix)) {
    throw new Error('adapter-surface-platform-mismatch')
  }
  return qualified.slice(prefix.length) as Surface
}

const youtubeAdapter: DomRuntimeAdapter<DomRuntimeCandidate> = {
  normalize: (candidate, observedAt) =>
    normalizeYouTubeCandidate(candidate as YouTubeCandidate, observedAt),
  observe: (root, options) => {
    const enabled = enabledSetFor(options.enabledSurfaces)
    const surfaces = enabledInstalledRouteSurfaces(
      options.surface,
      enabled
    ).map(surface => localSurface<YouTubeSurface>(surface, 'youtube'))
    return combineObservationHandles(
      surfaces.map(surface =>
        observeYouTubeCandidates(root, {
          onCandidate: options.onCandidate,
          pageInstanceId: options.pageInstanceId,
          surface
        })
      )
    )
  }
}

const linkedInAdapter: DomRuntimeAdapter<DomRuntimeCandidate> = {
  normalize: (candidate, observedAt) =>
    normalizeLinkedInCandidate(candidate as LinkedInCandidate, observedAt),
  observe: (root, options) => {
    const enabled = enabledSetFor(options.enabledSurfaces)
    return observeLinkedInCandidates(root, {
      onCandidate: (candidate, element) => {
        if (enabled.has(`linkedin:${candidate.surface}`)) {
          options.onCandidate(candidate, element)
        }
      },
      pageInstanceId: options.pageInstanceId,
      surface: localSurface<LinkedInSurface>(options.surface, 'linkedin')
    })
  }
}

const xAdapter: DomRuntimeAdapter<DomRuntimeCandidate> = {
  normalize: (candidate, observedAt) =>
    normalizeXCandidate(candidate as XCandidate, observedAt),
  observe: (root, options) => {
    const enabled = enabledSetFor(options.enabledSurfaces)
    return observeXCandidates(root, {
      onCandidate: (candidate, element) => {
        if (enabled.has(`x:${candidate.surface}`)) {
          options.onCandidate(candidate, element)
        }
      },
      pageInstanceId: options.pageInstanceId,
      surface: localSurface<XSurface>(options.surface, 'x')
    })
  }
}

const redditAdapter: DomRuntimeAdapter<DomRuntimeCandidate> = {
  normalize: (candidate, observedAt) =>
    normalizeRedditCandidate(candidate as RedditCandidate, observedAt),
  observe: (root, options) => {
    const enabled = enabledSetFor(options.enabledSurfaces)
    return observeRedditCandidates(root, {
      onCandidate: (candidate, element) => {
        if (enabled.has(`reddit:${candidate.surface}`)) {
          options.onCandidate(candidate, element)
        }
      },
      pageInstanceId: options.pageInstanceId,
      surface: localSurface<RedditSurface>(options.surface, 'reddit')
    })
  }
}

const hackerNewsAdapter: DomRuntimeAdapter<DomRuntimeCandidate> = {
  normalize: (candidate, observedAt) =>
    normalizeHackerNewsCandidate(candidate as HackerNewsCandidate, observedAt),
  observe: (root, options) => {
    const enabled = enabledSetFor(options.enabledSurfaces)
    return observeHackerNewsCandidates(root, {
      onCandidate: (candidate, element) => {
        if (enabled.has(`hacker-news:${candidate.surface}`)) {
          options.onCandidate(candidate, element)
        }
      },
      pageInstanceId: options.pageInstanceId,
      surface: localSurface<HackerNewsSurface>(options.surface, 'hacker-news')
    })
  }
}

const definitions: Readonly<
  Record<Exclude<Platform, 'rss'>, InstalledDomRuntimeDefinition>
> = {
  youtube: {
    adapter: youtubeAdapter,
    matchLocation: matchYouTubeLocation,
    platform: 'youtube',
    spaEvents: ['yt-navigate-finish']
  },
  linkedin: {
    adapter: linkedInAdapter,
    matchLocation: matchLinkedInLocation,
    platform: 'linkedin',
    spaEvents: []
  },
  x: {
    adapter: xAdapter,
    matchLocation: matchXLocation,
    platform: 'x',
    spaEvents: []
  },
  reddit: {
    adapter: redditAdapter,
    matchLocation: matchRedditLocation,
    platform: 'reddit',
    spaEvents: []
  },
  'hacker-news': {
    adapter: hackerNewsAdapter,
    matchLocation: matchHackerNewsLocation,
    platform: 'hacker-news',
    spaEvents: []
  }
}

export function installedDomRuntimeDefinition(
  platform: Platform
): InstalledDomRuntimeDefinition | undefined {
  return platform === 'rss' ? undefined : definitions[platform]
}
