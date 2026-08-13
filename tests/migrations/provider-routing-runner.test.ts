import { describe, expect, it } from 'vitest'

import { RecoveryService } from '@/application/recovery/service'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import type {
  MigrationEvidence,
  MigrationJournal,
  MigrationSnapshot,
  MigrationStore
} from '@/storage/migrations/contracts'
import {
  MigrationInterruptedError,
  MigrationRunner
} from '@/storage/migrations/runner'
import {
  migrateProfileV1_1ToV1_2,
  profileV1_1ToV1_2
} from '@/storage/migrations/v1-1-to-v1-2'

const at = '2026-07-31T00:00:00.000Z'

function sourceProfile(): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 1 },
    profileId: 'profile:routing',
    revision: 4,
    createdAt: at,
    updatedAt: at,
    rules: [],
    feedbackExamples: [],
    settings: {
      reviewMode: 'balanced',
      legacyModel: {
        providerConfigId: 'provider:fixture',
        modelId: 'model:fixture',
        modalities: ['text']
      }
    }
  }
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

describe('provider routing migration runner', () => {
  it('migrates through the journal and restores the exact 1.1 snapshot', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    const runner = new MigrationRunner(store, profileV1_1ToV1_2)

    expect(
      await runner.run({
        operationId: 'migration:profile:1.1-1.2',
        at
      })
    ).toMatchObject({
      state: 'complete',
      sourceVersion: { major: 1, minor: 1 },
      targetVersion: { major: 1, minor: 2 }
    })
    expect(store.activeProfile).toEqual(
      migrateProfileV1_1ToV1_2(sourceProfile(), at)
    )
    expect(store.snapshot?.profile).toEqual(sourceProfile())

    expect(await new RecoveryService(store).restore(at)).toMatchObject({
      state: 'restored',
      revision: 4
    })
    expect(store.activeProfile).toEqual(sourceProfile())
  })

  it('recovers after interruption immediately after committing the 1.2 profile', async () => {
    const store = new MemoryMigrationStore(sourceProfile())
    const runner = new MigrationRunner(store, profileV1_1ToV1_2, {
      injectFault(point) {
        if (point.phase === 'applying' && point.boundary === 'after-commit') {
          throw new MigrationInterruptedError(point)
        }
      }
    })

    await expect(
      runner.run({
        operationId: 'migration:profile:1.1-1.2:interrupted',
        at
      })
    ).rejects.toBeInstanceOf(MigrationInterruptedError)
    expect(store.activeProfile).toEqual(
      migrateProfileV1_1ToV1_2(sourceProfile(), at)
    )

    expect(
      await new MigrationRunner(store, profileV1_1ToV1_2).run({
        operationId: 'migration:profile:1.1-1.2:interrupted',
        at
      })
    ).toMatchObject({ state: 'complete' })
  })

  it('rejects a future minor without overwriting the active profile', async () => {
    const future = {
      ...sourceProfile(),
      schemaVersion: { major: 1, minor: 3 }
    }
    const store = new MemoryMigrationStore(future)

    expect(
      await new MigrationRunner(store, profileV1_1ToV1_2).run({
        operationId: 'migration:future',
        at
      })
    ).toEqual({
      state: 'blocked',
      code: 'unsupported-source-version',
      sourceVersion: { major: 1, minor: 1 },
      targetVersion: { major: 1, minor: 2 }
    })
    expect(store.activeProfile).toEqual(future)
  })
})
