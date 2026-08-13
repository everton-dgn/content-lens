import { verifySyncEnvelope } from '@/sync/canonical'
import type { SyncConflictDraft } from '@/sync/conflict-draft'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import type { SyncEnvelope } from '@/sync/contracts'
import type { SyncJournalPhase } from '@/sync/journal'
import { retryUnavailable } from '@/sync/retry-policy'
import {
  mergeSyncEnvelopes,
  type SyncConflictRecord
} from '@/sync/three-way-merge'

export type SyncTransportRead = {
  envelope: unknown
  versionToken: string
}

export type SyncTransport = {
  read(input?: { signal?: AbortSignal }): Promise<SyncTransportRead>
  compareAndSwap(input: {
    expectedVersionToken: string
    envelope: SyncEnvelope
    signal?: AbortSignal
  }): Promise<
    { state: 'committed'; versionToken: string } | { state: 'mismatch' }
  >
  confirm(input: {
    expectedDigest: string
    expectedVersionToken: string
    signal?: AbortSignal
  }): Promise<
    { state: 'confirmed'; versionToken: string } | { state: 'mismatch' }
  >
}

export type SyncStore = {
  readLocal(): Promise<SyncEnvelope>
  readBase(): Promise<SyncEnvelope | undefined>
  commitLocal(input: {
    candidate: SyncEnvelope
    recovery: SyncEnvelope
    attempt: number
    remoteVersionToken: string
    at: string
  }): Promise<void>
  confirmBase(input: {
    envelope: SyncEnvelope
    versionToken: string
    confirmedAt: string
  }): Promise<void>
  writeConflictDraft(input: {
    base: SyncEnvelope
    local: SyncEnvelope
    remote: SyncEnvelope
    remoteVersionToken: string
    at: string
  }): Promise<void>
  writeJournal(input: {
    phase: SyncJournalPhase
    candidateDigest?: string
    remoteVersionToken?: string
    attempt: number
    at: string
  }): Promise<void>
}

export type SyncResolutionStore = SyncStore & {
  readConflictDraft(): Promise<SyncConflictDraft | undefined>
  saveConflictResolutions(
    resolutions: readonly SyncConflictResolution[],
    at: string
  ): Promise<void>
  clearConflictDraft(): Promise<void>
}

export type SyncRunResult =
  | { state: 'confirmed'; attempts: number; digest: string }
  | { state: 'conflict'; attempts: number; conflicts: SyncConflictRecord[] }
  | {
      state: 'degraded'
      attempts: number
      code:
        | 'invalid-remote'
        | 'missing-base'
        | 'cas-retry-exhausted'
        | 'confirmation-mismatch'
        | 'provider-error'
    }

export class SyncCasService {
  readonly #store: SyncStore
  readonly #transport: SyncTransport
  readonly #maxAttempts: number
  readonly #sleep: (delayMs: number) => Promise<void>
  readonly #random: () => number
  readonly #onState: (state: 'pulling' | 'merging' | 'pushing') => Promise<void>

  constructor(input: {
    store: SyncStore
    transport: SyncTransport
    maxAttempts?: number
    sleep?: (delayMs: number) => Promise<void>
    random?: () => number
    onState?: (state: 'pulling' | 'merging' | 'pushing') => Promise<void>
  }) {
    this.#store = input.store
    this.#transport = input.transport
    this.#maxAttempts = input.maxAttempts ?? 3
    this.#sleep =
      input.sleep ??
      (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
    this.#random = input.random ?? Math.random
    this.#onState = input.onState ?? (async () => undefined)
    if (this.#maxAttempts < 1 || this.#maxAttempts > 3) {
      throw new RangeError('Sync CAS attempts must be between one and three')
    }
  }

  async synchronize(at: string, signal?: AbortSignal): Promise<SyncRunResult> {
    signal?.throwIfAborted()
    const initialLocal = await this.#store.readLocal()
    const base = await this.#store.readBase()
    if (!base) {
      await this.#store.writeJournal({
        phase: 'degraded',
        attempt: 0,
        at
      })
      return { state: 'degraded', attempts: 0, code: 'missing-base' }
    }
    await this.#store.writeJournal({
      phase: 'started',
      attempt: 0,
      at,
      candidateDigest: base.digest
    })

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const local = await this.#store.readLocal()
      let remoteRead: SyncTransportRead
      try {
        await this.#onState('pulling')
        remoteRead = await this.#retry(
          () => this.#transport.read({ signal }),
          signal
        )
      } catch {
        await this.#degrade(at, attempt)
        return { state: 'degraded', attempts: attempt, code: 'provider-error' }
      }
      if (!validVersionToken(remoteRead.versionToken)) {
        await this.#degrade(at, attempt)
        return { state: 'degraded', attempts: attempt, code: 'provider-error' }
      }
      await this.#store.writeJournal({
        phase: 'remote-read',
        attempt,
        at,
        remoteVersionToken: remoteRead.versionToken
      })
      const verifiedRemote = await verifySyncEnvelope(remoteRead.envelope)
      if (!verifiedRemote.valid) {
        await this.#store.writeJournal({
          phase: 'degraded',
          attempt,
          at,
          remoteVersionToken: remoteRead.versionToken
        })
        return { state: 'degraded', attempts: attempt, code: 'invalid-remote' }
      }
      await this.#store.writeJournal({
        phase: 'validated',
        attempt,
        at,
        remoteVersionToken: remoteRead.versionToken
      })
      await this.#onState('merging')
      const merged = await mergeSyncEnvelopes({
        base,
        local,
        remote: verifiedRemote.envelope
      })
      if (!merged.candidate) {
        await this.#store.writeConflictDraft({
          base,
          local,
          remote: verifiedRemote.envelope,
          remoteVersionToken: remoteRead.versionToken,
          at
        })
        await this.#store.writeJournal({
          phase: 'conflict',
          attempt,
          at,
          remoteVersionToken: remoteRead.versionToken
        })
        return {
          state: 'conflict',
          attempts: attempt,
          conflicts: merged.conflicts
        }
      }
      await this.#store.commitLocal({
        candidate: merged.candidate,
        recovery: initialLocal,
        attempt,
        at,
        remoteVersionToken: remoteRead.versionToken
      })
      await this.#store.writeJournal({
        phase: 'push-attempted',
        attempt,
        at,
        candidateDigest: merged.candidate.digest,
        remoteVersionToken: remoteRead.versionToken
      })
      let pushed: Awaited<ReturnType<SyncTransport['compareAndSwap']>>
      try {
        await this.#onState('pushing')
        pushed = await this.#retry(
          () =>
            this.#transport.compareAndSwap({
              expectedVersionToken: remoteRead.versionToken,
              envelope: merged.candidate as SyncEnvelope,
              signal
            }),
          signal
        )
      } catch {
        await this.#degrade(at, attempt, merged.candidate.digest)
        return { state: 'degraded', attempts: attempt, code: 'provider-error' }
      }
      if (pushed.state === 'mismatch') {
        continue
      }
      let confirmed: Awaited<ReturnType<SyncTransport['confirm']>>
      try {
        await this.#onState('pulling')
        confirmed = await this.#retry(
          () =>
            this.#transport.confirm({
              expectedDigest: merged.candidate?.digest ?? '',
              expectedVersionToken: pushed.versionToken,
              signal
            }),
          signal
        )
      } catch {
        await this.#degrade(at, attempt, merged.candidate.digest)
        return { state: 'degraded', attempts: attempt, code: 'provider-error' }
      }
      if (confirmed.state === 'mismatch') {
        if (attempt < this.#maxAttempts) {
          continue
        }
        await this.#degrade(at, attempt, merged.candidate.digest)
        return {
          state: 'degraded',
          attempts: attempt,
          code: 'confirmation-mismatch'
        }
      }
      await this.#store.writeJournal({
        phase: 'remote-confirmed',
        attempt,
        at,
        candidateDigest: merged.candidate.digest,
        remoteVersionToken: confirmed.versionToken
      })
      await this.#store.confirmBase({
        envelope: merged.candidate,
        versionToken: confirmed.versionToken,
        confirmedAt: at
      })
      await this.#store.writeJournal({
        phase: 'completed',
        attempt,
        at,
        candidateDigest: merged.candidate.digest,
        remoteVersionToken: confirmed.versionToken
      })
      return {
        state: 'confirmed',
        attempts: attempt,
        digest: merged.candidate.digest
      }
    }

    await this.#store.writeJournal({
      phase: 'degraded',
      attempt: this.#maxAttempts,
      at
    })
    return {
      state: 'degraded',
      attempts: this.#maxAttempts,
      code: 'cas-retry-exhausted'
    }
  }

  #retry<T>(operation: () => Promise<T>, signal?: AbortSignal) {
    return retryUnavailable({
      operation: async () => {
        signal?.throwIfAborted()
        return operation()
      },
      sleep: this.#sleep,
      random: this.#random,
      maxAttempts: 3
    })
  }

  async #degrade(at: string, attempt: number, candidateDigest?: string) {
    await this.#store.writeJournal({
      phase: 'degraded',
      attempt,
      at,
      candidateDigest
    })
  }
}

function validVersionToken(value: string) {
  return value.length > 0 && value.length <= 1_024 && !/[\r\n]/.test(value)
}
