import { describe, expect, it } from 'vitest'

import { createNativeFeedbackDiagnostic } from '@/application/native-feedback/diagnostics'
import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'

describe('native feedback diagnostics', () => {
  it('contains only the finite redacted contract', () => {
    const attempt = {
      attemptId: 'attempt:secret',
      operationId: 'operation:secret',
      platform: 'youtube',
      surface: 'youtube:home',
      platformContentId: 'private-video-id',
      pageInstanceId: 'private-page-id',
      actionType: 'youtube:not-interested',
      targetFingerprint: 'private-target',
      adapterVersion: 'youtube@1',
      addendumVersion: 'native@1',
      state: 'submitted',
      review: {
        platform: 'youtube',
        surface: 'youtube:home',
        platformContentId: 'private-video-id',
        pageInstanceId: 'private-page-id',
        actionType: 'youtube:not-interested',
        actionLabel: 'Private visible label',
        scope: 'Private target text',
        consequence: 'Private consequence',
        reversibility: { kind: 'irreversible' },
        targetFingerprint: 'private-target',
        reviewedAt: '2026-07-31T12:00:00.000Z'
      },
      createdAt: '2026-07-31T12:00:00.000Z',
      updatedAt: '2026-07-31T12:00:00.000Z',
      latencyBucket: 'under-25ms',
      verificationMethod: 'visible-confirmation'
    } satisfies NativeFeedbackAttempt
    const diagnostic = createNativeFeedbackDiagnostic(attempt, 'closed')
    expect(Object.keys(diagnostic).sort()).toEqual([
      'actionType',
      'adapterVersion',
      'circuitState',
      'latencyBucket',
      'platform',
      'status',
      'surface',
      'verificationMethod'
    ])
    const serialized = JSON.stringify(diagnostic)
    for (const sensitive of [
      'attempt:secret',
      'operation:secret',
      'private-video-id',
      'private-page-id',
      'private-target',
      'Private visible label',
      'Private target text',
      'Private consequence'
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
  })
})
