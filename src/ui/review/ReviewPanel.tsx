import { useCallback, useEffect, useRef, useState } from 'react'

import { relationFingerprint } from '@/application/similarity/service'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import {
  type ContentSimilarityRelation,
  relationSuppressionSchema,
  similarityBatchActionSchema
} from '@/core/similarity/contracts'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SimilarityDerivedState } from '@/storage/indexed-db/similarity-store'
import { Button, DataList, Dialog, StatePanel, Surface } from '@/ui/components'
import type { ReviewPanelCopy } from '@/ui/review/copy'
import { ClusterReview } from '@/ui/similarity/ClusterReview'
import { RelationEvidence } from '@/ui/similarity/RelationEvidence'

export type ReviewPanelProps = {
  copy: ReviewPanelCopy
  database: Pick<
    ContentLensDatabase,
    | 'readGraphDerivedState'
    | 'readSimilarityDerivedState'
    | 'replaceSimilarityDerivedState'
  >
}

type ReviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | {
      status: 'ready'
      similarity: SimilarityDerivedState
      graphNodes: number
      graphEdges: number
      relations: ContentSimilarityRelation[]
    }
  | { status: 'error' }

async function unsuppressedRelations(similarity: SimilarityDerivedState) {
  if (similarity.suppressions.length === 0) {
    return structuredClone(similarity.relations)
  }
  const suppressions = new Set(
    similarity.suppressions.map(
      suppression =>
        `${suppression.relationFingerprint}\u0000${suppression.evidenceVersion}`
    )
  )
  const relations: ContentSimilarityRelation[] = []
  for (const relation of similarity.relations) {
    const fingerprint = await relationFingerprint(relation)
    if (!suppressions.has(`${fingerprint}\u0000${relation.evidenceVersion}`)) {
      relations.push(relation)
    }
  }
  return relations
}

export const ReviewPanel = ({ copy, database }: ReviewPanelProps) => {
  const [state, setState] = useState<ReviewState>({ status: 'loading' })
  const [pending, setPending] = useState(false)
  const [separating, setSeparating] =
    useState<ContentSimilarityRelation | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [similarity, graph] = await Promise.all([
        database.readSimilarityDerivedState(),
        database.readGraphDerivedState()
      ])
      if (similarity.state === 'corrupt' || graph.state === 'corrupt') {
        setState({ status: 'error' })
        return
      }
      if (similarity.state !== 'ready') {
        setState({ status: 'empty' })
        return
      }
      const relations = await unsuppressedRelations(similarity.data)
      if (relations.length === 0 && similarity.data.clusters.length === 0) {
        setState({ status: 'empty' })
        return
      }
      setState({
        status: 'ready',
        similarity: similarity.data,
        graphNodes: graph.state === 'ready' ? graph.data.nodes.length : 0,
        graphEdges: graph.state === 'ready' ? graph.data.edges.length : 0,
        relations
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [database])

  useEffect(() => {
    void load()
  }, [load])

  const separate = useCallback(async () => {
    if (!separating || state.status !== 'ready') {
      return
    }
    setPending(true)
    try {
      const fingerprint = await relationFingerprint(separating)
      const suppression = relationSuppressionSchema.parse({
        id: `suppression:${fingerprint}:${separating.evidenceVersion}`,
        relationFingerprint: fingerprint,
        evidenceVersion: separating.evidenceVersion,
        reason: 'false-grouping',
        createdAt: new Date().toISOString()
      })
      const suppressions = [
        ...state.similarity.suppressions.filter(
          current => current.id !== suppression.id
        ),
        suppression
      ]
      const replaced = await database.replaceSimilarityDerivedState({
        ...state.similarity,
        suppressions
      })
      if (replaced.state !== 'replaced') {
        setState({ status: 'error' })
        return
      }
      setSeparating(null)
      await load()
    } finally {
      setPending(false)
    }
  }, [database, load, separating, state])

  const hideSimilar = useCallback(
    async (input: {
      cluster: SimilarityDerivedState['clusters'][number]
      eligibleContentIds: string[]
      preservedContentIds: string[]
    }) => {
      if (state.status !== 'ready' || input.eligibleContentIds.length === 0) {
        return
      }
      setPending(true)
      try {
        const acceptedAt = new Date().toISOString()
        const action = similarityBatchActionSchema.parse({
          id: `similarity-batch:${await fingerprintPortableValue({
            clusterId: input.cluster.clusterId,
            eligibleContentIds: input.eligibleContentIds,
            acceptedAt
          })}`,
          clusterId: input.cluster.clusterId,
          action: 'hide',
          contentIds: input.eligibleContentIds,
          preservedContentIds: input.preservedContentIds,
          policyVersion: 'similarity-batch-policy-v1',
          acceptedAt,
          expiresAt: new Date(
            Date.parse(acceptedAt) + 30 * 24 * 60 * 60 * 1_000
          ).toISOString()
        })
        const replaced = await database.replaceSimilarityDerivedState({
          ...state.similarity,
          batchActions: [
            ...state.similarity.batchActions.filter(
              current => current.clusterId !== action.clusterId
            ),
            action
          ]
        })
        if (replaced.state !== 'replaced') {
          setState({ status: 'error' })
        }
      } finally {
        setPending(false)
      }
    },
    [database, state]
  )
  const closeSeparateReview = useCallback(() => setSeparating(null), [])

  if (state.status === 'loading') {
    return (
      <StatePanel
        description={copy.loadingDescription}
        eyebrow={copy.loadingEyebrow}
        state="loading"
        title={copy.loadingTitle}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <StatePanel
        description={copy.errorDescription}
        eyebrow={copy.errorEyebrow}
        primaryAction={
          <Button onClick={load} size="full">
            {copy.title}
          </Button>
        }
        state="error"
        title={copy.errorTitle}
      />
    )
  }
  if (state.status === 'empty') {
    return (
      <StatePanel
        description={copy.emptyDescription}
        eyebrow={copy.emptyEyebrow}
        state="empty"
        title={copy.emptyTitle}
      />
    )
  }

  const clusteredRelationIds = new Set<string>()
  const clustersWithRelations = state.similarity.clusters.map(cluster => {
    const contentIds = new Set(cluster.members.map(member => member.contentId))
    const relations = state.relations.filter(relation => {
      const matches =
        contentIds.has(relation.leftContentId) &&
        contentIds.has(relation.rightContentId)
      if (matches) {
        clusteredRelationIds.add(relation.relationId)
      }
      return matches
    })
    return { cluster, relations }
  })
  const standalone = state.relations.filter(
    relation => !clusteredRelationIds.has(relation.relationId)
  )

  return (
    <section aria-label={copy.title} className="similarity-review">
      <header className="similarity-review__heading">
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
      </header>
      <Surface tone="subtle">
        <div className="similarity-review__summary">
          <h3>{copy.summaryTitle}</h3>
          <DataList
            items={[
              {
                term: copy.relationsLabel(state.relations.length),
                description: copy.clustersLabel(
                  state.similarity.clusters.length
                )
              },
              {
                term: copy.graphNodesLabel(state.graphNodes),
                description: copy.graphEdgesLabel(state.graphEdges)
              }
            ]}
          />
        </div>
      </Surface>
      {clustersWithRelations.map(({ cluster, relations }) => (
        <ClusterReview
          cluster={cluster}
          copy={copy}
          disabled={pending}
          key={cluster.clusterId}
          onHideSimilar={hideSimilar}
          onSeparate={setSeparating}
          relations={relations}
        />
      ))}
      {standalone.map(relation => (
        <Surface key={relation.relationId}>
          <RelationEvidence
            copy={copy}
            disabled={pending}
            onSeparate={setSeparating}
            relation={relation}
          />
        </Surface>
      ))}
      {separating ? (
        <Dialog
          cancelRef={cancelRef}
          description={copy.separateDescription}
          onDismiss={closeSeparateReview}
          title={copy.separateTitle}
        >
          <div className="similarity-review__dialog-actions">
            <Button disabled={pending} onClick={separate}>
              {copy.separateConfirmAction}
            </Button>
            <Button
              disabled={pending}
              onClick={closeSeparateReview}
              ref={cancelRef}
              variant="secondary"
            >
              {copy.cancelAction}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  )
}
