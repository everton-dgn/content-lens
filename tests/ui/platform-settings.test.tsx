// biome-ignore-all lint/performance/noJsxPropsBind: static markup snapshots need no stable handler identity.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import type { Platform } from '@/core/content/contracts'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'
import { createDefaultSettings } from '@/core/settings'
import { PlatformSettings } from '@/ui/settings/PlatformSettings'

vi.mock('@/i18n/runtime', () => ({
  t: (key: string) => key
}))

const copy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => property
  // biome-ignore lint/suspicious/noExplicitAny: the copy contract is exercised through its keys.
}) as any

const snapshot = {
  providers: { providers: [], models: [] }
  // biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
} as any as SettingsRuntimeSnapshot

const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, 'text/html')

const render = (platform: Platform, advancedMode = false) =>
  parse(
    renderToStaticMarkup(
      <PlatformSettings
        advancedMode={advancedMode}
        copy={copy}
        draft={createDefaultSettings()}
        onRequestPermission={() => undefined}
        pending={false}
        selectedPlatform={platform}
        setSelectedPlatform={() => undefined}
        snapshot={snapshot}
        updateDraft={() => undefined}
      />
    )
  )

describe('platform settings', () => {
  it.each(['youtube', 'linkedin', 'x', 'reddit', 'hacker-news'] as const)(
    'offers a toggle per declared surface of %s',
    platform => {
      const page = render(platform)
      const toggles = page.querySelectorAll(
        '[data-slot="toggle-field"] input[type="checkbox"]'
      )

      expect(toggles).toHaveLength(PLATFORM_SURFACES[platform].length + 1)
    }
  )

  it('keeps the permission rail for a DOM platform', () => {
    const page = render('youtube')
    const rail = page.querySelector('aside')

    expect(rail).not.toBeNull()
    expect(rail?.querySelector('button')).not.toBeNull()
  })

  it('drops the permission rail for RSS, which needs no host access', () => {
    const page = render('rss')

    expect(page.querySelector('aside')?.children).toHaveLength(0)
  })

  it('reports native feedback as degraded until a platform passes its live check', () => {
    const page = render('youtube')
    const notice = page.querySelector('[data-slot="notice"]')

    expect(notice?.getAttribute('data-tone')).toBe('degraded')
    expect(notice?.textContent).toContain('nativeFeedbackUnavailableTitle')
  })

  it('disables the native feedback consent while the capability is unavailable', () => {
    const page = render('youtube')
    const consent = page.querySelector(
      '[data-slot="toggle-field"] input[disabled]'
    )

    expect(consent).not.toBeNull()
  })

  it('needs a routed override, not just advanced mode, for the disclosure', () => {
    expect(render('youtube').querySelectorAll('details')).toHaveLength(0)
    expect(render('youtube', true).querySelectorAll('details')).toHaveLength(0)
  })

  it('offers one model override select per routed task', () => {
    const page = render('youtube')
    const selects = page.querySelectorAll('select')

    expect(selects.length).toBeGreaterThanOrEqual(7)
  })

  it('uses the canonical two-column grid so the rail sits beside the form', () => {
    const page = render('youtube')

    expect(page.querySelector('.settings-overview')).not.toBeNull()
    expect(page.querySelector('.settings-rail')).not.toBeNull()
  })

  it('keeps every surface toggle unchecked when the profile enables none', () => {
    const page = render('reddit')
    const checked = page.querySelectorAll(
      '[data-slot="toggle-field"] input[checked]'
    )

    expect(checked).toHaveLength(0)
  })
})
