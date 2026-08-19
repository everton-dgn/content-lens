import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createManifest } from '@/config/manifest'

import { collectMessageKeys, renderMessageKeys } from './generate-message-keys'
import { messageKeys } from './message-keys.generated'
import {
  createI18nRuntime,
  getUiLanguage,
  installMessageCatalog,
  t as translate
} from './runtime'

const browserI18n = vi.hoisted(() => ({
  getMessage: vi.fn(() => 'Browser message'),
  getUILanguage: vi.fn(() => 'es')
}))

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: browserI18n
  }
}))

type MessageCatalog = Record<string, { message: string }>

const locales = ['en', 'pt_BR', 'es'] as const
const readCatalog = async (locale: (typeof locales)[number]) =>
  JSON.parse(
    await readFile(
      resolve('public', '_locales', locale, 'messages.json'),
      'utf8'
    )
  ) as MessageCatalog

describe('native i18n catalogs', () => {
  it('localizes browser-owned manifest copy from the English fallback', () => {
    expect(createManifest('chrome')).toMatchObject({
      action: { default_title: '__MSG_actionOpen__' },
      default_locale: 'en',
      description: '__MSG_extensionDescription__',
      name: '__MSG_extensionName__'
    })
  })

  it('maintains parity across locales and keeps messages non-empty', async () => {
    const catalogs = await Promise.all(
      locales.map(async locale => ({
        catalog: await readCatalog(locale),
        locale
      }))
    )
    const canonicalCatalog = catalogs.find(
      ({ locale }) => locale === 'en'
    )?.catalog

    expect(canonicalCatalog).toBeDefined()
    if (!canonicalCatalog) {
      throw new Error('The English i18n catalog is required.')
    }
    const canonicalKeys = collectMessageKeys(canonicalCatalog)

    for (const { catalog } of catalogs) {
      expect(collectMessageKeys(catalog)).toEqual(canonicalKeys)
      for (const descriptor of Object.values(catalog)) {
        expect(descriptor.message.trim()).not.toBe('')
      }
    }
  })

  it('keeps the generated key union synchronized with the English catalog', async () => {
    const catalog = await readCatalog('en')
    const generatedSource = await readFile(
      resolve('src', 'i18n', 'message-keys.generated.ts'),
      'utf8'
    )

    expect(messageKeys).toEqual(collectMessageKeys(catalog))
    expect(generatedSource).toBe(renderMessageKeys(messageKeys))
  })

  it('delegates typed messages and the UI language to the browser', () => {
    const getMessage = vi.fn(() => 'Localized text')
    const runtime = createI18nRuntime({
      getMessage,
      getUILanguage: () => 'pt-BR'
    })

    expect(runtime.t('panelReady')).toBe('Localized text')
    expect(runtime.getUiLanguage()).toBe('pt-BR')
    expect(getMessage).toHaveBeenCalledWith('panelReady', undefined)
  })

  it('uses the browser i18n API through the default runtime', () => {
    expect(translate('panelReady')).toBe('Browser message')
    expect(getUiLanguage()).toBe('es')
    expect(browserI18n.getMessage).toHaveBeenCalledWith('panelReady', undefined)
    expect(browserI18n.getUILanguage).toHaveBeenCalledOnce()
  })

  it('answers from the installed catalog instead of the browser language', () => {
    const getMessage = vi.fn(() => 'Browser text')
    const runtime = createI18nRuntime({
      getMessage,
      getUILanguage: () => 'en-US'
    })
    installMessageCatalog({
      catalog: { panelReady: { message: 'Pronto' } },
      locale: 'pt_BR'
    })

    try {
      expect(runtime.t('panelReady')).toBe('Pronto')
      expect(runtime.getUiLanguage()).toBe('pt-BR')
      expect(getMessage).not.toHaveBeenCalled()
    } finally {
      installMessageCatalog(undefined)
    }
  })

  it('falls back to the browser language once the catalog is cleared', () => {
    installMessageCatalog({
      catalog: { panelReady: { message: 'Pronto' } },
      locale: 'pt_BR'
    })
    installMessageCatalog(undefined)

    expect(translate('panelReady')).toBe('Browser message')
    expect(getUiLanguage()).toBe('es')
  })

  it('prevents visible panel copy from being hard-coded in JSX or HTML', async () => {
    const appSource = await readFile(
      resolve('src', 'entrypoints', 'sidepanel', 'App.tsx'),
      'utf8'
    )
    const jsxText = [...appSource.matchAll(/>([^<>{]+)<\/[A-Za-z]/g)]
      .map(match => match[1]?.trim())
      .filter(Boolean)
    const literalExpressions = [
      ...appSource.matchAll(/>\s*{\s*["'`]([^"'`]+)["'`]\s*}\s*</g)
    ].map(match => match[1])
    const visibleAttributes = [
      ...appSource.matchAll(/\b(?:alt|aria-label|placeholder|title)="([^"]+)"/g)
    ].map(match => match[1])

    const html = await readFile(
      resolve('src', 'entrypoints', 'sidepanel', 'index.html'),
      'utf8'
    )
    const title = html.match(/<title>(.*?)<\/title>/s)?.[1]?.trim()

    expect([...jsxText, ...literalExpressions, ...visibleAttributes]).toEqual(
      []
    )
    expect(title).toBe('')
  })
})
