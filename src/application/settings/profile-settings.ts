import { modelRoutingSettingsSchema } from '@/ai/models/contracts'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import {
  type ContentLensSettings,
  contentLensSettingsSchema,
  createDefaultSettings
} from '@/core/settings'
import type {
  PortableJsonValue,
  PortableSettings
} from '@/storage/contracts/profile-envelope'

export const PROFILE_SETTINGS_SCHEMA_VERSION = 1

export type ProfileSettingsProjectionIssue =
  | 'invalid-model-routing'
  | 'invalid-platform-settings'
  | 'invalid-interface-settings'
  | `unknown-platform:${string}`

export type ProfileSettingsProjection = {
  settings: ContentLensSettings
  source: 'canonical' | 'legacy' | 'default' | 'recovered'
  issues: ProfileSettingsProjectionIssue[]
}

const KNOWN_PROFILE_SETTINGS_KEYS = new Set([
  'contentLensSettings',
  'enabledPlatforms',
  'interface',
  'modelRouting',
  'platforms',
  'routing',
  'settingsMigrationIssues',
  'settingsSchemaVersion'
])

function readEnabledPlatforms(
  value: PortableJsonValue | undefined,
  issues: ProfileSettingsProjectionIssue[]
): Set<Platform> | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const enabled = new Set<Platform>()
  for (const entry of value) {
    if (
      typeof entry === 'string' &&
      PLATFORM_VALUES.includes(entry as Platform)
    ) {
      enabled.add(entry as Platform)
      continue
    }
    if (typeof entry === 'string') {
      issues.push(`unknown-platform:${entry}`)
    }
  }
  return enabled
}

export function projectContentLensSettings(
  profileSettings: PortableSettings
): ProfileSettingsProjection {
  const defaults = createDefaultSettings()
  const issues: ProfileSettingsProjectionIssue[] = []
  const canonical =
    profileSettings.settingsSchemaVersion === PROFILE_SETTINGS_SCHEMA_VERSION

  const routing = modelRoutingSettingsSchema.safeParse(
    profileSettings.modelRouting
  )
  if (!routing.success && (canonical || 'modelRouting' in profileSettings)) {
    issues.push('invalid-model-routing')
  }

  const platforms = contentLensSettingsSchema.shape.platforms.safeParse(
    profileSettings.platforms
  )
  if (!platforms.success && (canonical || 'platforms' in profileSettings)) {
    issues.push('invalid-platform-settings')
  }

  const interfaceSettings = contentLensSettingsSchema.shape.interface.safeParse(
    profileSettings.interface
  )
  if (
    !interfaceSettings.success &&
    (canonical || 'interface' in profileSettings)
  ) {
    issues.push('invalid-interface-settings')
  }

  const enabledPlatforms = readEnabledPlatforms(
    profileSettings.enabledPlatforms,
    issues
  )
  const projectedPlatforms = platforms.success
    ? platforms.data
    : enabledPlatforms
      ? Object.fromEntries(
          PLATFORM_VALUES.map(platform => [
            platform,
            {
              ...defaults.platforms[platform],
              state: enabledPlatforms.has(platform)
                ? ('enabled' as const)
                : ('disabled' as const)
            }
          ])
        )
      : defaults.platforms

  const settings = contentLensSettingsSchema.parse({
    schemaVersion: PROFILE_SETTINGS_SCHEMA_VERSION,
    routing: routing.success ? routing.data : defaults.routing,
    platforms: projectedPlatforms,
    interface: interfaceSettings.success
      ? interfaceSettings.data
      : defaults.interface
  })
  const hasLegacySettings =
    'enabledPlatforms' in profileSettings ||
    'modelRouting' in profileSettings ||
    'platforms' in profileSettings ||
    'interface' in profileSettings

  return {
    settings,
    source: canonical
      ? issues.length === 0
        ? 'canonical'
        : 'recovered'
      : hasLegacySettings
        ? 'legacy'
        : 'default',
    issues
  }
}

export function writeContentLensSettings(
  current: PortableSettings,
  settings: ContentLensSettings
): PortableSettings {
  const parsed = contentLensSettingsSchema.parse(settings)
  const preserved = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) => !KNOWN_PROFILE_SETTINGS_KEYS.has(key)
    )
  )
  return {
    ...preserved,
    settingsSchemaVersion: PROFILE_SETTINGS_SCHEMA_VERSION,
    modelRouting: parsed.routing,
    platforms: parsed.platforms,
    interface: parsed.interface
  }
}
