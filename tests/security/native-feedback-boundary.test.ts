import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { issueTrustedUserGesture } from '@/application/native-feedback/gesture'
import {
  nativeFeedbackAddenda,
  nativeFeedbackCapability
} from '@/application/native-feedback/registry'

describe('native feedback security boundary', () => {
  it.each([
    ['classifier', { isTrusted: false, type: 'click' }],
    ['model', { isTrusted: false, type: 'keydown' }],
    ['timer', { isTrusted: false, type: 'timer' }],
    ['background', { isTrusted: false, type: 'message' }],
    ['page script', { isTrusted: false, type: 'click' }]
  ])('rejects gesture issuance from %s', (_source, event) => {
    expect(
      issueTrustedUserGesture(event, {
        attemptId: 'attempt:1',
        reviewFingerprint: 'fingerprint:1',
        occurredAt: '2026-07-31T12:00:00.000Z'
      })
    ).toBeUndefined()
  })

  it('keeps every real platform addendum disabled without a live smoke', () => {
    for (const addendum of Object.values(nativeFeedbackAddenda)) {
      expect(addendum.lastLiveSmokeAt).toBeNull()
      expect(
        addendum.capabilities.every(
          capability => capability.state !== 'supported'
        )
      ).toBe(true)
    }
  })

  it('resolves declared capabilities and creates a platform-safe fallback', () => {
    expect(
      nativeFeedbackCapability(
        'youtube',
        'youtube:home',
        'youtube:not-interested'
      )
    ).toMatchObject({
      platform: 'youtube',
      state: 'unsupported',
      code: 'live-menu-and-confirmation-not-verified'
    })
    expect(
      nativeFeedbackCapability(
        'hacker-news',
        'hacker-news:front-page',
        'youtube:not-interested'
      )
    ).toMatchObject({
      platform: 'hacker-news',
      state: 'unavailable',
      actionType: 'youtube:not-interested',
      code: 'native-action-not-declared'
    })
  })

  it('contains no account or network access in the DOM activation boundary', async () => {
    const source = await readFile(
      resolve('src/application/native-feedback/dom-adapter.ts'),
      'utf8'
    )
    for (const forbidden of [
      'document.cookie',
      'localStorage',
      'sessionStorage',
      'fetch(',
      'XMLHttpRequest',
      'Authorization',
      'browser.cookies',
      'chrome.cookies'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
