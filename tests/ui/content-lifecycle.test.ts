import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  startYouTubeContentLifecycle,
  type YouTubeRuntimeStart
} from '@/extension/content-script/lifecycle'
import type { YouTubeContentRuntime } from '@/extension/content-script/youtube-runtime'

const transitionEvent = (type: 'pagehide' | 'pageshow', persisted: boolean) => {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { value: persisted })
  return event
}

const createYouTubeLocation = (initialHref = 'https://www.youtube.com/') => {
  let current = new URL(initialHref)
  const testLocation = {
    get hash() {
      return current.hash
    },
    get host() {
      return current.host
    },
    get href() {
      return current.href
    },
    get pathname() {
      return current.pathname
    },
    get protocol() {
      return current.protocol
    },
    get search() {
      return current.search
    }
  } as Location

  return {
    location: testLocation,
    navigate(href: string) {
      current = new URL(href, current)
    }
  }
}

beforeEach(() => {
  delete document.documentElement.dataset.contentlensRuntimeReady
})

describe('YouTube content lifecycle', () => {
  it('restarts with the current surface after a YouTube SPA navigation', async () => {
    const starts: YouTubeRuntimeStart[] = []
    const disabled: boolean[] = []
    const testUrl = createYouTubeLocation()
    const lifecycle = startYouTubeContentLifecycle({
      browserName: 'chrome',
      createPageInstanceId: () => `page:${starts.length + 1}`,
      createRuntime: (start): YouTubeContentRuntime => {
        starts.push(start)
        let isDisabled = false
        disabled.push(isDisabled)
        return {
          captureFocus: () => undefined,
          disable: () => {
            isDisabled = true
            disabled[disabled.length - 1] = isDisabled
          },
          snapshot: () => ({
            disabled: isDisabled,
            hidden: 0,
            controls: 0
          })
        }
      },
      document,
      location: testUrl.location,
      target: globalThis
    })

    expect(starts).toEqual([{ pageInstanceId: 'page:1', surface: 'home' }])
    testUrl.navigate('/results?search_query=local')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await vi.waitFor(() => expect(starts).toHaveLength(2))

    expect(disabled[0]).toBe(true)
    expect(starts[1]).toEqual({
      pageInstanceId: 'page:2',
      surface: 'search'
    })
    expect(document.documentElement.dataset.contentlensRuntimeReady).toBe(
      'chrome'
    )
    lifecycle.dispose()
  })

  it('suspends on bfcache pagehide and restarts on persisted pageshow', () => {
    const starts: YouTubeRuntimeStart[] = []
    let disabled = 0
    const testUrl = createYouTubeLocation()
    const lifecycle = startYouTubeContentLifecycle({
      browserName: 'firefox',
      createPageInstanceId: () => `page:${starts.length + 1}`,
      createRuntime: start => {
        starts.push(start)
        return {
          captureFocus: () => undefined,
          disable: () => {
            disabled += 1
          },
          snapshot: () => ({ disabled: false, hidden: 0, controls: 0 })
        }
      },
      document,
      location: testUrl.location,
      target: globalThis
    })

    globalThis.dispatchEvent(transitionEvent('pagehide', true))
    expect(disabled).toBe(1)
    expect(document.documentElement.dataset.contentlensRuntimeReady).toBe(
      undefined
    )

    globalThis.dispatchEvent(transitionEvent('pageshow', true))
    expect(starts).toHaveLength(2)
    expect(document.documentElement.dataset.contentlensRuntimeReady).toBe(
      'firefox'
    )
    lifecycle.dispose()
  })
})
