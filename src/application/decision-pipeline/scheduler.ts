import {
  CapabilityCircuitBreaker,
  type CircuitBreakerOptions
} from '@/application/decision-pipeline/circuit-breaker'
import {
  type DecisionWorkBinding,
  type DecisionWorkCheckpoint,
  DecisionWorkError,
  type DecisionWorkInput,
  type DecisionWorkOutcome,
  type DecisionWorkPriority
} from '@/application/decision-pipeline/contracts'

type SchedulerOptions = {
  capacity: number
  concurrency: number
  maximumAttempts?: number
  autoStart?: boolean
  now?: () => number
  isCurrent?: (binding: DecisionWorkBinding) => boolean | Promise<boolean>
  circuit?: Partial<CircuitBreakerOptions>
}

type WorkRecord<Value> = {
  input: DecisionWorkInput<Value>
  attempt: number
  controller: AbortController
  completion: Promise<DecisionWorkOutcome<Value>>
  resolve(outcome: DecisionWorkOutcome<Value>): void
  settled: boolean
  state: 'pending' | 'active'
}

export type ScheduleResult<Value> =
  | {
      state: 'scheduled' | 'coalesced'
      completion: Promise<DecisionWorkOutcome<Value>>
      shedId?: string
    }
  | {
      state: 'backpressure'
    }
  | {
      state: 'skipped'
      reason: 'circuit-open'
    }
  | {
      state: 'rejected'
      reason: 'work-id-conflict'
    }

const priorityRank: Record<DecisionWorkPriority, number> = {
  'committed-intent': 4,
  'deterministic-visible': 3,
  'optional-visible': 2,
  'optional-offscreen': 1
}

function sameBinding(left: DecisionWorkBinding, right: DecisionWorkBinding) {
  return (
    left.contentId === right.contentId &&
    left.pageInstanceId === right.pageInstanceId &&
    left.profileRevision === right.profileRevision &&
    left.capabilityVersion === right.capabilityVersion &&
    left.adapterVersion === right.adapterVersion &&
    left.policyVersion === right.policyVersion
  )
}

export class DecisionScheduler {
  readonly #capacity: number
  readonly #concurrency: number
  readonly #maximumAttempts: number
  readonly #autoStart: boolean
  readonly #now: () => number
  readonly #isCurrent: (
    binding: DecisionWorkBinding
  ) => boolean | Promise<boolean>
  readonly #circuitBreaker: CapabilityCircuitBreaker
  readonly #records = new Map<string, WorkRecord<unknown>>()
  readonly #pending: WorkRecord<unknown>[] = []
  readonly #terminal = new Map<string, DecisionWorkOutcome<unknown>>()
  #active = 0

  constructor(options: SchedulerOptions) {
    if (options.capacity < 1 || options.concurrency < 1) {
      throw new Error('Scheduler capacity and concurrency must be positive')
    }
    if ((options.maximumAttempts ?? 2) < 1) {
      throw new Error('Scheduler maximum attempts must be positive')
    }
    this.#capacity = options.capacity
    this.#concurrency = options.concurrency
    this.#maximumAttempts = options.maximumAttempts ?? 2
    this.#autoStart = options.autoStart ?? true
    this.#now = options.now ?? Date.now
    this.#isCurrent = options.isCurrent ?? (() => true)
    this.#circuitBreaker = new CapabilityCircuitBreaker({
      failureThreshold: options.circuit?.failureThreshold ?? 3,
      cooldownMs: options.circuit?.cooldownMs ?? 30_000
    })
  }

  schedule<Value>(input: DecisionWorkInput<Value>): ScheduleResult<Value> {
    const existing = this.#records.get(input.workId)
    if (existing) {
      if (!sameBinding(existing.input.binding, input.binding)) {
        return { state: 'rejected', reason: 'work-id-conflict' }
      }
      return {
        state: 'coalesced',
        completion: existing.completion as Promise<DecisionWorkOutcome<Value>>
      }
    }
    const terminal = this.#terminal.get(input.workId)
    if (terminal?.state === 'committed' || terminal?.state === 'cancelled') {
      return {
        state: 'coalesced',
        completion: Promise.resolve(terminal as DecisionWorkOutcome<Value>)
      }
    }
    this.#terminal.delete(input.workId)

    if (
      input.optional &&
      !this.#circuitBreaker.allow(input.capability, this.#now())
    ) {
      return { state: 'skipped', reason: 'circuit-open' }
    }

    const record = this.#createRecord(input)
    let shedId: string | undefined
    if (this.#pending.length >= this.#capacity) {
      const optional = this.#pending
        .filter(({ input: pending }) => pending.optional)
        .sort(
          (left, right) =>
            priorityRank[left.input.priority] -
            priorityRank[right.input.priority]
        )[0]
      if (
        !optional ||
        priorityRank[input.priority] <= priorityRank[optional.input.priority]
      ) {
        if (input.optional) {
          this.#finish(record, {
            state: 'shed',
            reason: 'overload',
            attempts: 0
          })
          return {
            state: 'scheduled',
            completion: record.completion,
            shedId: input.workId
          }
        }
        return { state: 'backpressure' }
      }
      this.#pending.splice(this.#pending.indexOf(optional), 1)
      shedId = optional.input.workId
      this.#finish(optional, {
        state: 'shed',
        reason: 'overload',
        attempts: optional.attempt
      })
    }

    this.#records.set(input.workId, record as WorkRecord<unknown>)
    this.#pending.push(record as WorkRecord<unknown>)
    if (this.#autoStart) {
      this.#pump()
    }
    return {
      state: 'scheduled',
      completion: record.completion,
      ...(shedId ? { shedId } : {})
    }
  }

  replay(
    checkpoints: readonly DecisionWorkCheckpoint[],
    createWork: (
      checkpoint: DecisionWorkCheckpoint
    ) => DecisionWorkInput<unknown>
  ) {
    return checkpoints.map(checkpoint =>
      this.schedule(
        createWork({
          ...checkpoint,
          binding: structuredClone(checkpoint.binding)
        })
      )
    )
  }

  checkpoints(): DecisionWorkCheckpoint[] {
    return [...this.#records.values()].map(({ input, attempt }) => ({
      workId: input.workId,
      ...(input.operationId ? { operationId: input.operationId } : {}),
      capability: input.capability,
      optional: input.optional,
      priority: input.priority,
      binding: structuredClone(input.binding),
      attempt
    }))
  }

  cancel(workId: string, committedEffects: readonly string[] = []) {
    const record = this.#records.get(workId)
    if (!record) {
      return this.#terminal.get(workId) ?? null
    }
    if (record.state === 'pending') {
      this.#pending.splice(this.#pending.indexOf(record), 1)
    }
    record.controller.abort()
    const outcome = {
      state: 'cancelled',
      committedEffects: [...committedEffects]
    } as const
    this.#finish(record, outcome)
    return outcome
  }

  start() {
    this.#pump()
  }

  outcome(workId: string) {
    return this.#terminal.get(workId) ?? null
  }

  circuit(capability: string) {
    return this.#circuitBreaker.snapshot(capability)
  }

  snapshot() {
    return {
      active: this.#active,
      pending: this.#pending.length,
      terminal: this.#terminal.size
    }
  }

  #createRecord<Value>(input: DecisionWorkInput<Value>): WorkRecord<Value> {
    let resolve: ((outcome: DecisionWorkOutcome<Value>) => void) | undefined
    const completion = new Promise<DecisionWorkOutcome<Value>>(complete => {
      resolve = complete
    })
    if (!resolve) {
      throw new Error('Decision work completion was not initialized')
    }
    return {
      input,
      attempt: input.attempt ?? 0,
      controller: new AbortController(),
      completion,
      resolve,
      settled: false,
      state: 'pending'
    }
  }

  #pump() {
    while (this.#active < this.#concurrency && this.#pending.length > 0) {
      this.#pending.sort(
        (left, right) =>
          priorityRank[right.input.priority] - priorityRank[left.input.priority]
      )
      const record = this.#pending.shift()
      if (!record || record.settled) {
        continue
      }
      record.state = 'active'
      this.#active += 1
      void this.#execute(record).finally(() => {
        this.#active -= 1
        this.#pump()
      })
    }
  }

  async #execute(record: WorkRecord<unknown>) {
    while (!record.settled && record.attempt < this.#maximumAttempts) {
      record.attempt += 1
      try {
        const value = await record.input.run(record.controller.signal)
        if (record.settled) {
          return
        }
        if (!(await this.#isCurrent(record.input.binding))) {
          this.#finish(record, {
            state: 'discarded',
            reason: 'stale-binding',
            attempts: record.attempt
          })
          return
        }
        if (record.input.optional) {
          this.#circuitBreaker.success(record.input.capability, this.#now())
        }
        this.#finish(record, {
          state: 'committed',
          value,
          attempts: record.attempt
        })
        return
      } catch (error) {
        if (record.settled) {
          return
        }
        const classified =
          error instanceof DecisionWorkError
            ? error
            : new DecisionWorkError('permanent', 'work-failed')
        if (record.input.optional && classified.kind === 'transient') {
          this.#circuitBreaker.failure(
            record.input.capability,
            classified.code,
            this.#now()
          )
        }
        const retryable =
          classified.kind === 'transient' &&
          record.attempt < this.#maximumAttempts
        if (retryable) {
          continue
        }
        this.#finish(record, {
          state: 'failed',
          code: classified.code,
          retryable: classified.kind === 'transient',
          attempts: record.attempt
        })
        return
      }
    }
    if (!record.settled) {
      this.#finish(record, {
        state: 'failed',
        code: 'retry-budget-exhausted',
        retryable: false,
        attempts: record.attempt
      })
    }
  }

  #finish<Value>(
    record: WorkRecord<Value>,
    outcome: DecisionWorkOutcome<Value>
  ) {
    if (record.settled) {
      return
    }
    if (
      record.input.optional &&
      (outcome.state === 'cancelled' ||
        outcome.state === 'discarded' ||
        outcome.state === 'shed' ||
        (outcome.state === 'failed' && !outcome.retryable))
    ) {
      this.#circuitBreaker.incompleteProbe(
        record.input.capability,
        outcome.state === 'failed' ? outcome.code : outcome.state,
        this.#now()
      )
    }
    record.settled = true
    this.#records.delete(record.input.workId)
    this.#terminal.delete(record.input.workId)
    this.#terminal.set(
      record.input.workId,
      outcome as DecisionWorkOutcome<unknown>
    )
    const terminalCapacity = this.#capacity + this.#concurrency
    while (this.#terminal.size > terminalCapacity) {
      const oldest = this.#terminal.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.#terminal.delete(oldest)
    }
    record.resolve(outcome)
  }
}
