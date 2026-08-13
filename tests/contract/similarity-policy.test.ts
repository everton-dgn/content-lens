import { describe, expect, it } from 'vitest'

import { applySimilarityPolicy } from '@/application/similarity/policy'
import type { Decision } from '@/core/decisions/contracts'
import type { ContentSimilarityRelation } from '@/core/similarity/contracts'

const at = '2026-07-31T12:00:00.000Z'

const decision: Decision = {
  contentId: 'youtube:one',
  action: 'show',
  score: 0.5,
  confidence: 1,
  reasons: [],
  matchedRuleIds: [],
  decidedAt: at,
  classifierVersion: 'deterministic@1',
  policyVersion: 'deterministic@1',
  profileRevision: 1
}

function relation(
  overrides: Partial<ContentSimilarityRelation> = {}
): ContentSimilarityRelation {
  return {
    relationId: 'relation:one',
    leftContentId: 'youtube:one',
    rightContentId: 'youtube:two',
    type: 'exact-duplicate',
    score: 1,
    confidence: 1,
    threshold: 1,
    evidenceCodes: ['exact-content-fingerprint'],
    evidenceVersion: 'evidence-v1',
    relationPolicyVersion: 'relation-policy-v1',
    advisoryOnly: false,
    createdAt: at,
    validUntil: '2026-08-30T12:00:00.000Z',
    ...overrides
  }
}

const policy = {
  accepted: true,
  policyVersion: 'similarity-policy-v1',
  exactDuplicateAction: 'hide' as const,
  nearDuplicateAction: 'reduce' as const
}

describe('accepted similarity policy', () => {
  it('lets policy act on exact and near-duplicate signals only', () => {
    expect(
      applySimilarityPolicy({
        decision,
        resolution: 'default-show',
        relations: [relation()],
        policy,
        protectedException: false
      })
    ).toMatchObject({
      action: 'hide',
      confidence: 1,
      reasons: [{ source: 'adapter-observation', score: 1 }]
    })
    expect(
      applySimilarityPolicy({
        decision,
        resolution: 'default-show',
        relations: [
          relation({ type: 'story-update', score: 0.9, threshold: 0.84 })
        ],
        policy,
        protectedException: false
      }).action
    ).toBe('show')
  })

  it('preserves explicit allow, session reveal and protected exceptions', () => {
    for (const resolution of ['explicit-allow', 'session-reveal'] as const) {
      expect(
        applySimilarityPolicy({
          decision,
          resolution,
          relations: [relation()],
          policy,
          protectedException: false
        })
      ).toEqual(decision)
    }
    expect(
      applySimilarityPolicy({
        decision,
        resolution: 'default-show',
        relations: [relation()],
        policy,
        protectedException: true
      })
    ).toEqual(decision)
  })

  it('routes low-confidence duplicate signals to review', () => {
    expect(
      applySimilarityPolicy({
        decision,
        resolution: 'default-show',
        relations: [
          relation({
            type: 'near-duplicate',
            score: 0.97,
            confidence: 0.84,
            threshold: 0.96,
            advisoryOnly: true
          })
        ],
        policy,
        protectedException: false
      }).action
    ).toBe('review')
  })

  it('requires an explicitly accepted policy', () => {
    expect(
      applySimilarityPolicy({
        decision,
        resolution: 'default-show',
        relations: [relation()],
        policy: { ...policy, accepted: false },
        protectedException: false
      })
    ).toEqual(decision)
  })
})
