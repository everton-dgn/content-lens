import { describe, expect, it, vi } from 'vitest'

import { SyncProviderError } from '@/sync/providers/contracts'
import {
  parseRetryAfter,
  retryDelay,
  retryUnavailable
} from '@/sync/retry-policy'

describe('sync retry policy', () => {
  it('parses seconds and HTTP dates and treats Retry-After as a minimum', () => {
    const now = Date.parse('2026-07-31T12:00:00.000Z')
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter('Fri, 31 Jul 2026 12:02:00 GMT', now)).toBe(120_000)
    expect(parseRetryAfter('invalid', now)).toBeUndefined()
    expect(
      retryDelay({ attempt: 2, random: () => 0.25, retryAfterMs: 5_000 })
    ).toBe(5_000)
  })

  it('retries only typed retryable failures with jittered backoff', async () => {
    const sleep = vi.fn(async () => undefined)
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new SyncProviderError({
          code: 'remote-unavailable',
          retryable: true,
          retryAfterMs: 2_000
        })
      )
      .mockResolvedValue('ok')

    await expect(
      retryUnavailable({ operation, sleep, random: () => 0 })
    ).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2_000)

    const authenticationError = new SyncProviderError({
      code: 'authentication-required',
      retryable: false
    })
    await expect(
      retryUnavailable({
        operation: async () => {
          throw authenticationError
        },
        sleep
      })
    ).rejects.toBe(authenticationError)
  })
})
