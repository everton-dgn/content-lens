import { describe, expect, it } from 'vitest'

import {
  isSupportedLocale,
  localeTagFor,
  type MessageCatalog,
  matchSupportedLocale,
  resolveMessage
} from './catalog'
import type { MessageKey } from './message-keys.generated'

const key = (value: string) => value as MessageKey

describe('message catalog resolution', () => {
  it('expands named placeholders through their numbered content', () => {
    const catalog: MessageCatalog = {
      reviewScoreLabel: {
        message: '$SCORE$ match',
        placeholders: { score: { content: '$1' } }
      }
    }

    expect(resolveMessage(catalog, key('reviewScoreLabel'), '82%')).toBe(
      '82% match'
    )
  })

  it('fills every numbered token from an ordered substitution list', () => {
    const catalog: MessageCatalog = {
      scope: {
        message: '$COUNT$ items, $UPDATES$ updates and $PROTECTED$ protected',
        placeholders: {
          count: { content: '$1' },
          updates: { content: '$2' },
          protected: { content: '$3' }
        }
      }
    }

    expect(resolveMessage(catalog, key('scope'), ['9', '2', '1'])).toBe(
      '9 items, 2 updates and 1 protected'
    )
  })

  it('drops tokens with no matching substitution instead of printing them', () => {
    const catalog: MessageCatalog = {
      scope: {
        message: '$COUNT$ items',
        placeholders: { count: { content: '$1' } }
      }
    }

    expect(resolveMessage(catalog, key('scope'), [])).toBe(' items')
  })

  it('keeps a literal dollar sign and an undeclared placeholder intact', () => {
    const catalog: MessageCatalog = {
      price: { message: '$$5 for $UNKNOWN$' }
    }

    expect(resolveMessage(catalog, key('price'))).toBe('$5 for $UNKNOWN$')
  })

  it('answers an empty string for a key the catalog does not carry', () => {
    expect(resolveMessage({}, key('missingKey'))).toBe('')
  })

  it('recognizes only the locales the extension ships', () => {
    expect(isSupportedLocale('pt_BR')).toBe(true)
    expect(isSupportedLocale('en')).toBe(true)
    expect(isSupportedLocale('es')).toBe(true)
    expect(isSupportedLocale('auto')).toBe(false)
    expect(isSupportedLocale('fr')).toBe(false)
  })

  it('matches a browser language list against the shipped catalogs', () => {
    expect(matchSupportedLocale(['pt-BR', 'en-US'])).toBe('pt_BR')
    expect(matchSupportedLocale(['fr-FR', 'de', 'es'])).toBe('es')
    expect(matchSupportedLocale(['en_GB'])).toBe('en')
    expect(matchSupportedLocale(['PT'])).toBe('pt_BR')
    expect(matchSupportedLocale(['fr-FR', 'de-DE'])).toBeUndefined()
    expect(matchSupportedLocale([])).toBeUndefined()
  })

  it('maps each locale to its BCP 47 tag for the document language', () => {
    expect(localeTagFor('pt_BR')).toBe('pt-BR')
    expect(localeTagFor('en')).toBe('en')
    expect(localeTagFor('es')).toBe('es')
  })
})
