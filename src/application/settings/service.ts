import type { ModelCatalog } from '@/ai/models/catalog'
import type { ConsentRepository } from '@/ai/providers/consent'
import type { ProviderRegistry } from '@/ai/providers/registry'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type {
  OperationCommand,
  OperationResponse
} from '@/core/operations/journal'
import type { ContentLensSettings } from '@/core/settings'
import type { ConsentKey } from '@/security/credentials/contracts'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'

import {
  createSettingsCapabilitySnapshot,
  type SettingsCapabilitySnapshot,
  type SettingsCapabilitySnapshotStore
} from './capability-snapshot'
import {
  PROFILE_SETTINGS_SCHEMA_VERSION,
  type ProfileSettingsProjectionIssue,
  projectContentLensSettings,
  writeContentLensSettings
} from './profile-settings'
import { validateSettingsDraft } from './validation'

export type SaveSettingsCommand = {
  operationId: string
  expectedRevision: number
  settings: unknown
  reviewedConsentKeys: readonly ConsentKey[]
  at: string
}

export type SaveSettingsResult = {
  settingsSchemaVersion: typeof PROFILE_SETTINGS_SCHEMA_VERSION
}

export type SettingsLoadResult =
  | {
      state: 'ready'
      revision: number
      settings: ContentLensSettings
      capabilitySnapshot: SettingsCapabilitySnapshot
      source: 'canonical' | 'legacy' | 'default' | 'recovered'
      issues: ProfileSettingsProjectionIssue[]
    }
  | {
      state: 'unavailable'
      code: 'profile-not-found'
    }

export type SettingsServiceEnvironment = {
  catalog: ModelCatalog
  providers: ProviderRegistry
  consents: ConsentRepository
  capabilitySnapshots: Pick<SettingsCapabilitySnapshotStore, 'publish'>
}

function invalidSettings(): OperationResponse<SaveSettingsResult> {
  return {
    state: 'failed',
    error: {
      code: 'invalid-settings',
      message: 'Settings input is invalid'
    },
    retryable: false
  }
}

async function saveOperationCommand(
  input: SaveSettingsCommand,
  settings: ContentLensSettings,
  consentKeys: readonly ConsentKey[]
): Promise<OperationCommand> {
  return {
    operationId: input.operationId,
    type: 'settings.save',
    targetFingerprint: await fingerprintPortableValue({
      expectedRevision: input.expectedRevision,
      settings,
      consentKeys
    }),
    at: input.at
  }
}

export class SettingsManagementService {
  readonly #database: ContentLensDatabase
  readonly #environment: SettingsServiceEnvironment

  constructor(
    database: ContentLensDatabase,
    environment: SettingsServiceEnvironment
  ) {
    this.#database = database
    this.#environment = environment
  }

  async load(): Promise<SettingsLoadResult> {
    const profile = await this.#database.exportProfile()
    if (!profile) {
      return {
        state: 'unavailable',
        code: 'profile-not-found'
      }
    }
    const projected = projectContentLensSettings(profile.settings)
    const capabilitySnapshot = await this.#publishProfile(profile)
    return {
      state: 'ready',
      revision: profile.revision,
      capabilitySnapshot,
      ...projected
    }
  }

  async acknowledgeSave(
    input: SaveSettingsCommand
  ): Promise<OperationResponse<SaveSettingsResult>> {
    const validation = validateSettingsDraft(
      input.settings,
      this.#environment,
      {
        reviewedConsentKeys: input.reviewedConsentKeys
      }
    )
    if (!validation.success) {
      return invalidSettings()
    }
    const response =
      await this.#database.acknowledgeOperation<SaveSettingsResult>(
        await saveOperationCommand(
          input,
          validation.settings,
          validation.consentKeys
        )
      )
    if (response.state === 'committed') {
      await this.#publishCurrentProfile()
    }
    return response
  }

  async save(
    input: SaveSettingsCommand
  ): Promise<OperationResponse<SaveSettingsResult>> {
    const validation = validateSettingsDraft(
      input.settings,
      this.#environment,
      {
        reviewedConsentKeys: input.reviewedConsentKeys
      }
    )
    if (!validation.success) {
      return invalidSettings()
    }
    const command = await saveOperationCommand(
      input,
      validation.settings,
      validation.consentKeys
    )
    const response = await this.#database.transactProfile<SaveSettingsResult>(
      command,
      input.expectedRevision,
      current => ({
        profile: {
          ...current,
          revision: current.revision + 1,
          updatedAt: input.at,
          settings: writeContentLensSettings(
            current.settings,
            validation.settings
          )
        },
        value: {
          settingsSchemaVersion: PROFILE_SETTINGS_SCHEMA_VERSION
        } satisfies SaveSettingsResult,
        effects: [
          {
            kind: 'settings.saved',
            targetId: current.profileId
          }
        ]
      })
    )
    if (response.state === 'committed') {
      await this.#publishCurrentProfile()
    }
    return response
  }

  async #publishCurrentProfile() {
    const profile = await this.#database.exportProfile()
    return profile ? this.#publishProfile(profile) : undefined
  }

  async #publishProfile(profile: ProfileEnvelope) {
    const snapshot = await createSettingsCapabilitySnapshot({
      profileRevision: profile.revision,
      publishedAt: profile.updatedAt,
      providers: this.#environment.providers,
      catalog: this.#environment.catalog
    })
    this.#environment.capabilitySnapshots.publish(snapshot)
    return snapshot
  }
}
