import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@/core/content/contracts'
import type {
  ExactRule,
  IdentityRule,
  PreferenceRule,
  Rule,
  SemanticRule
} from '@/core/rules/contracts/rule'
import {
  buildRuleIndex,
  dryRunRuleChanges,
  evaluateRules,
  preferenceSignalKey,
  type RuleEvaluationInput,
  type RuleSignals
} from '@/core/rules/engine'

const timestamp = '2026-07-29T21:00:00.000Z'

const item: ContentItem = {
  id: 'youtube:video:abc',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'abc'
  },
  canonicalUrl: 'https://www.youtube.com/watch',
  surface: 'youtube:home',
  title: 'Transfer gossip',
  body: 'A player was linked to another club.',
  author: {
    platform: 'youtube',
    authorId: 'author:1',
    displayName: 'Reporter'
  },
  channel: {
    platform: 'youtube',
    channelId: 'channel:1',
    displayName: 'Sports channel'
  },
  media: [],
  observedAt: timestamp,
  context: {}
}

const baseRule: Pick<
  IdentityRule,
  'enabled' | 'scope' | 'createdAt' | 'updatedAt'
> = {
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: timestamp,
  updatedAt: timestamp
}

const identityAllow: IdentityRule = {
  ...baseRule,
  id: 'allow:identity',
  kind: 'identity',
  effect: 'allow',
  platform: 'youtube',
  identityType: 'channel',
  identityId: 'channel:1'
}

const exactAllow: ExactRule = {
  ...baseRule,
  id: 'allow:exact',
  kind: 'exact',
  effect: 'allow',
  field: 'title',
  value: 'Transfer gossip',
  caseSensitive: false
}

const identityBlock: IdentityRule = {
  ...baseRule,
  id: 'block:identity',
  kind: 'identity',
  effect: 'block',
  platform: 'youtube',
  identityType: 'channel',
  identityId: 'channel:1'
}

const exactBlock: ExactRule = {
  ...baseRule,
  id: 'block:exact',
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'Transfer gossip',
  caseSensitive: false
}

const semanticReduce: SemanticRule = {
  ...baseRule,
  id: 'semantic:reduce',
  kind: 'semantic',
  effect: 'reduce',
  description: 'Transfer speculation',
  examples: ['Player linked to club'],
  exclusions: ['Tactical analysis'],
  threshold: 0.8
}

const semanticAllow: SemanticRule = {
  ...semanticReduce,
  id: 'semantic:allow',
  effect: 'allow'
}

const preferencePromote: PreferenceRule = {
  ...baseRule,
  id: 'preference:promote',
  kind: 'preference',
  target: 'topic',
  targetId: 'football',
  weight: 1
}

type PrecedenceCase = {
  name: string
  rules: Rule[]
  options?: Partial<RuleEvaluationInput>
  action: 'show' | 'promote' | 'reduce' | 'hide' | 'review'
  resolution:
    | 'session-reveal'
    | 'explicit-allow'
    | 'identity'
    | 'exact'
    | 'semantic'
    | 'preference'
    | 'default-show'
}

const precedenceCases: PrecedenceCase[] = [
  {
    name: 'session reveal',
    rules: [],
    options: {
      sessionRevealedContentIds: new Set([item.id])
    },
    action: 'show',
    resolution: 'session-reveal'
  },
  {
    name: 'explicit allow',
    rules: [exactAllow],
    action: 'show',
    resolution: 'explicit-allow'
  },
  {
    name: 'identity block',
    rules: [identityBlock],
    action: 'hide',
    resolution: 'identity'
  },
  {
    name: 'exact block',
    rules: [exactBlock],
    action: 'hide',
    resolution: 'exact'
  },
  {
    name: 'semantic rule',
    rules: [semanticReduce],
    options: {
      signals: {
        semanticScores: { [semanticReduce.id]: 0.9 }
      }
    },
    action: 'reduce',
    resolution: 'semantic'
  },
  {
    name: 'preference',
    rules: [preferencePromote],
    options: {
      signals: {
        preferenceScores: {
          [preferenceSignalKey('topic', 'football')]: 1
        }
      }
    },
    action: 'promote',
    resolution: 'preference'
  },
  {
    name: 'default show',
    rules: [],
    action: 'show',
    resolution: 'default-show'
  }
]

function mergeCases(
  higher: PrecedenceCase,
  lower: PrecedenceCase
): RuleEvaluationInput {
  return {
    item,
    index: buildRuleIndex([...higher.rules, ...lower.rules]).index,
    profileRevision: 7,
    sessionRevealedContentIds:
      higher.options?.sessionRevealedContentIds ??
      lower.options?.sessionRevealedContentIds,
    signals: {
      semanticScores: {
        ...lower.options?.signals?.semanticScores,
        ...higher.options?.signals?.semanticScores
      },
      preferenceScores: {
        ...lower.options?.signals?.preferenceScores,
        ...higher.options?.signals?.preferenceScores
      }
    }
  }
}

describe('rules precedence', () => {
  for (
    let higherIndex = 0;
    higherIndex < precedenceCases.length;
    higherIndex += 1
  ) {
    for (
      let lowerIndex = higherIndex + 1;
      lowerIndex < precedenceCases.length;
      lowerIndex += 1
    ) {
      const higher = precedenceCases[higherIndex]
      const lower = precedenceCases[lowerIndex]
      if (!higher || !lower) {
        throw new Error('Precedence fixture is incomplete')
      }

      it(`${higher.name} overrides ${lower.name}`, () => {
        const result = evaluateRules(mergeCases(higher, lower))

        expect(result.decision.action).toBe(higher.action)
        expect(result.resolution).toBe(higher.resolution)
      })
    }
  }

  it.each([identityAllow, exactAllow])(
    '$id overrides identity and exact blocks in the same scope',
    allowRule => {
      const result = evaluateRules({
        item,
        index: buildRuleIndex([identityBlock, exactBlock, allowRule]).index,
        profileRevision: 1
      })

      expect(result.decision.action).toBe('show')
      expect(result.resolution).toBe('explicit-allow')
      expect(result.decision.matchedRuleIds).toContain(allowRule.id)
    }
  )

  it('keeps semantic allow below identity and exact blocks', () => {
    const result = evaluateRules({
      item,
      index: buildRuleIndex([identityBlock, exactBlock, semanticAllow]).index,
      profileRevision: 1,
      signals: {
        semanticScores: {
          [semanticAllow.id]: 0.9
        }
      }
    })

    expect(result.decision.action).toBe('hide')
    expect(result.resolution).toBe('identity')
    expect(result.decision.matchedRuleIds).toEqual([identityBlock.id])
  })
})

describe('rules scope and matching', () => {
  it.each([
    {
      name: 'omitted scope',
      scope: {},
      expected: 'hide'
    },
    {
      name: 'empty scope',
      scope: { platforms: [], surfaces: [] },
      expected: 'hide'
    },
    {
      name: 'matching platform and surface',
      scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
      expected: 'hide'
    },
    {
      name: 'different platform',
      scope: { platforms: ['reddit'], surfaces: ['youtube:home'] },
      expected: 'show'
    },
    {
      name: 'different surface',
      scope: { platforms: ['youtube'], surfaces: ['youtube:search'] },
      expected: 'show'
    }
  ] as const)('$name', ({ scope, expected }) => {
    const result = evaluateRules({
      item,
      index: buildRuleIndex([{ ...exactBlock, scope }]).index,
      profileRevision: 1
    })

    expect(result.decision.action).toBe(expected)
  })

  it('uses stable IDs and exact case handling instead of display names', () => {
    const displayNameRule: IdentityRule = {
      ...identityBlock,
      id: 'identity:display-name',
      identityId: item.channel?.displayName ?? ''
    }
    const caseSensitiveRule: ExactRule = {
      ...exactBlock,
      id: 'exact:case-sensitive',
      value: 'transfer gossip',
      caseSensitive: true
    }

    const result = evaluateRules({
      item,
      index: buildRuleIndex([displayNameRule, caseSensitiveRule]).index,
      profileRevision: 1
    })

    expect(result.decision.action).toBe('show')
  })
})

describe('rules deterministic index and fail-open behavior', () => {
  it('returns the same decision for every serialization order', () => {
    const rules = [
      exactBlock,
      semanticReduce,
      preferencePromote,
      identityBlock,
      exactAllow
    ]
    const options = {
      item,
      profileRevision: 3,
      signals: {
        semanticScores: { [semanticReduce.id]: 0.95 },
        preferenceScores: {
          [preferenceSignalKey('topic', 'football')]: 1
        }
      }
    }

    const forward = evaluateRules({
      ...options,
      index: buildRuleIndex(rules).index
    })
    const reverse = evaluateRules({
      ...options,
      index: buildRuleIndex([...rules].reverse()).index
    })

    expect(reverse).toEqual(forward)
  })

  it('orders distinct Unicode rule IDs independently of input order', () => {
    const softHyphen: IdentityRule = {
      ...identityBlock,
      id: 'a\u00adb',
      effect: 'promote'
    }
    const plain: IdentityRule = {
      ...identityBlock,
      id: 'ab'
    }
    const options = {
      item,
      profileRevision: 1
    }
    const forward = evaluateRules({
      ...options,
      index: buildRuleIndex([softHyphen, plain]).index
    })
    const reverse = evaluateRules({
      ...options,
      index: buildRuleIndex([plain, softHyphen]).index
    })

    expect(reverse).toEqual(forward)
    expect(forward.decision.matchedRuleIds).toEqual(['ab', 'a\u00adb'])
  })

  it('fails open when an unvalidated item contains an invalid canonical URL', () => {
    const domainRule: ExactRule = {
      ...exactBlock,
      id: 'exact:domain',
      field: 'domain',
      value: 'example.com'
    }

    expect(
      evaluateRules({
        item: {
          ...item,
          canonicalUrl: 'not a URL'
        },
        index: buildRuleIndex([domainRule]).index,
        profileRevision: 1
      }).decision.action
    ).toBe('show')
  })

  it('keeps indexed rules immutable when returning matched rules', () => {
    const indexed = buildRuleIndex([identityBlock]).index
    const first = evaluateRules({
      item,
      index: indexed,
      profileRevision: 1
    })

    expect(Object.isFrozen(first.matchedRules[0])).toBe(true)
    expect(Object.isFrozen(first.matchedRules[0]?.scope)).toBe(true)
    expect(
      evaluateRules({
        item,
        index: indexed,
        profileRevision: 1
      })
    ).toEqual(first)
  })

  it('quarantines invalid, deleted, and duplicate rules without hiding content', () => {
    const invalidRules: unknown[] = [
      {
        ...identityBlock,
        id: ''
      },
      {
        ...exactBlock,
        id: 'deleted:1',
        deletedAt: timestamp
      },
      {
        ...exactBlock,
        id: 'duplicate:1',
        effect: 'block'
      },
      {
        ...exactAllow,
        id: 'duplicate:1'
      }
    ]
    const built = buildRuleIndex(invalidRules)

    expect(built.quarantined).toHaveLength(4)
    expect(built.index.ruleIds).toEqual([])
    expect(
      evaluateRules({
        item,
        index: built.index,
        profileRevision: 1
      }).decision.action
    ).toBe('show')
  })

  it('ignores disabled rules for generated inputs', () => {
    for (let index = 0; index < 100; index += 1) {
      const disabledRule: ExactRule = {
        ...exactBlock,
        id: `disabled:${index}`,
        enabled: false,
        value: index % 2 === 0 ? (item.title ?? '') : 'unrelated'
      }

      expect(
        evaluateRules({
          item,
          index: buildRuleIndex([disabledRule]).index,
          profileRevision: index
        }).decision.action
      ).toBe('show')
    }
  })

  it('never lets generated model actions override an explicit allow', () => {
    const modelActions = [
      'show',
      'promote',
      'reduce',
      'hide',
      'review'
    ] as const

    for (let index = 0; index < 100; index += 1) {
      const action = modelActions[index % modelActions.length]
      if (!action) {
        throw new Error('Model action fixture is incomplete')
      }

      const result = evaluateRules({
        item,
        index: buildRuleIndex([identityAllow]).index,
        profileRevision: index,
        signals: {
          model: {
            action,
            score: index / 100,
            confidence: 1
          }
        } as unknown as RuleSignals
      })

      expect(result.decision.action).toBe('show')
      expect(result.resolution).toBe('explicit-allow')
    }
  })

  it('fails open for invalid model and preference signals', () => {
    const result = evaluateRules({
      item,
      index: buildRuleIndex([preferencePromote]).index,
      profileRevision: 1,
      signals: {
        preferenceScores: {
          [preferenceSignalKey('topic', 'football')]: Number.POSITIVE_INFINITY
        },
        model: {
          action: 'invalid' as 'hide',
          score: 2,
          confidence: Number.NaN
        }
      } as unknown as RuleSignals
    })

    expect(result.decision.action).toBe('show')
    expect(result.resolution).toBe('default-show')
  })
})

describe('rules conflicts and dry-run', () => {
  it('returns review with stable IDs for conflicting rules at one precedence', () => {
    const promote: IdentityRule = {
      ...identityBlock,
      id: 'identity:promote',
      effect: 'promote'
    }
    const block: IdentityRule = {
      ...identityBlock,
      id: 'identity:block'
    }

    const result = evaluateRules({
      item,
      index: buildRuleIndex([promote, block]).index,
      profileRevision: 1
    })

    expect(result.decision.action).toBe('review')
    expect(result.conflict).toEqual({
      ruleIds: ['identity:block', 'identity:promote'],
      actions: ['hide', 'promote'],
      resolutionAction: 'review-rules'
    })
  })

  it('reports dry-run changes without mutating the current index', () => {
    const current = buildRuleIndex([]).index
    const before = evaluateRules({
      item,
      index: current,
      profileRevision: 1
    })

    const report = dryRunRuleChanges({
      currentIndex: current,
      candidateRules: [exactBlock],
      items: [item],
      currentProfileRevision: 1,
      candidateProfileRevision: 2
    })

    const after = evaluateRules({
      item,
      index: current,
      profileRevision: 1
    })

    expect(report).toMatchObject({
      dryRun: true,
      changes: [
        {
          contentId: item.id,
          before: 'show',
          after: 'hide'
        }
      ]
    })
    expect(after).toEqual(before)
    expect(current.ruleIds).toEqual([])
  })
})
