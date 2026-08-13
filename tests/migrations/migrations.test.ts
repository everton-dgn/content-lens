import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { RecoveryService } from '@/application/recovery/service'
import type { Rule } from '@/core/rules/contracts/rule'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import {
  CONTENT_LENS_DATABASE_VERSION,
  ContentLensDatabase
} from '@/storage/indexed-db/database'
import type {
  MigrationEvidence,
  MigrationJournal,
  MigrationSnapshot,
  MigrationStore
} from '@/storage/migrations/contracts'
import {
  MIGRATION_FAULT_PHASES,
  MigrationInterruptedError,
  MigrationRunner
} from '@/storage/migrations/runner'
import {
  migrateProfileV1_0ToV1_1,
  profileV1_0ToV1_1
} from '@/storage/migrations/v1-0-to-v1-1'

const startedAt = '2026-07-29T22:00:00.000Z'
const afterSixDays = '2026-08-04T22:00:00.000Z'
const afterEightDays = '2026-08-06T22:00:00.000Z'

const rule: Rule = {
  id: 'rule:migration',
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: startedAt,
  updatedAt: startedAt,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'Synthetic migration fixture',
  caseSensitive: false
}

function sourceProfile(): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 0 },
    profileId: 'profile:migration',
    revision: 7,
    createdAt: startedAt,
    updatedAt: startedAt,
    rules: [rule],
    feedbackExamples: [
      {
        id: 'feedback:migration',
        contentId: 'youtube:video:migration',
        action: 'show-item',
        createdAt: startedAt
      }
    ],
    settings: {
      enabledPlatforms: ['youtube']
    },
    extensions: {
      'content-lens.fixture': {
        preserveUnknownField: true
      }
    }
  }
}

function targetProfile() {
  return migrateProfileV1_0ToV1_1(sourceProfile(), startedAt)
}

class MemoryMigrationStore implements MigrationStore {
  activeProfile: unknown
  journals = new Map<string, MigrationJournal>()
  snapshot?: MigrationSnapshot
  evidence?: MigrationEvidence

  constructor(profile: unknown) {
    this.activeProfile = structuredClone(profile)
  }

  async readActiveProfile() {
    return structuredClone(this.activeProfile)
  }

  async replaceActiveProfile(profile: ProfileEnvelope) {
    this.activeProfile = structuredClone(profile)
  }

  async readMigrationJournal(operationId: string) {
    const journal = this.journals.get(operationId)
    return journal ? structuredClone(journal) : undefined
  }

  async writeMigrationJournal(journal: MigrationJournal) {
    this.journals.set(journal.operationId, structuredClone(journal))
  }

  async readMigrationSnapshot() {
    return this.snapshot ? structuredClone(this.snapshot) : undefined
  }

  async replaceMigrationSnapshot(snapshot: MigrationSnapshot) {
    this.snapshot = structuredClone(snapshot)
  }

  async clearMigrationSnapshot() {
    this.snapshot = undefined
  }

  async writeMigrationEvidence(evidence: MigrationEvidence) {
    this.evidence = structuredClone(evidence)
  }

  async clearAllLocalData() {
    this.activeProfile = undefined
    this.journals.clear()
    this.snapshot = undefined
    this.evidence = undefined
  }
}

function openAtVersion(factory: IDBFactory, name: string, version: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, version)
    request.addEventListener('success', () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('open failed')),
      { once: true }
    )
  })
}

function createLegacyDatabase(
  factory: IDBFactory,
  name: string,
  profile: ProfileEnvelope,
  version = 1
) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name, version)
    request.addEventListener('upgradeneeded', () => {
      const profileStore = request.result.createObjectStore('profile', {
        keyPath: 'key'
      })
      const rules = request.result.createObjectStore('rules', {
        keyPath: 'id'
      })
      const feedback = request.result.createObjectStore('feedback', {
        keyPath: 'id'
      })
      const { rules: profileRules, feedbackExamples, ...metadata } = profile
      profileStore.put({ key: 'active', ...metadata })
      for (const item of profileRules) {
        rules.put(item)
      }
      for (const item of feedbackExamples) {
        feedback.put(item)
      }
    })
    request.addEventListener(
      'success',
      () => {
        request.result.close()
        resolve()
      },
      { once: true }
    )
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('legacy open failed')),
      { once: true }
    )
  })
}

describe('profile migration runner', () => {
  it('migrates 1.0 to 1.1, preserves intent and remains idempotent', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    const runner = new MigrationRunner(store, profileV1_0ToV1_1)

    expect(
      await runner.run({
        operationId: 'migration:profile:1.0-1.1',
        at: startedAt
      })
    ).toMatchObject({
      state: 'complete',
      sourceVersion: { major: 1, minor: 0 },
      targetVersion: { major: 1, minor: 1 }
    })
    expect(store.activeProfile).toEqual(targetProfile())
    expect(store.snapshot?.profile).toEqual(sourceProfile())
    expect(store.snapshot?.counts).toEqual({
      rules: 1,
      feedbackExamples: 1
    })
    expect(store.journals.get('migration:profile:1.0-1.1')?.phase).toBe(
      'complete'
    )
    expect(store.journals.get('migration:profile:1.0-1.1')?.summary).toEqual({
      rules: 1,
      feedbackExamples: 1
    })

    expect(
      await runner.run({
        operationId: 'migration:profile:1.0-1.1',
        at: startedAt
      })
    ).toMatchObject({ state: 'already-current' })
    expect(store.activeProfile).toEqual(targetProfile())
  })

  it('recovers exactly after 100 interruptions before and after every phase', async () => {
    for (const phase of MIGRATION_FAULT_PHASES) {
      for (const boundary of ['before', 'after'] as const) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const store = new MemoryMigrationStore(sourceProfile())
          let interrupted = false
          const runner = new MigrationRunner(store, profileV1_0ToV1_1, {
            injectFault(point) {
              if (
                !interrupted &&
                point.phase === phase &&
                point.boundary === boundary
              ) {
                interrupted = true
                throw new MigrationInterruptedError(point)
              }
            }
          })

          await expect(
            runner.run({
              operationId: `migration:fault:${phase}:${boundary}:${attempt}`,
              at: startedAt
            })
          ).rejects.toBeInstanceOf(MigrationInterruptedError)

          const current = store.activeProfile
          expect(
            current === undefined ||
              JSON.stringify(current) === JSON.stringify(sourceProfile()) ||
              JSON.stringify(current) === JSON.stringify(targetProfile())
          ).toBe(true)

          await new MigrationRunner(store, profileV1_0ToV1_1).run({
            operationId: `migration:fault:${phase}:${boundary}:${attempt}`,
            at: startedAt
          })
          expect(store.activeProfile).toEqual(targetProfile())
          expect((store.activeProfile as ProfileEnvelope).rules).toHaveLength(1)
          expect(
            (store.activeProfile as ProfileEnvelope).feedbackExamples
          ).toHaveLength(1)
        }
      }
    }
  }, 120_000)

  it('recovers when execution stops after target commit but before journal advance', async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const store = new MemoryMigrationStore(sourceProfile())
      let interrupted = false
      const runner = new MigrationRunner(store, profileV1_0ToV1_1, {
        injectFault(point) {
          if (
            !interrupted &&
            point.phase === 'applying' &&
            point.boundary === 'after-commit'
          ) {
            interrupted = true
            throw new MigrationInterruptedError(point)
          }
        }
      })
      const operationId = `migration:unknown-commit:${attempt}`

      await expect(
        runner.run({ operationId, at: startedAt })
      ).rejects.toBeInstanceOf(MigrationInterruptedError)
      expect(store.activeProfile).toEqual(targetProfile())

      await new MigrationRunner(store, profileV1_0ToV1_1).run({
        operationId,
        at: startedAt
      })
      expect(store.activeProfile).toEqual(targetProfile())
      expect(store.journals.get(operationId)?.phase).toBe('complete')
    }
  })

  it('blocks quota failure once and never mutates the source', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    const first = new MigrationRunner(store, profileV1_0ToV1_1, {
      reserveSnapshot: async () => false
    })

    expect(
      await first.run({ operationId: 'migration:quota', at: startedAt })
    ).toMatchObject({ state: 'blocked', code: 'insufficient-quota' })
    expect(store.activeProfile).toEqual(sourceProfile())
    expect(store.snapshot).toBeUndefined()

    expect(
      await new MigrationRunner(store, profileV1_0ToV1_1).run({
        operationId: 'migration:quota',
        at: startedAt
      })
    ).toMatchObject({ state: 'blocked', code: 'insufficient-quota' })
    expect(store.activeProfile).toEqual(sourceProfile())
  })

  it('reserves quota for both the snapshot and migrated working set', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    let reservedBytes = 0

    await new MigrationRunner(store, profileV1_0ToV1_1, {
      reserveSnapshot: async requiredBytes => {
        reservedBytes = requiredBytes
        return true
      }
    }).run({
      operationId: 'migration:working-set-quota',
      at: startedAt
    })

    expect(store.snapshot).toBeDefined()
    const encoder = new TextEncoder()
    const snapshotBytes = encoder.encode(
      JSON.stringify(store.snapshot)
    ).byteLength
    const targetBytes = encoder.encode(
      JSON.stringify(targetProfile())
    ).byteLength
    expect(reservedBytes).toBe(snapshotBytes + targetBytes)
  })

  it('preserves unsupported newer data without opening it for writes', async () => {
    const newer = {
      ...sourceProfile(),
      schemaVersion: { major: 2, minor: 0 }
    }
    const store = new MemoryMigrationStore(newer)

    expect(
      await new MigrationRunner(store, profileV1_0ToV1_1).run({
        operationId: 'migration:newer-major',
        at: startedAt
      })
    ).toMatchObject({
      state: 'blocked',
      code: 'unsupported-newer-major'
    })
    expect(store.activeProfile).toEqual(newer)
    expect(store.snapshot).toBeUndefined()
  })

  it('quarantines invalid source evidence and enters blocked-unreadable', async () => {
    const invalid = {
      schemaVersion: { major: 1, minor: 0 },
      profileId: 'profile:invalid'
    }
    const store = new MemoryMigrationStore(invalid)

    expect(
      await new MigrationRunner(store, profileV1_0ToV1_1).run({
        operationId: 'migration:invalid',
        at: startedAt
      })
    ).toMatchObject({
      state: 'blocked-unreadable',
      code: 'invalid-source'
    })
    expect(store.activeProfile).toEqual(invalid)
    expect(store.evidence).toMatchObject({
      operationId: 'migration:invalid',
      reason: 'invalid-source'
    })
  })
})

describe('recovery', () => {
  it('offers snapshot before reset, restores exactly and consumes it', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    await new MigrationRunner(store, profileV1_0ToV1_1).run({
      operationId: 'migration:recover',
      at: startedAt
    })
    const recovery = new RecoveryService(store)

    expect(await recovery.inspect(afterSixDays)).toMatchObject({
      state: 'recoverable',
      primaryAction: 'restore-snapshot',
      actions: ['restore-snapshot', 'export-profile', 'reset']
    })
    expect(await recovery.reset({ confirmed: false })).toEqual({
      state: 'confirmation-required'
    })
    expect(await recovery.restore(afterSixDays)).toEqual({
      state: 'restored',
      revision: sourceProfile().revision
    })
    expect(store.activeProfile).toEqual(sourceProfile())
    expect(store.snapshot).toBeUndefined()
  })

  it('rejects a corrupt snapshot and preserves the active authority', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    await new MigrationRunner(store, profileV1_0ToV1_1).run({
      operationId: 'migration:corrupt-snapshot',
      at: startedAt
    })
    if (!store.snapshot) {
      throw new Error('Expected migration snapshot')
    }
    store.snapshot.digest = 'corrupt'
    const active = structuredClone(store.activeProfile)

    expect(
      await new RecoveryService(store).restore(afterSixDays)
    ).toMatchObject({
      state: 'invalid-snapshot'
    })
    expect(store.activeProfile).toEqual(active)
    expect(store.snapshot).toBeDefined()
  })

  it('expires a snapshot after seven days and requires confirmation to reset', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    await new MigrationRunner(store, profileV1_0ToV1_1).run({
      operationId: 'migration:expiry',
      at: startedAt
    })
    const recovery = new RecoveryService(store)

    expect(await recovery.inspect(afterEightDays)).toMatchObject({
      state: 'readable',
      primaryAction: 'export-profile',
      actions: ['export-profile', 'reset']
    })
    expect(store.snapshot).toBeUndefined()
    expect(await recovery.reset({ confirmed: true })).toEqual({
      state: 'reset'
    })
    expect(store.activeProfile).toBeUndefined()
  })
})

describe('IndexedDB migration integration', () => {
  it('rejects a blocked schema upgrade instead of waiting indefinitely', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-blocked-open'
    const held = await openAtVersion(factory, name, 1)
    const database = new ContentLensDatabase({ factory, databaseName: name })

    await expect(database.counts()).rejects.toThrow(
      'ContentLens database upgrade blocked'
    )
    held.close()
  })

  it('upgrades the database layout from version 1 without losing intent', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-database-upgrade'
    await createLegacyDatabase(factory, name, sourceProfile())

    const database = new ContentLensDatabase({ factory, databaseName: name })

    expect(await database.exportProfile()).toEqual(sourceProfile())
    expect(await database.counts()).toMatchObject({
      profile: 1,
      rules: 1,
      feedback: 1,
      migrationSnapshots: 0,
      migrationJournals: 0,
      migrationEvidence: 0
    })
  })

  it('adds dedicated provider stores when upgrading a version 2 database', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-provider-stores'
    await createLegacyDatabase(factory, name, sourceProfile(), 2)

    const database = new ContentLensDatabase({ factory, databaseName: name })

    expect(CONTENT_LENS_DATABASE_VERSION).toBe(6)
    expect(await database.exportProfile()).toEqual(sourceProfile())
    expect(await database.counts()).toMatchObject({
      providers: 0,
      models: 0,
      consents: 0,
      credentials: 0,
      rssEntries: 0,
      rssRuntime: 0
    })
    expect(await database.readProviderState()).toEqual({
      schemaVersion: 1,
      providers: [],
      models: [],
      consents: [],
      credentials: []
    })
  })

  it('persists journal and one validated snapshot across reopen', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-integration'
    const database = new ContentLensDatabase({ factory, databaseName: name })
    await database.saveProfile(sourceProfile())

    await new MigrationRunner(database, profileV1_0ToV1_1).run({
      operationId: 'migration:indexeddb',
      at: startedAt
    })
    database.close()

    const reopened = new ContentLensDatabase({ factory, databaseName: name })
    expect(await reopened.exportProfile()).toEqual(targetProfile())
    expect(
      await reopened.readMigrationJournal('migration:indexeddb')
    ).toMatchObject({ phase: 'complete' })
    expect(await reopened.readMigrationSnapshot()).toMatchObject({
      validated: true,
      profile: sourceProfile()
    })
    expect(await reopened.counts()).toMatchObject({
      migrationSnapshots: 1,
      migrationJournals: 1
    })
    const restoreOptions = {
      operationId: 'operation:migration:restore',
      at: afterSixDays
    }
    const restored = await reopened.restoreMigrationSnapshot(restoreOptions)
    const replayedRestore =
      await reopened.restoreMigrationSnapshot(restoreOptions)
    expect(restored).toMatchObject({
      state: 'restored',
      revision: sourceProfile().revision
    })
    expect(replayedRestore).toEqual(restored)
    expect(await reopened.exportProfile()).toEqual(sourceProfile())
    expect(await reopened.readMigrationSnapshot()).toBeUndefined()
  })

  it('makes an older database version fail closed without changing the profile', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-downgrade'
    const database = new ContentLensDatabase({ factory, databaseName: name })
    await database.saveProfile(targetProfile())
    database.close()

    expect(CONTENT_LENS_DATABASE_VERSION).toBeGreaterThan(1)
    await expect(openAtVersion(factory, name, 1)).rejects.toMatchObject({
      name: 'VersionError'
    })

    const reopened = new ContentLensDatabase({ factory, databaseName: name })
    expect(await reopened.exportProfile()).toEqual(targetProfile())
  })

  it('removes snapshots, journals and quarantine with the recovery scope', async () => {
    const factory = new IDBFactory()
    const name = 'contentlens-migration-delete-recovery'
    const database = new ContentLensDatabase({ factory, databaseName: name })
    await database.saveProfile(sourceProfile())
    await new MigrationRunner(database, profileV1_0ToV1_1).run({
      operationId: 'migration:delete-recovery',
      at: startedAt
    })
    await database.writeMigrationEvidence({
      id: 'latest',
      operationId: 'migration:delete-recovery',
      createdAt: startedAt,
      reason: 'fixture',
      sourceFingerprint: 'redacted'
    })

    await database.clear('recovery', { at: startedAt })

    expect(await database.counts()).toMatchObject({
      migrationSnapshots: 0,
      migrationJournals: 0,
      migrationEvidence: 0
    })
    expect(await database.exportProfile()).toEqual(targetProfile())
  })
})
