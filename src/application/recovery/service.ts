import { parseProfileEnvelope } from '@/storage/contracts/profile-envelope'
import type { MigrationStore } from '@/storage/migrations/contracts'
import { validateMigrationSnapshot } from '@/storage/migrations/runner'

export class RecoveryService {
  readonly #store: MigrationStore

  constructor(store: MigrationStore) {
    this.#store = store
  }

  async inspect(at: string) {
    const snapshot = await this.#store.readMigrationSnapshot()
    if (snapshot) {
      const validation = await validateMigrationSnapshot(snapshot, at)
      if (validation.valid) {
        return {
          state: 'recoverable' as const,
          primaryAction: 'restore-snapshot' as const,
          actions: ['restore-snapshot', 'export-profile', 'reset'] as const,
          preserved: ['profile', 'rules', 'feedback'] as const
        }
      }
      if (validation.code === 'snapshot-expired') {
        await this.#store.clearMigrationSnapshot()
      }
    }

    const active = parseProfileEnvelope(await this.#store.readActiveProfile())
    if (active.success) {
      return {
        state: 'readable' as const,
        primaryAction: 'export-profile' as const,
        actions: ['export-profile', 'reset'] as const,
        preserved: ['profile', 'rules', 'feedback'] as const
      }
    }
    return {
      state: 'blocked-unreadable' as const,
      primaryAction: 'import-profile' as const,
      actions: ['import-profile', 'reset'] as const,
      preserved: [] as const
    }
  }

  async restore(at: string) {
    const snapshot = await this.#store.readMigrationSnapshot()
    if (!snapshot) {
      return {
        state: 'snapshot-unavailable' as const
      }
    }
    const validation = await validateMigrationSnapshot(snapshot, at)
    if (!validation.valid) {
      return {
        state: 'invalid-snapshot' as const,
        code: validation.code
      }
    }

    await this.#store.replaceActiveProfile(validation.profile)
    const restored = parseProfileEnvelope(await this.#store.readActiveProfile())
    if (!restored.success) {
      return {
        state: 'restore-failed' as const
      }
    }
    await this.#store.clearMigrationSnapshot()
    return {
      state: 'restored' as const,
      revision: restored.data.revision
    }
  }

  async exportProfile() {
    const active = parseProfileEnvelope(await this.#store.readActiveProfile())
    return active.success
      ? {
          state: 'exportable' as const,
          profile: active.data
        }
      : {
          state: 'unavailable' as const
        }
  }

  async reset(options: { confirmed: boolean }) {
    if (!options.confirmed) {
      return {
        state: 'confirmation-required' as const
      }
    }
    await this.#store.clearAllLocalData()
    return {
      state: 'reset' as const
    }
  }
}
