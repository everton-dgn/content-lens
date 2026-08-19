// biome-ignore-all lint/performance/noJsxPropsBind: static markup snapshots need no stable handler identity.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { createDefaultSettings } from '@/core/settings'
import { GeneralSettings } from '@/ui/settings/GeneralSettings'

vi.mock('@/i18n/runtime', () => ({
  t: (key: string) => key
}))

const countKeys = new Set(['generalModelCount', 'generalProviderCount'])
const copy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) =>
    countKeys.has(property)
      ? (count: number) => `${property}:${count}`
      : property
  // biome-ignore lint/suspicious/noExplicitAny: the copy contract is exercised through its keys.
}) as any

const snapshot = {
  providers: { models: [], providers: [] }
  // biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
} as any as SettingsRuntimeSnapshot

const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, 'text/html')

const render = (
  handlers: { onOpenData?: () => void; onOpenFeeds?: () => void } = {}
) =>
  parse(
    renderToStaticMarkup(
      <GeneralSettings
        copy={copy}
        draft={createDefaultSettings()}
        snapshot={snapshot}
        {...handlers}
      />
    )
  )

const shortcutSurface = (page: Document) =>
  page.querySelector('.settings-shortcuts')?.closest('[data-slot="surface"]')

describe('general settings shortcuts', () => {
  it('renders both shortcuts on the default surface tone', () => {
    const page = render({
      onOpenData: () => undefined,
      onOpenFeeds: () => undefined
    })
    const buttons = page.querySelectorAll('.settings-shortcuts button')

    expect(buttons).toHaveLength(2)
    expect(shortcutSurface(page)?.getAttribute('data-tone')).toBe('default')
  })

  it('marks each shortcut with its own chevron affordance', () => {
    const page = render({
      onOpenData: () => undefined,
      onOpenFeeds: () => undefined
    })

    const buttons = [...page.querySelectorAll('.settings-shortcuts button')]

    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.querySelectorAll('svg')).toHaveLength(1)
    }
  })

  it('offers only the shortcut whose destination is reachable', () => {
    const feedsOnly = render({ onOpenFeeds: () => undefined })
    const dataOnly = render({ onOpenData: () => undefined })

    expect(
      feedsOnly.querySelectorAll('.settings-shortcuts button')
    ).toHaveLength(1)
    expect(feedsOnly.body.textContent).toContain('feedsShortcutAction')
    expect(
      dataOnly.querySelectorAll('.settings-shortcuts button')
    ).toHaveLength(1)
    expect(dataOnly.body.textContent).toContain('dataShortcutAction')
  })

  it('drops the whole shortcut section with no destination at all', () => {
    const page = render()

    expect(page.querySelector('.settings-shortcuts')).toBeNull()
    expect(page.body.textContent).not.toContain('shortcutsTitle')
  })
})
