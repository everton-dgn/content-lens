import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyInterfaceLocale } from './load'
import { installMessageCatalog, t } from './runtime'

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: {
      getAcceptLanguages: async () => ['de-DE'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'de-DE'
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://extension-id${path}`
    }
  }
}))

const packagedCatalog = async (locale: string) =>
  JSON.parse(
    await readFile(
      resolve('public', '_locales', locale, 'messages.json'),
      'utf8'
    )
  ) as unknown

const servePackagedCatalogs = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const locale = /_locales\/([^/]+)\/messages\.json$/u.exec(url)?.[1]

      if (!locale) {
        return { ok: false, json: async () => ({}) }
      }
      const catalog = await packagedCatalog(locale)
      return { ok: true, json: async () => catalog }
    })
  )
}

beforeEach(() => {
  servePackagedCatalogs()
})

afterEach(() => {
  installMessageCatalog(undefined)
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('interface locale application', () => {
  it('installs the packaged catalog of a supported locale', async () => {
    await expect(applyInterfaceLocale('pt_BR')).resolves.toBe('pt_BR')
    expect(t('panelHomeNavigation')).toBe('Início')
  })

  it('resolves each shipped locale from its own catalog', async () => {
    await applyInterfaceLocale('es')
    const spanish = t('panelHomeNavigation')

    await applyInterfaceLocale('en')
    const english = t('panelHomeNavigation')

    expect(english).toBe('Home')
    expect(spanish).not.toBe(english)
    expect(spanish.length).toBeGreaterThan(0)
  })

  it('follows the first preferred language on the automatic choice', async () => {
    const api = {
      getAcceptLanguages: async () => ['pt-BR', 'en-US'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'en-US'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('pt_BR')
    expect(t('panelHomeNavigation')).toBe('Início')
  })

  it('ignores the region of a preferred language', async () => {
    const api = {
      getAcceptLanguages: async () => ['es-419'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'en-US'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('es')
  })

  it('skips preferred languages the extension does not ship', async () => {
    const api = {
      getAcceptLanguages: async () => ['fr-FR', 'de', 'pt'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'en-US'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('pt_BR')
  })

  it('falls back to the interface language with no usable preference', async () => {
    const api = {
      getAcceptLanguages: async () => ['fr-FR'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'es-ES'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('es')
  })

  it('leaves the browser in charge when nothing matches a shipped catalog', async () => {
    const api = {
      getAcceptLanguages: async () => ['fr-FR'],
      getMessage: () => 'Browser message',
      getUILanguage: () => 'de-DE'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBeUndefined()
    expect(t('panelHomeNavigation')).toBe('Browser message')
  })

  it('survives a browser without the preferred-language API', async () => {
    const api = {
      getMessage: () => 'Browser message',
      getUILanguage: () => 'pt-BR'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('pt_BR')
  })

  it('survives a rejected preferred-language lookup', async () => {
    const api = {
      getAcceptLanguages: async () => {
        throw new Error('unavailable')
      },
      getMessage: () => 'Browser message',
      getUILanguage: () => 'es'
    }

    await expect(applyInterfaceLocale('auto', api)).resolves.toBe('es')
  })

  it('keeps the browser language for a locale the extension does not ship', async () => {
    await expect(applyInterfaceLocale('fr')).resolves.toBeUndefined()
    expect(t('panelHomeNavigation')).toBe('Browser message')
  })

  it('keeps the browser language when the packaged catalog is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )

    await expect(applyInterfaceLocale('es')).resolves.toBeUndefined()
    expect(t('panelHomeNavigation')).toBe('Browser message')
  })

  it('keeps the browser language when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unavailable')
      })
    )

    await expect(applyInterfaceLocale('pt_BR')).resolves.toBeUndefined()
    expect(t('panelHomeNavigation')).toBe('Browser message')
  })

  it('rejects a payload that is not a message object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ['panelHomeNavigation']
      }))
    )

    await expect(applyInterfaceLocale('en')).resolves.toBeUndefined()
    expect(t('panelHomeNavigation')).toBe('Browser message')
  })
})
