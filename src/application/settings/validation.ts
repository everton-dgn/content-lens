import type { ModelCatalog } from '@/ai/models/catalog'
import {
  MODEL_TASK_VALUES,
  type ModelRef,
  type ModelTask,
  type PlatformRouteSelection
} from '@/ai/models/contracts'
import type { ConsentRepository } from '@/ai/providers/consent'
import type { ProviderRegistry } from '@/ai/providers/registry'
import type { Platform } from '@/core/content/contracts'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import {
  type ContentLensSettings,
  contentLensSettingsSchema
} from '@/core/settings'
import {
  type ConsentKey,
  consentKeySchema,
  normalizeConsentKey
} from '@/security/credentials/contracts'

export type SettingsValidationIssue = {
  code:
    | 'settings-invalid'
    | 'model-not-found'
    | 'task-unsupported'
    | 'provider-disconnected'
    | 'consent-missing'
  path: string
}

export type SettingsDraftValidation =
  | {
      success: true
      settings: ContentLensSettings
      consentKeys: ConsentKey[]
    }
  | {
      success: false
      issues: SettingsValidationIssue[]
    }

export type SettingsValidationEnvironment = {
  catalog: ModelCatalog
  providers: ProviderRegistry
  consents: ConsentRepository
}

export type SettingsValidationContext = {
  reviewedConsentKeys: readonly unknown[]
}

function validateReference(
  reference: ModelRef,
  task: ModelTask,
  path: string,
  environment: SettingsValidationEnvironment
): SettingsValidationIssue | undefined {
  const model = environment.catalog.get(reference)
  if (!model) {
    return { code: 'model-not-found', path }
  }
  if (!environment.catalog.supports(reference, task)) {
    return { code: 'task-unsupported', path }
  }
  const provider = environment.providers.get(reference.providerConfigId)
  if (
    !provider ||
    provider.status === 'revoked' ||
    provider.status === 'unconfigured'
  ) {
    return { code: 'provider-disconnected', path }
  }
  return undefined
}

function validateRoute(
  route: PlatformRouteSelection,
  task: ModelTask,
  path: string,
  environment: SettingsValidationEnvironment
): SettingsValidationIssue[] {
  if (route.state !== 'route') {
    return []
  }
  const issues: SettingsValidationIssue[] = []
  const primaryIssue = validateReference(
    route.primary,
    task,
    `${path}.primary`,
    environment
  )
  if (primaryIssue) {
    issues.push(primaryIssue)
  }
  for (const [index, fallback] of route.fallbacks.entries()) {
    const fallbackIssue = validateReference(
      fallback,
      task,
      `${path}.fallbacks.${index}`,
      environment
    )
    if (fallbackIssue) {
      issues.push(fallbackIssue)
    }
  }
  return issues
}

function effectiveRoute(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask
) {
  const override = settings.routing.platformOverrides[platform]?.[task]
  if (override && override.state !== 'inherit') {
    return {
      route: override,
      path: `routing.platformOverrides.${platform}.${task}`
    }
  }
  return {
    route: settings.routing.globalRoutes[task],
    path: `routing.globalRoutes.${task}`
  }
}

function normalizedReviewedConsentKeys(
  reviewed: readonly unknown[]
): ConsentKey[] {
  const normalized = new Map<string, ConsentKey>()
  for (const candidate of reviewed) {
    const parsed = consentKeySchema.safeParse(candidate)
    if (!parsed.success) {
      continue
    }
    const key = normalizeConsentKey(parsed.data)
    normalized.set(JSON.stringify(key), key)
  }
  return [...normalized.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')
  )
}

function keyMatchesCloudRoute(
  key: ConsentKey,
  input: {
    providerConfigId: string
    endpointOrigin: string
    task: ModelTask
    platform: Platform
  }
) {
  const vision = input.task === 'classification-vision'
  return (
    key.providerConfigId === input.providerConfigId &&
    key.endpointOrigin === input.endpointOrigin &&
    key.task === input.task &&
    key.platform === input.platform &&
    key.consentSchemaVersion === 1 &&
    key.includeImages === vision &&
    key.categories.includes('image') === vision
  )
}

function validateCloudConsents(
  settings: ContentLensSettings,
  environment: SettingsValidationEnvironment,
  reviewedConsentKeys: readonly ConsentKey[]
) {
  const issues: SettingsValidationIssue[] = []
  const used = new Map<string, ConsentKey>()
  for (const platform of PLATFORM_VALUES) {
    if (settings.platforms[platform].state !== 'enabled') {
      continue
    }
    for (const task of MODEL_TASK_VALUES) {
      const effective = effectiveRoute(settings, platform, task)
      const route = effective.route
      if (route?.state !== 'route') {
        continue
      }
      const primary = environment.catalog.get(route.primary)
      const candidates = [
        {
          reference: route.primary,
          path: `${effective.path}.primary`,
          executable: true
        },
        ...route.fallbacks.map((reference, index) => ({
          reference,
          path: `${effective.path}.fallbacks.${index}`,
          executable:
            primary?.executionKind === 'cloud' || route.allowCloudFallback
        }))
      ]
      for (const candidate of candidates) {
        if (!candidate.executable) {
          continue
        }
        const model = environment.catalog.get(candidate.reference)
        const provider = environment.providers.get(
          candidate.reference.providerConfigId
        )
        if (
          !model ||
          !provider ||
          model.executionKind !== 'cloud' ||
          provider.execution !== 'cloud'
        ) {
          continue
        }
        const key = reviewedConsentKeys.find(reviewed =>
          keyMatchesCloudRoute(reviewed, {
            providerConfigId: provider.providerConfigId,
            endpointOrigin: provider.endpointOrigin,
            task,
            platform
          })
        )
        if (!key || !environment.consents.has(key)) {
          issues.push({ code: 'consent-missing', path: candidate.path })
          continue
        }
        used.set(JSON.stringify(key), key)
      }
    }
  }
  return {
    issues,
    consentKeys: [...used.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')
    )
  }
}

export function validateSettingsDraft(
  input: unknown,
  environment: SettingsValidationEnvironment,
  context: SettingsValidationContext = { reviewedConsentKeys: [] }
): SettingsDraftValidation {
  const parsed = contentLensSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map(issue => ({
        code: 'settings-invalid',
        path: issue.path.join('.')
      }))
    }
  }
  const issues: SettingsValidationIssue[] = []
  for (const task of MODEL_TASK_VALUES) {
    const globalRoute = parsed.data.routing.globalRoutes[task]
    if (globalRoute) {
      issues.push(
        ...validateRoute(
          globalRoute,
          task,
          `routing.globalRoutes.${task}`,
          environment
        )
      )
    }
  }
  for (const platform of PLATFORM_VALUES) {
    for (const task of MODEL_TASK_VALUES) {
      const override = parsed.data.routing.platformOverrides[platform]?.[task]
      if (override) {
        issues.push(
          ...validateRoute(
            override,
            task,
            `routing.platformOverrides.${platform}.${task}`,
            environment
          )
        )
      }
    }
  }
  const consentValidation = validateCloudConsents(
    parsed.data,
    environment,
    normalizedReviewedConsentKeys(context.reviewedConsentKeys)
  )
  issues.push(...consentValidation.issues)
  return issues.length > 0
    ? { success: false, issues }
    : {
        success: true,
        settings: parsed.data,
        consentKeys: consentValidation.consentKeys
      }
}

export function resetPlatformOverride(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask
): ContentLensSettings {
  const platformOverrides = structuredClone(settings.routing.platformOverrides)
  const current = platformOverrides[platform]
  if (current) {
    delete current[task]
    if (Object.keys(current).length === 0) {
      delete platformOverrides[platform]
    }
  }
  return contentLensSettingsSchema.parse({
    ...settings,
    routing: {
      ...settings.routing,
      platformOverrides
    }
  })
}
