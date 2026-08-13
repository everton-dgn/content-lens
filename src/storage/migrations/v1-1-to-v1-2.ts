import {
  DEFAULT_BUDGET_POLICY,
  modelRoutingSettingsSchema
} from '@/ai/models/contracts'
import {
  type PortableJsonValue,
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'
import type { MigrationManifest } from '@/storage/migrations/contracts'

const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'credential',
  'password',
  'secret',
  'token'
])

type QuarantineRecord = {
  path: string
  reason: 'secret-field'
}

type LegacyModel = {
  providerConfigId: string
  modelId: string
  modalities: Array<'text' | 'image'>
}

function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function sanitizePortableValue(
  value: PortableJsonValue,
  path: string,
  quarantine: QuarantineRecord[]
): PortableJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizePortableValue(entry, `${path}[${index}]`, quarantine)
    )
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const sanitized: Record<string, PortableJsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`
    if (SECRET_FIELD_NAMES.has(normalizedFieldName(key))) {
      quarantine.push({ path: entryPath, reason: 'secret-field' })
      continue
    }
    sanitized[key] = sanitizePortableValue(entry, entryPath, quarantine)
  }
  return sanitized
}

function readLegacyModel(
  value: PortableJsonValue | undefined
): LegacyModel | undefined {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof value.providerConfigId !== 'string' ||
    typeof value.modelId !== 'string' ||
    !Array.isArray(value.modalities) ||
    !value.modalities.every(
      modality => modality === 'text' || modality === 'image'
    )
  ) {
    return undefined
  }
  return {
    providerConfigId: value.providerConfigId,
    modelId: value.modelId,
    modalities: [...new Set(value.modalities)]
  }
}

export function migrateProfileV1_1ToV1_2(
  source: ProfileEnvelope,
  at: string
): ProfileEnvelope {
  const legacyModel = readLegacyModel(source.settings.legacyModel)
  const settingsWithoutLegacy = Object.fromEntries(
    Object.entries(source.settings).filter(([key]) => key !== 'legacyModel')
  ) as Record<string, PortableJsonValue>
  const quarantine: QuarantineRecord[] = []
  const sanitizedSettings = sanitizePortableValue(
    settingsWithoutLegacy,
    'settings',
    quarantine
  ) as Record<string, PortableJsonValue>

  const globalRoutes =
    legacyModel === undefined
      ? {}
      : {
          'classification-text': {
            state: 'route' as const,
            primary: {
              providerConfigId: legacyModel.providerConfigId,
              modelId: legacyModel.modelId
            },
            fallbacks: [],
            allowCloudFallback: false,
            allowHigherCostFallback: false
          },
          ...(legacyModel.modalities.includes('image')
            ? {
                'classification-vision': {
                  state: 'route' as const,
                  primary: {
                    providerConfigId: legacyModel.providerConfigId,
                    modelId: legacyModel.modelId
                  },
                  fallbacks: [],
                  allowCloudFallback: false,
                  allowHigherCostFallback: false
                }
              }
            : {})
        }
  const modelRouting = modelRoutingSettingsSchema.parse({
    schemaVersion: 1,
    globalRoutes,
    platformOverrides: {},
    budgets: DEFAULT_BUDGET_POLICY
  })

  return profileEnvelopeSchema.parse({
    ...source,
    schemaVersion: { major: 1, minor: 2 },
    revision: source.revision + 1,
    updatedAt: at,
    settings: {
      ...sanitizedSettings,
      aiCacheSchemaVersion: 1,
      modelRouting,
      ...(quarantine.length > 0 ? { migrationQuarantine: quarantine } : {})
    }
  })
}

export const profileV1_1ToV1_2: MigrationManifest = {
  id: 'profile-1.1-to-1.2',
  sourceVersion: { major: 1, minor: 1 },
  targetVersion: { major: 1, minor: 2 },
  compatibility: 'backward-readable-minor',
  affectedStores: ['profile', 'provider-config', 'routing'],
  sourceProductVersion: '0.2.0',
  targetProductVersion: '0.3.0',
  recoveryNotes:
    'Restore the validated 1.1 snapshot; provider credentials must be entered again.',
  migrate: migrateProfileV1_1ToV1_2
}
