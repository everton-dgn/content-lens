import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterRouteMatch } from '@/adapters/contracts'
import {
  type PlatformRuntimeStart,
  startPlatformContentLifecycle
} from '@/extension/content-script/platform-lifecycle'

type FocusAnchor = {
  id: string
}

const transitionEvent = (type: 'pagehide' | 'pageshow', persisted: boolean) => {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { value: persisted })
  return event
}

const matchLocation = (url: URL): AdapterRouteMatch => {
  if (url.pathname === '/feed') {
    return {
      state: 'supported',
      surface: 'reddit:home'
    }
  }
  if (url.pathname === '/popular') {
    return {
      state: 'degraded',
      surface: 'reddit:popular',
      code: 'variant-unverified'
    }
  }
  return {
    state: 'unsupported',
    code: 'route-unsupported'
  }
}

beforeEach(() => {
  history.replaceState({}, '', '/')
  delete document.documentElement.dataset.contentlensRuntimeReady
})

describe('platform content lifecycle', () => {
  it('leaves an unsupported route untouched and starts after a supported route event', async () => {
    const starts: PlatformRuntimeStart<FocusAnchor>[] = []
    const lifecycle = startPlatformContentLifecycle<FocusAnchor>({
      browserName: 'chrome',
      createPageInstanceId: () => `reddit:page:${starts.length + 1}`,
      createRuntime: start => {
        starts.push(start)
        return {
          captureFocus: () => undefined,
          disable: vi.fn()
        }
      },
      document,
      location,
      matchLocation,
      platform: 'reddit',
      spaEvents: ['reddit-route-changed'],
      target: globalThis
    })

    expect(starts).toEqual([])
    expect(
      document.documentElement.dataset.contentlensRuntimeReady
    ).toBeUndefined()

    history.pushState({}, '', '/feed')
    document.dispatchEvent(new Event('reddit-route-changed'))
    await vi.waitFor(() => expect(starts).toHaveLength(1))

    expect(starts[0]).toEqual({
      pageInstanceId: 'reddit:page:1',
      routeState: 'supported',
      surface: 'reddit:home'
    })
    expect(document.documentElement.dataset.contentlensRuntimeReady).toBe(
      'chrome'
    )
    lifecycle.dispose()
  })

  it('invalidates the previous runtime and exposes degraded route diagnostics', async () => {
    history.replaceState({}, '', '/feed')
    const starts: PlatformRuntimeStart<FocusAnchor>[] = []
    const disabled: Array<ReturnType<typeof vi.fn>> = []
    const lifecycle = startPlatformContentLifecycle<FocusAnchor>({
      browserName: 'firefox',
      createPageInstanceId: () => `reddit:page:${starts.length + 1}`,
      createRuntime: start => {
        starts.push(start)
        const disable = vi.fn()
        disabled.push(disable)
        return {
          captureFocus: () => ({ id: 'focused-candidate' }),
          disable
        }
      },
      document,
      location,
      matchLocation,
      platform: 'reddit',
      spaEvents: ['reddit-route-changed'],
      target: globalThis
    })

    history.pushState({}, '', '/popular')
    document.dispatchEvent(new Event('reddit-route-changed'))
    await vi.waitFor(() => expect(starts).toHaveLength(2))

    expect(disabled[0]).toHaveBeenCalledOnce()
    expect(starts[1]).toEqual({
      pageInstanceId: 'reddit:page:2',
      restoreFocus: { id: 'focused-candidate' },
      routeCode: 'variant-unverified',
      routeState: 'degraded',
      surface: 'reddit:popular'
    })

    history.pushState({}, '', '/unknown')
    globalThis.dispatchEvent(new Event('popstate'))
    await vi.waitFor(() => expect(disabled[1]).toHaveBeenCalledOnce())
    expect(starts).toHaveLength(2)
    expect(
      document.documentElement.dataset.contentlensRuntimeReady
    ).toBeUndefined()
    lifecycle.dispose()
  })

  it('revalidates the route after bfcache and removes declared events on dispose', () => {
    history.replaceState({}, '', '/feed')
    const starts: PlatformRuntimeStart<FocusAnchor>[] = []
    const lifecycle = startPlatformContentLifecycle<FocusAnchor>({
      browserName: 'firefox',
      createPageInstanceId: () => `reddit:page:${starts.length + 1}`,
      createRuntime: start => {
        starts.push(start)
        return {
          captureFocus: () => ({ id: 'candidate:1' }),
          disable: vi.fn()
        }
      },
      document,
      location,
      matchLocation,
      platform: 'reddit',
      spaEvents: ['reddit-route-changed'],
      target: globalThis
    })

    globalThis.dispatchEvent(transitionEvent('pagehide', true))
    history.replaceState({}, '', '/popular')
    globalThis.dispatchEvent(transitionEvent('pageshow', true))

    expect(starts[1]).toMatchObject({
      pageInstanceId: 'reddit:page:2',
      restoreFocus: { id: 'candidate:1' },
      routeState: 'degraded',
      surface: 'reddit:popular'
    })

    lifecycle.dispose()
    history.replaceState({}, '', '/feed')
    document.dispatchEvent(new Event('reddit-route-changed'))
    expect(starts).toHaveLength(2)
  })
})
