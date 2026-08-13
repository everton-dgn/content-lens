import type {
  GlobalRouteSelection,
  ModelDescriptor,
  ModelTask,
  PlatformRouteSelection
} from '@/ai/models/contracts'
import { MODEL_TASK_VALUES } from '@/ai/models/contracts'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import type { ContentLensSettings } from '@/core/settings'

export type ProviderRouteImpact = {
  modelId: string
  platform: Platform | null
  role: 'primary' | 'fallback'
  task: ModelTask
}

export type ProviderRemovalImpact = {
  blocked: boolean
  models: string[]
  providerConfigId: string
  routes: ProviderRouteImpact[]
}

const routeImpacts = (
  route: GlobalRouteSelection | PlatformRouteSelection | undefined,
  providerConfigId: string,
  task: ModelTask,
  platform: Platform | null
): ProviderRouteImpact[] => {
  if (route?.state !== 'route') {
    return []
  }
  return [
    ...(route.primary.providerConfigId === providerConfigId
      ? [
          {
            modelId: route.primary.modelId,
            platform,
            role: 'primary' as const,
            task
          }
        ]
      : []),
    ...route.fallbacks
      .filter(reference => reference.providerConfigId === providerConfigId)
      .map(reference => ({
        modelId: reference.modelId,
        platform,
        role: 'fallback' as const,
        task
      }))
  ]
}

export function getProviderRemovalImpact(
  settings: ContentLensSettings,
  models: readonly ModelDescriptor[],
  providerConfigId: string
): ProviderRemovalImpact {
  const routes: ProviderRouteImpact[] = []
  for (const task of MODEL_TASK_VALUES) {
    routes.push(
      ...routeImpacts(
        settings.routing.globalRoutes[task],
        providerConfigId,
        task,
        null
      )
    )
  }
  for (const platform of PLATFORM_VALUES) {
    for (const task of MODEL_TASK_VALUES) {
      routes.push(
        ...routeImpacts(
          settings.routing.platformOverrides[platform]?.[task],
          providerConfigId,
          task,
          platform
        )
      )
    }
  }
  routes.sort((left, right) =>
    `${left.platform ?? 'global'}:${left.task}:${left.role}:${left.modelId}`.localeCompare(
      `${right.platform ?? 'global'}:${right.task}:${right.role}:${right.modelId}`,
      'en'
    )
  )
  const providerModels = models
    .filter(model => model.providerConfigId === providerConfigId)
    .map(model => model.modelId)
    .sort((left, right) => left.localeCompare(right, 'en'))
  return {
    blocked: routes.length > 0,
    models: providerModels,
    providerConfigId,
    routes
  }
}
