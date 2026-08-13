import {
  ASSISTANCE_DRAFT_SCHEMA_VERSION,
  ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
  type AssistanceCache,
  type AssistanceDraftRequest,
  type AssistanceExplanationRequest,
  type AssistanceRuntimeProvenance,
  AssistanceService,
  createProviderAssistanceModelPort,
  type DraftGenerationResult,
  type ExecuteAssistanceProviderPlan,
  type ExplanationResult,
  MemoryAssistanceCache
} from '@/ai/assistance'
import { ASSISTANCE_PROMPT_CONTRACT_VERSION } from '@/ai/assistance/prompt-contract'
import type { BrowserPromptExecutor } from '@/ai/browser/language-model'
import { createBrowserAssistanceModelPort } from '@/ai/browser/model-ports'
import type {
  BudgetPolicy,
  ModelCapability,
  ModelDescriptor,
  ModelRef,
  ModelTask
} from '@/ai/models/contracts'
import type { DataCategory } from '@/ai/providers/contracts'
import { RoutingBudget } from '@/ai/routing/budget'
import { RouteCircuitBreaker } from '@/ai/routing/circuit-breaker'
import {
  type EligibleRouteResolution,
  resolveEligibleRoute
} from '@/ai/routing/eligibility'
import {
  canAdvanceToFallback,
  type RouteFailureCategory,
  resolveConfiguredRoute
} from '@/ai/routing/resolver'
import type { ProviderRuntimeState } from '@/application/provider-management/persistence'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type { ContentLensSettings } from '@/core/settings'

type PermissionProbe = {
  has(
    binding: {
      endpointOrigin: string
      execution: 'local' | 'cloud' | 'browser'
    },
    dataCollection: readonly ('authenticationInfo' | 'websiteContent')[]
  ): Promise<boolean>
}

type RouteUnavailableCode = Extract<
  EligibleRouteResolution,
  { state: 'unavailable' }
>['code']

export type RoutedDraftResult =
  | DraftGenerationResult
  | {
      state: 'unavailable'
      code: RouteUnavailableCode | 'provider-state-unreadable'
      preservedIntent: string
    }

export type RoutedExplanationResult =
  | ExplanationResult
  | {
      state: 'unavailable'
      code: RouteUnavailableCode | 'provider-state-unreadable'
    }

type RoutedAssistanceOptions = {
  runtime: ProviderRuntimeState | Promise<ProviderRuntimeState | undefined>
  permissions: PermissionProbe
  browserAi?: BrowserPromptExecutor
  execute?: ExecuteAssistanceProviderPlan
  cache?: AssistanceCache
  fingerprint?: (input: unknown) => Promise<string>
  createId?: () => string
  now?: () => Date
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

function draftCategories(request: AssistanceDraftRequest): DataCategory[] {
  const categories: DataCategory[] = ['intent']
  if (request.itemText) categories.push('body')
  if ((request.trustedContext.examples?.length ?? 0) > 0)
    categories.push('examples')
  if ((request.batchEvidence?.representativeExamples.length ?? 0) > 0)
    categories.push('examples')
  if (
    (request.trustedContext.exclusions?.length ?? 0) > 0 ||
    (request.trustedContext.protectedExclusions?.length ?? 0) > 0
  ) {
    categories.push('exclusions')
  }
  if ((request.batchEvidence?.protectedExceptions.length ?? 0) > 0) {
    categories.push('exclusions')
  }
  if (
    request.trustedContext.effect !== undefined ||
    request.trustedContext.platforms !== undefined ||
    request.trustedContext.surfaces !== undefined ||
    request.trustedContext.description !== undefined ||
    request.trustedContext.threshold !== undefined
  ) {
    categories.push('rule')
  }
  return [...new Set(categories)]
}

function explanationCategories(
  request: AssistanceExplanationRequest
): DataCategory[] {
  return [
    'decision',
    ...(request.appliedRuleRefs.length > 0 ? (['rule'] as const) : [])
  ]
}

function routeFailureCategory(code: string): RouteFailureCategory {
  switch (code) {
    case 'provider-temporarily-unavailable':
    case 'circuit-open':
    case 'provider-unavailable':
    case 'timeout':
      return 'temporary'
    case 'invalid-output':
      return 'invalid-output'
    case 'budget-blocked':
      return 'budget'
    case 'consent-missing':
    case 'credential-missing':
    case 'permission-missing':
      return 'authorization'
    case 'language-unsupported':
    case 'input-too-large':
    case 'modality-unsupported':
      return 'input'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'configuration'
  }
}

function routeKey(reference: ModelRef, task: ModelTask) {
  return `${reference.providerConfigId}/${reference.modelId}/${task}`
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

export function createRoutedAssistanceService(
  options: RoutedAssistanceOptions
) {
  const circuit = new RouteCircuitBreaker()
  const budgets = new Map<string, RoutingBudget>()
  const cache = options.cache ?? new MemoryAssistanceCache()
  const now = options.now ?? (() => new Date())
  const fingerprint = options.fingerprint ?? fingerprintPortableValue
  const budgetFor = (settings: ContentLensSettings) => {
    const key = JSON.stringify(settings.routing.budgets)
    const existing = budgets.get(key)
    if (existing) return existing
    const budget = new RoutingBudget(settings.routing.budgets, {
      timeZone: 'UTC'
    })
    budgets.set(key, budget)
    return budget
  }

  const resolveAttempt = async (input: {
    runtime: ProviderRuntimeState
    settings: ContentLensSettings
    task: 'assistance-draft' | 'assistance-explain'
    platform: AssistanceDraftRequest['platform']
    language: string
    inputBytes: number
    categories: DataCategory[]
    reference: ModelRef
    attemptIndex: number
    previousCategory?: RouteFailureCategory
  }) => {
    const provider = input.runtime.providers.get(
      input.reference.providerConfigId
    )
    const model = input.runtime.catalog.get(input.reference)
    const capability = input.runtime.catalog.capability(
      input.reference,
      input.task
    )
    if (!provider || !model || !capability) {
      return {
        state: 'unavailable' as const,
        code: 'model-not-found' as const
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
    const pricing = estimatedPricing({
      model,
      capability,
      inputBytes: input.inputBytes,
      budget: input.settings.routing.budgets
    })
    const eligible = resolveEligibleRoute({
      settings: input.settings.routing,
      platform: input.platform,
      task: input.task,
      content: {
        language: input.language,
        inputBytes: input.inputBytes,
        modalities: ['text'],
        imageMimeType: null,
        categories: input.categories,
        includeImages: false
      },
      environment: {
        providers: input.runtime.providers,
        catalog: input.runtime.catalog,
        consents: input.runtime.consents,
        permissions: {
          has: origin => origin === provider.endpointOrigin && permissionGranted
        },
        credentials: {
          has: (reference, binding) =>
            credentialAvailable(input.runtime, reference, binding)
        },
        budget: budgetFor(input.settings),
        circuit
      },
      attempt:
        input.attemptIndex === 0
          ? { kind: 'primary' }
          : {
              kind: 'fallback',
              index: input.attemptIndex - 1,
              failureCategory: input.previousCategory ?? 'configuration'
            },
      at: now().getTime(),
      ...(pricing ? { pricing } : {})
    })
    return eligible.state === 'resolved'
      ? { state: 'resolved' as const, provider, model, capability, eligible }
      : eligible
  }

  const runtimeProvenance = async (input: {
    configured: Extract<
      ReturnType<typeof resolveConfiguredRoute>,
      { state: 'resolved' }
    >
    providerConfigId: string
    model: ModelDescriptor
    capability: ModelCapability
    executionKind: AssistanceRuntimeProvenance['executionKind']
    outputSchemaVersion: string
  }): Promise<AssistanceRuntimeProvenance> => ({
    providerConfigId: input.providerConfigId,
    modelId: input.model.modelId,
    modelVersion: input.model.declaredVersion ?? `model:${input.model.modelId}`,
    routeVersion: await fingerprintPortableValue(input.configured),
    promptVersion: ASSISTANCE_PROMPT_CONTRACT_VERSION,
    outputSchemaVersion: input.outputSchemaVersion,
    capabilityVersion: await fingerprintPortableValue(input.capability),
    executionKind: input.executionKind,
    generatedAt: now().toISOString()
  })

  return {
    async generateDraft(input: {
      request: AssistanceDraftRequest
      settings: ContentLensSettings
      signal: AbortSignal
    }): Promise<RoutedDraftResult> {
      const runtime = await options.runtime
      if (!runtime) {
        return {
          state: 'unavailable',
          code: 'provider-state-unreadable',
          preservedIntent: input.request.intent
        }
      }
      const configured = resolveConfiguredRoute({
        settings: input.settings.routing,
        catalog: runtime.catalog,
        platform: input.request.platform,
        task: 'assistance-draft'
      })
      if (configured.state !== 'resolved') {
        return {
          state: 'unavailable',
          code:
            configured.state === 'disabled'
              ? 'route-disabled'
              : configured.code,
          preservedIntent: input.request.intent
        }
      }
      const references = [configured.primary, ...configured.fallbacks]
      const inputBytes = new TextEncoder().encode(
        JSON.stringify(input.request)
      ).byteLength
      let category: RouteFailureCategory | undefined
      for (const [attemptIndex, reference] of references.entries()) {
        if (
          attemptIndex > 0 &&
          (!category || !canAdvanceToFallback(category))
        ) {
          break
        }
        const resolved = await resolveAttempt({
          runtime,
          settings: input.settings,
          task: 'assistance-draft',
          platform: input.request.platform,
          language: input.request.language ?? 'unknown',
          inputBytes,
          categories: draftCategories(input.request),
          reference,
          attemptIndex,
          previousCategory: category
        })
        if (resolved.state !== 'resolved') {
          category = routeFailureCategory(resolved.code)
          if (
            attemptIndex + 1 < references.length &&
            canAdvanceToFallback(category)
          ) {
            continue
          }
          return {
            state: 'unavailable',
            code: resolved.code,
            preservedIntent: input.request.intent
          }
        }
        if (resolved.provider.execution === 'browser' && !options.browserAi) {
          budgetFor(input.settings).release(resolved.eligible.reservationId)
          category = 'temporary'
          if (attemptIndex + 1 < references.length) continue
          return {
            state: 'unavailable',
            code: 'provider-unavailable',
            preservedIntent: input.request.intent
          }
        }
        const providerPort =
          resolved.provider.execution === 'browser'
            ? createBrowserAssistanceModelPort({
                executor: options.browserAi as BrowserPromptExecutor,
                language: input.request.language ?? 'unknown'
              })
            : createProviderAssistanceModelPort({
                provider: resolved.provider,
                modelId: resolved.model.modelId,
                vault: runtime.vault,
                ...(options.execute ? { execute: options.execute } : {})
              })
        const service = new AssistanceService({
          provider: providerPort,
          cache,
          fingerprint,
          ...(options.createId ? { createId: options.createId } : {})
        })
        const result = await service.generateDraft({
          request: input.request,
          runtime: await runtimeProvenance({
            configured,
            providerConfigId: resolved.provider.providerConfigId,
            model: resolved.model,
            capability: resolved.capability,
            executionKind: resolved.provider.execution,
            outputSchemaVersion: ASSISTANCE_DRAFT_SCHEMA_VERSION
          }),
          signal: input.signal
        })
        const budget = budgetFor(input.settings)
        if (result.state !== 'rejected' && result.cached) {
          budget.release(resolved.eligible.reservationId)
        } else if (!budget.commit(resolved.eligible.reservationId)) {
          return {
            state: 'unavailable',
            code: 'provider-unavailable',
            preservedIntent: input.request.intent
          }
        }
        if (result.state !== 'rejected') {
          circuit.recordSuccess(routeKey(reference, 'assistance-draft'))
          return result
        }
        category = routeFailureCategory(result.code)
        if (category === 'temporary' || category === 'invalid-output') {
          circuit.recordTemporaryFailure(
            routeKey(reference, 'assistance-draft'),
            now().getTime()
          )
        }
        if (
          attemptIndex + 1 < references.length &&
          canAdvanceToFallback(category)
        ) {
          continue
        }
        return result
      }
      return {
        state: 'unavailable',
        code: 'fallback-not-configured',
        preservedIntent: input.request.intent
      }
    },

    async explain(input: {
      request: AssistanceExplanationRequest
      settings: ContentLensSettings
      signal: AbortSignal
    }): Promise<RoutedExplanationResult> {
      const runtime = await options.runtime
      if (!runtime) {
        return {
          state: 'unavailable',
          code: 'provider-state-unreadable'
        }
      }
      const configured = resolveConfiguredRoute({
        settings: input.settings.routing,
        catalog: runtime.catalog,
        platform: input.request.platform,
        task: 'assistance-explain'
      })
      if (configured.state !== 'resolved') {
        return {
          state: 'unavailable',
          code:
            configured.state === 'disabled' ? 'route-disabled' : configured.code
        }
      }
      const references = [configured.primary, ...configured.fallbacks]
      const inputBytes = new TextEncoder().encode(
        JSON.stringify(input.request)
      ).byteLength
      let category: RouteFailureCategory | undefined
      for (const [attemptIndex, reference] of references.entries()) {
        if (
          attemptIndex > 0 &&
          (!category || !canAdvanceToFallback(category))
        ) {
          break
        }
        const resolved = await resolveAttempt({
          runtime,
          settings: input.settings,
          task: 'assistance-explain',
          platform: input.request.platform,
          language: input.request.language ?? 'unknown',
          inputBytes,
          categories: explanationCategories(input.request),
          reference,
          attemptIndex,
          previousCategory: category
        })
        if (resolved.state !== 'resolved') {
          category = routeFailureCategory(resolved.code)
          if (
            attemptIndex + 1 < references.length &&
            canAdvanceToFallback(category)
          ) {
            continue
          }
          return { state: 'unavailable', code: resolved.code }
        }
        if (resolved.provider.execution === 'browser' && !options.browserAi) {
          budgetFor(input.settings).release(resolved.eligible.reservationId)
          category = 'temporary'
          if (attemptIndex + 1 < references.length) continue
          return { state: 'unavailable', code: 'provider-unavailable' }
        }
        const providerPort =
          resolved.provider.execution === 'browser'
            ? createBrowserAssistanceModelPort({
                executor: options.browserAi as BrowserPromptExecutor,
                language: input.request.language ?? 'unknown'
              })
            : createProviderAssistanceModelPort({
                provider: resolved.provider,
                modelId: resolved.model.modelId,
                vault: runtime.vault,
                ...(options.execute ? { execute: options.execute } : {})
              })
        const service = new AssistanceService({
          provider: providerPort,
          cache,
          fingerprint,
          ...(options.createId ? { createId: options.createId } : {})
        })
        const result = await service.explain({
          request: input.request,
          runtime: await runtimeProvenance({
            configured,
            providerConfigId: resolved.provider.providerConfigId,
            model: resolved.model,
            capability: resolved.capability,
            executionKind: resolved.provider.execution,
            outputSchemaVersion: ASSISTANCE_EXPLANATION_SCHEMA_VERSION
          }),
          signal: input.signal
        })
        const budget = budgetFor(input.settings)
        if (result.state !== 'rejected' && result.cached) {
          budget.release(resolved.eligible.reservationId)
        } else if (!budget.commit(resolved.eligible.reservationId)) {
          return { state: 'unavailable', code: 'provider-unavailable' }
        }
        if (result.state !== 'rejected') {
          circuit.recordSuccess(routeKey(reference, 'assistance-explain'))
          return result
        }
        category = routeFailureCategory(result.code)
        if (category === 'temporary' || category === 'invalid-output') {
          circuit.recordTemporaryFailure(
            routeKey(reference, 'assistance-explain'),
            now().getTime()
          )
        }
        if (
          attemptIndex + 1 < references.length &&
          canAdvanceToFallback(category)
        ) {
          continue
        }
        return result
      }
      return { state: 'unavailable', code: 'fallback-not-configured' }
    }
  }
}
