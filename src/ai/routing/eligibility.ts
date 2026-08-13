import type { ModelCatalog } from '@/ai/models/catalog'
import type {
  ModelCapability,
  ModelRef,
  ModelRoutingSettings,
  ModelTask
} from '@/ai/models/contracts'
import type { ConsentRepository } from '@/ai/providers/consent'
import {
  type DataCategory,
  normalizeConsentKey
} from '@/ai/providers/contracts'
import type { ProviderRegistry } from '@/ai/providers/registry'
import type { RoutingBudget } from '@/ai/routing/budget'
import type { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import {
  canAdvanceToFallback,
  type RouteFailureCategory,
  resolveConfiguredRoute
} from '@/ai/routing/resolver'
import type { Platform } from '@/core/content/contracts'

type RouteContentCapabilities = {
  language: string
  inputBytes: number
  modalities: readonly ('text' | 'image')[]
  imageMimeType: string | null
  categories: readonly DataCategory[]
  includeImages: boolean
}

type RouteEnvironment = {
  providers: ProviderRegistry
  catalog: ModelCatalog
  consents: ConsentRepository
  permissions: {
    has(origin: string): boolean
  }
  credentials: {
    has(
      reference: string,
      binding: { providerConfigId: string; endpointOrigin: string }
    ): boolean
  }
  budget: RoutingBudget
  circuit: RouteCircuitBreaker
}

type RouteAttempt =
  | { kind: 'primary' }
  | {
      kind: 'fallback'
      index: number
      failureCategory: RouteFailureCategory
    }

type RouteUnavailableCode =
  | 'route-disabled'
  | 'route-invalid'
  | 'fallback-not-configured'
  | 'fallback-cause-not-allowed'
  | 'fallback-cloud-not-authorized'
  | 'fallback-higher-cost-not-authorized'
  | 'provider-not-found'
  | 'provider-unavailable'
  | 'provider-temporarily-unavailable'
  | 'model-not-found'
  | 'task-unsupported'
  | 'execution-mismatch'
  | 'modality-unsupported'
  | 'image-mime-unsupported'
  | 'language-unsupported'
  | 'input-too-large'
  | 'structured-output-unsupported'
  | 'permission-missing'
  | 'credential-missing'
  | 'consent-missing'
  | 'circuit-open'
  | 'budget-blocked'

export type EligibleRouteResolution =
  | {
      state: 'resolved'
      source: 'platform' | 'global'
      selected: ModelRef
      fallbackIndex: number | null
      executionKind: 'local' | 'browser' | 'cloud'
      capability: Pick<
        ModelCapability,
        'task' | 'modalities' | 'evidence' | 'maxInputBytes'
      >
      reservationId: string
      recoveryProbe: boolean
    }
  | {
      state: 'unavailable'
      source: 'platform' | 'global'
      code: RouteUnavailableCode
      fallbackIndex: number | null
    }

type ResolveEligibleRouteInput = {
  settings: ModelRoutingSettings
  platform: Platform
  task: ModelTask
  content: RouteContentCapabilities
  environment: RouteEnvironment
  attempt: RouteAttempt
  at: number
  pricing?: {
    estimatedCost: number
    priceVerifiedAt: number
    primaryEstimatedCost?: number
  }
}

function unavailable(
  source: 'platform' | 'global',
  code: RouteUnavailableCode,
  fallbackIndex: number | null
): EligibleRouteResolution {
  return { state: 'unavailable', source, code, fallbackIndex }
}

function selectedReference(
  input: ResolveEligibleRouteInput,
  route: Extract<
    ReturnType<typeof resolveConfiguredRoute>,
    { state: 'resolved' }
  >
): {
  reference: ModelRef
  fallbackIndex: number | null
  blockedCode?: RouteUnavailableCode
} {
  if (input.attempt.kind === 'primary') {
    return {
      reference: route.primary,
      fallbackIndex: null
    }
  }
  const fallback = route.fallbacks[input.attempt.index]
  if (!fallback) {
    return {
      reference: route.primary,
      fallbackIndex: input.attempt.index,
      blockedCode: 'fallback-not-configured'
    }
  }
  if (!canAdvanceToFallback(input.attempt.failureCategory)) {
    return {
      reference: fallback,
      fallbackIndex: input.attempt.index,
      blockedCode: 'fallback-cause-not-allowed'
    }
  }
  const primary = input.environment.catalog.get(route.primary)
  const candidate = input.environment.catalog.get(fallback)
  if (
    primary &&
    candidate?.executionKind === 'cloud' &&
    primary.executionKind !== 'cloud' &&
    !route.allowCloudFallback
  ) {
    return {
      reference: fallback,
      fallbackIndex: input.attempt.index,
      blockedCode: 'fallback-cloud-not-authorized'
    }
  }
  if (
    input.pricing?.primaryEstimatedCost !== undefined &&
    input.pricing.estimatedCost > input.pricing.primaryEstimatedCost &&
    !route.allowHigherCostFallback
  ) {
    return {
      reference: fallback,
      fallbackIndex: input.attempt.index,
      blockedCode: 'fallback-higher-cost-not-authorized'
    }
  }
  return {
    reference: fallback,
    fallbackIndex: input.attempt.index
  }
}

function capabilityBlock(
  capability: ModelCapability,
  content: RouteContentCapabilities
): RouteUnavailableCode | undefined {
  if (
    content.modalities.some(
      modality => !capability.modalities.includes(modality)
    )
  ) {
    return 'modality-unsupported'
  }
  if (
    content.includeImages &&
    (!content.imageMimeType ||
      !capability.imageMimeTypes.includes(content.imageMimeType))
  ) {
    return 'image-mime-unsupported'
  }
  if (!capability.languages.includes(content.language)) {
    return 'language-unsupported'
  }
  if (content.inputBytes > capability.maxInputBytes) {
    return 'input-too-large'
  }
  if (!capability.structuredOutput) {
    return 'structured-output-unsupported'
  }
  return undefined
}

export function resolveEligibleRoute(
  input: ResolveEligibleRouteInput
): EligibleRouteResolution {
  const configured = resolveConfiguredRoute({
    settings: input.settings,
    catalog: input.environment.catalog,
    platform: input.platform,
    task: input.task
  })
  if (configured.state === 'disabled') {
    return unavailable(
      configured.source,
      'route-disabled',
      input.attempt.kind === 'fallback' ? input.attempt.index : null
    )
  }
  if (configured.state === 'invalid') {
    return unavailable(
      configured.source,
      configured.code === 'model-not-found'
        ? 'model-not-found'
        : 'task-unsupported',
      input.attempt.kind === 'fallback' ? input.attempt.index : null
    )
  }

  const selected = selectedReference(input, configured)
  if (selected.blockedCode) {
    return unavailable(
      configured.source,
      selected.blockedCode,
      selected.fallbackIndex
    )
  }
  const provider = input.environment.providers.get(
    selected.reference.providerConfigId
  )
  if (!provider) {
    return unavailable(
      configured.source,
      'provider-not-found',
      selected.fallbackIndex
    )
  }
  if (provider.status !== 'ready') {
    return unavailable(
      configured.source,
      provider.status === 'degraded' || provider.status === 'rate-limited'
        ? 'provider-temporarily-unavailable'
        : 'provider-unavailable',
      selected.fallbackIndex
    )
  }
  const model = input.environment.catalog.get(selected.reference)
  if (!model) {
    return unavailable(
      configured.source,
      'model-not-found',
      selected.fallbackIndex
    )
  }
  if (model.executionKind !== provider.execution) {
    return unavailable(
      configured.source,
      'execution-mismatch',
      selected.fallbackIndex
    )
  }
  const capability = input.environment.catalog.capability(
    selected.reference,
    input.task
  )
  if (!capability || model.status !== 'available') {
    return unavailable(
      configured.source,
      'task-unsupported',
      selected.fallbackIndex
    )
  }
  const blockedCapability = capabilityBlock(capability, input.content)
  if (blockedCapability) {
    return unavailable(
      configured.source,
      blockedCapability,
      selected.fallbackIndex
    )
  }

  if (
    provider.execution !== 'browser' &&
    !input.environment.permissions.has(provider.endpointOrigin)
  ) {
    return unavailable(
      configured.source,
      'permission-missing',
      selected.fallbackIndex
    )
  }
  if (
    provider.credentialMode !== 'none' &&
    (!provider.credentialRef ||
      !input.environment.credentials.has(provider.credentialRef, {
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin
      }))
  ) {
    return unavailable(
      configured.source,
      'credential-missing',
      selected.fallbackIndex
    )
  }
  if (
    provider.execution === 'cloud' &&
    !input.environment.consents.has(
      normalizeConsentKey({
        providerConfigId: provider.providerConfigId,
        endpointOrigin: provider.endpointOrigin,
        task: input.task,
        platform: input.platform,
        categories: input.content.categories,
        includeImages: input.content.includeImages,
        consentSchemaVersion: 1
      })
    )
  ) {
    return unavailable(
      configured.source,
      'consent-missing',
      selected.fallbackIndex
    )
  }

  const reservation = input.environment.budget.reserve({
    providerConfigId: provider.providerConfigId,
    executionKind: provider.execution,
    at: input.at,
    ...(input.pricing ?? {})
  })
  if (reservation.state === 'blocked') {
    return unavailable(
      configured.source,
      'budget-blocked',
      selected.fallbackIndex
    )
  }
  const routeKey = [
    selected.reference.providerConfigId,
    selected.reference.modelId,
    input.task
  ].join('/')
  const circuit = input.environment.circuit.acquire(routeKey, input.at)
  if (!circuit.allowed) {
    input.environment.budget.release(reservation.reservationId)
    return unavailable(
      configured.source,
      'circuit-open',
      selected.fallbackIndex
    )
  }

  return {
    state: 'resolved',
    source: configured.source,
    selected: structuredClone(selected.reference),
    fallbackIndex: selected.fallbackIndex,
    executionKind: provider.execution,
    capability: {
      task: capability.task,
      modalities: structuredClone(capability.modalities),
      evidence: capability.evidence,
      maxInputBytes: capability.maxInputBytes
    },
    reservationId: reservation.reservationId,
    recoveryProbe: circuit.probe
  }
}
