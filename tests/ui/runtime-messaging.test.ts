import { describe, expect, it, vi } from 'vitest'

import { sendRuntimeMessageWithRetry } from '@/extension/content-script/runtime-messaging'

describe('runtime message restart recovery', () => {
  it('retries transient transport failures with the same message', async () => {
    const message = { requestId: 'request:stable' }
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker stopped'))
      .mockResolvedValue({ state: 'acknowledged' })
    const wait = vi.fn(async () => undefined)

    await expect(
      sendRuntimeMessageWithRetry(transport, message, {
        attempts: 3,
        delayMs: 50,
        wait
      })
    ).resolves.toEqual({ state: 'acknowledged' })

    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport).toHaveBeenNthCalledWith(1, message)
    expect(transport).toHaveBeenNthCalledWith(2, message)
    expect(wait).toHaveBeenCalledWith(50)
  })

  it('fails after the bounded number of attempts', async () => {
    const failure = new Error('extension context unavailable')
    const transport = vi.fn(async () => {
      throw failure
    })
    const wait = vi.fn(async () => undefined)

    await expect(
      sendRuntimeMessageWithRetry(
        transport,
        { requestId: 'request:bounded' },
        {
          attempts: 3,
          delayMs: 50,
          wait
        }
      )
    ).rejects.toBe(failure)

    expect(transport).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenNthCalledWith(1, 50)
    expect(wait).toHaveBeenNthCalledWith(2, 100)
  })
})
