import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import {
  type ProfileEnvelope,
  parseProfileEnvelope
} from '@/storage/contracts/profile-envelope'
import {
  MIGRATION_EVIDENCE_ID,
  MIGRATION_SNAPSHOT_ID,
  MIGRATION_SNAPSHOT_RETENTION_MS,
  type MigrationJournal,
  type MigrationManifest,
  type MigrationPhase,
  type MigrationSnapshot,
  type MigrationStore
} from '@/storage/migrations/contracts'

export const MIGRATION_FAULT_PHASES = [
  'preflight',
  'snapshotting',
  'snapshot-ready',
  'applying',
  'validating-target',
  'committed',
  'cleanup-pending'
] as const satisfies readonly MigrationPhase[]

export type MigrationFaultPoint = {
  phase: (typeof MIGRATION_FAULT_PHASES)[number]
  boundary: 'before' | 'after' | 'after-commit'
}

type MigrationRunnerOptions = {
  injectFault?: (point: MigrationFaultPoint) => void | Promise<void>
  reserveSnapshot?: (
    requiredBytes: number,
    operationId: string
  ) => boolean | Promise<boolean>
}

type MigrationResult =
  | {
      state: 'complete' | 'already-current'
      sourceVersion: MigrationManifest['sourceVersion']
      targetVersion: MigrationManifest['targetVersion']
    }
  | {
      state: 'blocked' | 'blocked-unreadable' | 'failed'
      code: string
      sourceVersion: MigrationManifest['sourceVersion']
      targetVersion: MigrationManifest['targetVersion']
    }

type SnapshotValidation =
  | { valid: true; profile: ProfileEnvelope }
  | {
      valid: false
      code: 'invalid-snapshot' | 'snapshot-digest-mismatch' | 'snapshot-expired'
    }

function versionsEqual(
  left: MigrationManifest['sourceVersion'],
  right: MigrationManifest['sourceVersion']
) {
  return left.major === right.major && left.minor === right.minor
}

function terminalResult(
  journal: MigrationJournal,
  manifest: MigrationManifest
): MigrationResult | undefined {
  if (
    journal.phase !== 'blocked' &&
    journal.phase !== 'blocked-unreadable' &&
    journal.phase !== 'failed'
  ) {
    return undefined
  }
  return {
    state: journal.phase,
    code: journal.code ?? 'migration-failed',
    sourceVersion: manifest.sourceVersion,
    targetVersion: manifest.targetVersion
  }
}

function expiryFrom(at: string) {
  return new Date(
    new Date(at).getTime() + MIGRATION_SNAPSHOT_RETENTION_MS
  ).toISOString()
}

async function snapshotFor(
  profile: ProfileEnvelope,
  operationId: string,
  at: string
): Promise<MigrationSnapshot> {
  return {
    id: MIGRATION_SNAPSHOT_ID,
    operationId,
    createdAt: at,
    expiresAt: expiryFrom(at),
    profile: structuredClone(profile),
    digest: await fingerprintPortableValue(profile),
    counts: {
      rules: profile.rules.length,
      feedbackExamples: profile.feedbackExamples.length
    },
    validated: true
  }
}

export async function validateMigrationSnapshot(
  snapshot: MigrationSnapshot,
  at: string
): Promise<SnapshotValidation> {
  const parsed = parseProfileEnvelope(snapshot.profile)
  if (
    !parsed.success ||
    snapshot.validated !== true ||
    snapshot.id !== MIGRATION_SNAPSHOT_ID ||
    snapshot.counts.rules !== snapshot.profile.rules.length ||
    snapshot.counts.feedbackExamples !==
      snapshot.profile.feedbackExamples.length
  ) {
    return { valid: false, code: 'invalid-snapshot' }
  }
  if (new Date(snapshot.expiresAt).getTime() < new Date(at).getTime()) {
    return { valid: false, code: 'snapshot-expired' }
  }
  if ((await fingerprintPortableValue(parsed.data)) !== snapshot.digest) {
    return { valid: false, code: 'snapshot-digest-mismatch' }
  }
  return { valid: true, profile: parsed.data }
}

export class MigrationInterruptedError extends Error {
  readonly point: MigrationFaultPoint

  constructor(point: MigrationFaultPoint) {
    super(`Migration interrupted at ${point.phase}:${point.boundary}`)
    this.name = 'MigrationInterruptedError'
    this.point = point
  }
}

export class MigrationRunner {
  readonly #store: MigrationStore
  readonly #manifest: MigrationManifest
  readonly #options: MigrationRunnerOptions

  constructor(
    store: MigrationStore,
    manifest: MigrationManifest,
    options: MigrationRunnerOptions = {}
  ) {
    this.#store = store
    this.#manifest = manifest
    this.#options = options
  }

  async run(input: {
    operationId: string
    at: string
  }): Promise<MigrationResult> {
    if (
      !nonEmptyStringSchema.safeParse(input.operationId).success ||
      !isoTimestampSchema.safeParse(input.at).success
    ) {
      throw new TypeError('Migration operation metadata is invalid')
    }

    let journal = await this.#store.readMigrationJournal(input.operationId)
    if (journal) {
      if (journal.manifestId !== this.#manifest.id) {
        return this.#result('blocked', 'operation-id-conflict')
      }
      const terminal = terminalResult(journal, this.#manifest)
      if (terminal) {
        return terminal
      }
    }

    const active = await this.#store.readActiveProfile()
    const activeVersion = this.#readVersion(active)
    if (
      journal?.phase === 'complete' &&
      activeVersion &&
      versionsEqual(activeVersion, this.#manifest.targetVersion)
    ) {
      return {
        state: 'already-current',
        sourceVersion: this.#manifest.sourceVersion,
        targetVersion: this.#manifest.targetVersion
      }
    }
    if (
      !journal &&
      activeVersion &&
      versionsEqual(activeVersion, this.#manifest.targetVersion)
    ) {
      return {
        state: 'already-current',
        sourceVersion: this.#manifest.sourceVersion,
        targetVersion: this.#manifest.targetVersion
      }
    }

    if (!journal) {
      await this.#phase('preflight', async () => {
        const rawVersion = this.#readVersion(active)
        if (
          rawVersion &&
          rawVersion.major > this.#manifest.sourceVersion.major
        ) {
          journal = await this.#writeInitialJournal(
            input,
            active,
            'blocked',
            'unsupported-newer-major'
          )
          return
        }

        const parsed = parseProfileEnvelope(active)
        if (!parsed.success) {
          const fingerprint = await this.#safeFingerprint(active)
          await this.#store.writeMigrationEvidence({
            id: MIGRATION_EVIDENCE_ID,
            operationId: input.operationId,
            createdAt: input.at,
            reason: 'invalid-source',
            sourceFingerprint: fingerprint
          })
          journal = await this.#writeInitialJournal(
            input,
            active,
            'blocked-unreadable',
            'invalid-source'
          )
          return
        }
        if (
          !versionsEqual(
            parsed.data.schemaVersion,
            this.#manifest.sourceVersion
          )
        ) {
          journal = await this.#writeInitialJournal(
            input,
            parsed.data,
            'blocked',
            'unsupported-source-version'
          )
          return
        }

        journal = {
          operationId: input.operationId,
          manifestId: this.#manifest.id,
          sourceVersion: structuredClone(this.#manifest.sourceVersion),
          targetVersion: structuredClone(this.#manifest.targetVersion),
          phase: 'snapshotting',
          sourceDigest: await fingerprintPortableValue(parsed.data),
          createdAt: input.at,
          updatedAt: input.at
        }
        await this.#store.writeMigrationJournal(journal)
      })
      if (!journal) {
        return this.#result('failed', 'preflight-did-not-complete')
      }
      const terminal = terminalResult(journal, this.#manifest)
      if (terminal) {
        return terminal
      }
    }

    while (journal.phase !== 'complete') {
      const terminal = terminalResult(journal, this.#manifest)
      if (terminal) {
        return terminal
      }

      switch (journal.phase) {
        case 'preflight':
          journal = await this.#updatePhase(journal, 'snapshotting', input.at)
          break
        case 'snapshotting':
          journal = await this.#snapshot(journal, input.at)
          break
        case 'snapshot-ready':
          journal = await this.#validateSnapshot(journal, input.at)
          break
        case 'applying':
          journal = await this.#apply(journal, input.at)
          break
        case 'validating-target':
          journal = await this.#validateTarget(journal, input.at)
          break
        case 'committed':
          journal = await this.#phase('committed', () =>
            this.#updatePhase(
              journal as MigrationJournal,
              'cleanup-pending',
              input.at
            )
          )
          break
        case 'cleanup-pending':
          journal = await this.#phase('cleanup-pending', () =>
            this.#updatePhase(journal as MigrationJournal, 'complete', input.at)
          )
          break
        case 'blocked':
        case 'blocked-unreadable':
        case 'failed':
          break
      }
    }

    return {
      state: 'complete',
      sourceVersion: this.#manifest.sourceVersion,
      targetVersion: this.#manifest.targetVersion
    }
  }

  async #snapshot(journal: MigrationJournal, at: string) {
    return this.#phase('snapshotting', async () => {
      const active = await this.#store.readActiveProfile()
      const parsed = parseProfileEnvelope(active)
      if (
        !parsed.success ||
        !versionsEqual(
          parsed.data.schemaVersion,
          this.#manifest.sourceVersion
        ) ||
        (await fingerprintPortableValue(parsed.data)) !== journal.sourceDigest
      ) {
        return this.#fail(journal, 'source-changed', at)
      }

      const snapshot = await snapshotFor(parsed.data, journal.operationId, at)
      const target = this.#manifest.migrate(parsed.data, at)
      const parsedTarget = parseProfileEnvelope(target)
      if (
        !parsedTarget.success ||
        !versionsEqual(
          parsedTarget.data.schemaVersion,
          this.#manifest.targetVersion
        )
      ) {
        return this.#fail(journal, 'invalid-migration-target', at)
      }
      const encoder = new TextEncoder()
      const requiredBytes =
        encoder.encode(JSON.stringify(snapshot)).byteLength +
        encoder.encode(JSON.stringify(parsedTarget.data)).byteLength
      const available = await (this.#options.reserveSnapshot?.(
        requiredBytes,
        journal.operationId
      ) ?? true)
      if (!available) {
        return this.#fail(journal, 'insufficient-quota', at, 'blocked')
      }
      await this.#store.replaceMigrationSnapshot(snapshot)
      return this.#updatePhase(journal, 'snapshot-ready', at)
    })
  }

  async #validateSnapshot(journal: MigrationJournal, at: string) {
    return this.#phase('snapshot-ready', async () => {
      const snapshot = await this.#store.readMigrationSnapshot()
      if (!snapshot || snapshot.operationId !== journal.operationId) {
        return this.#fail(journal, 'snapshot-missing', at)
      }
      const validation = await validateMigrationSnapshot(snapshot, at)
      if (
        !validation.valid ||
        !versionsEqual(
          validation.profile.schemaVersion,
          this.#manifest.sourceVersion
        )
      ) {
        return this.#fail(
          journal,
          validation.valid ? 'snapshot-source-mismatch' : validation.code,
          at
        )
      }
      return this.#updatePhase(journal, 'applying', at)
    })
  }

  async #apply(journal: MigrationJournal, at: string) {
    return this.#phase('applying', async () => {
      const snapshot = await this.#store.readMigrationSnapshot()
      if (!snapshot) {
        return this.#fail(journal, 'snapshot-missing', at)
      }
      const validation = await validateMigrationSnapshot(snapshot, at)
      if (!validation.valid) {
        return this.#fail(journal, validation.code, at)
      }

      const target = this.#manifest.migrate(validation.profile, at)
      const targetDigest = await fingerprintPortableValue(target)
      const active = parseProfileEnvelope(await this.#store.readActiveProfile())
      const activeDigest = active.success
        ? await fingerprintPortableValue(active.data)
        : undefined
      if (activeDigest !== targetDigest) {
        if (!active.success || activeDigest !== journal.sourceDigest) {
          return this.#fail(journal, 'active-authority-changed', at)
        }
        await this.#store.replaceActiveProfile(target)
        await this.#inject({
          phase: 'applying',
          boundary: 'after-commit'
        })
      }
      return this.#updatePhase(
        {
          ...journal,
          targetDigest
        },
        'validating-target',
        at
      )
    })
  }

  async #validateTarget(journal: MigrationJournal, at: string) {
    return this.#phase('validating-target', async () => {
      const active = parseProfileEnvelope(await this.#store.readActiveProfile())
      if (
        !active.success ||
        !versionsEqual(active.data.schemaVersion, this.#manifest.targetVersion)
      ) {
        return this.#fail(journal, 'invalid-target', at)
      }
      const digest = await fingerprintPortableValue(active.data)
      if (journal.targetDigest && digest !== journal.targetDigest) {
        return this.#fail(journal, 'target-digest-mismatch', at)
      }
      return this.#updatePhase(
        {
          ...journal,
          targetDigest: digest,
          summary: {
            rules: active.data.rules.length,
            feedbackExamples: active.data.feedbackExamples.length
          }
        },
        'committed',
        at
      )
    })
  }

  async #phase<T>(
    phase: (typeof MIGRATION_FAULT_PHASES)[number],
    action: () => T | Promise<T>
  ) {
    await this.#inject({ phase, boundary: 'before' })
    const result = await action()
    await this.#inject({ phase, boundary: 'after' })
    return result
  }

  async #inject(point: MigrationFaultPoint) {
    await this.#options.injectFault?.(point)
  }

  async #updatePhase(
    journal: MigrationJournal,
    phase: MigrationPhase,
    at: string
  ) {
    const updated = {
      ...journal,
      phase,
      updatedAt: at
    }
    await this.#store.writeMigrationJournal(updated)
    return updated
  }

  async #fail(
    journal: MigrationJournal,
    code: string,
    at: string,
    phase: 'blocked' | 'failed' = 'failed'
  ) {
    return this.#updatePhase(
      {
        ...journal,
        code
      },
      phase,
      at
    )
  }

  async #writeInitialJournal(
    input: { operationId: string; at: string },
    source: unknown,
    phase: 'blocked' | 'blocked-unreadable',
    code: string
  ) {
    const journal: MigrationJournal = {
      operationId: input.operationId,
      manifestId: this.#manifest.id,
      sourceVersion: structuredClone(this.#manifest.sourceVersion),
      targetVersion: structuredClone(this.#manifest.targetVersion),
      phase,
      sourceDigest: await this.#safeFingerprint(source),
      createdAt: input.at,
      updatedAt: input.at,
      code
    }
    await this.#store.writeMigrationJournal(journal)
    return journal
  }

  async #safeFingerprint(value: unknown) {
    try {
      return await fingerprintPortableValue(value)
    } catch {
      return 'unavailable'
    }
  }

  #readVersion(value: unknown) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('schemaVersion' in value) ||
      typeof value.schemaVersion !== 'object' ||
      value.schemaVersion === null
    ) {
      return undefined
    }
    const version = value.schemaVersion as Record<string, unknown>
    return Number.isInteger(version.major) && Number.isInteger(version.minor)
      ? {
          major: version.major as number,
          minor: version.minor as number
        }
      : undefined
  }

  #result(
    state: 'blocked' | 'blocked-unreadable' | 'failed',
    code: string
  ): MigrationResult {
    return {
      state,
      code,
      sourceVersion: this.#manifest.sourceVersion,
      targetVersion: this.#manifest.targetVersion
    }
  }
}
