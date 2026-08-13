import type {
  BudgetPolicy,
  ModelCapability,
  ModelDescriptor,
  ModelRef
} from '@/ai/models/contracts'
import { PROVIDER_OUTPUT_SCHEMA_VERSION } from '@/ai/providers/adapters/contracts'
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
  classifyText,
  type TextClassificationOutcome,
  type TextModelPort
} from '@/ai/text/classifier'
import {
  preprocessTextInput,
  TEXT_PREPROCESSING_VERSION
} from '@/ai/text/preprocessing'
import { TEXT_PROMPT_CONTRACT_VERSION } from '@/ai/text/prompt-contract'
import {
  createProviderTextModelPort,
  type ExecuteProviderPlan
} from '@/ai/text/provider-port'
import type { ProviderRuntimeState } from '@/application/provider-management/persistence'
import type { ContentItem } from '@/core/content/contracts'
import {
  type ClassificationSignals,
  classificationSignalsSchema
} from '@/core/decisions/signals'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type { SemanticRule } from '@/core/rules/contracts/rule'
import { preferenceSignalKey, type RuleSignals } from '@/core/rules/engine'
import type { ContentLensSettings } from '@/core/settings'

export type TextStageInput = {
  item: ContentItem
  semanticRules: readonly SemanticRule[]
  profileRevision: number
  pageInstanceId: string
  settings: ContentLensSettings
  signal: AbortSignal
}

export type TextStage = {
  version: string
  classify(input: TextStageInput): Promise<TextClassificationOutcome>
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

type RoutePricing = {
  estimatedCost: number
  priceVerifiedAt: number
  primaryEstimatedCost?: number
}

type RoutedTextStageOptions = {
  runtime: ProviderRuntimeState | Promise<ProviderRuntimeState | undefined>
  permissions: PermissionProbe
  execute?: ExecuteProviderPlan
  createBrowserModelPort?: (input: {
    runtime: ProviderRuntimeState
    providerConfigId: string
    modelId: string
  }) => TextModelPort
  cache?: {
    read(id: string): Promise<unknown | undefined>
    write(entry: {
      id: string
      updatedAt: string
      value: ClassificationSignals
    }): Promise<void>
  }
  allowedContextKeys?: (item: ContentItem) => readonly string[]
  pricing?: (input: {
    reference: ModelRef
    inputBytes: number
  }) => RoutePricing | undefined
  now?: () => Date
}

function abstain(
  code: Extract<
    TextClassificationOutcome,
    { state: 'abstained' }
  >['abstention']['code'],
  detailCode?: string
): TextClassificationOutcome {
  return {
    state: 'abstained',
    abstention: {
      code,
      ...(detailCode ? { detailCode } : {})
    }
  }
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

function unavailableCode(code: string) {
  switch (code) {
    case 'language-unsupported':
      return 'unsupported-language' as const
    case 'input-too-large':
      return 'resource-limit' as const
    case 'budget-blocked':
      return 'cost-limit' as const
    case 'modality-unsupported':
    case 'task-unsupported':
      return 'unsupported-input' as const
    default:
      return 'provider-unavailable' as const
  }
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
      return 'input'
    default:
      return 'configuration'
  }
}

function outcomeFailureCategory(
  outcome: Extract<TextClassificationOutcome, { state: 'abstained' }>
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
    case 'unsupported-language':
    case 'resource-limit':
      return 'input'
    default:
      return 'configuration'
  }
}

function routeKey(reference: ModelRef) {
  return `${reference.providerConfigId}/${reference.modelId}/classification-text`
}

function estimatedCloudPricing(input: {
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

async function cacheKey(input: {
  reference: ModelRef
  provider: {
    providerConfigId: string
    kind: string
    execution: string
    endpointOrigin: string
  }
  modelVersion: string
  capability: unknown
  route: unknown
  profileRevision: number
  contentFingerprint: string
}) {
  return buildModelCacheKey({
    providerConfigId: input.reference.providerConfigId,
    providerFingerprint: await fingerprintPortableValue(input.provider),
    modelId: input.reference.modelId,
    modelVersion: input.modelVersion,
    capabilityVersion: await fingerprintPortableValue(input.capability),
    task: 'classification-text',
    profileRevision: input.profileRevision,
    contentFingerprint: input.contentFingerprint,
    routeVersion: await fingerprintPortableValue(input.route),
    promptVersion: TEXT_PROMPT_CONTRACT_VERSION,
    outputSchemaVersion: PROVIDER_OUTPUT_SCHEMA_VERSION,
    preprocessingVersion: TEXT_PREPROCESSING_VERSION,
    policyVersion: 'deterministic-policy@1'
  })
}

function compatibleCachedSignals(
  value: unknown,
  input: {
    item: ContentItem
    contentFingerprint: string
    modelVersion: string
    sourceId: string
  }
) {
  const parsed = classificationSignalsSchema.safeParse(value)
  if (!parsed.success) {
    return undefined
  }
  const { provenance } = parsed.data
  return provenance.sourceKind === 'text-model' &&
    provenance.sourceId === input.sourceId &&
    provenance.sourceVersion === input.modelVersion &&
    provenance.inputFingerprint === input.contentFingerprint &&
    provenance.scope.contentId === input.item.id &&
    provenance.scope.platform === input.item.platform &&
    provenance.scope.surface === input.item.surface &&
    provenance.scope.task === 'classification-text'
    ? parsed.data
    : undefined
}

export function createRoutedTextStage(
  options: RoutedTextStageOptions
): TextStage {
  const circuit = new RouteCircuitBreaker()
  const budgets = new Map<string, RoutingBudget>()
  const now = options.now ?? (() => new Date())
  const budgetFor = (input: TextStageInput) => {
    const policyKey = JSON.stringify(input.settings.routing.budgets)
    const existing = budgets.get(policyKey)
    if (existing) {
      return existing
    }
    const budget = new RoutingBudget(input.settings.routing.budgets, {
      timeZone: 'UTC'
    })
    budgets.set(policyKey, budget)
    return budget
  }

  return {
    version: 'routed-text-stage@1',
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
        task: 'classification-text'
      })
      if (configured.state !== 'resolved') {
        return abstain(
          'provider-unavailable',
          configured.state === 'disabled' ? 'route-disabled' : configured.code
        )
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
          'classification-text'
        )
        const provider = runtime.providers.get(reference.providerConfigId)
        if (!model || !capability || !provider) {
          return abstain('provider-unavailable', 'route-binding-unavailable')
        }

        const preprocessed = await preprocessTextInput({
          item: input.item,
          semanticRules: input.semanticRules,
          allowedContextKeys: options.allowedContextKeys?.(input.item) ?? [],
          maxInputBytes: capability.maxInputBytes
        })
        if (preprocessed.state === 'abstained') {
          return preprocessed
        }
        const modelVersion = model.declaredVersion ?? `model:${model.modelId}`
        const sourceId = `${provider.providerConfigId}:${model.modelId}`
        const key = await cacheKey({
          reference,
          provider: {
            providerConfigId: provider.providerConfigId,
            kind: provider.kind,
            execution: provider.execution,
            endpointOrigin: provider.endpointOrigin
          },
          modelVersion,
          capability,
          route: configured,
          profileRevision: input.profileRevision,
          contentFingerprint: preprocessed.inputFingerprint
        })
        if (options.cache) {
          try {
            const cached = compatibleCachedSignals(
              await options.cache.read(key),
              {
                item: input.item,
                contentFingerprint: preprocessed.inputFingerprint,
                modelVersion,
                sourceId
              }
            )
            if (cached) {
              return { state: 'signals', signals: cached }
            }
          } catch {
            // Cache availability never changes the visible fail-open baseline.
          }
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
        const declaredPricing = estimatedCloudPricing({
          model,
          capability,
          inputBytes: preprocessed.inputBytes,
          budget: input.settings.routing.budgets
        })
        const primaryModel = runtime.catalog.get(configured.primary)
        const primaryCapability = runtime.catalog.capability(
          configured.primary,
          'classification-text'
        )
        const primaryPricing =
          primaryModel && primaryCapability
            ? estimatedCloudPricing({
                model: primaryModel,
                capability: primaryCapability,
                inputBytes: preprocessed.inputBytes,
                budget: input.settings.routing.budgets
              })
            : undefined
        const pricing =
          options.pricing?.({
            reference,
            inputBytes: preprocessed.inputBytes
          }) ??
          (declaredPricing
            ? {
                ...declaredPricing,
                primaryEstimatedCost:
                  primaryModel?.executionKind === 'cloud'
                    ? primaryPricing?.estimatedCost
                    : 0
              }
            : undefined)
        const eligible = resolveEligibleRoute({
          settings: input.settings.routing,
          platform: input.item.platform,
          task: 'classification-text',
          content: {
            language: preprocessed.input.language,
            inputBytes: preprocessed.inputBytes,
            modalities: ['text'],
            imageMimeType: null,
            categories: preprocessed.dataCategories,
            includeImages: false
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
              has: (credentialReference, binding) =>
                credentialAvailable(runtime, credentialReference, binding)
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
          ...(pricing ? { pricing } : {})
        })
        if (eligible.state === 'unavailable') {
          category = failureCategory(eligible.code)
          if (
            attemptIndex + 1 < references.length &&
            canAdvanceToFallback(category)
          ) {
            continue
          }
          return abstain(unavailableCode(eligible.code), eligible.code)
        }

        const modelPort =
          (provider.execution === 'browser'
            ? options.createBrowserModelPort?.({
                runtime,
                providerConfigId: provider.providerConfigId,
                modelId: model.modelId
              })
            : undefined) ??
          createProviderTextModelPort({
            provider,
            modelId: model.modelId,
            vault: runtime.vault,
            ...(options.execute ? { execute: options.execute } : {})
          })
        const outcome = await classifyText({
          preprocessed,
          provider: modelPort,
          classifierVersion: 'text-classifier@1',
          modelVersion,
          sourceId,
          observedAt: now().toISOString(),
          signal: input.signal
        })
        if (!budget.commit(eligible.reservationId)) {
          return abstain('provider-unavailable', 'budget-reservation-lost')
        }
        if (outcome.state === 'signals') {
          circuit.recordSuccess(routeKey(reference))
          if (options.cache) {
            try {
              await options.cache.write({
                id: key,
                updatedAt: now().toISOString(),
                value: outcome.signals
              })
            } catch {
              // A cache write is optional and cannot revoke valid signals.
            }
          }
          return outcome
        }

        category = outcomeFailureCategory(outcome)
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

function retainHighestScore(
  target: Record<string, number>,
  key: string,
  score: number
) {
  target[key] = Math.max(target[key] ?? 0, score)
}

export function ruleSignalsFromClassification(
  signals: ClassificationSignals
): RuleSignals {
  const semanticScores: Record<string, number> = {}
  for (const match of signals.semanticRuleMatches) {
    retainHighestScore(semanticScores, match.ruleId, match.score)
  }

  const preferenceScores: Record<string, number> = {}
  for (const topic of signals.topics) {
    retainHighestScore(
      preferenceScores,
      preferenceSignalKey('topic', topic.topicId),
      topic.score
    )
  }
  for (const archetype of signals.archetypes) {
    retainHighestScore(
      preferenceScores,
      preferenceSignalKey('archetype', archetype.archetypeId),
      archetype.score
    )
  }
  for (const [qualityId, score] of Object.entries(signals.quality)) {
    if (score !== undefined) {
      retainHighestScore(
        preferenceScores,
        preferenceSignalKey('quality', qualityId),
        score
      )
    }
  }

  return {
    semanticScores,
    preferenceScores
  }
}
