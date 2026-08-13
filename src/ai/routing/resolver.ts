import type { ModelCatalog } from '@/ai/models/catalog'
import type {
  GlobalRouteSelection,
  ModelRef,
  ModelRoutingSettings,
  ModelTask,
  PlatformRouteSelection
} from '@/ai/models/contracts'
import type { Platform } from '@/core/content/contracts'

export type RouteFailureCategory =
  | 'temporary'
  | 'invalid-output'
  | 'configuration'
  | 'authorization'
  | 'input'
  | 'budget'
  | 'cancelled'

type RouteSelection = GlobalRouteSelection | PlatformRouteSelection

export type ConfiguredRouteResolution =
  | {
      state: 'resolved'
      source: 'platform' | 'global'
      primary: ModelRef
      fallbacks: readonly ModelRef[]
      allowCloudFallback: boolean
      allowHigherCostFallback: boolean
    }
  | {
      state: 'disabled'
      source: 'platform' | 'global'
      reason?: 'text-only-without-vision-route'
    }
  | {
      state: 'invalid'
      source: 'platform' | 'global'
      code: 'model-not-found' | 'task-unsupported'
    }

function routeFor(
  settings: ModelRoutingSettings,
  platform: Platform,
  task: ModelTask
): { selection: RouteSelection; source: 'platform' | 'global' } {
  const override = settings.platformOverrides[platform]?.[task]
  if (override && override.state !== 'inherit') {
    return { selection: override, source: 'platform' }
  }
  return {
    selection: settings.globalRoutes[task] ?? { state: 'disabled' },
    source: 'global'
  }
}

export function resolveConfiguredRoute(input: {
  settings: ModelRoutingSettings
  catalog: ModelCatalog
  platform: Platform
  task: ModelTask
}): ConfiguredRouteResolution {
  const { selection, source } = routeFor(
    input.settings,
    input.platform,
    input.task
  )
  if (selection.state === 'disabled' || selection.state === 'inherit') {
    if (input.task === 'classification-vision') {
      const textRoute = routeFor(
        input.settings,
        input.platform,
        'classification-text'
      )
      if (
        textRoute.selection.state === 'route' &&
        input.catalog.supports(
          textRoute.selection.primary,
          'classification-text'
        ) &&
        !input.catalog.supportsModality(textRoute.selection.primary, 'image')
      ) {
        return {
          state: 'disabled',
          source,
          reason: 'text-only-without-vision-route'
        }
      }
    }
    return { state: 'disabled', source }
  }

  const model = input.catalog.get(selection.primary)
  if (!model) {
    return { state: 'invalid', source, code: 'model-not-found' }
  }
  if (!input.catalog.supports(selection.primary, input.task)) {
    return { state: 'invalid', source, code: 'task-unsupported' }
  }
  return {
    state: 'resolved',
    source,
    primary: structuredClone(selection.primary),
    fallbacks: structuredClone(selection.fallbacks),
    allowCloudFallback: selection.allowCloudFallback,
    allowHigherCostFallback: selection.allowHigherCostFallback
  }
}

export function canAdvanceToFallback(category: RouteFailureCategory) {
  return category === 'temporary' || category === 'invalid-output'
}
