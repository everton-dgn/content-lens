import { describe, expect, it } from 'vitest'

import {
  type ContentItem,
  contentItemSchema,
  MAX_CONTENT_BODY_LENGTH,
  MAX_CONTENT_CONTEXT_ENTRIES,
  MAX_CONTENT_CONTEXT_KEY_LENGTH,
  MAX_CONTENT_CONTEXT_STRING_LENGTH,
  MAX_CONTENT_TITLE_LENGTH
} from '@/core/content/contracts'
import { decisionSchema } from '@/core/decisions/contracts'
import {
  MAX_RULE_DESCRIPTION_BYTES,
  ruleSchema
} from '@/core/rules/contracts/rule'
import {
  MAX_FEEDBACK_EXAMPLES,
  MAX_PORTABLE_PROFILE_BYTES,
  MAX_PROFILE_DEPTH,
  MAX_RULES,
  type ProfileEnvelope,
  parseProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'

const timestamp = '2026-07-29T20:00:00.000Z'

const baseRule = {
  id: 'rule:1',
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: timestamp,
  updatedAt: timestamp
} as const

const exactRule = {
  ...baseRule,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'transfer gossip',
  caseSensitive: false
} as const

const profile = {
  schemaVersion: { major: 1, minor: 0 },
  profileId: 'profile:local',
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  rules: [exactRule],
  feedbackExamples: [
    {
      id: 'feedback:1',
      contentId: 'youtube:video:abc',
      action: 'correct-classification',
      correction: {
        topics: ['software-engineering'],
        desiredAction: 'show'
      },
      createdAt: timestamp
    }
  ],
  settings: {
    enabledPlatforms: ['youtube'],
    thresholds: { hide: 0.9 }
  },
  extensions: {
    'content-lens.example': { enabled: true }
  }
} as const

describe('core-contracts content', () => {
  it('accepts documented stable and ephemeral content identities', () => {
    const stable = contentItemSchema.parse({
      id: 'youtube:video:abc',
      platform: 'youtube',
      identity: {
        status: 'stable',
        platformContentId: 'abc'
      },
      canonicalUrl: 'https://www.youtube.com/watch',
      surface: 'youtube:home',
      title: 'A useful video',
      media: [
        {
          kind: 'thumbnail',
          url: 'https://www.youtube.com/thumbnail.jpg',
          width: 480,
          height: 360
        }
      ],
      observedAt: timestamp,
      context: {
        recommendationRank: 1,
        autoplay: false
      }
    }) satisfies ContentItem

    const ephemeral = contentItemSchema.safeParse({
      ...stable,
      id: 'youtube:page:session-1',
      identity: {
        status: 'ephemeral',
        pageInstanceId: 'session-1',
        reason: 'not-exposed'
      }
    })

    expect(ephemeral.success).toBe(true)
  })

  it('rejects invalid content without throwing or accepting unknown fields', () => {
    const result = contentItemSchema.safeParse({
      id: 'youtube:video:abc',
      platform: 'youtube',
      identity: {
        status: 'stable',
        platformContentId: 'abc'
      },
      canonicalUrl: 'javascript:alert(1)',
      surface: 'youtube:home',
      media: [],
      observedAt: 'not-a-timestamp',
      context: {},
      rawHtml: '<article>private platform markup</article>'
    })

    expect(result.success).toBe(false)
  })

  it.each([
    {
      field: 'title',
      value: 'x'.repeat(MAX_CONTENT_TITLE_LENGTH + 1)
    },
    {
      field: 'body',
      value: 'x'.repeat(MAX_CONTENT_BODY_LENGTH + 1)
    },
    {
      field: 'context',
      value: { ['x'.repeat(MAX_CONTENT_CONTEXT_KEY_LENGTH + 1)]: true }
    },
    {
      field: 'context',
      value: {
        oversized: 'x'.repeat(MAX_CONTENT_CONTEXT_STRING_LENGTH + 1)
      }
    },
    {
      field: 'context',
      value: Object.fromEntries(
        Array.from({ length: MAX_CONTENT_CONTEXT_ENTRIES + 1 }, (_, index) => [
          `key:${index}`,
          true
        ])
      )
    }
  ])('bounds untrusted content $field', ({ field, value }) => {
    const result = contentItemSchema.safeParse({
      id: 'youtube:video:bounded',
      platform: 'youtube',
      identity: {
        status: 'stable',
        platformContentId: 'bounded'
      },
      surface: 'youtube:home',
      media: [],
      observedAt: timestamp,
      context: {},
      [field]: value
    })

    expect(result.success).toBe(false)
  })
})

describe('core-contracts rules and decisions', () => {
  it('accepts every documented rule variant', () => {
    const rules = [
      {
        ...baseRule,
        kind: 'identity',
        effect: 'allow',
        platform: 'youtube',
        identityType: 'channel',
        identityId: 'channel:trusted'
      },
      exactRule,
      {
        ...baseRule,
        id: 'rule:semantic',
        kind: 'semantic',
        effect: 'reduce',
        description: 'Professional football transfer speculation',
        examples: ['Player linked to another club'],
        exclusions: ['Tactical analysis'],
        threshold: 0.8
      },
      {
        ...baseRule,
        id: 'rule:preference',
        kind: 'preference',
        target: 'topic',
        targetId: 'software-engineering',
        weight: 1.5
      }
    ]

    expect(rules.map(rule => ruleSchema.safeParse(rule).success)).toEqual([
      true,
      true,
      true,
      true
    ])
  })

  it('enforces semantic description bytes and normalized thresholds', () => {
    const oversizedDescription = 'á'.repeat(MAX_RULE_DESCRIPTION_BYTES / 2 + 1)
    const invalid = {
      ...baseRule,
      kind: 'semantic',
      effect: 'hide',
      description: oversizedDescription,
      examples: ['transfer rumour'],
      exclusions: [],
      threshold: 1.01
    }

    expect(new TextEncoder().encode(oversizedDescription)).toHaveLength(
      MAX_RULE_DESCRIPTION_BYTES + 2
    )
    expect(ruleSchema.safeParse(invalid).success).toBe(false)
  })

  it('validates decision scores, evidence, and timestamps', () => {
    expect(
      decisionSchema.safeParse({
        contentId: 'youtube:video:abc',
        action: 'hide',
        score: 0.75,
        confidence: 1,
        reasons: [
          {
            source: 'deterministic-rule',
            label: 'Blocked exact title',
            score: 1,
            ruleId: 'rule:1'
          }
        ],
        matchedRuleIds: ['rule:1'],
        decidedAt: timestamp,
        classifierVersion: 'deterministic@1',
        policyVersion: 'deterministic-policy@1',
        profileRevision: 1
      }).success
    ).toBe(true)

    expect(
      decisionSchema.safeParse({
        contentId: 'youtube:video:abc',
        action: 'hide',
        score: Number.POSITIVE_INFINITY,
        confidence: -0.01,
        reasons: [],
        matchedRuleIds: [],
        decidedAt: timestamp,
        classifierVersion: 'deterministic@1',
        policyVersion: 'deterministic-policy@1',
        profileRevision: 1
      }).success
    ).toBe(false)
  })
})

describe('core-contracts portable profile', () => {
  it('parses a valid profile and preserves JSON-safe extensions', () => {
    const parsed = parseProfileEnvelope(JSON.stringify(profile))

    expect(parsed).toEqual({
      success: true,
      data: profile
    })
    if (parsed.success) {
      const typedProfile = parsed.data satisfies ProfileEnvelope
      expect(typedProfile.extensions).toEqual(profile.extensions)
    }
  })

  it('rejects unknown schema majors and prohibited local-only fields', () => {
    expect(
      profileEnvelopeSchema.safeParse({
        ...profile,
        schemaVersion: { major: 2, minor: 0 }
      }).success
    ).toBe(false)

    expect(
      profileEnvelopeSchema.safeParse({
        ...profile,
        credentials: { present: true }
      }).success
    ).toBe(false)
  })

  it('enforces rule and feedback collection limits', () => {
    const tooManyRules = {
      ...profile,
      rules: Array.from({ length: MAX_RULES + 1 }, (_, index) => ({
        ...exactRule,
        id: `rule:${index}`
      }))
    }
    const tooManyFeedbackExamples = {
      ...profile,
      feedbackExamples: Array.from(
        { length: MAX_FEEDBACK_EXAMPLES + 1 },
        (_, index) => ({
          ...profile.feedbackExamples[0],
          id: `feedback:${index}`
        })
      )
    }

    expect(profileEnvelopeSchema.safeParse(tooManyRules).success).toBe(false)
    expect(
      profileEnvelopeSchema.safeParse(tooManyFeedbackExamples).success
    ).toBe(false)
  })

  it('fails open for invalid JSON, oversized payloads, and excessive depth', () => {
    expect(parseProfileEnvelope('{')).toMatchObject({
      success: false,
      code: 'invalid-json'
    })

    expect(
      parseProfileEnvelope(
        JSON.stringify({
          ...profile,
          settings: {
            padding: 'x'.repeat(MAX_PORTABLE_PROFILE_BYTES)
          }
        })
      )
    ).toMatchObject({
      success: false,
      code: 'payload-too-large'
    })

    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth <= MAX_PROFILE_DEPTH; depth += 1) {
      nested = { child: nested }
    }

    expect(
      parseProfileEnvelope({
        ...profile,
        settings: nested
      })
    ).toMatchObject({
      success: false,
      code: 'maximum-depth-exceeded'
    })
  })

  it('rejects non-finite portable values without throwing', () => {
    expect(() =>
      parseProfileEnvelope({
        ...profile,
        settings: {
          invalid: Number.NaN
        }
      })
    ).not.toThrow()
    expect(
      parseProfileEnvelope({
        ...profile,
        settings: {
          invalid: Number.NaN
        }
      })
    ).toMatchObject({
      success: false,
      code: 'invalid-profile'
    })
  })

  it('accepts shared acyclic values in structured profile input', () => {
    const shared = { hide: 0.9 }

    expect(
      parseProfileEnvelope({
        ...profile,
        settings: {
          primary: shared,
          fallback: shared
        }
      })
    ).toMatchObject({
      success: true
    })
  })

  it('fails early for an adversarial shared DAG', () => {
    let shared: Record<string, unknown> = { value: true }
    for (let level = 0; level < 18; level += 1) {
      shared = {
        left: shared,
        right: shared
      }
    }

    expect(
      parseProfileEnvelope({
        ...profile,
        settings: {
          shared
        }
      })
    ).toEqual({
      success: false,
      code: 'payload-too-large',
      issues: [`Profile exceeds ${MAX_PORTABLE_PROFILE_BYTES} UTF-8 bytes`]
    })
  })
})
