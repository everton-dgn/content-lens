export type OperationState =
  | 'created'
  | 'acknowledged'
  | 'running'
  | 'committed'
  | 'cancelled'
  | 'failed'
  | 'compensated'

export type OperationRecord = {
  operationId: string
  type: string
  state: OperationState
  targetFingerprint: string
  attempt: number
  createdAt: string
  updatedAt: string
  retryable: boolean
  errorCode?: string
  revision?: number
}

export type OperationEffect = {
  kind: string
  targetId: string
}

export type OperationFailure = {
  targetId: string
  error: UserSafeError
  retryable: boolean
}

export type UserSafeError = {
  code: string
  message: string
}

export type OperationResponse<T> =
  | {
      state: 'pending'
      operationId: string
    }
  | {
      state: 'committed'
      value: T
      revision: number
    }
  | {
      state: 'cancelled'
      committedEffects: OperationEffect[]
    }
  | {
      state: 'compensated'
      value: T
      revision: number
      compensatingOperationId?: string
    }
  | {
      state: 'partial'
      value: T
      failures: OperationFailure[]
    }
  | {
      state: 'unavailable'
      capability: string
      fallback: string
    }
  | {
      state: 'failed'
      error: UserSafeError
      retryable: boolean
    }

export type OperationCommand = {
  operationId: string
  type: string
  targetFingerprint: string
  at: string
}

export type OperationFaultPoint = 'before-commit' | 'after-commit'

export type OperationFaultInjector = (
  point: OperationFaultPoint,
  record: Readonly<OperationRecord>
) => void

export type RevisionedProfile = {
  revision: number
}

type OperationEntry = {
  record: OperationRecord
  result?: unknown
  committedEffects: OperationEffect[]
  error?: UserSafeError
  compensatedByOperationId?: string
}

export type OperationJournalSnapshot<Profile extends RevisionedProfile> = {
  profile: Profile
  entries: OperationEntry[]
}

type MutationResult<T> = {
  value: T
  effects?: OperationEffect[]
  compensation?: {
    operationId: string
    effect: OperationEffect
  }
}

type JournalOptions = {
  faultInjector?: OperationFaultInjector
}

export class OperationInterruptedError extends Error {
  readonly point: OperationFaultPoint

  constructor(point: OperationFaultPoint) {
    super(`Operation interrupted at ${point}`)
    this.name = 'OperationInterruptedError'
    this.point = point
  }
}

export class OperationMutationError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, options: { retryable: boolean }) {
    super(message)
    this.name = 'OperationMutationError'
    this.code = code
    this.retryable = options.retryable
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function conflictFailure<T>(): OperationResponse<T> {
  return {
    state: 'failed',
    error: {
      code: 'operation-id-conflict',
      message: 'Operation ID is already bound to another target'
    },
    retryable: false
  }
}

function invalidCommandFailure<T>(): OperationResponse<T> {
  return {
    state: 'failed',
    error: {
      code: 'invalid-operation',
      message: 'Operation metadata is invalid'
    },
    retryable: false
  }
}

function commandIsValid(command: OperationCommand) {
  return (
    nonEmptyStringSchema.safeParse(command.operationId).success &&
    nonEmptyStringSchema.safeParse(command.type).success &&
    nonEmptyStringSchema.safeParse(command.targetFingerprint).success &&
    isoTimestampSchema.safeParse(command.at).success
  )
}

export class AtomicOperationJournal<Profile extends RevisionedProfile> {
  #profile: Profile
  readonly #entries: Map<string, OperationEntry>
  readonly #faultInjector?: OperationFaultInjector
  readonly #inFlight = new Map<
    string,
    {
      type: string
      targetFingerprint: string
      promise: Promise<OperationResponse<unknown>>
    }
  >()
  #transactionTail: Promise<void> = Promise.resolve()

  constructor(profile: Profile, options: JournalOptions = {}) {
    this.#profile = clone(profile)
    this.#entries = new Map()
    this.#faultInjector = options.faultInjector
  }

  static fromSnapshot<Profile extends RevisionedProfile>(
    snapshot: OperationJournalSnapshot<Profile>,
    options: JournalOptions = {}
  ) {
    const journal = new AtomicOperationJournal(snapshot.profile, options)
    for (const entry of snapshot.entries) {
      journal.#entries.set(entry.record.operationId, clone(entry))
    }
    return journal
  }

  get profile(): Profile {
    return clone(this.#profile)
  }

  get records(): OperationRecord[] {
    return [...this.#entries.values()]
      .map(entry => clone(entry.record))
      .sort((left, right) =>
        comparePortableStrings(left.operationId, right.operationId)
      )
  }

  record(operationId: string) {
    const entry = this.#entries.get(operationId)
    return entry ? clone(entry.record) : undefined
  }

  snapshot(): OperationJournalSnapshot<Profile> {
    return {
      profile: clone(this.#profile),
      entries: [...this.#entries.values()].map(clone)
    }
  }

  status(operationId: string) {
    const entry = this.#entries.get(operationId)
    if (!entry) {
      return {
        state: 'unknown' as const,
        durable: false
      }
    }

    switch (entry.record.state) {
      case 'committed':
        return {
          state: 'success' as const,
          durable: true,
          revision: entry.record.revision
        }
      case 'compensated':
        return {
          state: 'compensated' as const,
          durable: true,
          revision: entry.record.revision,
          compensatingOperationId: entry.compensatedByOperationId
        }
      case 'cancelled':
        return {
          state: 'cancelled' as const,
          durable: entry.committedEffects.length > 0
        }
      case 'failed':
        return {
          state: 'failed' as const,
          durable: false,
          retryable: entry.record.retryable,
          errorCode: entry.record.errorCode
        }
      case 'created':
      case 'acknowledged':
      case 'running':
        return {
          state: 'pending' as const,
          durable: false
        }
    }
  }

  acknowledge<T>(command: OperationCommand): OperationResponse<T> {
    if (!commandIsValid(command)) {
      return invalidCommandFailure()
    }

    const existing = this.#entries.get(command.operationId)
    if (existing) {
      if (!this.#matches(existing, command)) {
        return conflictFailure()
      }
      return this.#response<T>(existing)
    }

    this.#entries.set(command.operationId, {
      record: {
        operationId: command.operationId,
        type: command.type,
        state: 'acknowledged',
        targetFingerprint: command.targetFingerprint,
        attempt: 0,
        createdAt: command.at,
        updatedAt: command.at,
        retryable: true
      },
      committedEffects: []
    })

    return {
      state: 'pending',
      operationId: command.operationId
    }
  }

  async execute<T>(
    command: OperationCommand,
    mutate: (draft: Profile) => MutationResult<T> | Promise<MutationResult<T>>
  ): Promise<OperationResponse<T>> {
    if (!commandIsValid(command)) {
      return invalidCommandFailure()
    }

    const inFlight = this.#inFlight.get(command.operationId)
    if (inFlight) {
      if (
        inFlight.type !== command.type ||
        inFlight.targetFingerprint !== command.targetFingerprint
      ) {
        return conflictFailure()
      }
      return (await inFlight.promise) as OperationResponse<T>
    }

    const execution = this.#transactionTail.then(() =>
      this.#executeOnce(command, mutate)
    )
    this.#transactionTail = execution.then(
      () => undefined,
      () => undefined
    )
    this.#inFlight.set(command.operationId, {
      type: command.type,
      targetFingerprint: command.targetFingerprint,
      promise: execution
    })

    try {
      return await execution
    } finally {
      const current = this.#inFlight.get(command.operationId)
      if (current?.promise === execution) {
        this.#inFlight.delete(command.operationId)
      }
    }
  }

  async #executeOnce<T>(
    command: OperationCommand,
    mutate: (draft: Profile) => MutationResult<T> | Promise<MutationResult<T>>
  ): Promise<OperationResponse<T>> {
    const acknowledgement = this.acknowledge<T>(command)
    const existing = this.#entries.get(command.operationId)
    if (!existing || !this.#matches(existing, command)) {
      return acknowledgement
    }
    if (
      existing.record.state === 'committed' ||
      existing.record.state === 'compensated' ||
      existing.record.state === 'cancelled' ||
      (existing.record.state === 'failed' && !existing.record.retryable)
    ) {
      return this.#response<T>(existing)
    }

    const running: OperationEntry = {
      record: {
        ...existing.record,
        state: 'running',
        attempt: existing.record.attempt + 1,
        updatedAt: command.at,
        retryable: true,
        errorCode: undefined
      },
      committedEffects: existing.committedEffects
    }
    this.#entries.set(command.operationId, running)

    try {
      const draft = clone(this.#profile)
      const mutation = await mutate(draft)
      draft.revision = this.#profile.revision + 1

      const current = this.#entries.get(command.operationId)
      if (current?.record.state === 'cancelled') {
        return this.#response<T>(current)
      }

      const compensated = mutation.compensation
        ? this.#compensatedEntry(
            mutation.compensation,
            command.operationId,
            command.at
          )
        : undefined

      this.#faultInjector?.('before-commit', clone(running.record))

      const committed: OperationEntry = {
        record: {
          ...running.record,
          state: 'committed',
          updatedAt: command.at,
          retryable: false,
          revision: draft.revision
        },
        result: clone(mutation.value),
        committedEffects: clone(mutation.effects ?? [])
      }
      this.#profile = draft
      if (compensated) {
        this.#entries.set(compensated.record.operationId, compensated)
      }
      this.#entries.set(command.operationId, committed)

      this.#faultInjector?.('after-commit', clone(committed.record))
      return this.#response<T>(committed)
    } catch (error) {
      if (error instanceof OperationInterruptedError) {
        throw error
      }

      const safeError =
        error instanceof OperationMutationError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable
            }
          : {
              code: 'operation-failed',
              message: 'The operation could not be saved',
              retryable: true
            }
      const failed: OperationEntry = {
        record: {
          ...running.record,
          state: 'failed',
          updatedAt: command.at,
          retryable: safeError.retryable,
          errorCode: safeError.code
        },
        committedEffects: [],
        error: {
          code: safeError.code,
          message: safeError.message
        }
      }
      this.#entries.set(command.operationId, failed)
      return this.#response<T>(failed)
    }
  }

  cancel<T>(operationId: string, at: string): OperationResponse<T> | undefined {
    const entry = this.#entries.get(operationId)
    if (!entry) {
      return undefined
    }
    if (
      entry.record.state === 'committed' ||
      entry.record.state === 'compensated' ||
      entry.record.state === 'cancelled' ||
      entry.record.state === 'failed'
    ) {
      return this.#response<T>(entry)
    }

    const cancelled: OperationEntry = {
      record: {
        ...entry.record,
        state: 'cancelled',
        updatedAt: at,
        retryable: false
      },
      committedEffects: clone(entry.committedEffects)
    }
    this.#entries.set(operationId, cancelled)
    return this.#response<T>(cancelled)
  }

  #matches(entry: OperationEntry, command: OperationCommand) {
    return (
      entry.record.type === command.type &&
      entry.record.targetFingerprint === command.targetFingerprint
    )
  }

  #compensatedEntry(
    compensation: NonNullable<MutationResult<unknown>['compensation']>,
    compensatingOperationId: string,
    at: string
  ) {
    const original = this.#entries.get(compensation.operationId)
    const effectMatches = original?.committedEffects.some(
      effect =>
        effect.kind === compensation.effect.kind &&
        effect.targetId === compensation.effect.targetId
    )
    if (original?.record.state !== 'committed' || !effectMatches) {
      throw new OperationMutationError(
        'invalid-compensation-target',
        'The original operation cannot be compensated',
        { retryable: false }
      )
    }

    return {
      ...clone(original),
      record: {
        ...clone(original.record),
        state: 'compensated' as const,
        updatedAt: at,
        retryable: false
      },
      compensatedByOperationId: compensatingOperationId
    }
  }

  #response<T>(entry: OperationEntry): OperationResponse<T> {
    switch (entry.record.state) {
      case 'committed':
        return {
          state: 'committed',
          value: clone(entry.result) as T,
          revision: entry.record.revision ?? this.#profile.revision
        }
      case 'compensated':
        return {
          state: 'compensated',
          value: clone(entry.result) as T,
          revision: entry.record.revision ?? this.#profile.revision,
          ...(entry.compensatedByOperationId
            ? { compensatingOperationId: entry.compensatedByOperationId }
            : {})
        }
      case 'cancelled':
        return {
          state: 'cancelled',
          committedEffects: clone(entry.committedEffects)
        }
      case 'failed':
        return {
          state: 'failed',
          error: clone(
            entry.error ?? {
              code: entry.record.errorCode ?? 'operation-failed',
              message: 'The operation could not be saved'
            }
          ),
          retryable: entry.record.retryable
        }
      case 'created':
      case 'acknowledged':
      case 'running':
        return {
          state: 'pending',
          operationId: entry.record.operationId
        }
    }
  }
}

import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'
import { comparePortableStrings } from '@/core/operations/fingerprint'
