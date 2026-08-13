import { t } from '@/i18n/runtime'

export const getFeedPanelCopy = () => ({
  browserUnavailableBody: t('feedsBrowserUnavailableBody'),
  browserPortableNote: t('feedsBrowserPortableNote'),
  browserUnavailableTitle: t('feedsBrowserUnavailableTitle'),
  cancelAction: t('feedsCancelAction'),
  description: t('feedsDescription'),
  emptyBody: t('feedsEmptyBody'),
  emptyTitle: t('feedsEmptyTitle'),
  errorBody: t('feedsErrorBody'),
  errorTitle: t('feedsErrorTitle'),
  eyebrow: t('feedsEyebrow'),
  intervalSuffix: t('feedsIntervalSuffix'),
  pauseAction: t('feedsPauseAction'),
  pausedStatus: t('feedsPausedStatus'),
  removeAction: t('feedsRemoveAction'),
  removeReviewBody: t('feedsRemoveReviewBody'),
  removeReviewTitle: t('feedsRemoveReviewTitle'),
  resumeAction: t('feedsResumeAction'),
  statusFailed: t('feedsStatusFailed'),
  statusFetching: t('feedsStatusFetching'),
  statusIdle: t('feedsStatusIdle'),
  statusNotChecked: t('feedsStatusNotChecked'),
  statusReady: t('feedsStatusReady'),
  statusScheduled: t('feedsStatusScheduled'),
  statusUnavailable: t('feedsStatusUnavailable'),
  successBody: t('feedsSuccessBody'),
  successTitle: t('feedsSuccessTitle'),
  title: t('feedsTitle')
})

export type FeedPanelCopy = ReturnType<typeof getFeedPanelCopy>
