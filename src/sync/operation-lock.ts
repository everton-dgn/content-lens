type PendingOperation = {
  operation: (signal: AbortSignal) => Promise<unknown>
  promise: Promise<unknown>
  resolve(value: unknown): void
  reject(reason: unknown): void
}

type LockEntry = {
  active: Promise<unknown>
  controller: AbortController
  pending?: PendingOperation
}

export class SyncOperationLock {
  readonly #entries = new Map<string, LockEntry>()

  run<T>(
    syncProfileId: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const current = this.#entries.get(syncProfileId)
    if (!current) {
      return this.#start(syncProfileId, operation)
    }
    if (current.pending) {
      return current.pending.promise as Promise<T>
    }

    let resolve: (value: unknown) => void = () => undefined
    let reject: (reason: unknown) => void = () => undefined
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    current.pending = { operation, promise, resolve, reject }
    return promise as Promise<T>
  }

  isActive(syncProfileId: string) {
    return this.#entries.has(syncProfileId)
  }

  hasPendingIntent(syncProfileId: string) {
    return this.#entries.get(syncProfileId)?.pending !== undefined
  }

  cancelPending(syncProfileId: string, reason = 'sync-disconnected') {
    const entry = this.#entries.get(syncProfileId)
    if (!entry?.pending) {
      return false
    }
    const pending = entry.pending
    entry.pending = undefined
    pending.reject(new Error(reason))
    return true
  }

  cancelActive(syncProfileId: string, reason = 'sync-disconnected') {
    const entry = this.#entries.get(syncProfileId)
    if (!entry) {
      return false
    }
    entry.controller.abort(new Error(reason))
    return true
  }

  cancel(syncProfileId: string, reason = 'sync-disconnected') {
    return {
      active: this.cancelActive(syncProfileId, reason),
      pending: this.cancelPending(syncProfileId, reason)
    }
  }

  #start<T>(
    syncProfileId: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController()
    const running = operation(controller.signal)
    this.#entries.set(syncProfileId, { active: running, controller })
    void running.then(
      () => this.#advance(syncProfileId, running),
      () => this.#advance(syncProfileId, running)
    )
    return running
  }

  #advance(syncProfileId: string, completed: Promise<unknown>) {
    const entry = this.#entries.get(syncProfileId)
    if (!entry || entry.active !== completed) {
      return
    }
    const pending = entry.pending
    if (!pending) {
      this.#entries.delete(syncProfileId)
      return
    }

    const controller = new AbortController()
    const next = pending.operation(controller.signal)
    this.#entries.set(syncProfileId, { active: next, controller })
    next.then(pending.resolve, pending.reject)
    void next.then(
      () => this.#advance(syncProfileId, next),
      () => this.#advance(syncProfileId, next)
    )
  }
}
