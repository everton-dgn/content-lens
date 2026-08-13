import type { ContentLensSettings } from '@/core/settings'

export type ColorMode = ContentLensSettings['interface']['colorMode']
export type ResolvedColorMode = Exclude<ColorMode, 'system'>

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const THEME_BROADCAST_CHANNEL = 'contentlens-theme'

export const resolveColorMode = (
  colorMode: ColorMode,
  matchesDark = globalThis.matchMedia?.(DARK_MEDIA_QUERY).matches ?? true
): ResolvedColorMode => {
  if (colorMode === 'system') {
    return matchesDark ? 'dark' : 'light'
  }
  return colorMode
}

export const applyColorMode = (
  colorMode: ColorMode,
  root: HTMLElement = document.documentElement
) => {
  const resolved = resolveColorMode(colorMode)
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  return resolved
}
