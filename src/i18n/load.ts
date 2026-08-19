import { browser } from 'wxt/browser'

import {
  isSupportedLocale,
  type MessageCatalog,
  matchSupportedLocale,
  type SupportedLocale
} from './catalog'
import { type BrowserI18nApi, installMessageCatalog } from './runtime'

export type BrowserLanguageApi = BrowserI18nApi & {
  getAcceptLanguages?(): Promise<string[]>
}

/**
 * Reads the catalog the browser already ships inside the package. Extension
 * pages and the worker can read their own files without exposing them to any
 * site, so this costs no bundle space and no manifest surface.
 */
export const loadCatalog = async (
  locale: SupportedLocale
): Promise<MessageCatalog | undefined> => {
  try {
    const response = await fetch(
      browser.runtime.getURL(`/_locales/${locale}/messages.json`)
    )

    if (!response.ok) {
      return undefined
    }
    const catalog = (await response.json()) as unknown

    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      return undefined
    }
    return catalog as MessageCatalog
  } catch {
    return undefined
  }
}

/**
 * Resolves the automatic choice. The browser i18n API answers in the interface
 * language, which on some systems stays English even when the reader put
 * another language first, so the preferred list is consulted before it.
 */
export const resolveAutomaticLocale = async (
  api: BrowserLanguageApi
): Promise<SupportedLocale | undefined> => {
  const accepted = await Promise.resolve(
    api.getAcceptLanguages?.() ?? []
  ).catch(() => [] as string[])

  return matchSupportedLocale([...accepted, api.getUILanguage()])
}

/**
 * Applies the stored interface language. An unreadable catalog or a language
 * the extension does not ship leaves the browser-resolved language in place,
 * so a failed load degrades instead of showing an untranslated interface.
 */
export const applyInterfaceLocale = async (
  locale: string,
  api: BrowserLanguageApi = browser.i18n
): Promise<SupportedLocale | undefined> => {
  const resolved = isSupportedLocale(locale)
    ? locale
    : locale === 'auto'
      ? await resolveAutomaticLocale(api)
      : undefined

  if (!resolved) {
    installMessageCatalog(undefined)
    return undefined
  }
  const catalog = await loadCatalog(resolved)

  if (!catalog) {
    installMessageCatalog(undefined)
    return undefined
  }
  installMessageCatalog({ catalog, locale: resolved })
  return resolved
}
