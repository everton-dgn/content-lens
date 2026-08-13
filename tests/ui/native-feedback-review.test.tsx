import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'
import type { NativeFeedbackCopy } from '@/ui/native-feedback/copy'
import { NativeFeedbackReview } from '@/ui/native-feedback/NativeFeedbackReview'

const copy: NativeFeedbackCopy = {
  actionLabel: 'Visible action',
  cancelAction: 'Keep local',
  consequenceLabel: 'Consequence',
  confirmAction: 'Confirm platform action',
  irreversible: 'No verified undo',
  platformLabel: 'Platform and surface',
  reviewDescription: 'Review exact scope',
  reviewTitle: 'Review platform feedback',
  scopeLabel: 'Scope',
  stateLabel: state => state,
  stateMessage: state => `Message ${state}`
}

const base: NativeFeedbackAttempt = {
  attemptId: 'attempt:1',
  operationId: 'operation:1',
  platform: 'linkedin',
  surface: 'linkedin:feed',
  platformContentId: 'post:1',
  pageInstanceId: 'page:1',
  actionType: 'linkedin:reduce-similar',
  targetFingerprint: 'target:1',
  adapterVersion: 'linkedin-test@1',
  addendumVersion: 'linkedin-native-test@1',
  state: 'pending-review',
  review: {
    platform: 'linkedin',
    surface: 'linkedin:feed',
    platformContentId: 'post:1',
    pageInstanceId: 'page:1',
    actionType: 'linkedin:reduce-similar',
    actionLabel: 'Show fewer posts like this',
    scope: 'this post',
    consequence: 'LinkedIn may show fewer similar posts',
    reversibility: { kind: 'irreversible' },
    targetFingerprint: 'target:1',
    reviewedAt: '2026-07-31T12:00:00.000Z'
  },
  createdAt: '2026-07-31T12:00:00.000Z',
  updatedAt: '2026-07-31T12:00:00.000Z'
}

describe('native feedback review UI', () => {
  it.each([
    'pending-review',
    'submitting',
    'submitted',
    'rejected',
    'unavailable',
    'uncertain',
    'cancelled',
    'cooldown'
  ] as const)('renders the %s state with review context', state => {
    const markup = renderToStaticMarkup(
      <NativeFeedbackReview
        attempt={{ ...base, state }}
        copy={copy}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        reviewFingerprint="review:1"
      />
    )
    expect(markup).toContain('Review platform feedback')
    expect(markup).toContain('Show fewer posts like this')
    expect(markup).toContain(`Message ${state}`)
    expect(markup.includes('Confirm platform action')).toBe(
      state === 'pending-review'
    )
  })
})
