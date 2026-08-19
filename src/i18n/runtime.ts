import { browser } from 'wxt/browser'

import {
  localeTagFor,
  type MessageCatalog,
  type MessageSubstitutions,
  resolveMessage,
  type SupportedLocale
} from './catalog'
import type { MessageKey } from './message-keys.generated'

export type { MessageSubstitutions } from './catalog'

export interface BrowserI18nApi {
  getMessage(messageName: string, substitutions?: MessageSubstitutions): string
  getUILanguage(): string
}

export interface I18nRuntime {
  getUiLanguage(): string
  t(key: MessageKey, substitutions?: MessageSubstitutions): string
}

export type InstalledCatalog = {
  catalog: MessageCatalog
  locale: SupportedLocale
}

let installed: InstalledCatalog | undefined

/**
 * Overrides the browser-resolved locale with an explicit catalog. The browser
 * i18n API always answers in the browser UI language, so an extension-level
 * language choice can only be honored by resolving the catalog here.
 */
export const installMessageCatalog = (next: InstalledCatalog | undefined) => {
  installed = next
}

/**
 * Reports the language currently answering messages. The packaged catalog of a
 * language never changes while the extension runs, so a caller that would
 * install the same language again can skip reading it.
 */
export const getInstalledLocale = (): SupportedLocale | undefined =>
  installed?.locale

export const createI18nRuntime = (api: BrowserI18nApi): I18nRuntime => ({
  getUiLanguage: () =>
    installed ? localeTagFor(installed.locale) : api.getUILanguage(),
  t: (key, substitutions) =>
    installed
      ? resolveMessage(installed.catalog, key, substitutions)
      : api.getMessage(key, substitutions)
})

const getRuntime = (): I18nRuntime => createI18nRuntime(browser.i18n)

export const getUiLanguage = (): string => getRuntime().getUiLanguage()

export const t = (
  key: MessageKey,
  substitutions?: MessageSubstitutions
): string => getRuntime().t(key, substitutions)
