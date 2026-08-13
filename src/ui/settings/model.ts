import {
  type GlobalRouteSelection,
  MODEL_TASK_VALUES,
  type ModelDescriptor,
  type ModelRef,
  type ModelTask,
  type PlatformRouteSelection
} from '@/ai/models/contracts'
import {
  type ConsentKey,
  type ConsentReceipt,
  normalizeConsentKey,
  type ProviderDescriptor
} from '@/ai/providers/contracts'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import type { ContentLensSettings } from '@/core/settings'

export const routeValue = (reference: ModelRef) =>
  `${reference.providerConfigId}\u0000${reference.modelId}`

export const parseRouteValue = (value: string): ModelRef | undefined => {
  const [providerConfigId, modelId, extra] = value.split('\u0000')
  return providerConfigId && modelId && extra === undefined
    ? { providerConfigId, modelId }
    : undefined
}

type RoutedSelection = Extract<PlatformRouteSelection, { state: 'route' }>
type FallbackPolicyKey = 'allowCloudFallback' | 'allowHigherCostFallback'

const sameReference = (left: ModelRef, right: ModelRef) =>
  left.providerConfigId === right.providerConfigId &&
  left.modelId === right.modelId

const replacePrimary = (
  current: GlobalRouteSelection | PlatformRouteSelection | undefined,
  primary: ModelRef
): RoutedSelection =>
  current?.state === 'route'
    ? {
        ...current,
        primary,
        fallbacks: current.fallbacks.filter(
          fallback => !sameReference(fallback, primary)
        )
      }
    : {
        state: 'route',
        primary,
        fallbacks: [],
        allowCloudFallback: false,
        allowHigherCostFallback: false
      }

const replaceFallback = (
  current: GlobalRouteSelection | PlatformRouteSelection | undefined,
  index: number,
  value: string
): RoutedSelection | undefined => {
  if (
    current?.state !== 'route' ||
    index < 0 ||
    index > current.fallbacks.length
  ) {
    return undefined
  }
  const reference = parseRouteValue(value)
  const fallbacks = [...current.fallbacks]
  if (!reference) {
    fallbacks.splice(index)
    return { ...current, fallbacks }
  }
  if (
    sameReference(current.primary, reference) ||
    fallbacks.some(
      (fallback, candidateIndex) =>
        candidateIndex !== index && sameReference(fallback, reference)
    )
  ) {
    return undefined
  }
  fallbacks[index] = reference
  return { ...current, fallbacks }
}

export function modelsForTask(
  models: readonly ModelDescriptor[],
  task: ModelTask
) {
  return models.filter(
    model =>
      model.status === 'available' &&
      model.capabilities.some(capability => capability.task === task)
  )
}

export function effectiveRoute(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask
): PlatformRouteSelection {
  const override = settings.routing.platformOverrides[platform]?.[task]
  if (override && override.state !== 'inherit') {
    return override
  }
  return settings.routing.globalRoutes[task] ?? { state: 'disabled' }
}

export function updateGlobalRoute(
  settings: ContentLensSettings,
  task: ModelTask,
  value: string
): ContentLensSettings {
  const reference = parseRouteValue(value)
  return {
    ...settings,
    routing: {
      ...settings.routing,
      globalRoutes: {
        ...settings.routing.globalRoutes,
        [task]: reference
          ? replacePrimary(settings.routing.globalRoutes[task], reference)
          : { state: 'disabled' }
      }
    }
  }
}

export function updateGlobalFallback(
  settings: ContentLensSettings,
  task: ModelTask,
  index: number,
  value: string
): ContentLensSettings {
  const route = replaceFallback(
    settings.routing.globalRoutes[task],
    index,
    value
  )
  if (!route) {
    return settings
  }
  return {
    ...settings,
    routing: {
      ...settings.routing,
      globalRoutes: { ...settings.routing.globalRoutes, [task]: route }
    }
  }
}

export function updateGlobalFallbackPolicy(
  settings: ContentLensSettings,
  task: ModelTask,
  key: FallbackPolicyKey,
  enabled: boolean
): ContentLensSettings {
  const current = settings.routing.globalRoutes[task]
  if (current?.state !== 'route') {
    return settings
  }
  return {
    ...settings,
    routing: {
      ...settings.routing,
      globalRoutes: {
        ...settings.routing.globalRoutes,
        [task]: { ...current, [key]: enabled }
      }
    }
  }
}

export function updatePlatformRoute(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask,
  value: string
): ContentLensSettings {
  const reference = parseRouteValue(value)
  const selection: PlatformRouteSelection =
    value === 'inherit'
      ? { state: 'inherit' }
      : reference
        ? {
            ...replacePrimary(
              settings.routing.platformOverrides[platform]?.[task],
              reference
            )
          }
        : { state: 'disabled' }
  return {
    ...settings,
    routing: {
      ...settings.routing,
      platformOverrides: {
        ...settings.routing.platformOverrides,
        [platform]: {
          ...settings.routing.platformOverrides[platform],
          [task]: selection
        }
      }
    }
  }
}

export function updatePlatformFallback(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask,
  index: number,
  value: string
): ContentLensSettings {
  const route = replaceFallback(
    settings.routing.platformOverrides[platform]?.[task],
    index,
    value
  )
  if (!route) {
    return settings
  }
  return {
    ...settings,
    routing: {
      ...settings.routing,
      platformOverrides: {
        ...settings.routing.platformOverrides,
        [platform]: {
          ...settings.routing.platformOverrides[platform],
          [task]: route
        }
      }
    }
  }
}

export function updatePlatformFallbackPolicy(
  settings: ContentLensSettings,
  platform: Platform,
  task: ModelTask,
  key: FallbackPolicyKey,
  enabled: boolean
): ContentLensSettings {
  const current = settings.routing.platformOverrides[platform]?.[task]
  if (current?.state !== 'route') {
    return settings
  }
  return {
    ...settings,
    routing: {
      ...settings.routing,
      platformOverrides: {
        ...settings.routing.platformOverrides,
        [platform]: {
          ...settings.routing.platformOverrides[platform],
          [task]: { ...current, [key]: enabled }
        }
      }
    }
  }
}

const categoriesForTask = (task: ModelTask) => {
  switch (task) {
    case 'classification-vision':
      return ['title', 'context', 'rule', 'image'] as const
    case 'embedding':
      return ['title', 'body'] as const
    case 'assistance-draft':
      return ['title', 'body', 'rule', 'examples', 'intent'] as const
    case 'assistance-explain':
      return ['title', 'body', 'rule', 'decision'] as const
    case 'classification-text':
      return ['title', 'body', 'author', 'context', 'rule'] as const
  }
}

const consentKeyId = (key: ConsentKey) => JSON.stringify(key)

export type RequiredCloudConsent = {
  key: ConsentKey
  provider: ProviderDescriptor
  receipt: ConsentReceipt
}

export function requiredCloudConsents(
  settings: ContentLensSettings,
  snapshot: SettingsRuntimeSnapshot,
  at: string
): RequiredCloudConsent[] {
  const providers = new Map(
    snapshot.providers.providers.map(provider => [
      provider.providerConfigId,
      provider
    ])
  )
  const models = new Map(
    snapshot.providers.models.map(model => [routeValue(model), model])
  )
  const required = new Map<string, RequiredCloudConsent>()
  for (const platform of PLATFORM_VALUES) {
    if (settings.platforms[platform].state !== 'enabled') {
      continue
    }
    for (const task of MODEL_TASK_VALUES) {
      const route = effectiveRoute(settings, platform, task)
      if (route.state !== 'route') {
        continue
      }
      const model = models.get(routeValue(route.primary))
      const provider = providers.get(route.primary.providerConfigId)
      if (
        !model ||
        !provider ||
        model.executionKind !== 'cloud' ||
        provider.execution !== 'cloud'
      ) {
        continue
      }
      const key = normalizeConsentKey({
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin,
        task,
        platform,
        categories: categoriesForTask(task),
        includeImages: task === 'classification-vision',
        consentSchemaVersion: 1
      })
      required.set(consentKeyId(key), {
        key,
        provider,
        receipt: {
          key,
          providerKind: provider.kind,
          policyUrl: provider.policyUrl,
          policyReviewedAt: provider.policyReviewedAt,
          estimatedFrequency: 'per visible item',
          declaredRetention: null,
          consentedAt: at
        }
      })
    }
  }
  return [...required.values()]
}

export const hasConsent = (
  receipts: readonly ConsentReceipt[],
  key: ConsentKey
) => receipts.some(receipt => consentKeyId(receipt.key) === consentKeyId(key))
