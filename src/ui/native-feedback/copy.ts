import { t } from '@/i18n/runtime'

export const getNativeFeedbackCopy = () => ({
  actionLabel: t('nativeFeedbackActionLabel'),
  cancelAction: t('nativeFeedbackCancelAction'),
  consequenceLabel: t('nativeFeedbackConsequenceLabel'),
  confirmAction: t('nativeFeedbackConfirmAction'),
  irreversible: t('nativeFeedbackIrreversible'),
  platformLabel: t('nativeFeedbackPlatformLabel'),
  reviewDescription: t('nativeFeedbackReviewDescription'),
  reviewTitle: t('nativeFeedbackReviewTitle'),
  scopeLabel: t('nativeFeedbackScopeLabel'),
  stateLabel: (state: string) =>
    ({
      'pending-review': t('nativeFeedbackStatePendingReview'),
      submitting: t('nativeFeedbackStateSubmitting'),
      submitted: t('nativeFeedbackStateSubmitted'),
      rejected: t('nativeFeedbackStateRejected'),
      unavailable: t('nativeFeedbackStateUnavailable'),
      uncertain: t('nativeFeedbackStateUncertain'),
      cancelled: t('nativeFeedbackStateCancelled'),
      cooldown: t('nativeFeedbackStateCooldown')
    })[state] ?? state,
  stateMessage: (state: string) =>
    ({
      'pending-review': t('nativeFeedbackMessagePendingReview'),
      submitting: t('nativeFeedbackMessageSubmitting'),
      submitted: t('nativeFeedbackMessageSubmitted'),
      rejected: t('nativeFeedbackMessageRejected'),
      unavailable: t('nativeFeedbackMessageUnavailable'),
      uncertain: t('nativeFeedbackMessageUncertain'),
      cancelled: t('nativeFeedbackMessageCancelled'),
      cooldown: t('nativeFeedbackMessageCooldown')
    })[state] ?? state
})

export type NativeFeedbackCopy = ReturnType<typeof getNativeFeedbackCopy>
