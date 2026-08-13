import type { ContentSimilarityRelation } from '@/core/similarity/contracts'
import { Badge, Button, DataList } from '@/ui/components'
import type { ReviewPanelCopy } from '@/ui/review/copy'

export type RelationEvidenceProps = {
  copy: ReviewPanelCopy
  disabled?: boolean
  onSeparate?(relation: ContentSimilarityRelation): void
  relation: ContentSimilarityRelation
}

export const RelationEvidence = ({
  copy,
  disabled = false,
  onSeparate,
  relation
}: RelationEvidenceProps) => {
  const handleSeparate = useCallback(() => {
    onSeparate?.(relation)
  }, [onSeparate, relation])
  return (
    <article className="similarity-relation" data-relation-type={relation.type}>
      <header className="similarity-relation__heading">
        <Badge tone={relation.advisoryOnly ? 'degraded' : 'info'}>
          {copy.relationLabel(relation.type)}
        </Badge>
        {relation.advisoryOnly ? (
          <Badge tone="degraded">{copy.advisoryLabel}</Badge>
        ) : null}
      </header>
      <DataList
        items={[
          {
            term: copy.scoreLabel(relation.score),
            description: `${relation.leftContentId} → ${relation.rightContentId}`
          },
          {
            term: copy.evidenceLabel,
            description: relation.evidenceCodes.join(', ')
          }
        ]}
      />
      {onSeparate ? (
        <Button
          disabled={disabled}
          onClick={handleSeparate}
          size="compact"
          variant="secondary"
        >
          {copy.separateAction}
        </Button>
      ) : null}
    </article>
  )
}

import { useCallback } from 'react'
