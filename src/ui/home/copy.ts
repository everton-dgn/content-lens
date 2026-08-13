import { t } from '@/i18n/runtime'

export const getHomePanelCopy = () => ({
  activeRulesLabel: t('homeActiveRulesLabel'),
  description: t('homeDescription'),
  enabledPlatformsLabel: t('homeEnabledPlatformsLabel'),
  feedbackLabel: t('homeFeedbackLabel'),
  historyEmpty: t('homeHistoryEmpty'),
  historyTitle: t('homeHistoryTitle'),
  openRulesAction: t('homeOpenRulesAction'),
  overviewTitle: t('homeOverviewTitle'),
  profileRevisionLabel: t('homeProfileRevisionLabel'),
  statisticsTitle: t('homeStatisticsTitle'),
  title: t('homeTitle'),
  updatedLabel: t('homeUpdatedLabel')
})

export type HomePanelCopy = ReturnType<typeof getHomePanelCopy>
