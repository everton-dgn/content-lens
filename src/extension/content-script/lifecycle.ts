import { matchYouTubeLocation, type YouTubeSurface } from '@/adapters/youtube'
import {
  type PlatformContentLifecycle,
  startPlatformContentLifecycle
} from '@/extension/content-script/platform-lifecycle'
import type {
  YouTubeContentRuntime,
  YouTubeRuntimeFocusAnchor
} from '@/extension/content-script/youtube-runtime'

export type YouTubeRuntimeStart = {
  pageInstanceId: string
  restoreFocus?: YouTubeRuntimeFocusAnchor
  surface: YouTubeSurface
}

export type YouTubeContentLifecycleOptions = {
  browserName: string
  createPageInstanceId?: () => string
  createRuntime(start: YouTubeRuntimeStart): YouTubeContentRuntime
  document: Document
  location: Location
  target: EventTarget
}

export type YouTubeContentLifecycle = {
  dispose(): void
  restart(): void
}

export function surfaceFromLocation(
  location: Pick<Location, 'href'>
): YouTubeSurface | undefined {
  const match = matchYouTubeLocation(new URL(location.href))
  return match.state === 'unsupported'
    ? undefined
    : surfaceFromQualifiedSurface(match.surface)
}

export function startYouTubeContentLifecycle(
  options: YouTubeContentLifecycleOptions
): YouTubeContentLifecycle {
  const lifecycle: PlatformContentLifecycle =
    startPlatformContentLifecycle<YouTubeRuntimeFocusAnchor>({
      browserName: options.browserName,
      ...(options.createPageInstanceId
        ? { createPageInstanceId: options.createPageInstanceId }
        : {}),
      createRuntime: ({ pageInstanceId, restoreFocus, surface }) => {
        const youtubeSurface = surfaceFromQualifiedSurface(surface)
        return options.createRuntime({
          pageInstanceId,
          ...(restoreFocus ? { restoreFocus } : {}),
          surface: youtubeSurface
        })
      },
      document: options.document,
      location: options.location,
      matchLocation: matchYouTubeLocation,
      platform: 'youtube',
      spaEvents: ['yt-navigate-finish'],
      target: options.target
    })
  return lifecycle
}

function surfaceFromQualifiedSurface(surface: string): YouTubeSurface {
  return surface.slice('youtube:'.length) as YouTubeSurface
}
