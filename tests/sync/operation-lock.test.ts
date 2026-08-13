import { describe, expect, it, vi } from 'vitest'

import { SyncOperationLock } from '@/sync/operation-lock'

describe('sync operation lock', () => {
  it('serializes one active operation per profile and coalesces pending intent', async () => {
    const lock = new SyncOperationLock()
    let release: (() => void) | undefined
    const first = lock.run(
      'sync:one',
      () => new Promise<void>(resolve => (release = resolve))
    )
    const secondOperation = vi.fn(async () => 'second')
    const second = lock.run('sync:one', secondOperation)
    const thirdOperation = vi.fn(async () => 'third')
    const third = lock.run('sync:one', thirdOperation)

    expect(lock.isActive('sync:one')).toBe(true)
    expect(lock.hasPendingIntent('sync:one')).toBe(true)
    expect(secondOperation).not.toHaveBeenCalled()
    release?.()

    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe('second')
    await expect(third).resolves.toBe('second')
    expect(secondOperation).toHaveBeenCalledOnce()
    expect(thirdOperation).not.toHaveBeenCalled()
    expect(lock.isActive('sync:one')).toBe(false)
    expect(lock.hasPendingIntent('sync:one')).toBe(false)
  })

  it('cancels a queued intent without interrupting the active operation', async () => {
    const lock = new SyncOperationLock()
    let release: (() => void) | undefined
    const active = lock.run(
      'sync:cancel',
      () => new Promise<void>(resolve => (release = resolve))
    )
    const pending = lock.run('sync:cancel', async () => 'pending')

    expect(lock.cancelPending('sync:cancel')).toBe(true)
    await expect(pending).rejects.toThrow('sync-disconnected')
    release?.()
    await expect(active).resolves.toBeUndefined()
  })

  it('aborts the active operation and rejects the queued intent on disconnect', async () => {
    const lock = new SyncOperationLock()
    const active = lock.run(
      'sync:abort',
      signal =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        )
    )
    const pending = lock.run('sync:abort', async () => 'pending')

    expect(lock.cancel('sync:abort')).toEqual({
      active: true,
      pending: true
    })
    await expect(active).rejects.toThrow('sync-disconnected')
    await expect(pending).rejects.toThrow('sync-disconnected')
    expect(lock.isActive('sync:abort')).toBe(false)
  })
})
