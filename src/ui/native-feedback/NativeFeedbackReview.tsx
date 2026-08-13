import type { MouseEvent } from 'react'
import { useCallback } from 'react'

import {
  issueTrustedUserGesture,
  type TrustedUserGesture
} from '@/application/native-feedback/gesture'
import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'
import { Badge, Button, DataList, Notice, Surface } from '@/ui/components'
import type { NativeFeedbackCopy } from '@/ui/native-feedback/copy'

export type NativeFeedbackReviewProps = {
  attempt: NativeFeedbackAttempt
  copy: NativeFeedbackCopy
  disabled?: boolean
  reviewFingerprint: string
  onCancel(attempt: NativeFeedbackAttempt): void
  onConfirm(attempt: NativeFeedbackAttempt, gesture: TrustedUserGesture): void
}

const stateTone = (state: NativeFeedbackAttempt['state']) =>
  state === 'submitted'
    ? ('success' as const)
    : state === 'rejected' || state === 'uncertain' || state === 'cooldown'
      ? ('degraded' as const)
      : ('neutral' as const)

export const NativeFeedbackReview = ({
  attempt,
  copy,
  disabled = false,
  reviewFingerprint,
  onCancel,
  onConfirm
}: NativeFeedbackReviewProps) => {
  const cancel = useCallback(() => onCancel(attempt), [attempt, onCancel])
  const confirm = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const gesture = issueTrustedUserGesture(event.nativeEvent, {
        attemptId: attempt.attemptId,
        reviewFingerprint,
        occurredAt: new Date().toISOString()
      })
      if (gesture) onConfirm(attempt, gesture)
    },
    [attempt, onConfirm, reviewFingerprint]
  )
  const pendingReview = attempt.state === 'pending-review'

  return (
    <Surface elevation="raised">
      <article
        aria-busy={attempt.state === 'submitting' ? 'true' : undefined}
        aria-label={copy.reviewTitle}
        className="native-feedback-review"
      >
        <header className="native-feedback-review__heading">
          <div>
            <h3>{copy.reviewTitle}</h3>
            <p>{copy.reviewDescription}</p>
          </div>
          <Badge tone={stateTone(attempt.state)}>
            {copy.stateLabel(attempt.state)}
          </Badge>
        </header>
        <DataList
          items={[
            {
              term: copy.platformLabel,
              description: `${attempt.platform} · ${attempt.surface}`
            },
            {
              term: copy.actionLabel,
              description: attempt.review.actionLabel
            },
            {
              term: copy.scopeLabel,
              description: attempt.review.scope
            },
            {
              term: copy.consequenceLabel,
              description: attempt.review.consequence
            }
          ]}
        />
        <Notice
          body={copy.stateMessage(attempt.state)}
          title={
            attempt.review.reversibility.kind === 'irreversible'
              ? copy.irreversible
              : copy.stateLabel(attempt.state)
          }
          tone={attempt.state === 'submitted' ? 'success' : 'degraded'}
        />
        {pendingReview ? (
          <div className="native-feedback-review__actions">
            <Button disabled={disabled} onClick={confirm}>
              {copy.confirmAction}
            </Button>
            <Button disabled={disabled} onClick={cancel} variant="secondary">
              {copy.cancelAction}
            </Button>
          </div>
        ) : null}
      </article>
    </Surface>
  )
}
