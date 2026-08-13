// biome-ignore-all lint/performance/noJsxPropsBind: static markup snapshots need no stable handler identity.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultSettings } from '@/core/settings'
import { DiagnosticsSettings } from '@/ui/settings/DiagnosticsSettings'
import { GeneralSettings } from '@/ui/settings/GeneralSettings'
import { InterfaceSettings } from '@/ui/settings/InterfaceSettings'

vi.mock('@/i18n/runtime', () => ({
  t: (key: string) => key
}))

const copy = new Proxy(
  {
    generalModelCount: (count: number) => `generalModelCount:${count}`,
    generalProviderCount: (count: number) => `generalProviderCount:${count}`
  } as Record<string, unknown>,
  {
    get: (target, property: string) =>
      property in target ? target[property] : property
  }
  // biome-ignore lint/suspicious/noExplicitAny: the copy contract is exercised through its keys.
) as any

const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, 'text/html')

const snapshot = {
  providers: { providers: [], models: [] }
  // biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
} as any

describe('settings accessibility', () => {
  it('keeps one heading level and a labelled term list in the overview', () => {
    const page = parse(
      renderToStaticMarkup(
        <GeneralSettings
          copy={copy}
          draft={createDefaultSettings()}
          onOpenData={() => undefined}
          onOpenFeeds={() => undefined}
          snapshot={snapshot}
        />
      )
    )

    const headings = Array.from(
      page.querySelectorAll('h1, h2, h3, h4'),
      node => node.tagName
    )
    expect(headings).toEqual(['H3', 'H3'])

    const list = page.querySelector('dl')
    expect(list).not.toBeNull()
    expect(page.querySelectorAll('dt')).toHaveLength(4)
    expect(page.querySelectorAll('dd')).toHaveLength(4)
  })

  it('exposes every shortcut as a secondary action, never a primary one', () => {
    const page = parse(
      renderToStaticMarkup(
        <GeneralSettings
          copy={copy}
          draft={createDefaultSettings()}
          onOpenData={() => undefined}
          onOpenFeeds={() => undefined}
          snapshot={snapshot}
        />
      )
    )

    const buttons = Array.from(page.querySelectorAll('button'))
    expect(buttons).toHaveLength(2)
    expect(
      buttons.every(
        button => button.getAttribute('data-variant') === 'secondary'
      )
    ).toBe(true)
    expect(page.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)
  })

  it('gives every interface control a programmatic label', () => {
    const page = parse(
      renderToStaticMarkup(
        <InterfaceSettings
          copy={copy}
          draft={createDefaultSettings()}
          updateDraft={() => undefined}
        />
      )
    )

    const controls = Array.from(
      page.querySelectorAll(
        'input:not([aria-hidden="true"]), select:not([aria-hidden="true"]), button[role="combobox"], button[role="switch"]'
      )
    )
    expect(controls.length).toBeGreaterThanOrEqual(3)

    for (const control of controls) {
      const id = control.getAttribute('id')
      const labelled =
        control.getAttribute('aria-label') ??
        page.getElementById(control.getAttribute('aria-labelledby') ?? '')
          ?.textContent ??
        (id ? page.querySelector(`label[for="${id}"]`)?.textContent : null) ??
        control.closest('label')?.textContent
      expect(labelled, control.outerHTML).toBeTruthy()
    }
  })

  it('announces the color mode switch with switch semantics', () => {
    const page = parse(
      renderToStaticMarkup(
        <InterfaceSettings
          copy={copy}
          draft={createDefaultSettings()}
          updateDraft={() => undefined}
        />
      )
    )

    const advanced = page.querySelector('[role="switch"]')
    expect(advanced).not.toBeNull()
    expect(advanced?.tagName).toBe('BUTTON')
    expect(advanced?.getAttribute('type')).toBe('button')
  })

  it('keeps the diagnostics view free of a primary or danger action', () => {
    const page = parse(
      renderToStaticMarkup(
        <DiagnosticsSettings copy={copy} onOpenData={() => undefined} />
      )
    )

    expect(page.querySelector('h3')).not.toBeNull()
    expect(page.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)
    expect(page.querySelectorAll('[data-variant="danger"]')).toHaveLength(0)
    expect(page.querySelectorAll('[data-variant="secondary"]')).toHaveLength(1)
  })
})
