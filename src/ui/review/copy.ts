import { t } from '@/i18n/runtime'

export const getReviewPanelCopy = () => ({
  advisoryLabel: t('reviewAdvisoryLabel'),
  cancelAction: t('reviewCancelAction'),
  clustersLabel: (count: number) => t('reviewClustersLabel', String(count)),
  description: t('reviewDescription'),
  errorDescription: t('reviewErrorDescription'),
  errorEyebrow: t('reviewErrorEyebrow'),
  errorTitle: t('reviewErrorTitle'),
  emptyDescription: t('reviewEmptyDescription'),
  emptyEyebrow: t('reviewEmptyEyebrow'),
  emptyTitle: t('reviewEmptyTitle'),
  evidenceLabel: t('reviewEvidenceLabel'),
  hideSimilarAction: t('reviewHideSimilarAction'),
  hideSimilarConfirmAction: t('reviewHideSimilarConfirmAction'),
  hideSimilarDescription: (
    count: number,
    updates: number,
    protectedCount: number
  ) =>
    t('reviewHideSimilarDescription', [
      String(count),
      String(updates),
      String(protectedCount)
    ]),
  hideSimilarTitle: t('reviewHideSimilarTitle'),
  graphEdgesLabel: (count: number) => t('reviewGraphEdgesLabel', String(count)),
  graphNodesLabel: (count: number) => t('reviewGraphNodesLabel', String(count)),
  loadingDescription: t('reviewLoadingDescription'),
  loadingEyebrow: t('reviewLoadingEyebrow'),
  loadingTitle: t('reviewLoadingTitle'),
  preservedLabel: t('reviewPreservedLabel'),
  protectedLabel: t('reviewProtectedLabel'),
  relationLabel: (type: string) => {
    const labels = {
      'exact-duplicate': t('reviewRelationExactDuplicate'),
      'near-duplicate': t('reviewRelationNearDuplicate'),
      'related-distinct': t('reviewRelationRelatedDistinct'),
      'semantically-similar': t('reviewRelationSemanticallySimilar'),
      'story-update': t('reviewRelationStoryUpdate')
    } as const
    return labels[type as keyof typeof labels] ?? type
  },
  relationsLabel: (count: number) => t('reviewRelationsLabel', String(count)),
  representativeLabel: t('reviewRepresentativeLabel'),
  scoreLabel: (score: number) =>
    t('reviewScoreLabel', `${Math.round(score * 100)}%`),
  separateAction: t('reviewSeparateAction'),
  separateConfirmAction: t('reviewSeparateConfirmAction'),
  separateDescription: t('reviewSeparateDescription'),
  separateTitle: t('reviewSeparateTitle'),
  sponsoredLabel: t('reviewSponsoredLabel'),
  summaryTitle: t('reviewSummaryTitle'),
  title: t('reviewTitle'),
  updatesLabel: t('reviewUpdatesLabel')
})

export type ReviewPanelCopy = ReturnType<typeof getReviewPanelCopy>
