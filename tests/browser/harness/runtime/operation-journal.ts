export type InterruptionBoundary =
  | 'before-read'
  | 'after-read'
  | 'after-effect'
  | 'after-operation'
  | 'after-commit'

export interface OperationRecord {
  attempt: number
  effectId: string
  operationId: string
  state: 'committed'
}

export interface OperationCommitResult {
  effectId: string
  operationId: string
  replayed: boolean
  state: 'committed'
}

export class SimulatedInterruptionError extends Error {
  readonly code = 'SIMULATED_INTERRUPTION'

  constructor(readonly boundary: InterruptionBoundary) {
    super(`Simulated interruption at "${boundary}".`)
    this.name = 'SimulatedInterruptionError'
  }
}

export class InMemoryOperationJournal {
  readonly #effects = new Set<string>()
  readonly #operations = new Map<string, OperationRecord>()

  commitOnce(
    operationId: string,
    effectId: string,
    interruptAt?: InterruptionBoundary
  ): OperationCommitResult {
    const interrupt = (boundary: InterruptionBoundary): void => {
      if (interruptAt === boundary) {
        throw new SimulatedInterruptionError(boundary)
      }
    }

    interrupt('before-read')
    const existing = this.#operations.get(operationId)
    interrupt('after-read')

    if (existing) {
      return {
        effectId: existing.effectId,
        operationId,
        replayed: true,
        state: 'committed'
      }
    }

    const operationsSnapshot = new Map(this.#operations)
    const effectsSnapshot = new Set(this.#effects)

    try {
      this.#effects.add(effectId)
      interrupt('after-effect')
      this.#operations.set(operationId, {
        attempt: 1,
        effectId,
        operationId,
        state: 'committed'
      })
      interrupt('after-operation')
    } catch (error) {
      this.#operations.clear()
      this.#effects.clear()
      for (const [id, record] of operationsSnapshot) {
        this.#operations.set(id, record)
      }
      for (const id of effectsSnapshot) {
        this.#effects.add(id)
      }
      throw error
    }

    interrupt('after-commit')
    return {
      effectId,
      operationId,
      replayed: false,
      state: 'committed'
    }
  }

  effectCount(): number {
    return this.#effects.size
  }

  operationCount(): number {
    return this.#operations.size
  }
}
