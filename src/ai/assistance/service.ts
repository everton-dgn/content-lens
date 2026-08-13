import {
  type AssistanceCache,
  MemoryAssistanceCache
} from '@/ai/assistance/cache'
import {
  type AssistanceExplanation,
  type AssistanceRuntimeProvenance,
  assistanceExplanationModelOutputSchema,
  assistanceExplanationSchema,
  MAX_ASSISTANCE_INPUT_BYTES,
  type RuleDraftProposal,
  ruleDraftModelOutputSchema,
  ruleDraftProposalSchema
} from '@/ai/assistance/contracts'
import {
  contextFieldRefs,
  evaluateDraftPolicy
} from '@/ai/assistance/draft-policy'
import {
  ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
  ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA
} from '@/ai/assistance/output-schema'
import {
  type AssistanceDraftRequest,
  type AssistanceExplanationRequest,
  assistanceDraftRequestSchema,
  assistanceExplanationRequestSchema,
  buildAssistanceDraftPrompt,
  buildAssistanceExplanationPrompt
} from '@/ai/assistance/prompt-contract'

export type AssistanceModelFailureCode =
  | 'provider-unavailable'
  | 'timeout'
  | 'cancelled'
  | 'refused'
  | 'content-filtered'
  | 'truncated'
  | 'invalid-output'

export class AssistanceModelFailure extends Error {
  readonly code: AssistanceModelFailureCode

  constructor(code: AssistanceModelFailureCode) {
    super(code)
    this.name = 'AssistanceModelFailure'
    this.code = code
  }
}

export type AssistanceModelPort = {
  generateDraft(input: {
    task: 'assistance-draft'
    prompt: string
    outputSchema: typeof ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA
    signal: AbortSignal
  }): Promise<unknown>
  explain(input: {
    task: 'assistance-explain'
    prompt: string
    outputSchema: typeof ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA
    signal: AbortSignal
  }): Promise<unknown>
}

type RejectionCode =
  | AssistanceModelFailureCode
  | 'input-too-large'
  | 'invalid-input'

export type DraftGenerationResult =
  | {
      state: 'draft-ready' | 'review-required'
      proposal: RuleDraftProposal
      preservedIntent: string
      cached: boolean
    }
  | {
      state: 'rejected'
      code: RejectionCode
      preservedIntent: string
    }

export type ExplanationResult =
  | {
      state: 'explanation-ready'
      explanation: AssistanceExplanation
      cached: boolean
    }
  | {
      state: 'rejected'
      code: RejectionCode
    }

type ServiceOptions = {
  provider: AssistanceModelPort
  cache?: AssistanceCache
  createId?: () => string
  fingerprint(input: unknown): Promise<string>
}

function trustedProvenance(input: {
  runtime: AssistanceRuntimeProvenance
  fingerprint: string
  request: {
    baseRevision: number
    platform: AssistanceDraftRequest['platform']
    surface: AssistanceDraftRequest['surface']
    contentId?: string
  }
}) {
  return {
    ...input.runtime,
    inputFingerprint: input.fingerprint,
    profileRevision: input.request.baseRevision,
    platform: input.request.platform,
    surface: input.request.surface,
    ...(input.request.contentId ? { contentId: input.request.contentId } : {})
  }
}

function cacheKey(input: {
  task: 'assistance-draft' | 'assistance-explain'
  runtime: AssistanceRuntimeProvenance
  fingerprint: string
  profileRevision: number
}) {
  return JSON.stringify({
    task: input.task,
    providerConfigId: input.runtime.providerConfigId,
    modelId: input.runtime.modelId,
    modelVersion: input.runtime.modelVersion,
    routeVersion: input.runtime.routeVersion,
    promptVersion: input.runtime.promptVersion,
    outputSchemaVersion: input.runtime.outputSchemaVersion,
    capabilityVersion: input.runtime.capabilityVersion,
    profileRevision: input.profileRevision,
    inputFingerprint: input.fingerprint
  })
}

function modelFailure(error: unknown): AssistanceModelFailureCode {
  return error instanceof AssistanceModelFailure
    ? error.code
    : 'provider-unavailable'
}

function defaultId() {
  return crypto.randomUUID()
}

function controlledSignal(
  external: AbortSignal | undefined,
  executionKind: AssistanceRuntimeProvenance['executionKind']
) {
  const timeout = AbortSignal.timeout(
    executionKind === 'cloud' ? 20_000 : 45_000
  )
  return external ? AbortSignal.any([external, timeout]) : timeout
}

export class AssistanceService {
  readonly #provider: AssistanceModelPort
  readonly #cache: AssistanceCache
  readonly #createId: () => string
  readonly #fingerprint: (input: unknown) => Promise<string>

  constructor(options: ServiceOptions) {
    this.#provider = options.provider
    this.#cache = options.cache ?? new MemoryAssistanceCache()
    this.#createId = options.createId ?? defaultId
    this.#fingerprint = options.fingerprint
  }

  async generateDraft(input: {
    request: AssistanceDraftRequest
    runtime: AssistanceRuntimeProvenance
    signal?: AbortSignal
  }): Promise<DraftGenerationResult> {
    if (
      new TextEncoder().encode(input.request.intent).byteLength >
      MAX_ASSISTANCE_INPUT_BYTES
    ) {
      return {
        state: 'rejected',
        code: 'input-too-large',
        preservedIntent: input.request.intent
      }
    }
    const request = assistanceDraftRequestSchema.safeParse(input.request)
    if (!request.success) {
      return {
        state: 'rejected',
        code: 'invalid-input',
        preservedIntent: input.request.intent
      }
    }
    const fingerprint = await this.#fingerprint({
      request: request.data,
      task: 'assistance-draft'
    })
    const key = cacheKey({
      task: 'assistance-draft',
      runtime: input.runtime,
      fingerprint,
      profileRevision: request.data.baseRevision
    })
    const cached = ruleDraftProposalSchema.safeParse(
      await this.#cache.read(key)
    )
    if (cached.success) {
      return {
        state:
          cached.data.warnings.length > 0 ||
          cached.data.ambiguousFields.length > 0 ||
          cached.data.missingFields.length > 0
            ? 'review-required'
            : 'draft-ready',
        proposal: cached.data,
        preservedIntent: request.data.intent,
        cached: true
      }
    }

    let raw: unknown
    try {
      raw = await this.#provider.generateDraft({
        task: 'assistance-draft',
        prompt: buildAssistanceDraftPrompt(request.data),
        outputSchema: ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA,
        signal: controlledSignal(input.signal, input.runtime.executionKind)
      })
    } catch (error) {
      return {
        state: 'rejected',
        code:
          input.signal?.aborted && modelFailure(error) !== 'timeout'
            ? 'cancelled'
            : modelFailure(error),
        preservedIntent: request.data.intent
      }
    }
    if (input.signal?.aborted) {
      return {
        state: 'rejected',
        code: 'cancelled',
        preservedIntent: request.data.intent
      }
    }
    const output = ruleDraftModelOutputSchema.safeParse(raw)
    if (!output.success) {
      return {
        state: 'rejected',
        code: 'invalid-output',
        preservedIntent: request.data.intent
      }
    }
    const allowedEvidence = new Set(request.data.allowedEvidenceCodes)
    if (
      output.data.inferredFields.some(field =>
        field.evidenceCodes.some(code => !allowedEvidence.has(code))
      )
    ) {
      return {
        state: 'rejected',
        code: 'invalid-output',
        preservedIntent: request.data.intent
      }
    }
    const contextFields = contextFieldRefs(request.data.trustedContext)
    const contextFieldNames = new Set(contextFields.map(field => field.field))
    if (
      [
        ...output.data.inferredFields,
        ...output.data.ambiguousFields,
        ...output.data.missingFields
      ].some(field => contextFieldNames.has(field.field))
    ) {
      return {
        state: 'rejected',
        code: 'invalid-output',
        preservedIntent: request.data.intent
      }
    }
    const proposal = ruleDraftProposalSchema.parse(
      evaluateDraftPolicy({
        proposal: {
          schemaVersion: output.data.schemaVersion,
          draftId: this.#createId(),
          baseRevision: request.data.baseRevision,
          origin: request.data.origin,
          rule: output.data.rule,
          contextFields,
          inferredFields: output.data.inferredFields,
          ambiguousFields: output.data.ambiguousFields,
          missingFields: output.data.missingFields,
          provenance: trustedProvenance({
            runtime: input.runtime,
            fingerprint,
            request: request.data
          })
        },
        request: request.data
      })
    )
    await this.#cache.write(key, proposal)
    return {
      state:
        proposal.warnings.length > 0 ||
        proposal.ambiguousFields.length > 0 ||
        proposal.missingFields.length > 0
          ? 'review-required'
          : 'draft-ready',
      proposal,
      preservedIntent: request.data.intent,
      cached: false
    }
  }

  async explain(input: {
    request: AssistanceExplanationRequest
    runtime: AssistanceRuntimeProvenance
    signal?: AbortSignal
  }): Promise<ExplanationResult> {
    const request = assistanceExplanationRequestSchema.safeParse(input.request)
    if (!request.success) {
      return { state: 'rejected', code: 'invalid-input' }
    }
    const fingerprint = await this.#fingerprint({
      request: request.data,
      task: 'assistance-explain'
    })
    const key = cacheKey({
      task: 'assistance-explain',
      runtime: input.runtime,
      fingerprint,
      profileRevision: request.data.baseRevision
    })
    const cached = assistanceExplanationSchema.safeParse(
      await this.#cache.read(key)
    )
    if (cached.success) {
      return {
        state: 'explanation-ready',
        explanation: cached.data,
        cached: true
      }
    }

    let raw: unknown
    try {
      raw = await this.#provider.explain({
        task: 'assistance-explain',
        prompt: buildAssistanceExplanationPrompt(request.data),
        outputSchema: ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA,
        signal: controlledSignal(input.signal, input.runtime.executionKind)
      })
    } catch (error) {
      return {
        state: 'rejected',
        code:
          input.signal?.aborted && modelFailure(error) !== 'timeout'
            ? 'cancelled'
            : modelFailure(error)
      }
    }
    const output = assistanceExplanationModelOutputSchema.safeParse(raw)
    if (!output.success) {
      return { state: 'rejected', code: 'invalid-output' }
    }
    const allowedEvidence = new Set(request.data.evidenceCodes)
    const allowedRules = new Set(request.data.appliedRuleRefs)
    if (
      output.data.signalSources.some(source =>
        source.evidenceCodes.some(code => !allowedEvidence.has(code))
      ) ||
      output.data.appliedRuleRefs.some(rule => !allowedRules.has(rule))
    ) {
      return { state: 'rejected', code: 'invalid-output' }
    }
    const explanation = assistanceExplanationSchema.parse({
      ...output.data,
      explanationId: this.#createId(),
      baseRevision: request.data.baseRevision,
      provenance: trustedProvenance({
        runtime: input.runtime,
        fingerprint,
        request: request.data
      })
    })
    await this.#cache.write(key, explanation)
    return {
      state: 'explanation-ready',
      explanation,
      cached: false
    }
  }
}
