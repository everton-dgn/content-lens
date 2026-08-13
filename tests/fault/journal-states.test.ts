import { describe, expect, it } from 'vitest'

import {
  AtomicOperationJournal,
  type OperationCommand
} from '@/core/operations/journal'

type TestProfile = { revision: number; rules: string[] }

const at = '2026-07-31T08:00:00.000Z'

const command = (
  overrides: Partial<OperationCommand> = {}
): OperationCommand => ({
  operationId: 'op:add-rule',
  type: 'rule.add',
  targetFingerprint: 'rule:1',
  at,
  ...overrides
})

const profile = (): TestProfile => ({ revision: 0, rules: [] })

const addRule = (id: string) => (draft: TestProfile) => {
  draft.rules.push(id)
  return { value: id }
}

describe('operation journal states', () => {
  it('reports unknown for a record it never saw', () => {
    const journal = new AtomicOperationJournal(profile())

    expect(journal.status('op:never-seen')).toEqual({
      state: 'unknown',
      durable: false
    })
    expect(journal.record('op:never-seen')).toBeUndefined()
    expect(journal.cancel('op:never-seen', at)).toBeUndefined()
  })

  it('marks a committed operation as a durable success', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const cmd = command()

    const result = await journal.execute<string>(cmd, addRule('rule:1'))

    expect(result).toMatchObject({ state: 'committed', value: 'rule:1' })
    expect(journal.status(cmd.operationId)).toEqual({
      state: 'success',
      durable: true,
      revision: 1
    })
    expect(journal.profile.rules).toEqual(['rule:1'])
  })

  it('compensates a committed operation and reports it durably', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const first = command({
      operationId: 'op:add',
      targetFingerprint: 'rule:1'
    })
    const effect = { kind: 'rule', targetId: 'rule:1' }

    await journal.execute<string>(first, draft => {
      draft.rules.push('rule:1')
      return { value: 'rule:1', effects: [effect] }
    })

    const undo = command({
      operationId: 'op:undo',
      type: 'rule.remove',
      targetFingerprint: 'rule:1'
    })
    const result = await journal.execute<string>(undo, draft => {
      draft.rules = draft.rules.filter(rule => rule !== 'rule:1')
      return {
        value: 'removed',
        compensation: { operationId: 'op:add', effect }
      }
    })

    expect(result).toMatchObject({ state: 'committed' })
    expect(journal.status('op:add')).toMatchObject({
      state: 'compensated',
      durable: true,
      compensatingOperationId: 'op:undo'
    })
  })

  it('cancels a pending operation and reports it durably', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const cmd = command({ operationId: 'op:pending' })

    journal.acknowledge(cmd)
    const cancelled = journal.cancel<string>(cmd.operationId, at)

    expect(cancelled).toMatchObject({ state: 'cancelled' })
    expect(journal.status(cmd.operationId)).toEqual({
      state: 'cancelled',
      durable: false
    })
    expect(journal.cancel<string>(cmd.operationId, at)).toMatchObject({
      state: 'cancelled'
    })
  })

  it('reports a failed operation with its retryable flag', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const cmd = command({ operationId: 'op:fail' })

    const result = await journal.execute<string>(cmd, () => {
      throw new Error('storage exploded')
    })

    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'operation-failed' },
      retryable: true
    })
    expect(journal.status(cmd.operationId)).toMatchObject({
      state: 'failed',
      durable: false,
      retryable: true,
      errorCode: 'operation-failed'
    })
  })

  it('rejects an invalid command without touching the journal', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const bad = command({ operationId: '' })

    const acked = journal.acknowledge(bad)
    expect(acked).toMatchObject({
      state: 'failed',
      error: { code: 'invalid-operation' }
    })

    const executed = await journal.execute<string>(bad, addRule('rule:1'))
    expect(executed).toMatchObject({
      state: 'failed',
      error: { code: 'invalid-operation' }
    })
    expect(journal.records).toHaveLength(0)
  })

  it('rejects a conflicting reuse of an operation id', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const first = command({ operationId: 'op:shared', targetFingerprint: 'a' })
    await journal.execute<string>(first, addRule('rule:1'))

    const replay = await journal.execute<string>(
      command({ operationId: 'op:shared', targetFingerprint: 'b' }),
      addRule('rule:2')
    )

    expect(replay).toMatchObject({
      state: 'failed',
      error: { code: 'operation-id-conflict' },
      retryable: false
    })
    expect(journal.profile.rules).toEqual(['rule:1'])
  })

  it('rejects a compensation whose target was never committed', async () => {
    const journal = new AtomicOperationJournal<TestProfile>(profile())
    const cmd = command({ operationId: 'op:bad-comp' })

    const result = await journal.execute<string>(cmd, () => ({
      value: 'nope',
      compensation: {
        operationId: 'op:never-committed',
        effect: { kind: 'rule', targetId: 'rule:1' }
      }
    }))

    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'invalid-compensation-target' },
      retryable: false
    })
  })
})
