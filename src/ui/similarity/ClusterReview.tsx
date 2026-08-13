import { useCallback, useRef, useState } from 'react'

import { clusterReviewSummary } from '@/ai/similarity/cluster'
import type {
  ContentSimilarityRelation,
  SimilarityCluster
} from '@/core/similarity/contracts'
import { Button, DataList, Dialog, Surface } from '@/ui/components'
import type { ReviewPanelCopy } from '@/ui/review/copy'
import { RelationEvidence } from '@/ui/similarity/RelationEvidence'

export type ClusterReviewProps = {
  cluster: SimilarityCluster
  copy: ReviewPanelCopy
  disabled?: boolean
  onHideSimilar(input: {
    cluster: SimilarityCluster
    eligibleContentIds: string[]
    preservedContentIds: string[]
  }): void
  onSeparate(relation: ContentSimilarityRelation): void
  relations: readonly ContentSimilarityRelation[]
}

export const ClusterReview = ({
  cluster,
  copy,
  disabled = false,
  onHideSimilar,
  onSeparate,
  relations
}: ClusterReviewProps) => {
  const [reviewingBatch, setReviewingBatch] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const summary = clusterReviewSummary(cluster)
  const preservedContentIds = cluster.members
    .filter(
      member =>
        member.contentId === cluster.representativeContentId ||
        member.protected ||
        member.update
    )
    .map(member => member.contentId)
  const preserved = new Set(preservedContentIds)
  const eligibleContentIds = cluster.members
    .filter(member => !preserved.has(member.contentId))
    .map(member => member.contentId)
  const openBatchReview = useCallback(() => setReviewingBatch(true), [])
  const closeBatchReview = useCallback(() => setReviewingBatch(false), [])
  const confirmBatch = useCallback(() => {
    onHideSimilar({ cluster, eligibleContentIds, preservedContentIds })
    setReviewingBatch(false)
  }, [cluster, eligibleContentIds, onHideSimilar, preservedContentIds])

  return (
    <Surface elevation="raised">
      <div className="similarity-cluster">
        <DataList
          items={[
            {
              term: copy.representativeLabel,
              description: cluster.representativeContentId
            },
            {
              term: copy.preservedLabel,
              description: preservedContentIds.join(', ')
            },
            {
              term: copy.protectedLabel,
              description: String(summary.protectedCount)
            },
            {
              term: copy.updatesLabel,
              description: String(summary.updateCount)
            },
            {
              term: copy.sponsoredLabel,
              description: String(summary.sponsoredCount)
            }
          ]}
        />
        <div className="similarity-cluster__relations">
          {relations.map(relation => (
            <RelationEvidence
              copy={copy}
              disabled={disabled}
              key={relation.relationId}
              onSeparate={onSeparate}
              relation={relation}
            />
          ))}
        </div>
        {eligibleContentIds.length > 0 ? (
          <Button
            disabled={disabled}
            onClick={openBatchReview}
            size="full"
            variant="secondary"
          >
            {copy.hideSimilarAction}
          </Button>
        ) : null}
        {reviewingBatch ? (
          <Dialog
            cancelRef={cancelRef}
            description={copy.hideSimilarDescription(
              cluster.members.length,
              summary.updateCount,
              summary.protectedCount
            )}
            onDismiss={closeBatchReview}
            title={copy.hideSimilarTitle}
          >
            <div className="similarity-review__dialog-actions">
              <Button onClick={confirmBatch}>
                {copy.hideSimilarConfirmAction}
              </Button>
              <Button
                onClick={closeBatchReview}
                ref={cancelRef}
                variant="secondary"
              >
                {copy.cancelAction}
              </Button>
            </div>
          </Dialog>
        ) : null}
      </div>
    </Surface>
  )
}
