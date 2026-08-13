import type { ModelCatalog } from '@/ai/models/catalog'
import type { ModelRef, ModelTask } from '@/ai/models/contracts'
import type { ProviderRegistry } from '@/ai/providers/registry'
import { resolveConfiguredRoute } from '@/ai/routing/resolver'
import type { Platform } from '@/core/content/contracts'
import type { ContentLensSettings } from '@/core/settings'

type EffectiveModel = ModelRef & {
  displayName: string
  executionKind: 'local' | 'browser' | 'cloud'
  providerDisplayName: string
}

export type EffectiveRoutePreview =
  | {
      state: 'disabled'
      source: 'global' | 'platform'
      inherited: boolean
      reason?: 'text-only-without-vision-route'
    }
  | {
      state: 'invalid'
      source: 'global' | 'platform'
      inherited: boolean
      code:
        | 'model-not-found'
        | 'task-unsupported'
        | 'provider-not-found'
        | 'provider-disconnected'
    }
  | {
      state: 'resolved'
      source: 'global' | 'platform'
      inherited: boolean
      primary: EffectiveModel
      fallbacks: readonly ModelRef[]
      allowCloudFallback: boolean
      allowHigherCostFallback: boolean
    }

export function previewEffectiveRoute(input: {
  settings: ContentLensSettings
  catalog: ModelCatalog
  providers: ProviderRegistry
  platform: Platform
  task: ModelTask
}): EffectiveRoutePreview {
  const resolution = resolveConfiguredRoute({
    settings: input.settings.routing,
    catalog: input.catalog,
    platform: input.platform,
    task: input.task
  })
  const source =
    resolution.source === 'platform'
      ? ('platform' as const)
      : ('global' as const)
  const inherited = source === 'global'
  if (resolution.state === 'disabled') {
    return {
      state: 'disabled',
      source,
      inherited,
      ...(resolution.reason ? { reason: resolution.reason } : {})
    }
  }
  if (resolution.state === 'invalid') {
    return {
      state: 'invalid',
      source,
      inherited,
      code: resolution.code
    }
  }

  const model = input.catalog.get(resolution.primary)
  if (!model) {
    return {
      state: 'invalid',
      source,
      inherited,
      code: 'model-not-found'
    }
  }
  const provider = input.providers.get(model.providerConfigId)
  if (!provider) {
    return {
      state: 'invalid',
      source,
      inherited,
      code: 'provider-not-found'
    }
  }
  if (provider.status === 'revoked' || provider.status === 'unconfigured') {
    return {
      state: 'invalid',
      source,
      inherited,
      code: 'provider-disconnected'
    }
  }
  return {
    state: 'resolved',
    source,
    inherited,
    primary: {
      ...resolution.primary,
      displayName: model.displayName,
      executionKind: model.executionKind,
      providerDisplayName: provider.displayName
    },
    fallbacks: resolution.fallbacks,
    allowCloudFallback: resolution.allowCloudFallback,
    allowHigherCostFallback: resolution.allowHigherCostFallback
  }
}
