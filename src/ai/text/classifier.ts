import {
  type TextModelOutput,
  textModelOutputSchema
} from '@/ai/text/contracts'
import type { ReadyTextInput } from '@/ai/text/preprocessing'
import { buildTextClassificationPrompt } from '@/ai/text/prompt-contract'
import {
  type ClassificationSignals,
  classificationSignalsSchema
} from '@/core/decisions/signals'

export type TextModelFailureCode =
  | 'unsupported-language'
  | 'unsupported-input'
  | 'resource-limit'
  | 'cost-limit'
  | 'provider-unavailable'
  | 'timeout'
  | 'cancelled'
  | 'refused'
  | 'content-filtered'
  | 'truncated'
  | 'invalid-output'

export class TextModelFailure extends Error {
  readonly code: TextModelFailureCode

  constructor(code: TextModelFailureCode) {
    super(code)
    this.name = 'TextModelFailure'
    this.code = code
  }
}

export type TextModelPort = {
  classify(input: {
    task: 'classification-text'
    prompt: string
    signal?: AbortSignal
  }): Promise<unknown>
}

export type TextClassificationOutcome =
  | { state: 'signals'; signals: ClassificationSignals }
  | {
      state: 'abstained'
      abstention: NonNullable<ClassificationSignals['abstention']>
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

function canonicalSignals(input: {
  modelOutput: TextModelOutput
  preprocessed: ReadyTextInput
  classifierVersion: string
  modelVersion: string
  sourceId: string
  observedAt: string
}) {
  return classificationSignalsSchema.safeParse({
    ...input.modelOutput,
    schemaVersion: '1',
    relations: [],
    provenance: {
      sourceKind: 'text-model',
      sourceId: input.sourceId,
      sourceVersion: input.modelVersion,
      observedAt: input.observedAt,
      inputFingerprint: input.preprocessed.inputFingerprint,
      scope: {
        ...input.preprocessed.binding,
        task: 'classification-text'
      },
      ...(input.modelOutput.confidence === null
        ? {}
        : { confidence: input.modelOutput.confidence }),
      evidenceRefs: input.modelOutput.evidence.map(
        evidence => evidence.evidenceId
      )
    },
    classifierVersion: input.classifierVersion,
    modelVersion: input.modelVersion
  })
}

export async function classifyText(input: {
  preprocessed: ReadyTextInput
  provider: TextModelPort
  classifierVersion: string
  modelVersion: string
  sourceId: string
  observedAt: string
  signal?: AbortSignal
}): Promise<TextClassificationOutcome> {
  if (input.signal?.aborted) {
    return abstain('cancelled')
  }

  let raw: unknown
  try {
    raw = await input.provider.classify({
      task: 'classification-text',
      prompt: buildTextClassificationPrompt(input.preprocessed.input),
      ...(input.signal ? { signal: input.signal } : {})
    })
  } catch (error) {
    if (input.signal?.aborted) {
      return abstain('cancelled')
    }
    if (error instanceof TextModelFailure) {
      return abstain(error.code)
    }
    return abstain('provider-unavailable')
  }
  if (input.signal?.aborted) {
    return abstain('cancelled')
  }

  const modelOutput = textModelOutputSchema.safeParse(raw)
  if (!modelOutput.success) {
    return abstain('invalid-output')
  }
  if (modelOutput.data.abstention) {
    return {
      state: 'abstained',
      abstention: modelOutput.data.abstention
    }
  }
  const signals = canonicalSignals({
    modelOutput: modelOutput.data,
    preprocessed: input.preprocessed,
    classifierVersion: input.classifierVersion,
    modelVersion: input.modelVersion,
    sourceId: input.sourceId,
    observedAt: input.observedAt
  })
  if (!signals.success) {
    return abstain('invalid-output')
  }
  return { state: 'signals', signals: signals.data }
}
