import { createSimilarityCluster } from '@/ai/similarity/cluster'
import type { EmbeddingAttempt } from '@/ai/similarity/embedding-provider'
import { executeEmbeddingRoute } from '@/ai/similarity/embedding-provider'
import {
  compareExactContent,
  exactContentFingerprint
} from '@/ai/similarity/exact'
import { BoundedSimilarityIndex } from '@/ai/similarity/index'
import {
  classifySimilarityRelation,
  type RelationEvidence
} from '@/ai/similarity/relations'
import type { ContentItem } from '@/core/content/contracts'
import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'
import {
  type ContentSimilarityRelation,
  contentSimilarityRelationSchema,
  MAX_SIMILARITY_RETENTION_DAYS,
  type RelationSuppression,
  relationSuppressionSchema,
  type SimilarityBatchAction,
  type SimilarityVectorRecord,
  similarityRuntimeStateSchema
} from '@/core/similarity/contracts'

export const SIMILARITY_EVIDENCE_VERSION = 'similarity-evidence-v1'
export const SIMILARITY_RELATION_POLICY_VERSION = 'similarity-policy-v1'

const retentionMilliseconds =
  MAX_SIMILARITY_RETENTION_DAYS * 24 * 60 * 60 * 1_000

function expirationFor(at: string) {
  return new Date(Date.parse(at) + retentionMilliseconds).toISOString()
}

export async function relationFingerprint(
  relation: Pick<
    ContentSimilarityRelation,
    'leftContentId' | 'rightContentId' | 'type' | 'evidenceVersion'
  >
) {
  const contentIds = [relation.leftContentId, relation.rightContentId].sort(
    comparePortableStrings
  )
  return fingerprintPortableValue({
    contentIds,
    type: relation.type,
    evidenceVersion: relation.evidenceVersion
  })
}

async function exactRelation(input: {
  left: ContentItem
  right: ContentItem
  evidenceCodes: readonly string[]
  at: string
}) {
  const relationId = `relation:${await fingerprintPortableValue({
    left: input.left.id,
    right: input.right.id,
    type: 'exact-duplicate',
    evidenceVersion: SIMILARITY_EVIDENCE_VERSION
  })}`
  return contentSimilarityRelationSchema.parse({
    relationId,
    leftContentId: input.left.id,
    rightContentId: input.right.id,
    type: 'exact-duplicate',
    score: 1,
    confidence: 1,
    threshold: 1,
    evidenceCodes: input.evidenceCodes,
    evidenceVersion: SIMILARITY_EVIDENCE_VERSION,
    relationPolicyVersion: SIMILARITY_RELATION_POLICY_VERSION,
    advisoryOnly: false,
    createdAt: input.at,
    validUntil: expirationFor(input.at)
  })
}

export type SimilarityObservationResult = {
  exactEvaluated: true
  embeddingState:
    | 'not-needed'
    | 'embedded'
    | 'route-unavailable'
    | 'input-too-large'
    | 'cancelled'
    | 'provider-failed'
  relations: ContentSimilarityRelation[]
  durableEligible: boolean
}

export class SimilarityService {
  readonly #index: BoundedSimilarityIndex
  readonly #observations = new Map<string, ContentItem>()
  readonly #relations = new Map<string, ContentSimilarityRelation>()
  readonly #relationFingerprints = new Map<string, string>()
  readonly #suppressions = new Map<string, RelationSuppression>()
  readonly #activeControllers = new Set<AbortController>()
  #enabled = true

  constructor(index = new BoundedSimilarityIndex()) {
    this.#index = index
  }

  async observe(input: {
    item: ContentItem
    attempts: readonly EmbeddingAttempt[]
    at: string
    signal?: AbortSignal
    evidenceFor?: (
      left: ContentItem,
      right: ContentItem,
      score: number
    ) => RelationEvidence | Promise<RelationEvidence>
  }): Promise<SimilarityObservationResult> {
    if (!this.#enabled) {
      return {
        exactEvaluated: true,
        embeddingState: 'route-unavailable',
        relations: [],
        durableEligible: false
      }
    }
    const controller = new AbortController()
    const cancel = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', cancel, { once: true })
    this.#activeControllers.add(controller)
    try {
      const candidates = [...this.#observations.values()]
        .filter(
          candidate =>
            candidate.id !== input.item.id &&
            candidate.platform === input.item.platform &&
            candidate.surface === input.item.surface &&
            candidate.language === input.item.language &&
            Date.parse(candidate.observedAt) >=
              Date.parse(input.at) - retentionMilliseconds
        )
        .sort((left, right) => comparePortableStrings(left.id, right.id))
      const exactRelations: ContentSimilarityRelation[] = []
      for (const candidate of candidates) {
        const exact = await compareExactContent(input.item, candidate)
        if (exact.matched) {
          exactRelations.push(
            await exactRelation({
              left: input.item,
              right: candidate,
              evidenceCodes: exact.evidenceCodes,
              at: input.at
            })
          )
        }
      }
      this.#observations.set(input.item.id, structuredClone(input.item))
      if (exactRelations.length > 0) {
        const relations = await this.#storeActiveRelations(exactRelations)
        return {
          exactEvaluated: true,
          embeddingState: 'not-needed',
          relations,
          durableEligible:
            input.item.identity.status === 'stable' ||
            candidates.some(candidate => candidate.identity.status === 'stable')
        }
      }

      const embedded = await executeEmbeddingRoute({
        item: input.item,
        attempts: input.attempts,
        signal: controller.signal
      })
      if (embedded.state !== 'embedded') {
        return {
          exactEvaluated: true,
          embeddingState: embedded.code,
          relations: [],
          durableEligible: input.item.identity.status === 'stable'
        }
      }
      const queried = this.#index.query({
        vector: embedded.vector,
        versionSpace: embedded.manifest.versionSpace,
        platform: input.item.platform,
        surface: input.item.surface,
        language: input.item.language ?? null,
        observedAfter: new Date(
          Date.parse(input.at) - retentionMilliseconds
        ).toISOString(),
        now: input.at
      })
      const relations: ContentSimilarityRelation[] = []
      if (queried.state === 'ready') {
        for (const match of queried.candidates) {
          const candidate = this.#observations.get(match.contentId)
          if (!candidate) {
            continue
          }
          const evidence = input.evidenceFor
            ? await input.evidenceFor(input.item, candidate, match.score)
            : {
                structuralOverlap: false,
                visualAgreement: false,
                materialFactDelta: false,
                publishedTimeDelta: false,
                sourceLink: false
              }
          const classified = await classifySimilarityRelation({
            leftContentId: input.item.id,
            rightContentId: candidate.id,
            score: match.score,
            confidence: match.score,
            representation: embedded.manifest,
            evidence,
            evidenceVersion: SIMILARITY_EVIDENCE_VERSION,
            relationPolicyVersion: SIMILARITY_RELATION_POLICY_VERSION,
            createdAt: input.at,
            validUntil: expirationFor(input.at)
          })
          if (classified.state === 'related') {
            relations.push(classified.relation)
          }
        }
      }
      const fingerprint = await exactContentFingerprint(input.item)
      this.#index.insert(
        {
          id: `vector:${input.item.id}:${embedded.manifest.versionSpace}`,
          contentId: input.item.id,
          platform: input.item.platform,
          surface: input.item.surface,
          language: input.item.language ?? null,
          stableIdentity: input.item.identity.status === 'stable',
          exactFingerprint: fingerprint,
          manifest: embedded.manifest,
          vector: embedded.vector,
          observedAt: input.item.observedAt,
          expiresAt: expirationFor(input.item.observedAt),
          byteLength: embedded.vector.length * Float32Array.BYTES_PER_ELEMENT
        },
        input.at
      )
      return {
        exactEvaluated: true,
        embeddingState: 'embedded',
        relations: await this.#storeActiveRelations(relations),
        durableEligible:
          input.item.identity.status === 'stable' ||
          relations.some(relation =>
            [relation.leftContentId, relation.rightContentId].some(
              contentId =>
                this.#observations.get(contentId)?.identity.status === 'stable'
            )
          )
      }
    } finally {
      input.signal?.removeEventListener('abort', cancel)
      this.#activeControllers.delete(controller)
    }
  }

  async suppress(input: {
    relationId: string
    reason: RelationSuppression['reason']
    at: string
  }) {
    const relation = this.#relations.get(input.relationId)
    if (!relation) {
      return { state: 'missing' as const }
    }
    const fingerprint =
      this.#relationFingerprints.get(relation.relationId) ??
      (await relationFingerprint(relation))
    const suppression = relationSuppressionSchema.parse({
      id: `suppression:${fingerprint}:${relation.evidenceVersion}`,
      relationFingerprint: fingerprint,
      evidenceVersion: relation.evidenceVersion,
      reason: input.reason,
      createdAt: input.at
    })
    this.#suppressions.set(suppression.id, suppression)
    return { state: 'suppressed' as const, suppression }
  }

  activeRelations(now: string) {
    return [...this.#relations.values()]
      .filter(relation => Date.parse(relation.validUntil) > Date.parse(now))
      .filter(relation => !this.#isSuppressed(relation))
      .map(relation => structuredClone(relation))
  }

  async clusters(input: {
    at: string
    protectedContentIds?: ReadonlySet<string>
  }) {
    const relations = this.activeRelations(input.at)
    const adjacency = new Map<string, Set<string>>()
    for (const relation of relations) {
      const left = adjacency.get(relation.leftContentId) ?? new Set<string>()
      const right = adjacency.get(relation.rightContentId) ?? new Set<string>()
      left.add(relation.rightContentId)
      right.add(relation.leftContentId)
      adjacency.set(relation.leftContentId, left)
      adjacency.set(relation.rightContentId, right)
    }
    const visited = new Set<string>()
    const clusters = []
    const relationPriority = [
      'exact-duplicate',
      'near-duplicate',
      'story-update',
      'semantically-similar',
      'related-distinct'
    ] as const
    for (const start of [...adjacency.keys()].sort(comparePortableStrings)) {
      if (visited.has(start)) {
        continue
      }
      const pending = [start]
      const component: string[] = []
      while (pending.length > 0) {
        const current = pending.shift()
        if (!current || visited.has(current)) {
          continue
        }
        visited.add(current)
        component.push(current)
        for (const neighbor of adjacency.get(current) ?? []) {
          pending.push(neighbor)
        }
      }
      const members = component.flatMap(contentId => {
        const item = this.#observations.get(contentId)
        if (!item) {
          return []
        }
        const adjacentRelations = relations.filter(
          relation =>
            relation.leftContentId === contentId ||
            relation.rightContentId === contentId
        )
        const relationType = relationPriority.find(type =>
          adjacentRelations.some(relation => relation.type === type)
        )
        if (!relationType) {
          return []
        }
        return [
          {
            contentId,
            platform: item.platform,
            stableIdentity: item.identity.status === 'stable',
            sponsored: item.context.sponsored === true,
            sourceEvidence: adjacentRelations.some(relation =>
              relation.evidenceCodes.includes('source-link')
            ),
            publishedAt: item.publishedAt ?? null,
            portableOrderId: item.id,
            relationType,
            protected: input.protectedContentIds?.has(contentId) ?? false,
            update: adjacentRelations.some(
              relation => relation.type === 'story-update'
            )
          }
        ]
      })
      if (
        members.length < 2 ||
        !members.some(member => member.stableIdentity)
      ) {
        continue
      }
      clusters.push(
        await createSimilarityCluster({
          members,
          evidenceVersion: SIMILARITY_EVIDENCE_VERSION,
          createdAt: input.at
        })
      )
    }
    return clusters
  }

  loadObservations(items: readonly ContentItem[]) {
    for (const item of items) {
      this.#observations.set(item.id, structuredClone(item))
    }
  }

  async restoreDerived(input: {
    vectors: readonly SimilarityVectorRecord[]
    relations: readonly ContentSimilarityRelation[]
    suppressions: readonly RelationSuppression[]
    at: string
  }) {
    this.#index.reset()
    this.#relations.clear()
    this.#relationFingerprints.clear()
    this.#suppressions.clear()
    for (const vector of input.vectors) {
      if (this.#index.insert(vector, input.at).state !== 'stored') {
        this.#index.markCorrupt('restore-vector-invalid')
        return { state: 'corrupt' as const }
      }
    }
    for (const relation of input.relations) {
      const parsed = contentSimilarityRelationSchema.safeParse(relation)
      if (!parsed.success) {
        this.#index.markCorrupt('restore-relation-invalid')
        return { state: 'corrupt' as const }
      }
      this.#relations.set(parsed.data.relationId, parsed.data)
      this.#relationFingerprints.set(
        parsed.data.relationId,
        await relationFingerprint(parsed.data)
      )
    }
    for (const suppression of input.suppressions) {
      const parsed = relationSuppressionSchema.safeParse(suppression)
      if (!parsed.success) {
        this.#index.markCorrupt('restore-suppression-invalid')
        return { state: 'corrupt' as const }
      }
      this.#suppressions.set(parsed.data.id, parsed.data)
    }
    this.#enabled = true
    return { state: 'restored' as const }
  }

  async derivedState(input: {
    at: string
    batchActions?: readonly SimilarityBatchAction[]
    protectedContentIds?: ReadonlySet<string>
  }) {
    const snapshot = this.#index.snapshot()
    const vectors = this.#index.records(input.at)
    const runtime = similarityRuntimeStateSchema.parse({
      schemaVersion: 1,
      state: !this.#enabled
        ? 'disabled'
        : snapshot.state === 'degraded'
          ? 'degraded'
          : vectors.length > 0
            ? 'ready'
            : 'exact-only',
      activeVersionSpace: vectors[0]?.manifest.versionSpace ?? null,
      itemCount: vectors.length,
      byteLength: vectors.reduce(
        (total, vector) => total + vector.byteLength,
        0
      ),
      lastErrorCode: snapshot.lastErrorCode,
      updatedAt: input.at
    })
    return {
      vectors,
      relations: this.activeRelations(input.at),
      suppressions: [...this.#suppressions.values()].map(suppression =>
        structuredClone(suppression)
      ),
      clusters: await this.clusters({
        at: input.at,
        ...(input.protectedContentIds
          ? { protectedContentIds: input.protectedContentIds }
          : {})
      }),
      batchActions: structuredClone(input.batchActions ?? []),
      runtime,
      checkpoint: null
    }
  }

  disable() {
    this.#enabled = false
    for (const controller of this.#activeControllers) {
      controller.abort(new Error('similarity-disabled'))
    }
    this.#index.disable()
    this.#relations.clear()
    this.#relationFingerprints.clear()
    this.#suppressions.clear()
  }

  reset() {
    this.#enabled = true
    this.#index.reset()
    this.#relations.clear()
    this.#relationFingerprints.clear()
    this.#suppressions.clear()
  }

  snapshot() {
    return {
      enabled: this.#enabled,
      observations: this.#observations.size,
      relations: this.#relations.size,
      suppressions: this.#suppressions.size,
      index: this.#index.snapshot()
    }
  }

  async #storeActiveRelations(relations: readonly ContentSimilarityRelation[]) {
    const active: ContentSimilarityRelation[] = []
    for (const relation of relations) {
      this.#relationFingerprints.set(
        relation.relationId,
        await relationFingerprint(relation)
      )
      if (this.#isSuppressed(relation)) {
        continue
      }
      this.#relations.set(relation.relationId, relation)
      active.push(structuredClone(relation))
    }
    return active
  }

  #isSuppressed(relation: ContentSimilarityRelation) {
    const fingerprint = this.#relationFingerprints.get(relation.relationId)
    if (!fingerprint) {
      return false
    }
    return [...this.#suppressions.values()].some(
      suppression =>
        suppression.evidenceVersion === relation.evidenceVersion &&
        suppression.relationFingerprint === fingerprint
    )
  }
}
