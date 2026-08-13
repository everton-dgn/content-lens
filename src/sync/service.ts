import { verifySyncEnvelope } from '@/sync/canonical'
import {
  SyncCasService,
  type SyncResolutionStore,
  type SyncRunResult
} from '@/sync/cas-service'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import { resolveSyncConflicts } from '@/sync/conflict-resolution'
import { type SyncConnection, syncConnectionSchema } from '@/sync/connection'
import { decideSyncRecovery, type SyncJournalRecord } from '@/sync/journal'
import { SyncOperationLock } from '@/sync/operation-lock'
import {
  type SyncProvider,
  SyncProviderError
} from '@/sync/providers/contracts'

export type SyncConnectionRepository = {
  readSyncConnection(): Promise<SyncConnection>
  writeSyncConnection(input: unknown): Promise<{ state: 'stored' | 'invalid' }>
  readSyncIdentity?(): Promise<{ syncProfileId: string } | undefined>
  readSyncJournal?(
    syncProfileId: string
  ): Promise<SyncJournalRecord | undefined>
}

type SyncProviderFactory = (connection: SyncConnection) => Promise<SyncProvider>
type SyncStoreFactory = (input: {
  connection: SyncConnection
  operationId: string
  at: string
}) => SyncResolutionStore

export type SyncConnectInput = {
  providerConfigId: string
  endpointPath: string
  remoteObjectId: string
  scheduleMinutes: number | null
  retention: string
  revocation: string
  consentedAt: string
}

export type SyncResolveInput = {
  at: string
  resolutions: readonly SyncConflictResolution[]
}

export class UserOwnedSyncService {
  readonly #repository: SyncConnectionRepository
  readonly #providerFactory: SyncProviderFactory
  readonly #storeFactory: SyncStoreFactory
  readonly #lock: SyncOperationLock

  constructor(input: {
    repository: SyncConnectionRepository
    providerFactory: SyncProviderFactory
    storeFactory: SyncStoreFactory
    lock?: SyncOperationLock
  }) {
    this.#repository = input.repository
    this.#providerFactory = input.providerFactory
    this.#storeFactory = input.storeFactory
    this.#lock = input.lock ?? new SyncOperationLock()
  }

  status() {
    return this.#repository.readSyncConnection()
  }

  async connect(input: SyncConnectInput) {
    const connecting = syncConnectionSchema.parse({
      id: 'active-sync-connection',
      configured: true,
      enabled: false,
      runtimeState: 'connecting',
      providerConfigId: input.providerConfigId,
      endpointPath: input.endpointPath,
      remoteObjectId: input.remoteObjectId,
      scheduleMinutes: input.scheduleMinutes,
      retention: input.retention,
      revocation: input.revocation,
      encryption: 'none',
      consentedAt: input.consentedAt,
      connectedAt: null,
      disconnectedAt: null,
      lastAttemptAt: input.consentedAt,
      lastConfirmedAt: null,
      lastConfirmedDigest: null,
      lastErrorCode: null
    })
    await this.#save(connecting)
    const operationId = `sync-connect:${crypto.randomUUID()}`
    const store = this.#storeFactory({
      connection: connecting,
      operationId,
      at: input.consentedAt
    })
    const local = await store.readLocal()
    return this.#lock.run(local.syncProfileId, async signal => {
      try {
        const provider = await this.#providerFactory(connecting)
        signal.throwIfAborted()
        let remote: { envelope: unknown; versionToken: string }
        try {
          remote = await provider.read({ signal })
        } catch (error) {
          if (
            !(error instanceof SyncProviderError) ||
            error.code !== 'remote-missing'
          ) {
            throw error
          }
          const initialized = await provider.initialize(local, { signal })
          if (initialized.state === 'mismatch') {
            remote = await provider.read({ signal })
          } else {
            const confirmation = await provider.confirm({
              expectedDigest: local.digest,
              expectedVersionToken: initialized.versionToken,
              signal
            })
            if (confirmation.state !== 'confirmed') {
              return this.#connectionFailure(
                connecting,
                'confirmation-mismatch'
              )
            }
            await store.confirmBase({
              envelope: local,
              versionToken: confirmation.versionToken,
              confirmedAt: input.consentedAt
            })
            return this.#connectionReady(
              connecting,
              local.digest,
              input.consentedAt
            )
          }
        }

        const verified = await verifySyncEnvelope(remote.envelope)
        if (!verified.valid) {
          return this.#connectionFailure(connecting, 'invalid-remote')
        }
        if (
          verified.envelope.syncProfileId !== local.syncProfileId ||
          verified.envelope.generation !== local.generation ||
          verified.envelope.digest !== local.digest
        ) {
          return this.#connectionFailure(
            connecting,
            'missing-compatible-base',
            'conflict'
          )
        }
        await store.confirmBase({
          envelope: verified.envelope,
          versionToken: remote.versionToken,
          confirmedAt: input.consentedAt
        })
        return this.#connectionReady(
          connecting,
          verified.envelope.digest,
          input.consentedAt
        )
      } catch (error) {
        if (signal.aborted) {
          return {
            state: 'disconnected' as const,
            connection: await this.#repository.readSyncConnection()
          }
        }
        return this.#connectionFailure(
          connecting,
          error instanceof SyncProviderError ? error.code : 'connection-failed'
        )
      }
    })
  }

  async disconnect(at: string) {
    const current = await this.#repository.readSyncConnection()
    const identity = await this.#repository.readSyncIdentity?.()
    const lockKey = identity?.syncProfileId ?? current.providerConfigId
    if (lockKey) {
      this.#lock.cancel(lockKey)
    }
    const disconnected = syncConnectionSchema.parse({
      ...current,
      enabled: false,
      runtimeState: 'disconnected',
      disconnectedAt: at,
      lastErrorCode: null
    })
    await this.#save(disconnected)
    return disconnected
  }

  async syncNow(
    at: string
  ): Promise<SyncRunResult | { state: 'disconnected' }> {
    const connection = await this.#repository.readSyncConnection()
    if (!connection.enabled || !connection.providerConfigId) {
      return { state: 'disconnected' }
    }
    const operationId = `sync-run:${crypto.randomUUID()}`
    const store = this.#storeFactory({ connection, operationId, at })
    const lockKey = (await store.readLocal()).syncProfileId
    return this.#lock.run(lockKey, async signal => {
      await this.#save({
        ...connection,
        runtimeState: 'pulling',
        lastAttemptAt: at,
        lastErrorCode: null
      })
      let result: SyncRunResult
      try {
        const provider = await this.#providerFactory(connection)
        signal.throwIfAborted()
        result = await new SyncCasService({
          store,
          transport: provider,
          onState: async runtimeState =>
            this.#save({
              ...connection,
              runtimeState,
              lastAttemptAt: at,
              lastErrorCode: null
            })
        }).synchronize(at, signal)
      } catch {
        if (signal.aborted) {
          return { state: 'disconnected' as const }
        }
        result = { state: 'degraded', attempts: 0, code: 'provider-error' }
      }
      if (signal.aborted) {
        return { state: 'disconnected' as const }
      }
      const next = syncConnectionSchema.parse({
        ...connection,
        runtimeState:
          result.state === 'confirmed'
            ? 'idle'
            : result.state === 'conflict'
              ? 'conflict'
              : 'degraded',
        lastAttemptAt: at,
        lastConfirmedAt:
          result.state === 'confirmed' ? at : connection.lastConfirmedAt,
        lastConfirmedDigest:
          result.state === 'confirmed'
            ? result.digest
            : connection.lastConfirmedDigest,
        lastErrorCode: result.state === 'degraded' ? result.code : null
      })
      await this.#save(next)
      return result
    })
  }

  async conflictDraft() {
    const connection = await this.#repository.readSyncConnection()
    if (!connection.configured || !connection.providerConfigId) {
      return undefined
    }
    const store = this.#storeFactory({
      connection,
      operationId: `sync-inspect:${crypto.randomUUID()}`,
      at: new Date().toISOString()
    })
    return store.readConflictDraft()
  }

  async resolveConflict(input: SyncResolveInput) {
    const connection = await this.#repository.readSyncConnection()
    if (!connection.enabled || !connection.providerConfigId) {
      return { state: 'disconnected' as const }
    }
    const operationId = `sync-resolve:${crypto.randomUUID()}`
    const store = this.#storeFactory({
      connection,
      operationId,
      at: input.at
    })
    const draft = await store.readConflictDraft()
    if (!draft) {
      return { state: 'unavailable' as const }
    }
    return this.#lock.run(draft.syncProfileId, async signal => {
      await store.saveConflictResolutions(input.resolutions, input.at)
      const resolved = await resolveSyncConflicts({
        local: draft.local,
        merge: draft.merge,
        resolutions: input.resolutions
      })
      if (resolved.state !== 'resolved') {
        return resolved
      }
      await store.writeJournal({
        phase: 'started',
        candidateDigest: draft.base.digest,
        attempt: 0,
        at: input.at
      })
      await store.writeJournal({
        phase: 'remote-read',
        remoteVersionToken: draft.remoteVersionToken,
        attempt: 1,
        at: input.at
      })
      await store.writeJournal({
        phase: 'validated',
        remoteVersionToken: draft.remoteVersionToken,
        attempt: 1,
        at: input.at
      })
      await store.commitLocal({
        candidate: resolved.candidate,
        recovery: draft.local,
        remoteVersionToken: draft.remoteVersionToken,
        attempt: 1,
        at: input.at
      })
      await store.writeJournal({
        phase: 'push-attempted',
        candidateDigest: resolved.candidate.digest,
        remoteVersionToken: draft.remoteVersionToken,
        attempt: 1,
        at: input.at
      })
      try {
        const provider = await this.#providerFactory(connection)
        signal.throwIfAborted()
        const pushed = await provider.compareAndSwap({
          expectedVersionToken: draft.remoteVersionToken,
          envelope: resolved.candidate,
          signal
        })
        if (pushed.state === 'mismatch') {
          await store.writeJournal({
            phase: 'conflict',
            candidateDigest: resolved.candidate.digest,
            remoteVersionToken: draft.remoteVersionToken,
            attempt: 1,
            at: input.at
          })
          await this.#save({
            ...connection,
            runtimeState: 'conflict',
            lastErrorCode: 'stale-conflict-draft'
          })
          return { state: 'conflict' as const, code: 'stale-remote' as const }
        }
        const confirmed = await provider.confirm({
          expectedDigest: resolved.candidate.digest,
          expectedVersionToken: pushed.versionToken,
          signal
        })
        if (confirmed.state !== 'confirmed') {
          await store.writeJournal({
            phase: 'degraded',
            candidateDigest: resolved.candidate.digest,
            remoteVersionToken: pushed.versionToken,
            attempt: 1,
            at: input.at
          })
          await this.#save({
            ...connection,
            runtimeState: 'degraded',
            lastErrorCode: 'confirmation-mismatch'
          })
          return {
            state: 'degraded' as const,
            code: 'confirmation-mismatch' as const
          }
        }
        await store.writeJournal({
          phase: 'remote-confirmed',
          candidateDigest: resolved.candidate.digest,
          remoteVersionToken: confirmed.versionToken,
          attempt: 1,
          at: input.at
        })
        await store.confirmBase({
          envelope: resolved.candidate,
          versionToken: confirmed.versionToken,
          confirmedAt: input.at
        })
        await store.writeJournal({
          phase: 'completed',
          candidateDigest: resolved.candidate.digest,
          remoteVersionToken: confirmed.versionToken,
          attempt: 1,
          at: input.at
        })
        await store.clearConflictDraft()
        await this.#save({
          ...connection,
          runtimeState: 'idle',
          lastAttemptAt: input.at,
          lastConfirmedAt: input.at,
          lastConfirmedDigest: resolved.candidate.digest,
          lastErrorCode: null
        })
        return {
          state: 'confirmed' as const,
          digest: resolved.candidate.digest
        }
      } catch (error) {
        if (signal.aborted) {
          return { state: 'disconnected' as const }
        }
        await store.writeJournal({
          phase: 'degraded',
          candidateDigest: resolved.candidate.digest,
          remoteVersionToken: draft.remoteVersionToken,
          attempt: 1,
          at: input.at
        })
        await this.#save({
          ...connection,
          runtimeState: 'degraded',
          lastErrorCode:
            error instanceof SyncProviderError ? error.code : 'provider-error'
        })
        return { state: 'degraded' as const, code: 'provider-error' as const }
      }
    })
  }

  async deleteRemote(input: { at: string; confirmedRemoteObjectId: string }) {
    const connection = await this.#repository.readSyncConnection()
    if (
      !connection.configured ||
      !connection.providerConfigId ||
      !connection.remoteObjectId ||
      input.confirmedRemoteObjectId !== connection.remoteObjectId
    ) {
      return { state: 'invalid-confirmation' as const }
    }
    const store = this.#storeFactory({
      connection,
      operationId: `sync-delete-remote:${crypto.randomUUID()}`,
      at: input.at
    })
    const local = await store.readLocal()
    return this.#lock.run(local.syncProfileId, async signal => {
      try {
        const provider = await this.#providerFactory(connection)
        if (!provider.deleteRemote) {
          return {
            state: 'unavailable' as const,
            code: 'remote-delete-unavailable' as const
          }
        }
        const remote = await provider.read({ signal })
        const verified = await verifySyncEnvelope(remote.envelope)
        if (
          !verified.valid ||
          verified.envelope.syncProfileId !== local.syncProfileId
        ) {
          return {
            state: 'conflict' as const,
            code: 'remote-mismatch' as const
          }
        }
        const deleted = await provider.deleteRemote({
          expectedVersionToken: remote.versionToken,
          signal
        })
        if (deleted.state === 'mismatch') {
          return { state: 'conflict' as const, code: 'stale-remote' as const }
        }
        try {
          await provider.read({ signal })
          return {
            state: 'degraded' as const,
            code: 'delete-confirmation-mismatch' as const
          }
        } catch (error) {
          if (
            !(error instanceof SyncProviderError) ||
            error.code !== 'remote-missing'
          ) {
            throw error
          }
        }
        const disconnected = syncConnectionSchema.parse({
          ...connection,
          enabled: false,
          runtimeState: 'disconnected',
          disconnectedAt: input.at,
          lastErrorCode: null
        })
        await this.#save(disconnected)
        return { state: 'deleted' as const, connection: disconnected }
      } catch (error) {
        if (signal.aborted) {
          return { state: 'disconnected' as const }
        }
        return {
          state: 'degraded' as const,
          code:
            error instanceof SyncProviderError ? error.code : 'provider-error'
        }
      }
    })
  }

  async updateSchedule(scheduleMinutes: number | null) {
    const current = await this.#repository.readSyncConnection()
    const next = syncConnectionSchema.parse({ ...current, scheduleMinutes })
    await this.#save(next)
    return next
  }

  async resumeIncomplete(at: string) {
    const connection = await this.#repository.readSyncConnection()
    if (!connection.enabled) {
      return { state: 'idle' as const, reason: 'disconnected' as const }
    }
    const identity = await this.#repository.readSyncIdentity?.()
    if (!identity || !this.#repository.readSyncJournal) {
      return { state: 'idle' as const, reason: 'journal-unavailable' as const }
    }
    const journal = await this.#repository.readSyncJournal(
      identity.syncProfileId
    )
    if (
      !journal ||
      ['completed', 'conflict', 'degraded'].includes(journal.phase)
    ) {
      return { state: 'idle' as const, reason: 'no-recovery' as const }
    }
    const decision = decideSyncRecovery({ journal })
    const result = await this.syncNow(at)
    return { state: 'resumed' as const, decision, result }
  }

  async #connectionReady(
    connection: SyncConnection,
    digest: string,
    at: string
  ) {
    const ready = syncConnectionSchema.parse({
      ...connection,
      enabled: true,
      runtimeState: 'idle',
      connectedAt: at,
      disconnectedAt: null,
      lastConfirmedAt: at,
      lastConfirmedDigest: digest,
      lastErrorCode: null
    })
    await this.#save(ready)
    return { state: 'connected' as const, connection: ready }
  }

  async #connectionFailure(
    connection: SyncConnection,
    code: string,
    runtimeState: 'degraded' | 'conflict' = 'degraded'
  ) {
    const failed = syncConnectionSchema.parse({
      ...connection,
      enabled: false,
      runtimeState,
      lastErrorCode: code
    })
    await this.#save(failed)
    return { state: runtimeState, code, connection: failed } as const
  }

  async #save(connection: SyncConnection) {
    const stored = await this.#repository.writeSyncConnection(connection)
    if (stored.state !== 'stored') {
      throw new TypeError('Unable to persist sync connection state')
    }
  }
}
