import { z } from 'zod'

import {
  DEFAULT_BUDGET_POLICY,
  MODEL_TASK_VALUES,
  modelRoutingSettingsSchema
} from '@/ai/models/contracts'
import { PLATFORM_VALUES, platformSchema } from '@/core/content/contracts'
import {
  PLATFORM_SURFACES,
  platformSurfaceSchema
} from '@/core/content/surfaces'

export const CONTENT_LENS_SETTINGS_SCHEMA_VERSION = 1

export const PLATFORM_ACTIVATION_STATES = [
  'enabled',
  'paused',
  'disabled'
] as const

export const PLATFORM_PERMISSION_STATES = [
  'not-requested',
  'granted',
  'denied',
  'revoked',
  'unavailable'
] as const

export const platformSettingsSchema = z.strictObject({
  platform: platformSchema,
  state: z.enum(PLATFORM_ACTIVATION_STATES),
  permissionState: z.enum(PLATFORM_PERMISSION_STATES),
  nativeFeedbackEnabled: z.boolean().default(false),
  surfaces: z.partialRecord(platformSurfaceSchema, z.boolean())
})

const platformsSchema = z
  .record(platformSchema, platformSettingsSchema)
  .superRefine((platforms, context) => {
    for (const platform of PLATFORM_VALUES) {
      const settings = platforms[platform]
      if (settings.platform !== platform) {
        context.addIssue({
          code: 'custom',
          message: 'Platform settings key must match its platform',
          path: [platform, 'platform']
        })
      }
      for (const surface of Object.keys(settings.surfaces)) {
        if (!surface.startsWith(`${platform}:`)) {
          context.addIssue({
            code: 'custom',
            message: 'Configured surface must belong to its platform',
            path: [platform, 'surfaces', surface]
          })
        }
      }
    }
  })

export const contentLensSettingsSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_LENS_SETTINGS_SCHEMA_VERSION),
  routing: modelRoutingSettingsSchema,
  platforms: platformsSchema,
  interface: z.strictObject({
    advancedMode: z.boolean(),
    colorMode: z.enum(['system', 'light', 'dark']),
    locale: z.enum(['auto', 'en', 'pt_BR', 'es'])
  })
})

export type PlatformSettings = z.infer<typeof platformSettingsSchema>
export type ContentLensSettings = z.infer<typeof contentLensSettingsSchema>

export function createDefaultSettings(): ContentLensSettings {
  const globalRoutes = Object.fromEntries(
    MODEL_TASK_VALUES.map(task => [task, { state: 'disabled' as const }])
  )
  const platforms = Object.fromEntries(
    PLATFORM_VALUES.map(platform => [
      platform,
      {
        platform,
        state: platform === 'youtube' ? 'enabled' : 'disabled',
        permissionState: 'not-requested',
        nativeFeedbackEnabled: false,
        surfaces: Object.fromEntries(
          PLATFORM_SURFACES[platform].map(surface => [
            `${platform}:${surface}`,
            platform === 'youtube' &&
              ['home', 'search', 'recommendations'].includes(surface)
          ])
        )
      }
    ])
  )

  return contentLensSettingsSchema.parse({
    schemaVersion: CONTENT_LENS_SETTINGS_SCHEMA_VERSION,
    routing: {
      schemaVersion: 1,
      globalRoutes,
      platformOverrides: {},
      budgets: DEFAULT_BUDGET_POLICY
    },
    platforms,
    interface: {
      advancedMode: false,
      colorMode: 'system',
      locale: 'auto'
    }
  })
}
