import { browser } from 'wxt/browser'

import type { MessageKey } from './message-keys.generated'

export type MessageSubstitutions = string | string[]

export interface BrowserI18nApi {
  getMessage(messageName: string, substitutions?: MessageSubstitutions): string
  getUILanguage(): string
}

export interface I18nRuntime {
  getUiLanguage(): string
  t(key: MessageKey, substitutions?: MessageSubstitutions): string
}

export const createI18nRuntime = (api: BrowserI18nApi): I18nRuntime => ({
  getUiLanguage: () => api.getUILanguage(),
  t: (key, substitutions) => api.getMessage(key, substitutions)
})

const getRuntime = (): I18nRuntime => createI18nRuntime(browser.i18n)

export const getUiLanguage = (): string => getRuntime().getUiLanguage()

export const t = (
  key: MessageKey,
  substitutions?: MessageSubstitutions
): string => getRuntime().t(key, substitutions)
