import { classificationModelOutputSchema } from '@/ai/classification/model-output'
import type { ReadyVisualInput } from '@/ai/vision/contracts'
import { buildVisionClassificationPrompt } from '@/ai/vision/prompt-contract'
import {
  type ClassificationSignals,
  classificationSignalsSchema
} from '@/core/decisions/signals'

export type VisualModelFailureCode =
  | 'unsupported-input'
  | 'unsupported-media'
  | 'resource-limit'
  | 'cost-limit'
  | 'provider-unavailable'
  | 'timeout'
  | 'cancelled'
  | 'refused'
  | 'content-filtered'
  | 'truncated'
  | 'invalid-output'

export class VisualModelFailure extends Error {
  readonly code: VisualModelFailureCode

  constructor(code: VisualModelFailureCode) {
    super(code)
    this.name = 'VisualModelFailure'
    this.code = code
  }
}

export type VisualModelPort = {
  classify(input: {
    task: 'classification-vision'
    prompt: string
    image: ReadyVisualInput['image']
    signal?: AbortSignal
  }): Promise<unknown>
}

export type VisualClassificationOutcome =
  | { state: 'signals'; signals: ClassificationSignals }
  | {
      state: 'abstained'
      abstention: NonNullable<ClassificationSignals['abstention']>
    }

function abstain(
  code: NonNullable<ClassificationSignals['abstention']>['code']
): VisualClassificationOutcome {
  return { state: 'abstained', abstention: { code } }
}

function outputMatchesCandidates(
  output: ReturnType<typeof classificationModelOutputSchema.parse>,
  prepared: ReadyVisualInput
) {
  const topics = new Set(prepared.input.candidateTopicIds)
  const archetypes = new Set(prepared.input.candidateArchetypeIds)
  const rules = new Set(prepared.input.semanticRules.map(rule => rule.ruleId))
  const evidenceCodes = new Set(prepared.input.candidateEvidenceCodes)
  return (
    output.topics.every(topic => topics.has(topic.topicId)) &&
    output.archetypes.every(archetype =>
      archetypes.has(archetype.archetypeId)
    ) &&
    output.semanticRuleMatches.every(match => rules.has(match.ruleId)) &&
    output.evidence.every(evidence => evidenceCodes.has(evidence.label))
  )
}

export async function classifyVision(input: {
  prepared: ReadyVisualInput
  provider: VisualModelPort
  classifierVersion: string
  modelVersion: string
  sourceId: string
  observedAt: string
  signal?: AbortSignal
}): Promise<VisualClassificationOutcome> {
  if (input.signal?.aborted) {
    return abstain('cancelled')
  }

  let raw: unknown
  try {
    raw = await input.provider.classify({
      task: 'classification-vision',
      prompt: buildVisionClassificationPrompt(input.prepared.input),
      image: input.prepared.image,
      ...(input.signal ? { signal: input.signal } : {})
    })
  } catch (error) {
    if (input.signal?.aborted) {
      return abstain('cancelled')
    }
    if (error instanceof VisualModelFailure) {
      return abstain(error.code)
    }
    return abstain('provider-unavailable')
  }
  if (input.signal?.aborted) {
    return abstain('cancelled')
  }

  const modelOutput = classificationModelOutputSchema.safeParse(raw)
  if (!modelOutput.success) {
    return abstain('invalid-output')
  }
  if (modelOutput.data.abstention) {
    return { state: 'abstained', abstention: modelOutput.data.abstention }
  }
  if (!outputMatchesCandidates(modelOutput.data, input.prepared)) {
    return abstain('invalid-output')
  }
  const signals = classificationSignalsSchema.safeParse({
    ...modelOutput.data,
    schemaVersion: '1',
    relations: [],
    provenance: {
      sourceKind: 'vision-model',
      sourceId: input.sourceId,
      sourceVersion: input.modelVersion,
      observedAt: input.observedAt,
      inputFingerprint: input.prepared.inputFingerprint,
      scope: {
        platform: input.prepared.binding.platform,
        surface: input.prepared.binding.surface,
        contentId: input.prepared.binding.contentId,
        task: 'classification-vision'
      },
      ...(modelOutput.data.confidence === null
        ? {}
        : { confidence: modelOutput.data.confidence }),
      evidenceRefs: modelOutput.data.evidence.map(
        evidence => evidence.evidenceId
      )
    },
    classifierVersion: input.classifierVersion,
    modelVersion: input.modelVersion
  })
  return signals.success
    ? { state: 'signals', signals: signals.data }
    : abstain('invalid-output')
}
