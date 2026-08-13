import { describe, expect, it } from 'vitest'

import {
  PROFILE_SETTINGS_SCHEMA_VERSION,
  projectContentLensSettings
} from '@/application/settings'
import {
  type ContentLensSettings,
  createDefaultSettings
} from '@/core/settings'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import {
  migrateProfileV1_2ToV1_3,
  profileV1_2ToV1_3
} from '@/storage/migrations/v1-2-to-v1-3'

const at = '2026-07-31T03:10:00.000Z'

function sourceProfile(
  settings: ContentLensSettings,
  enabledPlatforms: string[] = ['youtube', 'reddit']
): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 2 },
    profileId: 'profile:settings',
    revision: 7,
    createdAt: at,
    updatedAt: at,
    rules: [],
    feedbackExamples: [],
    settings: {
      reviewMode: 'balanced',
      enabledPlatforms,
      modelRouting: settings.routing
    }
  }
}

describe('settings profile migration', () => {
  it('normalizes legacy settings without losing routing or adjacent portable fields', () => {
    const defaults = createDefaultSettings()
    const migrated = migrateProfileV1_2ToV1_3(
      sourceProfile(defaults),
      '2026-07-31T03:11:00.000Z'
    )
    const projected = projectContentLensSettings(migrated.settings)

    expect(migrated).toMatchObject({
      schemaVersion: { major: 1, minor: 3 },
      revision: 8,
      updatedAt: '2026-07-31T03:11:00.000Z',
      settings: {
        reviewMode: 'balanced',
        settingsSchemaVersion: PROFILE_SETTINGS_SCHEMA_VERSION,
        modelRouting: defaults.routing,
        interface: defaults.interface
      }
    })
    expect(migrated.settings).not.toHaveProperty('enabledPlatforms')
    expect(migrated.settings).not.toHaveProperty('routing')
    expect(projected).toMatchObject({
      source: 'canonical',
      issues: [],
      settings: {
        routing: defaults.routing,
        platforms: {
          youtube: { state: 'enabled' },
          reddit: { state: 'enabled' },
          linkedin: { state: 'disabled' }
        }
      }
    })
  })

  it('records recoverable legacy diagnostics without expanding platform scope', () => {
    const migrated = migrateProfileV1_2ToV1_3(
      sourceProfile(createDefaultSettings(), ['youtube', 'unknown']),
      at
    )

    expect(migrated.settings.settingsMigrationIssues).toEqual([
      'unknown-platform:unknown'
    ])
    expect(
      projectContentLensSettings(migrated.settings).settings.platforms
    ).toMatchObject({
      youtube: { state: 'enabled' },
      reddit: { state: 'disabled' },
      linkedin: { state: 'disabled' },
      x: { state: 'disabled' },
      'hacker-news': { state: 'disabled' },
      rss: { state: 'disabled' }
    })
  })

  it('declares an explicit recoverable minor-version manifest', () => {
    expect(profileV1_2ToV1_3).toMatchObject({
      id: 'profile-1.2-to-1.3',
      sourceVersion: { major: 1, minor: 2 },
      targetVersion: { major: 1, minor: 3 },
      compatibility: 'backward-readable-minor',
      affectedStores: ['profile', 'routing', 'platform-settings']
    })
  })
})
