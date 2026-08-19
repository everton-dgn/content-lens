import type { MessageKey } from './message-keys.generated'

export type MessageSubstitutions = string | string[]

export type CatalogEntry = {
  message: string
  placeholders?: Record<string, { content: string }>
}

export type MessageCatalog = Record<string, CatalogEntry>

export const supportedLocales = ['en', 'pt_BR', 'es'] as const

export type SupportedLocale = (typeof supportedLocales)[number]

export const isSupportedLocale = (value: string): value is SupportedLocale =>
  (supportedLocales as readonly string[]).includes(value)

const localeTags: Record<SupportedLocale, string> = {
  en: 'en',
  es: 'es',
  pt_BR: 'pt-BR'
}

export const localeTagFor = (locale: SupportedLocale): string =>
  localeTags[locale]

const localesByLanguage: Record<string, SupportedLocale> = {
  en: 'en',
  es: 'es',
  pt: 'pt_BR'
}

/**
 * Picks the first shipped catalog that matches a browser language list. Region
 * is ignored because the extension ships one catalog per language, so `pt-PT`
 * and `en-GB` still reach a readable interface.
 */
export const matchSupportedLocale = (
  tags: readonly string[]
): SupportedLocale | undefined => {
  for (const tag of tags) {
    const language = tag.split(/[-_]/u)[0]?.toLowerCase()
    const locale = language ? localesByLanguage[language] : undefined

    if (locale) {
      return locale
    }
  }
  return undefined
}

const substitutionAt = (
  substitutions: MessageSubstitutions | undefined,
  index: number
): string => {
  if (substitutions === undefined) {
    return ''
  }
  const values =
    typeof substitutions === 'string' ? [substitutions] : substitutions
  return values[index - 1] ?? ''
}

const applyPlaceholders = (
  message: string,
  placeholders: CatalogEntry['placeholders']
): string => {
  if (!placeholders) {
    return message
  }
  const contents = new Map(
    Object.entries(placeholders).map(([name, { content }]) => [
      name.toLowerCase(),
      content
    ])
  )
  return message.replaceAll(/\$([a-z0-9_@]+)\$/giu, (match, name: string) => {
    const content = contents.get(name.toLowerCase())
    return content ?? match
  })
}

const applySubstitutions = (
  message: string,
  substitutions: MessageSubstitutions | undefined
): string =>
  message.replaceAll(/\$(\$|[1-9])/gu, (_match, token: string) =>
    token === '$' ? '$' : substitutionAt(substitutions, Number(token))
  )

/**
 * Resolves one catalog entry the way `browser.i18n.getMessage` does: named
 * placeholders expand to their `$n` content first, then numbered tokens take
 * the caller substitutions. An unknown key resolves to an empty string, which
 * is what the browser API returns.
 */
export const resolveMessage = (
  catalog: MessageCatalog,
  key: MessageKey,
  substitutions?: MessageSubstitutions
): string => {
  const entry = catalog[key]

  if (!entry) {
    return ''
  }

  return applySubstitutions(
    applyPlaceholders(entry.message, entry.placeholders),
    substitutions
  )
}
