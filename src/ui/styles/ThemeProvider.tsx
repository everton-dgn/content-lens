import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { SettingsRuntimeClient } from '@/ui/settings/runtime'
import { browserSettingsRuntime } from '@/ui/settings/runtime'
import {
  applyColorMode,
  type ColorMode,
  DARK_MEDIA_QUERY,
  type ResolvedColorMode,
  resolveColorMode,
  THEME_BROADCAST_CHANNEL
} from '@/ui/styles/theme'

type ThemeContextValue = {
  resolvedTheme: ResolvedColorMode
  setTheme(theme: ColorMode, options?: { broadcast?: boolean }): void
  theme: ColorMode
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined
)

export type ThemeProviderProps = {
  children: ReactNode
  runtime?: SettingsRuntimeClient
}

export const ThemeProvider = ({
  children,
  runtime = browserSettingsRuntime
}: ThemeProviderProps) => {
  const [theme, setThemeState] = useState<ColorMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedColorMode>(() =>
    resolveColorMode('system')
  )
  const themeRef = useRef<ColorMode>('system')
  const channelRef = useRef<BroadcastChannel>(null)

  const setTheme = useCallback(
    (nextTheme: ColorMode, options?: { broadcast?: boolean }) => {
      themeRef.current = nextTheme
      setThemeState(nextTheme)
      setResolvedTheme(applyColorMode(nextTheme))
      if (options?.broadcast !== false) {
        channelRef.current?.postMessage(nextTheme)
      }
    },
    []
  )

  useEffect(() => {
    let active = true
    void runtime
      .request({ type: 'settings.snapshot' })
      .then(response => {
        if (active && response.kind === 'snapshot') {
          setTheme(response.value.settings.settings.interface.colorMode, {
            broadcast: false
          })
        }
      })
      .catch(() => {
        if (active) {
          setTheme('system', { broadcast: false })
        }
      })

    if ('BroadcastChannel' in globalThis) {
      const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL)
      channelRef.current = channel
      const receiveTheme = (event: MessageEvent<ColorMode>) => {
        if (!['system', 'light', 'dark'].includes(event.data)) {
          return
        }
        themeRef.current = event.data
        setThemeState(event.data)
        setResolvedTheme(applyColorMode(event.data))
      }
      channel.addEventListener('message', receiveTheme)
      return () => {
        active = false
        channelRef.current = null
        channel.removeEventListener('message', receiveTheme)
        channel.close()
      }
    }

    return () => {
      active = false
    }
  }, [runtime, setTheme])

  useEffect(() => {
    if (!('matchMedia' in globalThis)) {
      return
    }
    const mediaQuery = globalThis.matchMedia(DARK_MEDIA_QUERY)
    const updateSystemTheme = () => {
      if (themeRef.current === 'system') {
        setResolvedTheme(applyColorMode('system'))
      }
    }
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  const value = useMemo(
    () => ({ resolvedTheme, setTheme, theme }),
    [resolvedTheme, setTheme, theme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
