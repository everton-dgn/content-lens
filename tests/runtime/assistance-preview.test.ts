import { describe, expect, it } from 'vitest'

import type { RuleDraftProposal } from '@/ai/assistance'
import { previewAssistedRuleDraft } from '@/application/rule-management/draft-preview'
import type { ContentItem } from '@/core/content/contracts'
import type { Rule } from '@/core/rules/contracts/rule'

const at = '2026-07-31T00:00:00.000Z'
const item = (id: string, channelId: string): ContentItem => ({
  id,
  platform: 'youtube',
  surface: 'youtube:home',
  identity: { status: 'stable', platformContentId: id },
  title: id,
  channel: {
    platform: 'youtube',
    channelId,
    displayName: channelId
  },
  media: [],
  observedAt: at,
  context: {}
})

const draft: RuleDraftProposal = {
  schemaVersion: 'rule-draft-proposal@1',
  draftId: 'draft:clickbait',
  baseRevision: 12,
  origin: 'natural-language',
  rule: {
    effect: 'block',
    scope: {
      platforms: ['youtube'],
      surfaces: ['youtube:home']
    },
    description: 'Clickbait',
    examples: ['Você não vai acreditar'],
    exclusions: [],
    threshold: 0.8
  },
  contextFields: [],
  inferredFields: [],
  ambiguousFields: [],
  missingFields: [],
  warnings: [],
  provenance: {
    providerConfigId: 'provider:fixture',
    modelId: 'model:fixture',
    modelVersion: 'model@1',
    routeVersion: 'route@1',
    promptVersion: 'assistance-prompt@1',
    outputSchemaVersion: 'assistance-output@1',
    capabilityVersion: 'capability@1',
    executionKind: 'local',
    generatedAt: at,
    inputFingerprint: 'sha256:input',
    profileRevision: 12,
    platform: 'youtube',
    surface: 'youtube:home',
    contentId: 'item:match'
  }
}

const allowRule: Rule = {
  id: 'rule:allow-channel',
  kind: 'identity',
  enabled: true,
  effect: 'allow',
  platform: 'youtube',
  identityType: 'channel',
  identityId: 'protected',
  scope: {},
  createdAt: at,
  updatedAt: at
}

describe('assistance draft preview', () => {
  it('dry-runs without changing current rules and reports protected exceptions', () => {
    const currentRules = [allowRule]
    const result = previewAssistedRuleDraft({
      draft,
      currentRevision: 12,
      currentRules,
      currentContentId: 'item:match',
      items: [
        item('item:match', 'ordinary'),
        item('item:protected', 'protected')
      ],
      signalsByContentId: {
        'item:match': {
          semanticScores: { 'draft:clickbait': 0.95 }
        },
        'item:protected': {
          semanticScores: { 'draft:clickbait': 0.95 }
        }
      },
      at
    })

    expect(result).toMatchObject({
      state: 'preview-ready',
      baseRevision: 12,
      representativeMatches: [
        {
          contentId: 'item:match',
          before: 'show',
          after: 'hide'
        }
      ],
      protectedExceptions: [
        {
          contentId: 'item:protected',
          resolution: 'explicit-allow'
        }
      ]
    })
    expect(currentRules).toEqual([allowRule])
  })

  it('rejects stale profile revision and stale card identity', () => {
    expect(
      previewAssistedRuleDraft({
        draft,
        currentRevision: 13,
        currentRules: [],
        currentContentId: 'item:match',
        items: [],
        at
      })
    ).toEqual({
      state: 'stale',
      reason: 'profile-revision',
      expectedRevision: 12,
      currentRevision: 13
    })

    expect(
      previewAssistedRuleDraft({
        draft,
        currentRevision: 12,
        currentRules: [],
        currentContentId: 'item:other',
        items: [],
        at
      })
    ).toEqual({
      state: 'stale',
      reason: 'content-identity',
      expectedContentId: 'item:match',
      currentContentId: 'item:other'
    })
  })
})
