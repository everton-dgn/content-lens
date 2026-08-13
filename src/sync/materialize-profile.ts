import { z } from 'zod'

import { modelRoutingSettingsSchema } from '@/ai/models/contracts'
import {
  projectContentLensSettings,
  writeContentLensSettings
} from '@/application/settings/profile-settings'
import { PLATFORM_VALUES, platformSchema } from '@/core/content/contracts'
import { platformSurfaceSchema } from '@/core/content/surfaces'
import {
  type ContentLensSettings,
  contentLensSettingsSchema
} from '@/core/settings'
import {
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'
import type { SyncEnvelope } from '@/sync/contracts'

const portablePlatformPreferenceSchema = z
  .strictObject({
    platform: platformSchema,
    state: z.enum(['enabled', 'paused', 'disabled']),
    nativeFeedbackEnabled: z.boolean().default(false),
    surfaces: z.partialRecord(platformSurfaceSchema, z.boolean())
  })
  .superRefine((preference, context) => {
    for (const surface of Object.keys(preference.surfaces)) {
      if (!surface.startsWith(`${preference.platform}:`)) {
        context.addIssue({
          code: 'custom',
          message: 'Portable surface must belong to its platform',
          path: ['surfaces', surface]
        })
      }
    }
  })

function importedSettings(
  envelope: SyncEnvelope,
  current: ContentLensSettings
) {
  let interfaceSettings = current.interface
  let routing = current.routing
  const platforms = structuredClone(current.platforms)

  for (const preference of envelope.profile.platformPreferences) {
    if (preference.id === 'settings:interface') {
      interfaceSettings = contentLensSettingsSchema.shape.interface.parse(
        preference.value
      )
      continue
    }
    if (preference.id === 'settings:routing') {
      routing = modelRoutingSettingsSchema.parse(preference.value)
      continue
    }
    if (preference.id.startsWith('platform:')) {
      const parsed = portablePlatformPreferenceSchema.parse(preference.value)
      if (preference.id !== `platform:${parsed.platform}`) {
        throw new TypeError('Portable platform preference ID is inconsistent')
      }
      platforms[parsed.platform] = {
        ...parsed,
        permissionState: current.platforms[parsed.platform].permissionState
      }
      continue
    }
    throw new TypeError('Unknown portable preference')
  }

  for (const platform of PLATFORM_VALUES) {
    if (!platforms[platform]) {
      throw new TypeError('Portable platform preference is incomplete')
    }
  }
  return contentLensSettingsSchema.parse({
    schemaVersion: 1,
    routing,
    platforms,
    interface: interfaceSettings
  })
}

export function materializeImportedProfile(input: {
  current: ProfileEnvelope
  envelope: SyncEnvelope
  importedAt: string
}) {
  const currentSettings = projectContentLensSettings(
    input.current.settings
  ).settings
  const settings = importedSettings(input.envelope, currentSettings)

  return profileEnvelopeSchema.parse({
    ...input.current,
    revision: input.current.revision + 1,
    updatedAt: input.importedAt,
    rules: input.envelope.profile.rules,
    settings: writeContentLensSettings(input.current.settings, settings)
  })
}
