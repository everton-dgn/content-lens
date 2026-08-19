import { describe, expect, it, vi } from 'vitest'

import {
  getInjectedOverlayCopy,
  injectedOverlayCopyFields,
  isInjectedOverlayCopy
} from './overlay-copy'

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: {
      getMessage: (key: string) => `translated:${key}`,
      getUILanguage: () => 'en-US'
    }
  }
}))

const complete = Object.fromEntries(
  injectedOverlayCopyFields.map(field => [field, field])
)

describe('injected overlay copy', () => {
  it('accepts the copy the worker resolves', () => {
    expect(isInjectedOverlayCopy(getInjectedOverlayCopy())).toBe(true)
    expect(isInjectedOverlayCopy(complete)).toBe(true)
  })

  it.each(injectedOverlayCopyFields)('rejects copy missing %s', field => {
    const { [field]: _removed, ...partial } = complete

    // The content script gates activation on this predicate, and a rejected
    // message leaves the platform silently inactive, so a missing field has to
    // fail here rather than reach the overlay as undefined text.
    expect(isInjectedOverlayCopy(partial)).toBe(false)
  })

  it('rejects a field that is not text', () => {
    expect(isInjectedOverlayCopy({ ...complete, reveal: 42 })).toBe(false)
    expect(isInjectedOverlayCopy({ ...complete, reveal: null })).toBe(false)
  })

  it('rejects payloads that are not a copy object at all', () => {
    expect(isInjectedOverlayCopy(undefined)).toBe(false)
    expect(isInjectedOverlayCopy(null)).toBe(false)
    expect(isInjectedOverlayCopy('reveal')).toBe(false)
    expect(isInjectedOverlayCopy([complete])).toBe(false)
  })

  it('resolves every declared field through the message catalog', () => {
    const copy = getInjectedOverlayCopy()

    for (const field of injectedOverlayCopyFields) {
      expect(copy[field]).toMatch(/^translated:injected/u)
    }
  })
})
