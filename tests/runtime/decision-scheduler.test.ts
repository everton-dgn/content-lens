import { describe, expect, it, vi } from 'vitest'

import {
  DecisionWorkError,
  type DecisionWorkInput
} from '@/application/decision-pipeline/contracts'
import { DecisionScheduler } from '@/application/decision-pipeline/scheduler'

const binding = {
  contentId: 'youtube:video:runtime',
  pageInstanceId: 'page:runtime',
  profileRevision: 3,
  capabilityVersion: 'youtube-adapter@1',
  adapterVersion: 'youtube-adapter@1',
  policyVersion: 'deterministic-policy@1'
}

function work(
  overrides: Partial<DecisionWorkInput<string>> = {}
): DecisionWorkInput<string> {
  return {
    workId: 'work:runtime',
    operationId: 'operation:runtime',
    capability: 'deterministic-rules',
    optional: false,
    priority: 'deterministic-visible',
    binding,
    run: async () => 'show',
    ...overrides
  }
}

describe('decision scheduler dedupe and replay', () => {
  it('coalesces duplicate bindings into one execution and one result', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const run = vi.fn(async () => {
      await gate
      return 'show'
    })
    const scheduler = new DecisionScheduler({
      capacity: 4,
      concurrency: 1
    })

    const first = scheduler.schedule(work({ run }))
    const duplicate = scheduler.schedule(work({ run }))

    expect(first.state).toBe('scheduled')
    expect(duplicate.state).toBe('coalesced')
    if (!('completion' in first) || !('completion' in duplicate)) {
      throw new Error('Expected scheduled completions')
    }
    expect(duplicate.completion).toBe(first.completion)
    release?.()

    await expect(first.completion).resolves.toEqual({
      state: 'committed',
      value: 'show',
      attempts: 1
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('replays sanitized checkpoints after restart and discards stale results', async () => {
    const original = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      autoStart: false
    })
    original.schedule(work())
    const checkpoints = original.checkpoints()

    expect(checkpoints).toEqual([
      {
        workId: 'work:runtime',
        operationId: 'operation:runtime',
        capability: 'deterministic-rules',
        optional: false,
        priority: 'deterministic-visible',
        binding,
        attempt: 0
      }
    ])
    expect(JSON.stringify(checkpoints)).not.toContain('title')

    const restarted = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      isCurrent: () => false
    })
    const replay = restarted.replay(checkpoints, checkpoint =>
      work({
        ...checkpoint,
        run: async () => 'hide'
      })
    )
    const scheduled = replay[0]
    if (!scheduled || !('completion' in scheduled)) {
      throw new Error('Expected replayed completion')
    }

    await expect(scheduled.completion).resolves.toEqual({
      state: 'discarded',
      reason: 'stale-binding',
      attempts: 1
    })
  })

  it('resolves a replay whose retry budget is already exhausted', async () => {
    const restarted = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      maximumAttempts: 2
    })
    const replay = restarted.replay(
      [
        {
          workId: 'work:exhausted',
          capability: 'deterministic-rules',
          optional: false,
          priority: 'deterministic-visible',
          binding,
          attempt: 2
        }
      ],
      checkpoint =>
        work({
          ...checkpoint,
          run: vi.fn(async () => 'late')
        })
    )
    const scheduled = replay[0]
    if (!scheduled || !('completion' in scheduled)) {
      throw new Error('Expected replayed completion')
    }

    await expect(scheduled.completion).resolves.toEqual({
      state: 'failed',
      code: 'retry-budget-exhausted',
      retryable: false,
      attempts: 2
    })
  })
})

describe('decision scheduler overload and cancellation', () => {
  it('sheds off-screen optional work before applying required backpressure', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const scheduler = new DecisionScheduler({
      capacity: 2,
      concurrency: 1
    })
    const active = scheduler.schedule(
      work({
        workId: 'work:active',
        run: async () => {
          await gate
          return 'active'
        }
      })
    )
    await Promise.resolve()
    const optional = scheduler.schedule(
      work({
        workId: 'work:optional',
        operationId: undefined,
        capability: 'optional-model',
        optional: true,
        priority: 'optional-offscreen'
      })
    )
    scheduler.schedule(
      work({
        workId: 'work:visible',
        priority: 'deterministic-visible'
      })
    )

    const committedIntent = scheduler.schedule(
      work({
        workId: 'work:committed',
        priority: 'committed-intent'
      })
    )
    expect(committedIntent).toMatchObject({
      state: 'scheduled',
      shedId: 'work:optional'
    })
    if (!('completion' in optional)) {
      throw new Error('Expected optional completion')
    }
    await expect(optional.completion).resolves.toEqual({
      state: 'shed',
      reason: 'overload',
      attempts: 0
    })

    expect(
      scheduler.schedule(
        work({
          workId: 'work:backpressure',
          priority: 'committed-intent'
        })
      )
    ).toEqual({ state: 'backpressure' })
    release?.()
    if ('completion' in active) {
      await active.completion
    }
  })

  it('keeps cancellation terminal and rejects a late success', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const scheduler = new DecisionScheduler({
      capacity: 2,
      concurrency: 1
    })
    const scheduled = scheduler.schedule(
      work({
        run: async () => {
          await gate
          return 'late-success'
        }
      })
    )
    await Promise.resolve()

    expect(
      scheduler.cancel('work:runtime', ['effect:already-committed'])
    ).toEqual({
      state: 'cancelled',
      committedEffects: ['effect:already-committed']
    })
    release?.()
    if (!('completion' in scheduled)) {
      throw new Error('Expected scheduled completion')
    }
    await expect(scheduled.completion).resolves.toEqual({
      state: 'cancelled',
      committedEffects: ['effect:already-committed']
    })
    expect(scheduler.outcome('work:runtime')).toEqual({
      state: 'cancelled',
      committedEffects: ['effect:already-committed']
    })
  })
})

describe('decision scheduler retries and capability circuits', () => {
  it('retries transient failures finitely and isolates an open optional circuit', async () => {
    let now = 1_000
    const scheduler = new DecisionScheduler({
      capacity: 4,
      concurrency: 1,
      now: () => now,
      maximumAttempts: 2,
      circuit: {
        failureThreshold: 2,
        cooldownMs: 30_000
      }
    })
    const failing = scheduler.schedule(
      work({
        capability: 'optional-model',
        optional: true,
        priority: 'optional-visible',
        run: async () => {
          throw new DecisionWorkError('transient', 'model-unavailable')
        }
      })
    )
    if (!('completion' in failing)) {
      throw new Error('Expected failing completion')
    }

    await expect(failing.completion).resolves.toEqual({
      state: 'failed',
      code: 'model-unavailable',
      retryable: true,
      attempts: 2
    })
    expect(scheduler.circuit('optional-model')).toMatchObject({
      state: 'open',
      reason: 'model-unavailable',
      retryAt: 31_000
    })

    expect(
      scheduler.schedule(
        work({
          workId: 'work:circuit-open',
          capability: 'optional-model',
          optional: true,
          priority: 'optional-visible'
        })
      )
    ).toEqual({
      state: 'skipped',
      reason: 'circuit-open'
    })

    const baseline = scheduler.schedule(
      work({
        workId: 'work:baseline',
        capability: 'deterministic-rules',
        run: async () => 'show'
      })
    )
    if (!('completion' in baseline)) {
      throw new Error('Expected baseline completion')
    }
    await expect(baseline.completion).resolves.toMatchObject({
      state: 'committed',
      value: 'show'
    })

    now = 31_001
    const probe = scheduler.schedule(
      work({
        workId: 'work:probe',
        capability: 'optional-model',
        optional: true,
        priority: 'optional-visible',
        run: async () => 'reduce'
      })
    )
    if (!('completion' in probe)) {
      throw new Error('Expected probe completion')
    }
    await expect(probe.completion).resolves.toMatchObject({
      state: 'committed',
      value: 'reduce'
    })
    expect(scheduler.circuit('optional-model')).toMatchObject({
      state: 'closed'
    })
  })

  it('does not retry permanent validation failures', async () => {
    const run = vi.fn(async () => {
      throw new DecisionWorkError('permanent', 'invalid-work')
    })
    const scheduler = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      maximumAttempts: 3
    })
    const scheduled = scheduler.schedule(work({ run }))
    if (!('completion' in scheduled)) {
      throw new Error('Expected scheduled completion')
    }

    await expect(scheduled.completion).resolves.toEqual({
      state: 'failed',
      code: 'invalid-work',
      retryable: false,
      attempts: 1
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reopens a half-open circuit when its admitted probe is cancelled', async () => {
    let now = 1_000
    const scheduler = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      now: () => now,
      autoStart: false,
      maximumAttempts: 1,
      circuit: {
        failureThreshold: 1,
        cooldownMs: 30_000
      }
    })
    const first = scheduler.schedule(
      work({
        capability: 'optional-model',
        optional: true,
        priority: 'optional-visible',
        run: async () => {
          throw new DecisionWorkError('transient', 'model-unavailable')
        }
      })
    )
    scheduler.start()
    if (!('completion' in first)) {
      throw new Error('Expected first completion')
    }
    await first.completion

    now = 31_001
    const probe = scheduler.schedule(
      work({
        workId: 'work:cancelled-probe',
        capability: 'optional-model',
        optional: true,
        priority: 'optional-visible'
      })
    )
    expect(scheduler.circuit('optional-model')).toMatchObject({
      state: 'half-open'
    })
    scheduler.cancel('work:cancelled-probe')
    if (!('completion' in probe)) {
      throw new Error('Expected probe completion')
    }
    await probe.completion

    expect(scheduler.circuit('optional-model')).toMatchObject({
      state: 'open',
      reason: 'cancelled',
      retryAt: 61_001
    })
    expect(
      scheduler.schedule(
        work({
          workId: 'work:blocked-after-cancel',
          capability: 'optional-model',
          optional: true,
          priority: 'optional-visible'
        })
      )
    ).toEqual({ state: 'skipped', reason: 'circuit-open' })
  })
})
