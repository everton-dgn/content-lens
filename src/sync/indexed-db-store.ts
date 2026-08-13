import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SyncResolutionStore, SyncStore } from '@/sync/cas-service'
import { createSyncConflictDraft } from '@/sync/conflict-draft'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import {
  advanceSyncJournal,
  createSyncJournal,
  type SyncJournalRecord
} from '@/sync/journal'
import { buildLocalSyncEnvelope } from '@/sync/local-envelope'
import { reconcileLocalProjection } from '@/sync/reconcile-local'

type IndexedDbSyncStoreOptions = {
  database: ContentLensDatabase
  providerConfigId: string
  remoteObjectId: string
  operationId: string
  at: string
}

export class IndexedDbSyncStore implements SyncResolutionStore {
  readonly #database: ContentLensDatabase
  readonly #providerConfigId: string
  readonly #remoteObjectId: string
  readonly #operationId: string
  readonly #at: string

  constructor(options: IndexedDbSyncStoreOptions) {
    this.#database = options.database
    this.#providerConfigId = options.providerConfigId
    this.#remoteObjectId = options.remoteObjectId
    this.#operationId = options.operationId
    this.#at = options.at
  }

  async readLocal() {
    const [profile, providerState, identity, active] = await Promise.all([
      this.#database.exportProfile(),
      this.#database.readProviderState(),
      this.#database.ensureSyncIdentity(),
      this.#database.readActiveSyncEnvelope()
    ])
    if (!profile) {
      throw new TypeError('Local profile is unavailable')
    }
    const base = await this.#database.readSyncBase(identity.syncProfileId)
    const projection = await buildLocalSyncEnvelope({
      generation: identity.generation,
      profile,
      providerState,
      syncProfileId: identity.syncProfileId
    })
    return reconcileLocalProjection({
      previous: active ?? base?.envelope,
      projection,
      at: this.#at
    })
  }

  async readBase() {
    const identity = await this.#database.readSyncIdentity()
    if (!identity) {
      return undefined
    }
    return (await this.#database.readSyncBase(identity.syncProfileId))?.envelope
  }

  async commitLocal(input: Parameters<SyncStore['commitLocal']>[0]) {
    const journal = await this.#requireJournal()
    const snapshotCreated = advanceSyncJournal(journal, {
      phase: 'snapshot-created',
      attempt: input.attempt,
      at: input.at,
      candidateDigest: input.candidate.digest,
      remoteVersionToken: input.remoteVersionToken
    })
    const localCommitted = advanceSyncJournal(snapshotCreated, {
      phase: 'local-committed',
      attempt: input.attempt,
      at: input.at,
      candidateDigest: input.candidate.digest,
      remoteVersionToken: input.remoteVersionToken
    })
    const committed = await this.#database.commitSyncCandidate(
      input.candidate,
      {
        at: input.at,
        operationId: this.#operationId,
        journal: localCommitted
      }
    )
    if (committed.state !== 'committed') {
      throw new TypeError('Unable to commit the synchronized candidate')
    }
  }

  async confirmBase(input: Parameters<SyncStore['confirmBase']>[0]) {
    const confirmed = await this.#database.confirmSyncBase({
      envelope: input.envelope,
      providerConfigId: this.#providerConfigId,
      remoteObjectId: this.#remoteObjectId,
      versionToken: input.versionToken,
      confirmedAt: input.confirmedAt
    })
    if (confirmed.state !== 'confirmed') {
      throw new TypeError('Unable to confirm the synchronized base')
    }
  }

  async writeConflictDraft(
    input: Parameters<SyncStore['writeConflictDraft']>[0]
  ) {
    const draft = await createSyncConflictDraft(input)
    const stored = await this.#database.writeSyncConflictDraft(draft)
    if (stored.state !== 'stored') {
      throw new TypeError('Unable to persist the sync conflict draft')
    }
  }

  async readConflictDraft() {
    const identity = await this.#database.ensureSyncIdentity()
    return this.#database.readSyncConflictDraft(identity.syncProfileId)
  }

  async saveConflictResolutions(
    resolutions: readonly SyncConflictResolution[],
    at: string
  ) {
    const draft = await this.readConflictDraft()
    if (!draft) {
      throw new TypeError('Sync conflict draft is unavailable')
    }
    const stored = await this.#database.writeSyncConflictDraft({
      ...draft,
      resolutions: structuredClone(resolutions),
      updatedAt: at
    })
    if (stored.state !== 'stored') {
      throw new TypeError('Unable to persist sync conflict resolutions')
    }
  }

  async clearConflictDraft() {
    const identity = await this.#database.ensureSyncIdentity()
    await this.#database.clearSyncConflictDraft(identity.syncProfileId)
  }

  async writeJournal(input: Parameters<SyncStore['writeJournal']>[0]) {
    let journal: SyncJournalRecord
    if (input.phase === 'started') {
      journal = createSyncJournal({
        operationId: this.#operationId,
        syncProfileId: (await this.#database.ensureSyncIdentity())
          .syncProfileId,
        baseDigest: input.candidateDigest ?? '0'.repeat(64),
        at: input.at
      })
    } else {
      const existing = await this.#database.readSyncJournal(
        (await this.#database.ensureSyncIdentity()).syncProfileId
      )
      if (!existing) {
        const started = createSyncJournal({
          operationId: this.#operationId,
          syncProfileId: (await this.#database.ensureSyncIdentity())
            .syncProfileId,
          baseDigest: '0'.repeat(64),
          at: input.at
        })
        journal = advanceSyncJournal(started, {
          ...input,
          phase: 'degraded'
        })
      } else {
        journal = advanceSyncJournal(existing, input)
      }
    }
    const stored = await this.#database.writeSyncJournal(journal)
    if (stored.state !== 'stored') {
      throw new TypeError('Unable to persist the sync journal')
    }
  }

  async #requireJournal() {
    const identity = await this.#database.ensureSyncIdentity()
    const journal = await this.#database.readSyncJournal(identity.syncProfileId)
    if (!journal) {
      throw new TypeError('Sync journal is unavailable')
    }
    return journal
  }
}
