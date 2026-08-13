import {
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'
import type { MigrationManifest } from '@/storage/migrations/contracts'

export function migrateProfileV1_0ToV1_1(
  source: ProfileEnvelope,
  at: string
): ProfileEnvelope {
  return profileEnvelopeSchema.parse({
    ...source,
    schemaVersion: {
      major: 1,
      minor: 1
    },
    revision: source.revision + 1,
    updatedAt: at,
    settings: {
      reviewMode: 'balanced',
      ...source.settings
    }
  })
}

export const profileV1_0ToV1_1: MigrationManifest = {
  id: 'profile-1.0-to-1.1',
  sourceVersion: {
    major: 1,
    minor: 0
  },
  targetVersion: {
    major: 1,
    minor: 1
  },
  compatibility: 'backward-readable-minor',
  affectedStores: ['profile', 'rules', 'feedback'],
  sourceProductVersion: '0.1.0',
  targetProductVersion: '0.2.0',
  recoveryNotes:
    'Restore the validated 1.0 snapshot or export the readable active profile.',
  migrate: migrateProfileV1_0ToV1_1
}
