import { comparePortableStrings } from '@/core/operations/fingerprint'
import {
  MAX_SIMILARITY_BYTES,
  MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_ITEMS,
  type SimilarityVectorRecord,
  similarityVectorRecordSchema
} from '@/core/similarity/contracts'

type QueryInput = {
  vector: readonly number[]
  versionSpace: string
  platform?: SimilarityVectorRecord['platform']
  surface?: SimilarityVectorRecord['surface']
  language?: string | null
  observedAfter?: string
  limit?: number
  now: string
}

type IndexedRecord = SimilarityVectorRecord & { lastAccessedAt: string }

function cosine(left: readonly number[], right: readonly number[]) {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)
  return denominator === 0 ? 0 : dot / denominator
}

export class BoundedSimilarityIndex {
  readonly #maximumItems: number
  readonly #maximumBytes: number
  readonly #records = new Map<string, IndexedRecord>()
  #bytes = 0
  #insertionsSinceSweep = 0
  #state: 'ready' | 'degraded' | 'disabled' = 'ready'
  #errorCode: string | null = null

  constructor(input: { maximumItems?: number; maximumBytes?: number } = {}) {
    this.#maximumItems = input.maximumItems ?? MAX_SIMILARITY_ITEMS
    this.#maximumBytes = input.maximumBytes ?? MAX_SIMILARITY_BYTES
  }

  insert(input: unknown, now: string) {
    if (this.#state === 'disabled') {
      return { state: 'disabled' as const }
    }
    const parsed = similarityVectorRecordSchema.safeParse(input)
    if (!parsed.success) {
      this.#degrade('invalid-vector-record')
      return { state: 'invalid' as const }
    }
    const current = this.#records.get(parsed.data.id)
    if (current) {
      this.#bytes -= current.byteLength
    }
    this.#records.set(parsed.data.id, { ...parsed.data, lastAccessedAt: now })
    this.#bytes += parsed.data.byteLength
    this.#insertionsSinceSweep += 1
    this.#evict(now)
    return { state: 'stored' as const }
  }

  query(input: QueryInput) {
    if (this.#state !== 'ready') {
      return { state: 'unavailable' as const, candidates: [] }
    }
    const limit = Math.min(
      Math.max(1, input.limit ?? MAX_SIMILARITY_CANDIDATES),
      MAX_SIMILARITY_CANDIDATES
    )
    const candidates = [...this.#records.values()]
      .filter(
        record =>
          record.manifest.versionSpace === input.versionSpace &&
          record.vector.length === input.vector.length &&
          Date.parse(record.expiresAt) > Date.parse(input.now) &&
          (!input.platform || record.platform === input.platform) &&
          (!input.surface || record.surface === input.surface) &&
          (input.language === undefined ||
            record.language === input.language) &&
          (!input.observedAfter ||
            Date.parse(record.observedAt) >= Date.parse(input.observedAfter))
      )
      .map(record => ({
        contentId: record.contentId,
        score: cosine(input.vector, record.vector),
        record
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          comparePortableStrings(left.contentId, right.contentId)
      )
      .slice(0, limit)
    for (const candidate of candidates) {
      candidate.record.lastAccessedAt = input.now
    }
    return {
      state: 'ready' as const,
      candidates: candidates.map(({ contentId, score }) => ({
        contentId,
        score
      }))
    }
  }

  disable() {
    this.#records.clear()
    this.#bytes = 0
    this.#insertionsSinceSweep = 0
    this.#state = 'disabled'
    this.#errorCode = null
  }

  reset() {
    this.#records.clear()
    this.#bytes = 0
    this.#insertionsSinceSweep = 0
    this.#state = 'ready'
    this.#errorCode = null
  }

  markCorrupt(code = 'index-corrupt') {
    this.#degrade(code)
  }

  snapshot() {
    return {
      state: this.#state,
      itemCount: this.#records.size,
      byteLength: this.#bytes,
      lastErrorCode: this.#errorCode
    }
  }

  records(now: string) {
    if (this.#state !== 'ready') {
      return []
    }
    return [...this.#records.values()]
      .filter(record => Date.parse(record.expiresAt) > Date.parse(now))
      .sort((left, right) => comparePortableStrings(left.id, right.id))
      .map(({ lastAccessedAt: _lastAccessedAt, ...record }) =>
        structuredClone(record)
      )
  }

  #degrade(code: string) {
    this.#records.clear()
    this.#bytes = 0
    this.#insertionsSinceSweep = 0
    this.#state = 'degraded'
    this.#errorCode = code
  }

  #evict(now: string) {
    const overLimit =
      this.#records.size > this.#maximumItems ||
      this.#bytes > this.#maximumBytes
    if (overLimit || this.#insertionsSinceSweep >= 256) {
      const expired = [...this.#records.values()]
        .filter(record => Date.parse(record.expiresAt) <= Date.parse(now))
        .sort((left, right) =>
          comparePortableStrings(left.expiresAt, right.expiresAt)
        )
      for (const record of expired) {
        this.#remove(record.id)
      }
      this.#insertionsSinceSweep = 0
    }
    if (
      this.#records.size <= this.#maximumItems &&
      this.#bytes <= this.#maximumBytes
    ) {
      return
    }
    const oldest = [...this.#records.values()].sort(
      (left, right) =>
        comparePortableStrings(left.lastAccessedAt, right.lastAccessedAt) ||
        comparePortableStrings(left.id, right.id)
    )
    for (const record of oldest) {
      if (
        this.#records.size <= this.#maximumItems &&
        this.#bytes <= this.#maximumBytes
      ) {
        break
      }
      this.#remove(record.id)
    }
  }

  #remove(id: string) {
    const record = this.#records.get(id)
    if (!record) {
      return
    }
    this.#records.delete(id)
    this.#bytes -= record.byteLength
  }
}
