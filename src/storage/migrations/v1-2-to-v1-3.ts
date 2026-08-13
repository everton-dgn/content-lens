import {
  projectContentLensSettings,
  writeContentLensSettings
} from '@/application/settings/profile-settings'
import {
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'
import type { MigrationManifest } from '@/storage/migrations/contracts'

export function migrateProfileV1_2ToV1_3(
  source: ProfileEnvelope,
  at: string
): ProfileEnvelope {
  const projected = projectContentLensSettings(source.settings)
  const settings = writeContentLensSettings(source.settings, projected.settings)

  return profileEnvelopeSchema.parse({
    ...source,
    schemaVersion: { major: 1, minor: 3 },
    revision: source.revision + 1,
    updatedAt: at,
    settings: {
      ...settings,
      ...(projected.issues.length > 0
        ? { settingsMigrationIssues: projected.issues }
        : {})
    }
  })
}

export const profileV1_2ToV1_3: MigrationManifest = {
  id: 'profile-1.2-to-1.3',
  sourceVersion: { major: 1, minor: 2 },
  targetVersion: { major: 1, minor: 3 },
  compatibility: 'backward-readable-minor',
  affectedStores: ['profile', 'routing', 'platform-settings'],
  sourceProductVersion: '0.3.0',
  targetProductVersion: '0.4.0',
  recoveryNotes:
    'Restore the validated 1.2 snapshot; provider credentials remain outside the portable profile.',
  migrate: migrateProfileV1_2ToV1_3
}
