import type { AdapterRouteMatch } from '@/adapters/contracts'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'

export type PlatformRuntimeStart<FocusAnchor> = {
  pageInstanceId: string
  restoreFocus?: FocusAnchor
  routeCode?: string
  routeState: 'supported' | 'degraded'
  surface: PlatformSurface
}

export type PlatformContentRuntime<FocusAnchor> = {
  captureFocus(): FocusAnchor | undefined
  disable(): void
}

export type PlatformContentLifecycleOptions<FocusAnchor> = {
  browserName: string
  createPageInstanceId?: () => string
  createRuntime(
    start: PlatformRuntimeStart<FocusAnchor>
  ): PlatformContentRuntime<FocusAnchor>
  document: Document
  location: Location
  matchLocation(url: URL): AdapterRouteMatch
  platform: Platform
  spaEvents: readonly string[]
  target: EventTarget
}

export type PlatformContentLifecycle = {
  dispose(): void
  restart(): void
}

const locationKey = (location: Location) =>
  `${location.protocol}//${location.host}${location.pathname}${location.search}${location.hash}`

const transitionPersisted = (event: Event) =>
  (event as Event & { persisted?: boolean }).persisted === true

export function startPlatformContentLifecycle<FocusAnchor>(
  options: PlatformContentLifecycleOptions<FocusAnchor>
): PlatformContentLifecycle {
  const createPageInstanceId =
    options.createPageInstanceId ??
    (() => `${options.platform}:${globalThis.crypto.randomUUID()}`)
  let currentLocationKey = ''
  let disposed = false
  let restartQueued = false
  let runtime: PlatformContentRuntime<FocusAnchor> | undefined
  let suspendedFocus: FocusAnchor | undefined
  let suspended = false

  const restart = () => {
    if (disposed || suspended) {
      return
    }
    const nextLocationKey = locationKey(options.location)
    if (runtime && currentLocationKey === nextLocationKey) {
      return
    }
    const focus = runtime?.captureFocus() ?? suspendedFocus
    suspendedFocus = undefined
    runtime?.disable()
    runtime = undefined
    delete options.document.documentElement.dataset.contentlensRuntimeReady

    let route: AdapterRouteMatch
    try {
      route = options.matchLocation(new URL(options.location.href))
    } catch {
      route = {
        state: 'unsupported',
        code: 'route-match-failed'
      }
    }
    currentLocationKey = nextLocationKey
    if (
      route.state === 'unsupported' ||
      !route.surface.startsWith(`${options.platform}:`)
    ) {
      return
    }

    runtime = options.createRuntime({
      pageInstanceId: createPageInstanceId(),
      ...(focus ? { restoreFocus: focus } : {}),
      ...(route.state === 'degraded' ? { routeCode: route.code } : {}),
      routeState: route.state,
      surface: route.surface
    })
    options.document.documentElement.dataset.contentlensRuntimeReady =
      options.browserName
  }

  const queueRestart = () => {
    if (restartQueued || disposed) {
      return
    }
    restartQueued = true
    queueMicrotask(() => {
      restartQueued = false
      restart()
    })
  }

  const onPageHide = (event: Event) => {
    if (transitionPersisted(event)) {
      suspendedFocus = runtime?.captureFocus()
    }
    runtime?.disable()
    runtime = undefined
    delete options.document.documentElement.dataset.contentlensRuntimeReady
    if (transitionPersisted(event)) {
      suspended = true
      return
    }
    dispose()
  }

  const onPageShow = (event: Event) => {
    if (!transitionPersisted(event) || disposed) {
      return
    }
    suspended = false
    currentLocationKey = ''
    restart()
  }

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    runtime?.disable()
    runtime = undefined
    options.target.removeEventListener('hashchange', queueRestart)
    options.target.removeEventListener('pagehide', onPageHide)
    options.target.removeEventListener('pageshow', onPageShow)
    options.target.removeEventListener('popstate', queueRestart)
    for (const eventName of options.spaEvents) {
      options.document.removeEventListener(eventName, queueRestart)
    }
    delete options.document.documentElement.dataset.contentlensRuntimeReady
  }

  options.target.addEventListener('hashchange', queueRestart)
  options.target.addEventListener('pagehide', onPageHide)
  options.target.addEventListener('pageshow', onPageShow)
  options.target.addEventListener('popstate', queueRestart)
  for (const eventName of options.spaEvents) {
    options.document.addEventListener(eventName, queueRestart)
  }
  restart()

  return { dispose, restart }
}
