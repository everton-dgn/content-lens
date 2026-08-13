import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@/core/content/contracts'
import { decideFromSignals } from '@/core/decisions/policy'
import { emptyClassificationSignals } from '@/core/decisions/signals'

const at = '2026-07-31T00:00:00.000Z'

const item: ContentItem = {
  id: 'youtube:video:policy',
  platform: 'youtube',
  identity: { status: 'stable', platformContentId: 'policy' },
  surface: 'youtube:home',
  media: [],
  observedAt: at,
  context: {}
}

const signals = {
  ...emptyClassificationSignals({
    provenance: {
      sourceKind: 'text-model',
      sourceId: 'classifier:fixture',
      sourceVersion: '1',
      observedAt: at,
      inputFingerprint: 'sha256:fixture',
      scope: {
        platform: 'youtube',
        surface: 'youtube:home',
        contentId: item.id,
        task: 'classification-text'
      },
      confidence: 0.96,
      evidenceRefs: ['evidence:noise']
    },
    classifierVersion: 'classifier@1',
    modelVersion: 'model@1'
  }),
  quality: { noise: 0.96 },
  confidence: 0.96
}

describe('decision policy authority', () => {
  it('allows probabilistic hide only with an accepted exact threshold', () => {
    expect(
      decideFromSignals({
        item,
        signals,
        profile: {
          revision: 8,
          policyVersion: 'policy@1',
          reduceThreshold: 0.6,
          hideThresholds: [
            {
              capabilityVersion: 'classification-text@1',
              classifierVersion: 'classifier@1',
              platform: 'youtube',
              surface: 'youtube:home',
              language: '*',
              threshold: 0.9,
              accepted: true
            }
          ]
        },
        capabilityVersion: 'classification-text@1',
        decidedAt: at
      }).action
    ).toBe('hide')
  })

  it('prevents hide when calibration is absent and keeps policy as authority', () => {
    const decision = decideFromSignals({
      item,
      signals,
      profile: {
        revision: 8,
        policyVersion: 'policy@1',
        reduceThreshold: 0.6,
        hideThresholds: []
      },
      capabilityVersion: 'classification-text@1',
      decidedAt: at
    })

    expect(decision).toMatchObject({
      action: 'reduce',
      policyVersion: 'policy@1',
      profileRevision: 8,
      classifierVersion: 'classifier@1'
    })
    expect(JSON.stringify(signals)).not.toContain('"action"')
  })
})
