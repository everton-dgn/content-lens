import type {
  ContentLensDatabase,
  DurableMutationOptions
} from '@/storage/indexed-db/database'
import { verifySyncEnvelope } from '@/sync/canonical'
import {
  resolveSyncConflicts,
  type SyncConflictResolution
} from '@/sync/conflict-resolution'
import type { SyncEnvelope } from '@/sync/contracts'
import { previewPortableChanges } from '@/sync/import-preview'
import { buildLocalSyncEnvelope } from '@/sync/local-envelope'
import {
  materializeImportedSyncEnvelope,
  reconcileMergedSyncEnvelope
} from '@/sync/materialize-import'
import { materializeImportedProfile } from '@/sync/materialize-profile'
import {
  parsePortabilityFile,
  serializeEncryptedPortabilityFile,
  serializePlaintextPortabilityFile
} from '@/sync/portability-format'
import {
  mergeSyncEnvelopes,
  type SyncConflictRecord,
  type SyncMergeResult
} from '@/sync/three-way-merge'

export type PortableImportPreview = {
  currentRevision: number
  encrypted: boolean
  envelope: SyncEnvelope
  changes: ReturnType<typeof previewPortableChanges>
  merge:
    | {
        state: 'unavailable'
        code: 'missing-compatible-base' | 'profile-mismatch'
      }
    | {
        state: 'conflict'
        conflicts: SyncConflictRecord[]
        localEnvelope: SyncEnvelope
        result: SyncMergeResult
      }
    | { state: 'ready'; candidate: SyncEnvelope }
}

export class PortableImportExportService {
  readonly #database: ContentLensDatabase

  constructor(database: ContentLensDatabase) {
    this.#database = database
  }

  async #localEnvelope() {
    const [profile, providerState, identity] = await Promise.all([
      this.#database.exportProfile(),
      this.#database.readProviderState(),
      this.#database.ensureSyncIdentity()
    ])
    if (!profile) {
      throw new TypeError('Local profile is unavailable')
    }
    return {
      envelope: await buildLocalSyncEnvelope({
        generation: identity.generation,
        profile,
        providerState,
        syncProfileId: identity.syncProfileId
      }),
      profile
    }
  }

  async exportPlaintext(createdAt: string) {
    const { envelope } = await this.#localEnvelope()
    return serializePlaintextPortabilityFile(envelope, createdAt)
  }

  async exportEncrypted(input: { createdAt: string; passphrase: string }) {
    const { envelope } = await this.#localEnvelope()
    return serializeEncryptedPortabilityFile(
      envelope,
      input.passphrase,
      input.createdAt
    )
  }

  async preview(raw: string, passphrase?: string) {
    const parsed = await parsePortabilityFile(raw, passphrase)
    if (parsed.state !== 'ready') {
      return parsed
    }
    const local = await this.#localEnvelope()
    materializeImportedSyncEnvelope(parsed.envelope, new Date().toISOString())
    materializeImportedProfile({
      current: local.profile,
      envelope: parsed.envelope,
      importedAt: new Date().toISOString()
    })
    const baseRecord = await this.#database.readSyncBase(
      parsed.envelope.syncProfileId
    )
    let merge: PortableImportPreview['merge']
    if (local.envelope.syncProfileId !== parsed.envelope.syncProfileId) {
      merge = { state: 'unavailable', code: 'profile-mismatch' }
    } else if (!baseRecord) {
      merge = { state: 'unavailable', code: 'missing-compatible-base' }
    } else {
      const verifiedBase = await verifySyncEnvelope(baseRecord.envelope)
      if (!verifiedBase.valid) {
        merge = { state: 'unavailable', code: 'missing-compatible-base' }
      } else {
        const result = await mergeSyncEnvelopes({
          base: verifiedBase.envelope,
          local: local.envelope,
          remote: parsed.envelope
        })
        merge = result.candidate
          ? { state: 'ready', candidate: result.candidate }
          : {
              state: 'conflict',
              conflicts: result.conflicts,
              localEnvelope: local.envelope,
              result
            }
      }
    }
    return {
      state: 'preview' as const,
      preview: {
        currentRevision: local.profile.revision,
        encrypted: parsed.encrypted,
        envelope: parsed.envelope,
        changes: previewPortableChanges(local.envelope, parsed.envelope),
        merge
      } satisfies PortableImportPreview
    }
  }

  async replace(
    preview: PortableImportPreview,
    options: DurableMutationOptions
  ) {
    const current = await this.#database.exportProfile()
    if (!current || current.revision !== preview.currentRevision) {
      return { state: 'stale-preview' as const }
    }
    const materialized = materializeImportedSyncEnvelope(
      preview.envelope,
      options.at
    )
    const profile = materializeImportedProfile({
      current,
      envelope: preview.envelope,
      importedAt: options.at
    })
    return this.#database.replacePortableConfiguration(
      {
        mode: 'replace',
        profile,
        providerState: {
          schemaVersion: 1,
          providers: materialized.providers,
          models: materialized.models,
          consents: [],
          credentials: []
        },
        activeEnvelope: preview.envelope,
        baseEnvelope: preview.envelope
      },
      options
    )
  }

  async resolve(
    preview: PortableImportPreview,
    resolutions: readonly SyncConflictResolution[]
  ) {
    if (preview.merge.state !== 'conflict') {
      return { state: 'resolution-unavailable' as const }
    }
    const resolved = await resolveSyncConflicts({
      local: preview.merge.localEnvelope,
      merge: preview.merge.result,
      resolutions
    })
    return resolved.state === 'resolved'
      ? {
          state: 'resolved' as const,
          preview: {
            ...preview,
            merge: { state: 'ready' as const, candidate: resolved.candidate }
          }
        }
      : resolved
  }

  async merge(preview: PortableImportPreview, options: DurableMutationOptions) {
    if (preview.merge.state !== 'ready') {
      return { state: 'merge-unavailable' as const }
    }
    const current = await this.#database.exportProfile()
    if (!current || current.revision !== preview.currentRevision) {
      return { state: 'stale-preview' as const }
    }
    const currentProviderState = await this.#database.readProviderState()
    const materialized = reconcileMergedSyncEnvelope(
      preview.merge.candidate,
      currentProviderState,
      options.at
    )
    const profile = materializeImportedProfile({
      current,
      envelope: preview.merge.candidate,
      importedAt: options.at
    })
    return this.#database.replacePortableConfiguration(
      {
        mode: 'merge',
        profile,
        providerState: {
          ...materialized
        },
        activeEnvelope: preview.merge.candidate,
        baseEnvelope: preview.envelope
      },
      options
    )
  }
}
