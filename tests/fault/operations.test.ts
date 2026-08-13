import { describe, expect, it } from 'vitest'

import {
  type FeedbackProfile,
  FeedbackProfileService
} from '@/core/feedback/service'
import {
  AtomicOperationJournal,
  type OperationFaultPoint,
  OperationInterruptedError
} from '@/core/operations/journal'
import type { Rule } from '@/core/rules/contracts/rule'
import type { FeedbackExample } from '@/storage/contracts/profile-envelope'

const timestamp = '2026-07-29T21:15:00.000Z'

const feedback: FeedbackExample = {
  id: 'feedback:1',
  contentId: 'youtube:video:abc',
  action: 'correct-classification',
  correction: {
    topics: ['software-engineering'],
    desiredAction: 'show'
  },
  createdAt: timestamp
}

const rule: Rule = {
  id: 'rule:1',
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'Transfer gossip',
  caseSensitive: false
}

function initialProfile(): FeedbackProfile {
  return {
    revision: 0,
    rules: [],
    feedbackExamples: []
  }
}

function interruptOnceAt(point: OperationFaultPoint) {
  let interrupted = false
  return (currentPoint: OperationFaultPoint) => {
    if (!interrupted && currentPoint === point) {
      interrupted = true
      throw new OperationInterruptedError(point)
    }
  }
}

describe('idempotent feedback operations', () => {
  it('keeps acknowledgement pending until profile and revision commit together', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:1',
      feedback,
      at: timestamp
    }

    const acknowledgement = await service.acknowledgeFeedback(command)

    expect(acknowledgement).toEqual({
      state: 'pending',
      operationId: command.operationId
    })
    expect(journal.profile).toEqual(initialProfile())
    expect(journal.status(command.operationId)).toMatchObject({
      state: 'pending',
      durable: false
    })

    const committed = await service.commitFeedback(command)

    expect(committed).toEqual({
      state: 'committed',
      value: { feedbackId: feedback.id },
      revision: 1
    })
    expect(journal.profile).toMatchObject({
      revision: 1,
      feedbackExamples: [feedback]
    })
    expect(journal.status(command.operationId)).toMatchObject({
      state: 'success',
      durable: true,
      revision: 1
    })
  })

  it('replays a committed operation without duplicating feedback or revision', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:replay',
      feedback,
      at: timestamp
    }

    await service.acknowledgeFeedback(command)
    const first = await service.commitFeedback(command)
    const replay = await service.commitFeedback(command)

    expect(replay).toEqual(first)
    expect(journal.profile.revision).toBe(1)
    expect(journal.profile.feedbackExamples).toHaveLength(1)
    expect(journal.records).toHaveLength(1)
  })

  it('coalesces concurrent delivery of the same operation', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:concurrent-replay',
      feedback,
      at: timestamp
    }

    await service.acknowledgeFeedback(command)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.commitFeedback(command))
    )

    expect(new Set(results.map(result => JSON.stringify(result)))).toHaveLength(
      1
    )
    expect(journal.profile.revision).toBe(1)
    expect(journal.profile.feedbackExamples).toHaveLength(1)
    expect(journal.record(command.operationId)?.attempt).toBe(1)
  })

  it('serializes different operations without losing a revision', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const commands = ['first', 'second'].map(suffix => ({
      operationId: `operation:feedback:${suffix}`,
      feedback: {
        ...feedback,
        id: `feedback:${suffix}`
      },
      at: timestamp
    }))

    await Promise.all(
      commands.map(async command => {
        await service.acknowledgeFeedback(command)
        return service.commitFeedback(command)
      })
    )

    expect(journal.profile.revision).toBe(2)
    expect(journal.profile.feedbackExamples.map(({ id }) => id)).toEqual([
      'feedback:first',
      'feedback:second'
    ])
  })

  it('retries unfinished work after interruption before commit', async () => {
    const journal = new AtomicOperationJournal(initialProfile(), {
      faultInjector: interruptOnceAt('before-commit')
    })
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:before-commit',
      feedback,
      at: timestamp
    }

    await service.acknowledgeFeedback(command)
    await expect(service.commitFeedback(command)).rejects.toBeInstanceOf(
      OperationInterruptedError
    )
    expect(journal.profile).toEqual(initialProfile())
    expect(journal.record(command.operationId)).toMatchObject({
      state: 'running',
      attempt: 1
    })

    const restarted = AtomicOperationJournal.fromSnapshot(journal.snapshot())
    const replay = await new FeedbackProfileService(restarted).commitFeedback(
      command
    )

    expect(replay).toMatchObject({
      state: 'committed',
      revision: 1
    })
    expect(restarted.profile.feedbackExamples).toHaveLength(1)
    expect(restarted.record(command.operationId)).toMatchObject({
      state: 'committed',
      attempt: 2
    })
  })

  it('replays the durable result after response loss following commit', async () => {
    const journal = new AtomicOperationJournal(initialProfile(), {
      faultInjector: interruptOnceAt('after-commit')
    })
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:after-commit',
      feedback,
      at: timestamp
    }

    await service.acknowledgeFeedback(command)
    await expect(service.commitFeedback(command)).rejects.toBeInstanceOf(
      OperationInterruptedError
    )
    expect(journal.profile).toMatchObject({
      revision: 1,
      feedbackExamples: [feedback]
    })
    expect(journal.record(command.operationId)?.state).toBe('committed')

    const restarted = AtomicOperationJournal.fromSnapshot(journal.snapshot())
    const replay = await new FeedbackProfileService(restarted).commitFeedback(
      command
    )

    expect(replay).toEqual({
      state: 'committed',
      value: { feedbackId: feedback.id },
      revision: 1
    })
    expect(restarted.profile.feedbackExamples).toHaveLength(1)
  })

  it('fails without mutation or false durable success', async () => {
    const journal = new AtomicOperationJournal({
      ...initialProfile(),
      feedbackExamples: [feedback]
    })
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:feedback:duplicate-entity',
      feedback,
      at: timestamp
    }

    expect(await service.acknowledgeFeedback(command)).toMatchObject({
      state: 'pending'
    })
    const failed = await service.commitFeedback(command)

    expect(failed).toEqual({
      state: 'failed',
      error: {
        code: 'feedback-already-exists',
        message: 'Feedback was already recorded'
      },
      retryable: false
    })
    expect(journal.profile.revision).toBe(0)
    expect(journal.profile.feedbackExamples).toHaveLength(1)
    expect(journal.status(command.operationId)).toMatchObject({
      state: 'failed',
      durable: false
    })
  })

  it('rejects operation ID reuse for a different target', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const first = {
      operationId: 'operation:collision',
      feedback,
      at: timestamp
    }
    const collision = {
      ...first,
      feedback: {
        ...feedback,
        id: 'feedback:other'
      }
    }

    expect(await service.acknowledgeFeedback(first)).toMatchObject({
      state: 'pending'
    })
    expect(await service.acknowledgeFeedback(collision)).toEqual({
      state: 'failed',
      error: {
        code: 'operation-id-conflict',
        message: 'Operation ID is already bound to another target'
      },
      retryable: false
    })
    expect(journal.records).toHaveLength(1)
  })

  it('rejects invalid operation metadata without creating a record', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)

    expect(
      await service.acknowledgeFeedback({
        operationId: ' ',
        feedback,
        at: timestamp
      })
    ).toEqual({
      state: 'failed',
      error: {
        code: 'invalid-operation',
        message: 'Operation metadata is invalid'
      },
      retryable: false
    })
    expect(journal.records).toEqual([])
  })

  it('keeps cancellation terminal and effect-free', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:cancelled',
      feedback,
      at: timestamp
    }

    await service.acknowledgeFeedback(command)
    expect(journal.cancel(command.operationId, timestamp)).toEqual({
      state: 'cancelled',
      committedEffects: []
    })
    expect(await service.commitFeedback(command)).toEqual({
      state: 'cancelled',
      committedEffects: []
    })
    expect(journal.profile).toEqual(initialProfile())
  })

  it('does not commit a mutation cancelled while it is running', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const command = {
      operationId: 'operation:cancel-running',
      type: 'test.delayed',
      targetFingerprint: 'sha256:cancel-running',
      at: timestamp
    }
    let releaseMutation: (() => void) | undefined
    const mutationCanFinish = new Promise<void>(resolve => {
      releaseMutation = resolve
    })

    journal.acknowledge(command)
    const execution = journal.execute(command, async draft => {
      await mutationCanFinish
      draft.feedbackExamples = [feedback]
      return {
        value: { feedbackId: feedback.id }
      }
    })
    await Promise.resolve()

    expect(journal.cancel(command.operationId, timestamp)?.state).toBe(
      'cancelled'
    )
    releaseMutation?.()

    expect(await execution).toEqual({
      state: 'cancelled',
      committedEffects: []
    })
    expect(journal.profile).toEqual(initialProfile())
  })

  it('retries one safe failure without losing input or duplicating effects', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const command = {
      operationId: 'operation:retryable',
      type: 'test.retryable',
      targetFingerprint: 'sha256:retryable',
      at: timestamp
    }

    journal.acknowledge(command)
    const failed = await journal.execute(command, () => {
      throw new Error('raw storage failure')
    })

    expect(failed).toEqual({
      state: 'failed',
      error: {
        code: 'operation-failed',
        message: 'The operation could not be saved'
      },
      retryable: true
    })
    expect(JSON.stringify(failed)).not.toContain('raw storage failure')
    expect(journal.profile).toEqual(initialProfile())

    const committed = await journal.execute(command, draft => {
      draft.feedbackExamples.push(feedback)
      return {
        value: { feedbackId: feedback.id },
        effects: [
          {
            kind: 'feedback.recorded',
            targetId: feedback.id
          }
        ]
      }
    })

    expect(committed).toMatchObject({
      state: 'committed',
      revision: 1
    })
    expect(journal.profile.feedbackExamples).toHaveLength(1)
    expect(journal.record(command.operationId)?.attempt).toBe(2)
  })

  it('undoes committed feedback atomically and marks the original compensated', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const recordCommand = {
      operationId: 'operation:feedback:for-undo',
      feedback,
      at: timestamp
    }
    const undoCommand = {
      operationId: 'operation:feedback:undo',
      originalOperationId: recordCommand.operationId,
      feedbackId: feedback.id,
      at: timestamp
    }

    await service.acknowledgeFeedback(recordCommand)
    await service.commitFeedback(recordCommand)
    expect(await service.acknowledgeFeedbackUndo(undoCommand)).toMatchObject({
      state: 'pending'
    })

    const undone = await service.commitFeedbackUndo(undoCommand)
    const replay = await service.commitFeedbackUndo(undoCommand)

    expect(undone).toEqual({
      state: 'committed',
      value: { feedbackId: feedback.id },
      revision: 2
    })
    expect(replay).toEqual(undone)
    expect(journal.profile).toMatchObject({
      revision: 2,
      feedbackExamples: []
    })
    expect(journal.record(recordCommand.operationId)?.state).toBe('compensated')
    expect(journal.record(undoCommand.operationId)?.state).toBe('committed')
    expect(await service.commitFeedback(recordCommand)).toEqual({
      state: 'compensated',
      value: { feedbackId: feedback.id },
      revision: 1,
      compensatingOperationId: undoCommand.operationId
    })
    expect(journal.profile.feedbackExamples).toEqual([])
  })

  it('keeps feedback when the compensation target is invalid', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const recordCommand = {
      operationId: 'operation:feedback:valid-original',
      feedback,
      at: timestamp
    }
    const invalidUndo = {
      operationId: 'operation:feedback:invalid-undo',
      originalOperationId: 'operation:missing',
      feedbackId: feedback.id,
      at: timestamp
    }

    await service.acknowledgeFeedback(recordCommand)
    await service.commitFeedback(recordCommand)
    await service.acknowledgeFeedbackUndo(invalidUndo)

    expect(await service.commitFeedbackUndo(invalidUndo)).toEqual({
      state: 'failed',
      error: {
        code: 'invalid-compensation-target',
        message: 'The original operation cannot be compensated'
      },
      retryable: false
    })
    expect(journal.profile).toMatchObject({
      revision: 1,
      feedbackExamples: [feedback]
    })
  })
})

describe('atomic rule revision', () => {
  it('commits one rule and one revision for every replay of one operation', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)
    const command = {
      operationId: 'operation:rule:1',
      rule,
      at: timestamp
    }

    const acknowledgement = await service.acknowledgeRule(command)
    const committed = await service.commitRule(command)
    const replay = await service.commitRule(command)

    expect(acknowledgement.state).toBe('pending')
    expect(committed).toEqual({
      state: 'committed',
      value: { ruleId: rule.id },
      revision: 1
    })
    expect(replay).toEqual(committed)
    expect(journal.profile).toMatchObject({
      revision: 1,
      rules: [rule]
    })
  })

  it('rejects an invalid rule before acknowledgement', async () => {
    const journal = new AtomicOperationJournal(initialProfile())
    const service = new FeedbackProfileService(journal)

    expect(
      await service.acknowledgeRule({
        operationId: 'operation:invalid-rule',
        rule: {
          ...rule,
          id: ''
        },
        at: timestamp
      })
    ).toEqual({
      state: 'failed',
      error: {
        code: 'invalid-rule',
        message: 'Rule input is invalid'
      },
      retryable: false
    })
    expect(journal.records).toEqual([])
  })
})
