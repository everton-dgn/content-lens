import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'
import {
  type AtomicOperationJournal,
  type OperationCommand,
  OperationMutationError,
  type OperationResponse
} from '@/core/operations/journal'
import { type Rule, ruleSchema } from '@/core/rules/contracts/rule'
import {
  type FeedbackExample,
  feedbackExampleSchema
} from '@/storage/contracts/profile-envelope'

export type FeedbackProfile = {
  revision: number
  rules: Rule[]
  feedbackExamples: FeedbackExample[]
}

export type FeedbackCommandInput = {
  operationId: string
  feedback: unknown
  at: string
}

export type RuleCommandInput = {
  operationId: string
  rule: unknown
  at: string
}

export type FeedbackUndoCommandInput = {
  operationId: string
  originalOperationId: string
  feedbackId: string
  at: string
}

type FeedbackResult = {
  feedbackId: string
}

type RuleResult = {
  ruleId: string
}

function invalidInput<T>(code: string, message: string): OperationResponse<T> {
  return {
    state: 'failed',
    error: { code, message },
    retryable: false
  }
}

async function operationCommand(
  operationId: string,
  type: string,
  target: unknown,
  at: string
): Promise<OperationCommand> {
  return {
    operationId,
    type,
    targetFingerprint: await fingerprintPortableValue(target),
    at
  }
}

export class FeedbackProfileService {
  readonly #journal: AtomicOperationJournal<FeedbackProfile>

  constructor(journal: AtomicOperationJournal<FeedbackProfile>) {
    this.#journal = journal
  }

  async acknowledgeFeedback(
    input: FeedbackCommandInput
  ): Promise<OperationResponse<FeedbackResult>> {
    const parsed = feedbackExampleSchema.safeParse(input.feedback)
    if (!parsed.success) {
      return invalidInput('invalid-feedback', 'Feedback input is invalid')
    }
    return this.#journal.acknowledge(
      await operationCommand(
        input.operationId,
        'feedback.record',
        parsed.data,
        input.at
      )
    )
  }

  async commitFeedback(
    input: FeedbackCommandInput
  ): Promise<OperationResponse<FeedbackResult>> {
    const parsed = feedbackExampleSchema.safeParse(input.feedback)
    if (!parsed.success) {
      return invalidInput('invalid-feedback', 'Feedback input is invalid')
    }
    const command = await operationCommand(
      input.operationId,
      'feedback.record',
      parsed.data,
      input.at
    )

    return this.#journal.execute(command, draft => {
      if (
        draft.feedbackExamples.some(feedback => feedback.id === parsed.data.id)
      ) {
        throw new OperationMutationError(
          'feedback-already-exists',
          'Feedback was already recorded',
          { retryable: false }
        )
      }
      draft.feedbackExamples.push(parsed.data)
      draft.feedbackExamples.sort((left, right) =>
        comparePortableStrings(left.id, right.id)
      )
      return {
        value: { feedbackId: parsed.data.id },
        effects: [
          {
            kind: 'feedback.recorded',
            targetId: parsed.data.id
          }
        ]
      }
    })
  }

  async acknowledgeFeedbackUndo(
    input: FeedbackUndoCommandInput
  ): Promise<OperationResponse<FeedbackResult>> {
    return this.#journal.acknowledge(
      await operationCommand(
        input.operationId,
        'feedback.undo',
        {
          originalOperationId: input.originalOperationId,
          feedbackId: input.feedbackId
        },
        input.at
      )
    )
  }

  async commitFeedbackUndo(
    input: FeedbackUndoCommandInput
  ): Promise<OperationResponse<FeedbackResult>> {
    const command = await operationCommand(
      input.operationId,
      'feedback.undo',
      {
        originalOperationId: input.originalOperationId,
        feedbackId: input.feedbackId
      },
      input.at
    )

    return this.#journal.execute(command, draft => {
      const feedbackIndex = draft.feedbackExamples.findIndex(
        feedback => feedback.id === input.feedbackId
      )
      if (feedbackIndex === -1) {
        throw new OperationMutationError(
          'feedback-not-found',
          'Feedback is no longer available to undo',
          { retryable: false }
        )
      }
      draft.feedbackExamples.splice(feedbackIndex, 1)
      return {
        value: { feedbackId: input.feedbackId },
        effects: [
          {
            kind: 'feedback.removed',
            targetId: input.feedbackId
          }
        ],
        compensation: {
          operationId: input.originalOperationId,
          effect: {
            kind: 'feedback.recorded',
            targetId: input.feedbackId
          }
        }
      }
    })
  }

  async acknowledgeRule(
    input: RuleCommandInput
  ): Promise<OperationResponse<RuleResult>> {
    const parsed = ruleSchema.safeParse(input.rule)
    if (!parsed.success) {
      return invalidInput('invalid-rule', 'Rule input is invalid')
    }
    return this.#journal.acknowledge(
      await operationCommand(
        input.operationId,
        'rule.save',
        parsed.data,
        input.at
      )
    )
  }

  async commitRule(
    input: RuleCommandInput
  ): Promise<OperationResponse<RuleResult>> {
    const parsed = ruleSchema.safeParse(input.rule)
    if (!parsed.success) {
      return invalidInput('invalid-rule', 'Rule input is invalid')
    }
    const command = await operationCommand(
      input.operationId,
      'rule.save',
      parsed.data,
      input.at
    )

    return this.#journal.execute(command, draft => {
      const existingIndex = draft.rules.findIndex(
        rule => rule.id === parsed.data.id
      )
      if (existingIndex === -1) {
        draft.rules.push(parsed.data)
      } else {
        draft.rules[existingIndex] = parsed.data
      }
      draft.rules.sort((left, right) =>
        comparePortableStrings(left.id, right.id)
      )
      return {
        value: { ruleId: parsed.data.id },
        effects: [
          {
            kind: 'rule.saved',
            targetId: parsed.data.id
          }
        ]
      }
    })
  }
}
