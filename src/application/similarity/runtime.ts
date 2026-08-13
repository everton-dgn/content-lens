import type { EmbeddingAttempt } from '@/ai/similarity/embedding-provider'
import type { RelationEvidence } from '@/ai/similarity/relations'
import { SimilarityService } from '@/application/similarity/service'
import type { ContentItem } from '@/core/content/contracts'
import type { SimilarityBatchAction } from '@/core/similarity/contracts'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'

type SimilarityRuntimeDatabase = Pick<
  ContentLensDatabase,
  | 'clearDerivedIntelligence'
  | 'readRecentContent'
  | 'readSimilarityDerivedState'
  | 'replaceSimilarityDerivedState'
>

export class SimilarityRuntime {
  readonly #database: SimilarityRuntimeDatabase
  readonly #service: SimilarityService
  #batchActions: SimilarityBatchAction[] = []

  constructor(
    database: SimilarityRuntimeDatabase,
    service = new SimilarityService()
  ) {
    this.#database = database
    this.#service = service
  }

  async start(at: string) {
    this.#service.loadObservations(await this.#database.readRecentContent())
    const stored = await this.#database.readSimilarityDerivedState()
    if (stored.state === 'corrupt') {
      await this.#database.clearDerivedIntelligence()
      const persisted = await this.#persist(at)
      return {
        state: 'exact-only' as const,
        code: 'derived-state-corrupt' as const,
        persisted
      }
    }
    if (stored.state === 'ready') {
      this.#batchActions = structuredClone(stored.data.batchActions)
      const restored = await this.#service.restoreDerived({
        vectors: stored.data.vectors,
        relations: stored.data.relations,
        suppressions: stored.data.suppressions,
        at
      })
      if (restored.state === 'corrupt') {
        await this.#database.clearDerivedIntelligence()
        const persisted = await this.#persist(at)
        return {
          state: 'exact-only' as const,
          code: 'derived-state-corrupt' as const,
          persisted
        }
      }
      return { state: 'ready' as const }
    }
    return {
      state: 'exact-only' as const,
      persisted: await this.#persist(at)
    }
  }

  async observe(input: {
    item: ContentItem
    attempts: readonly EmbeddingAttempt[]
    at: string
    signal?: AbortSignal
    protectedContentIds?: ReadonlySet<string>
    evidenceFor?: (
      left: ContentItem,
      right: ContentItem,
      score: number
    ) => RelationEvidence | Promise<RelationEvidence>
  }) {
    const result = await this.#service.observe(input)
    const persisted = await this.#persist(input.at, input.protectedContentIds)
    return { ...result, persisted }
  }

  async disable() {
    this.#service.disable()
    this.#batchActions = []
    return this.#database.clearDerivedIntelligence()
  }

  service() {
    return this.#service
  }

  async #persist(at: string, protectedContentIds?: ReadonlySet<string>) {
    const state = await this.#service.derivedState({
      at,
      batchActions: this.#batchActions,
      ...(protectedContentIds ? { protectedContentIds } : {})
    })
    return this.#database.replaceSimilarityDerivedState(state)
  }
}
