import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import {
  projectContentLensSettings,
  writeContentLensSettings
} from '@/application/settings/profile-settings'
import { createDefaultSettings } from '@/core/settings'
import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import { materializeImportedProfile } from '@/sync/materialize-profile'

const at = '2026-07-31T12:00:00.000Z'
const importedAt = '2026-07-31T13:00:00.000Z'

describe('imported sync profile materialization', () => {
  it('replaces synchronized settings while preserving local permissions and history', async () => {
    const current = createLocalProfile({ at, profileId: 'profile:local' })
    const localSettings = createDefaultSettings()
    localSettings.platforms.youtube.permissionState = 'granted'
    current.settings = writeContentLensSettings(current.settings, localSettings)
    current.feedbackExamples = [
      {
        id: 'feedback:local',
        contentId: 'content:local',
        action: 'show-item',
        createdAt: at
      }
    ]

    const importedSettings = createDefaultSettings()
    importedSettings.interface = {
      advancedMode: true,
      colorMode: 'dark',
      locale: 'pt_BR'
    }
    importedSettings.platforms.youtube.state = 'paused'
    importedSettings.platforms.youtube.surfaces['youtube:home'] = false
    const envelope = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: 'sync:remote',
      generation: 0,
      profile: {
        ...emptySyncProfile(),
        platformPreferences: [
          { id: 'settings:interface', value: importedSettings.interface },
          { id: 'settings:routing', value: importedSettings.routing },
          {
            id: 'platform:youtube',
            value: {
              platform: 'youtube',
              state: 'paused',
              surfaces: importedSettings.platforms.youtube.surfaces
            }
          }
        ]
      },
      tombstones: []
    })

    const result = materializeImportedProfile({
      current,
      envelope,
      importedAt
    })
    const resultSettings = projectContentLensSettings(result.settings).settings

    expect(result).toMatchObject({
      profileId: 'profile:local',
      revision: 1,
      updatedAt: importedAt,
      feedbackExamples: current.feedbackExamples
    })
    expect(resultSettings.interface).toEqual(importedSettings.interface)
    expect(resultSettings.platforms.youtube).toMatchObject({
      state: 'paused',
      permissionState: 'granted',
      surfaces: { 'youtube:home': false }
    })
  })

  it('fails closed for unknown portable preference IDs', async () => {
    const current = createLocalProfile({ at, profileId: 'profile:local' })
    const envelope = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: 'sync:remote',
      generation: 0,
      profile: {
        ...emptySyncProfile(),
        platformPreferences: [
          { id: 'unknown:future', value: { enabled: true } }
        ]
      },
      tombstones: []
    })

    expect(() =>
      materializeImportedProfile({ current, envelope, importedAt })
    ).toThrow('Unknown portable preference')
  })
})
