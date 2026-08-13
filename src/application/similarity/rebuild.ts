import {
  type SimilarityRebuildCheckpoint,
  similarityRebuildCheckpointSchema
} from '@/core/similarity/contracts'

export class SimilarityRebuildSession {
  #checkpoint: SimilarityRebuildCheckpoint
  readonly #controller = new AbortController()

  constructor(input: {
    generation: number
    evidenceVersion: string
    representationVersionSpace: string
    at: string
    checkpoint?: unknown
  }) {
    this.#checkpoint = input.checkpoint
      ? similarityRebuildCheckpointSchema.parse(input.checkpoint)
      : similarityRebuildCheckpointSchema.parse({
          id: `similarity-rebuild:${input.generation}`,
          generation: input.generation,
          evidenceVersion: input.evidenceVersion,
          representationVersionSpace: input.representationVersionSpace,
          cursor: 0,
          processedCount: 0,
          state: 'pending',
          updatedAt: input.at
        })
    if (
      this.#checkpoint.generation !== input.generation ||
      this.#checkpoint.evidenceVersion !== input.evidenceVersion ||
      this.#checkpoint.representationVersionSpace !==
        input.representationVersionSpace
    ) {
      throw new TypeError('Similarity rebuild checkpoint version mismatch')
    }
  }

  async run<T>(input: {
    items: readonly T[]
    at: () => string
    batchSize?: number
    process(item: T, signal: AbortSignal): Promise<void>
  }) {
    const batchSize = Math.min(Math.max(1, input.batchSize ?? 100), 1_000)
    this.#checkpoint = similarityRebuildCheckpointSchema.parse({
      ...this.#checkpoint,
      state: 'running',
      updatedAt: input.at()
    })
    try {
      while (this.#checkpoint.cursor < input.items.length) {
        this.#controller.signal.throwIfAborted()
        const end = Math.min(
          this.#checkpoint.cursor + batchSize,
          input.items.length
        )
        for (let index = this.#checkpoint.cursor; index < end; index += 1) {
          const item = input.items[index]
          if (item !== undefined) {
            await input.process(item, this.#controller.signal)
          }
        }
        this.#checkpoint = similarityRebuildCheckpointSchema.parse({
          ...this.#checkpoint,
          cursor: end,
          processedCount: end,
          updatedAt: input.at()
        })
      }
      this.#checkpoint = similarityRebuildCheckpointSchema.parse({
        ...this.#checkpoint,
        state: 'completed',
        updatedAt: input.at()
      })
      return { state: 'completed' as const, checkpoint: this.snapshot() }
    } catch {
      const state = this.#controller.signal.aborted ? 'cancelled' : 'failed'
      this.#checkpoint = similarityRebuildCheckpointSchema.parse({
        ...this.#checkpoint,
        state,
        updatedAt: input.at()
      })
      return { state, checkpoint: this.snapshot() }
    }
  }

  cancel() {
    this.#controller.abort(new Error('similarity-rebuild-cancelled'))
  }

  snapshot() {
    return structuredClone(this.#checkpoint)
  }
}
