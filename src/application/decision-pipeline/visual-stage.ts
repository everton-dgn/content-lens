import type {
  BudgetPolicy,
  ModelCapability,
  ModelDescriptor,
  ModelRef
} from '@/ai/models/contracts'
import { PROVIDER_OUTPUT_SCHEMA_VERSION } from '@/ai/providers/adapters/contracts'
import { normalizeConsentKey } from '@/ai/providers/contracts'
import { RoutingBudget } from '@/ai/routing/budget'
import { buildModelCacheKey } from '@/ai/routing/cache-key'
import { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import { resolveEligibleRoute } from '@/ai/routing/eligibility'
import {
  canAdvanceToFallback,
  type RouteFailureCategory,
  resolveConfiguredRoute
} from '@/ai/routing/resolver'
import {
  classifyVision,
  type VisualClassificationOutcome,
  type VisualModelPort
} from '@/ai/vision/classifier'
import {
  MAX_VISUAL_EDGE,
  type MinimizedImage,
  type ResolvedMedia,
  VISION_PREPROCESSING_VERSION,
  type VisualMimeType
} from '@/ai/vision/contracts'
import {
  preflightResolvedMedia,
  selectVisualMedia
} from '@/ai/vision/media-preflight'
import type { VisualMediaPorts } from '@/ai/vision/media-runtime'
import {
  prepareVisualInput,
  visualDataCategories
} from '@/ai/vision/preprocessing'
import { VISION_PROMPT_CONTRACT_VERSION } from '@/ai/vision/prompt-contract'
import {
  createProviderVisualModelPort,
  type ExecuteVisualProviderPlan
} from '@/ai/vision/provider-port'
import type { ProviderRuntimeState } from '@/application/provider-management/persistence'
import type { ContentItem } from '@/core/content/contracts'
import {
  type ClassificationSignals,
  classificationSignalsSchema
} from '@/core/decisions/signals'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type { SemanticRule } from '@/core/rules/contracts/rule'
import type { ContentLensSettings } from '@/core/settings'

export type VisualStageInput = {
  item: ContentItem
  semanticRules: readonly SemanticRule[]
  profileRevision: number
  pageInstanceId: string
  settings: ContentLensSettings
  signal: AbortSignal
}

export type VisualStage = {
  version: string
  classify(input: VisualStageInput): Promise<VisualClassificationOutcome>
}

type PermissionProbe = {
  has(
    binding: {
      endpointOrigin: string
      execution: 'local' | 'cloud' | 'browser'
    },
    dataCollection: readonly ('authenticationInfo' | 'websiteContent')[]
  ): Promise<boolean>
}

type VisualCandidates = {
  topicIds: readonly string[]
  archetypeIds: readonly string[]
  evidenceCodes: readonly string[]
}

type RoutedVisualStageOptions = {
  runtime: ProviderRuntimeState | Promise<ProviderRuntimeState | undefined>
  permissions: PermissionProbe
  media: VisualMediaPorts
  execute?: ExecuteVisualProviderPlan
  createModelPort?: (input: {
    runtime: ProviderRuntimeState
    providerConfigId: string
    modelId: string
  }) => VisualModelPort
  createBrowserModelPort?: (input: {
    runtime: ProviderRuntimeState
    providerConfigId: string
    modelId: string
  }) => VisualModelPort
  candidates?: (item: ContentItem) => VisualCandidates
  cache?: {
    read(id: string): Promise<unknown | undefined>
    write(entry: {
      id: string
      updatedAt: string
      value: ClassificationSignals
    }): Promise<void>
  }
  hash?: (bytes: Uint8Array) => Promise<string>
  now?: () => Date
}

function abstain(
  code: NonNullable<ClassificationSignals['abstention']>['code'],
  detailCode?: string
): VisualClassificationOutcome {
  return {
    state: 'abstained',
    abstention: { code, ...(detailCode ? { detailCode } : {}) }
  }
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer
  )
  return `sha256:${[...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

function credentialAvailable(
  runtime: ProviderRuntimeState,
  reference: string,
  binding: { providerConfigId: string; endpointOrigin: string }
) {
  return runtime.vault
    .metadata()
    .some(
      credential =>
        credential.reference === reference &&
        credential.binding.providerConfigId === binding.providerConfigId &&
        credential.binding.endpointOrigin === binding.endpointOrigin &&
        !credential.locked
    )
}

function failureCategory(code: string): RouteFailureCategory {
  switch (code) {
    case 'provider-unavailable':
    case 'provider-temporarily-unavailable':
    case 'circuit-open':
      return 'temporary'
    case 'budget-blocked':
      return 'budget'
    case 'credential-missing':
    case 'consent-missing':
    case 'permission-missing':
      return 'authorization'
    case 'input-too-large':
    case 'language-unsupported':
    case 'modality-unsupported':
    case 'image-mime-unsupported':
      return 'input'
    default:
      return 'configuration'
  }
}

function outcomeCategory(
  outcome: Extract<VisualClassificationOutcome, { state: 'abstained' }>
): RouteFailureCategory {
  switch (outcome.abstention.code) {
    case 'invalid-output':
      return 'invalid-output'
    case 'provider-unavailable':
    case 'timeout':
      return 'temporary'
    case 'cancelled':
      return 'cancelled'
    case 'cost-limit':
      return 'budget'
    case 'unsupported-input':
    case 'unsupported-media':
    case 'resource-limit':
      return 'input'
    default:
      return 'configuration'
  }
}

function routeKey(reference: ModelRef) {
  return `${reference.providerConfigId}/${reference.modelId}/classification-vision`
}

function estimatedPricing(input: {
  model: ModelDescriptor
  capability: ModelCapability
  inputBytes: number
  budget: BudgetPolicy
}) {
  if (input.model.executionKind !== 'cloud' || !input.model.pricing) {
    return undefined
  }
  if (input.model.pricing.currency !== input.budget.monetaryBudget.currency) {
    return undefined
  }
  return {
    estimatedCost:
      (input.inputBytes * input.model.pricing.inputPrice +
        input.capability.maxOutputBytes * input.model.pricing.outputPrice) /
      1_000_000,
    priceVerifiedAt: Date.parse(input.model.pricing.verifiedAt)
  }
}

function acceptedMimeTypes(capability: ModelCapability): VisualMimeType[] {
  return capability.imageMimeTypes.filter(
    (mime): mime is VisualMimeType =>
      mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
  )
}

function compatibleCachedSignals(
  value: unknown,
  input: {
    item: ContentItem
    fingerprint: string
    modelVersion: string
    sourceId: string
  }
) {
  const parsed = classificationSignalsSchema.safeParse(value)
  if (!parsed.success) {
    return undefined
  }
  const { provenance } = parsed.data
  return provenance.sourceKind === 'vision-model' &&
    provenance.sourceId === input.sourceId &&
    provenance.sourceVersion === input.modelVersion &&
    provenance.inputFingerprint === input.fingerprint &&
    provenance.scope.contentId === input.item.id &&
    provenance.scope.platform === input.item.platform &&
    provenance.scope.surface === input.item.surface &&
    provenance.scope.task === 'classification-vision'
    ? parsed.data
    : undefined
}

export function createRoutedVisualStage(
  options: RoutedVisualStageOptions
): VisualStage {
  const circuit = new RouteCircuitBreaker()
  const budgets = new Map<string, RoutingBudget>()
  const now = options.now ?? (() => new Date())
  const hash = options.hash ?? sha256
  const budgetFor = (input: VisualStageInput) => {
    const key = JSON.stringify(input.settings.routing.budgets)
    const current = budgets.get(key)
    if (current) {
      return current
    }
    const budget = new RoutingBudget(input.settings.routing.budgets, {
      timeZone: 'UTC'
    })
    budgets.set(key, budget)
    return budget
  }

  return {
    version: 'routed-visual-stage@1',
    async classify(input) {
      if (input.signal.aborted) {
        return abstain('cancelled')
      }
      const runtime = await options.runtime
      if (!runtime) {
        return abstain('provider-unavailable', 'provider-state-unreadable')
      }
      const configured = resolveConfiguredRoute({
        settings: input.settings.routing,
        catalog: runtime.catalog,
        platform: input.item.platform,
        task: 'classification-vision'
      })
      if (configured.state !== 'resolved') {
        if (
          configured.state === 'invalid' &&
          configured.code === 'task-unsupported'
        ) {
          return abstain('unsupported-media', 'unsupported-modality')
        }
        return abstain(
          'provider-unavailable',
          configured.state === 'disabled' ? 'route-disabled' : configured.code
        )
      }

      const primaryModel = runtime.catalog.get(configured.primary)
      const primaryCapability = runtime.catalog.capability(
        configured.primary,
        'classification-vision'
      )
      if (!primaryModel || !primaryCapability?.modalities.includes('image')) {
        return abstain('unsupported-media', 'unsupported-modality')
      }
      const primaryProvider = runtime.providers.get(
        configured.primary.providerConfigId
      )
      if (!primaryProvider) {
        return abstain('provider-unavailable', 'provider-not-found')
      }

      const categories = visualDataCategories({
        item: input.item,
        semanticRules: input.semanticRules
      })
      if (
        primaryProvider.execution === 'cloud' &&
        !runtime.consents.has(
          normalizeConsentKey({
            providerConfigId: primaryProvider.providerConfigId,
            endpointOrigin: primaryProvider.endpointOrigin,
            task: 'classification-vision',
            platform: input.item.platform,
            categories,
            includeImages: true,
            consentSchemaVersion: 1
          })
        )
      ) {
        return abstain('provider-unavailable', 'consent-missing')
      }

      const selected = selectVisualMedia(input.item)
      if (selected.state === 'abstained') {
        return selected
      }
      const allowedOrigins = options.media.allowedOrigins(input.item.platform)
      let mediaOrigin: string
      try {
        mediaOrigin = new URL(selected.media.url).origin
      } catch {
        return abstain('unsupported-media', 'media-url')
      }
      if (!allowedOrigins.includes(mediaOrigin)) {
        return abstain('unsupported-media', 'media-origin')
      }
      if (!(await options.media.hasPermission(mediaOrigin))) {
        return abstain('provider-unavailable', 'media-permission-missing')
      }

      let resolved: ResolvedMedia
      try {
        resolved = await options.media.resolve(selected.media, {
          allowedOrigins,
          signal: input.signal
        })
      } catch {
        return input.signal.aborted
          ? abstain('cancelled')
          : abstain('unsupported-media', 'media-resolve')
      }
      const firstPreflight = await preflightResolvedMedia(resolved, {
        acceptedMimeTypes: acceptedMimeTypes(primaryCapability),
        maxInputBytes: primaryCapability.maxInputBytes,
        hash
      })
      if (firstPreflight.state === 'abstained') {
        return firstPreflight
      }

      let minimized: MinimizedImage
      try {
        minimized = await options.media.minimize(firstPreflight.media, {
          acceptedMimeTypes: acceptedMimeTypes(primaryCapability),
          maxEdge: MAX_VISUAL_EDGE,
          maxBytes: primaryCapability.maxInputBytes,
          signal: input.signal
        })
      } catch {
        return input.signal.aborted
          ? abstain('cancelled')
          : abstain('unsupported-media', 'media-minimize')
      }
      const finalPreflight = await preflightResolvedMedia(
        {
          bytes: minimized.bytes,
          declaredMimeType: minimized.mimeType,
          width: minimized.width,
          height: minimized.height
        },
        {
          acceptedMimeTypes: acceptedMimeTypes(primaryCapability),
          maxInputBytes: primaryCapability.maxInputBytes,
          hash
        }
      )
      if (finalPreflight.state === 'abstained') {
        return finalPreflight
      }
      if (
        finalPreflight.media.width > MAX_VISUAL_EDGE ||
        finalPreflight.media.height > MAX_VISUAL_EDGE
      ) {
        return abstain('resource-limit', 'minimized-edge')
      }

      const candidates = options.candidates?.(input.item) ?? {
        topicIds: [],
        archetypeIds: ['visual-clickbait'],
        evidenceCodes: [
          'visual.clickbait',
          'visual.text-overlay',
          'visual.low-quality',
          'visual.deceptive'
        ]
      }
      const prepared = await prepareVisualInput({
        item: input.item,
        pageInstanceId: input.pageInstanceId,
        profileRevision: input.profileRevision,
        semanticRules: input.semanticRules,
        image: finalPreflight.media,
        maxInputBytes: primaryCapability.maxInputBytes,
        candidateTopicIds: candidates.topicIds,
        candidateArchetypeIds: candidates.archetypeIds,
        candidateEvidenceCodes: candidates.evidenceCodes
      })
      if (prepared.state === 'abstained') {
        return prepared
      }

      const references = [configured.primary, ...configured.fallbacks]
      let category: RouteFailureCategory | undefined
      for (const [attemptIndex, reference] of references.entries()) {
        if (input.signal.aborted) {
          return abstain('cancelled')
        }
        if (
          attemptIndex > 0 &&
          (!category || !canAdvanceToFallback(category))
        ) {
          break
        }
        const model = runtime.catalog.get(reference)
        const capability = runtime.catalog.capability(
          reference,
          'classification-vision'
        )
        const provider = runtime.providers.get(reference.providerConfigId)
        if (!model || !capability || !provider) {
          category = 'configuration'
          break
        }
        const permissionGranted =
          provider.execution === 'browser' ||
          (await options.permissions.has(
            {
              endpointOrigin: provider.endpointOrigin,
              execution: provider.execution
            },
            provider.credentialMode === 'none'
              ? ['websiteContent']
              : ['authenticationInfo', 'websiteContent']
          ))
        const budget = budgetFor(input)
        const price = estimatedPricing({
          model,
          capability,
          inputBytes: prepared.prepared.inputBytes,
          budget: input.settings.routing.budgets
        })
        const eligible = resolveEligibleRoute({
          settings: input.settings.routing,
          platform: input.item.platform,
          task: 'classification-vision',
          content: {
            language: prepared.prepared.input.language,
            inputBytes: prepared.prepared.inputBytes,
            modalities: ['text', 'image'],
            imageMimeType: prepared.prepared.image.mimeType,
            categories: prepared.prepared.dataCategories,
            includeImages: true
          },
          environment: {
            providers: runtime.providers,
            catalog: runtime.catalog,
            consents: runtime.consents,
            permissions: {
              has: origin =>
                origin === provider.endpointOrigin && permissionGranted
            },
            credentials: {
              has: (reference, binding) =>
                credentialAvailable(runtime, reference, binding)
            },
            budget,
            circuit
          },
          attempt:
            attemptIndex === 0
              ? { kind: 'primary' }
              : {
                  kind: 'fallback',
                  index: attemptIndex - 1,
                  failureCategory: category ?? 'configuration'
                },
          at: now().getTime(),
          ...(price ? { pricing: price } : {})
        })
        if (eligible.state === 'unavailable') {
          category = failureCategory(eligible.code)
          if (
            attemptIndex + 1 < references.length &&
            canAdvanceToFallback(category)
          ) {
            continue
          }
          return abstain(
            eligible.code === 'budget-blocked'
              ? 'cost-limit'
              : eligible.code === 'input-too-large'
                ? 'resource-limit'
                : eligible.code === 'modality-unsupported' ||
                    eligible.code === 'image-mime-unsupported'
                  ? 'unsupported-media'
                  : 'provider-unavailable',
            eligible.code
          )
        }

        const modelVersion = model.declaredVersion ?? `model:${model.modelId}`
        const sourceId = `${provider.providerConfigId}:${model.modelId}`
        const cacheId = buildModelCacheKey({
          providerConfigId: reference.providerConfigId,
          providerFingerprint: await fingerprintPortableValue({
            providerConfigId: provider.providerConfigId,
            kind: provider.kind,
            execution: provider.execution,
            endpointOrigin: provider.endpointOrigin
          }),
          modelId: reference.modelId,
          modelVersion,
          capabilityVersion: await fingerprintPortableValue(capability),
          task: 'classification-vision',
          profileRevision: input.profileRevision,
          contentFingerprint: prepared.prepared.inputFingerprint,
          routeVersion: await fingerprintPortableValue({
            configured,
            consent:
              provider.execution === 'cloud'
                ? normalizeConsentKey({
                    providerConfigId: provider.providerConfigId,
                    endpointOrigin: provider.endpointOrigin,
                    task: 'classification-vision',
                    platform: input.item.platform,
                    categories: prepared.prepared.dataCategories,
                    includeImages: true,
                    consentSchemaVersion: 1
                  })
                : 'not-applicable'
          }),
          promptVersion: VISION_PROMPT_CONTRACT_VERSION,
          outputSchemaVersion: PROVIDER_OUTPUT_SCHEMA_VERSION,
          preprocessingVersion: VISION_PREPROCESSING_VERSION,
          policyVersion: 'deterministic-policy@1'
        })
        if (options.cache) {
          try {
            const cached = compatibleCachedSignals(
              await options.cache.read(cacheId),
              {
                item: input.item,
                fingerprint: prepared.prepared.inputFingerprint,
                modelVersion,
                sourceId
              }
            )
            if (cached) {
              budget.release(eligible.reservationId)
              return { state: 'signals', signals: cached }
            }
          } catch {
            // Cache availability cannot change the fail-open baseline.
          }
        }

        const modelPort =
          options.createModelPort?.({
            runtime,
            providerConfigId: provider.providerConfigId,
            modelId: model.modelId
          }) ??
          (provider.execution === 'browser'
            ? options.createBrowserModelPort?.({
                runtime,
                providerConfigId: provider.providerConfigId,
                modelId: model.modelId
              })
            : undefined) ??
          createProviderVisualModelPort({
            provider,
            modelId: model.modelId,
            vault: runtime.vault,
            ...(options.execute ? { execute: options.execute } : {})
          })
        const timeout = AbortSignal.timeout(
          provider.execution === 'cloud' ? 15_000 : 30_000
        )
        const outcome = await classifyVision({
          prepared: prepared.prepared,
          provider: modelPort,
          classifierVersion: 'vision-classifier@1',
          modelVersion,
          sourceId,
          observedAt: now().toISOString(),
          signal: AbortSignal.any([input.signal, timeout])
        })
        if (!budget.commit(eligible.reservationId)) {
          return abstain('provider-unavailable', 'budget-reservation-lost')
        }
        if (outcome.state === 'signals') {
          circuit.recordSuccess(routeKey(reference))
          if (options.cache) {
            try {
              await options.cache.write({
                id: cacheId,
                updatedAt: now().toISOString(),
                value: outcome.signals
              })
            } catch {
              // A cache write is optional and cannot revoke valid signals.
            }
          }
          return outcome
        }
        category = outcomeCategory(outcome)
        if (category === 'temporary' || category === 'invalid-output') {
          circuit.recordTemporaryFailure(routeKey(reference), now().getTime())
        }
        if (
          attemptIndex + 1 < references.length &&
          canAdvanceToFallback(category)
        ) {
          continue
        }
        return outcome
      }
      return abstain('provider-unavailable', 'fallback-not-configured')
    }
  }
}
