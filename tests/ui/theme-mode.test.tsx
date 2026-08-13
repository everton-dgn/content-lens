import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTheme } from '@/ui/hooks/useTheme'
import type { SettingsRuntimeClient } from '@/ui/settings/runtime'
import { ThemeProvider } from '@/ui/styles/ThemeProvider'
import { applyColorMode, type ColorMode } from '@/ui/styles/theme'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: Root }> = []
const broadcastTheme = vi.fn()
let matchesSystemDark = false
let receiveTheme: ((event: MessageEvent<ColorMode>) => void) | undefined
let updateSystemTheme: (() => void) | undefined

const ThemeProbe = () => {
  const { resolvedTheme, setTheme, theme } = useTheme()
  return (
    <div data-resolved-theme={resolvedTheme} data-theme={theme}>
      <button onClick={() => setTheme('light')} type="button">
        Commit light
      </button>
      <button
        onClick={() => setTheme('dark', { broadcast: false })}
        type="button"
      >
        Preview dark
      </button>
    </div>
  )
}

const renderThemeHarness = async (runtime: SettingsRuntimeClient) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(
      <ThemeProvider runtime={runtime}>
        <ThemeProbe />
      </ThemeProvider>
    )
    await Promise.resolve()
  })
  return { host, root }
}

beforeEach(() => {
  matchesSystemDark = false
  receiveTheme = undefined
  updateSystemTheme = undefined
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      get matches() {
        return matchesSystemDark
      },
      addEventListener: vi.fn((type, listener) => {
        if (type === 'change') {
          updateSystemTheme = listener as () => void
        }
      }),
      removeEventListener: vi.fn()
    }))
  )
  broadcastTheme.mockReset()
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      addEventListener = vi.fn((type, listener) => {
        if (type === 'message') {
          receiveTheme = listener as (event: MessageEvent<ColorMode>) => void
        }
      })
      close = vi.fn()
      postMessage = broadcastTheme
      removeEventListener = vi.fn()
    }
  )
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => view.root.unmount())
      view.host.remove()
    }
  }
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.style.removeProperty('color-scheme')
  vi.unstubAllGlobals()
})

describe('theme mode', () => {
  it('applies explicit themes and restores system mode', () => {
    applyColorMode('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyColorMode('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('light')

    applyColorMode('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('loads the stored mode through the settings boundary', async () => {
    const runtime = {
      request: vi.fn().mockResolvedValue({
        kind: 'snapshot',
        value: {
          settings: { settings: { interface: { colorMode: 'dark' } } }
        }
      }),
      requestPlatformPermission: vi.fn(),
      requestProviderPermission: vi.fn()
    } as unknown as SettingsRuntimeClient

    const view = await renderThemeHarness(runtime)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(runtime.request).toHaveBeenCalledWith({ type: 'settings.snapshot' })
    const probe = view.host.querySelector('div')
    expect(probe?.dataset.theme).toBe('dark')
    expect(probe?.dataset.resolvedTheme).toBe('dark')

    await act(async () =>
      view.host.querySelector<HTMLButtonElement>('button')?.click()
    )
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(broadcastTheme).toHaveBeenCalledWith('light')

    broadcastTheme.mockClear()
    await act(async () =>
      view.host.querySelectorAll<HTMLButtonElement>('button')[1]?.click()
    )
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(broadcastTheme).not.toHaveBeenCalled()
  })

  it('falls back to system mode when the settings boundary fails', async () => {
    document.documentElement.dataset.theme = 'dark'
    const runtime = {
      request: vi.fn().mockRejectedValue(new Error('unavailable')),
      requestPlatformPermission: vi.fn(),
      requestProviderPermission: vi.fn()
    } as unknown as SettingsRuntimeClient

    const view = await renderThemeHarness(runtime)

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(view.host.querySelector('div')?.dataset.theme).toBe('system')
  })

  it('accepts valid theme broadcasts and ignores unsupported values', async () => {
    const runtime = {
      request: vi.fn().mockResolvedValue({
        kind: 'snapshot',
        value: {
          settings: { settings: { interface: { colorMode: 'light' } } }
        }
      }),
      requestPlatformPermission: vi.fn(),
      requestProviderPermission: vi.fn()
    } as unknown as SettingsRuntimeClient
    const view = await renderThemeHarness(runtime)

    await act(async () => {
      receiveTheme?.(
        new MessageEvent<ColorMode>('message', {
          data: 'sepia' as unknown as ColorMode
        })
      )
    })
    expect(view.host.querySelector('div')?.dataset.theme).toBe('light')

    await act(async () => {
      receiveTheme?.(new MessageEvent<ColorMode>('message', { data: 'dark' }))
    })
    expect(view.host.querySelector('div')?.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('tracks system changes only while system mode is active', async () => {
    const runtime = {
      request: vi.fn().mockResolvedValue({
        kind: 'snapshot',
        value: {
          settings: { settings: { interface: { colorMode: 'system' } } }
        }
      }),
      requestPlatformPermission: vi.fn(),
      requestProviderPermission: vi.fn()
    } as unknown as SettingsRuntimeClient
    const view = await renderThemeHarness(runtime)

    matchesSystemDark = true
    await act(async () => updateSystemTheme?.())
    expect(document.documentElement.dataset.theme).toBe('dark')

    await act(async () =>
      view.host.querySelector<HTMLButtonElement>('button')?.click()
    )
    matchesSystemDark = false
    await act(async () => updateSystemTheme?.())
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(view.host.querySelector('div')?.dataset.theme).toBe('light')
  })

  it('ignores responses that are not settings snapshots', async () => {
    const runtime = {
      request: vi.fn().mockResolvedValue({
        kind: 'provider-catalog',
        value: []
      }),
      requestPlatformPermission: vi.fn(),
      requestProviderPermission: vi.fn()
    } as unknown as SettingsRuntimeClient
    const view = await renderThemeHarness(runtime)

    expect(view.host.querySelector('div')?.dataset.theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
