import { describe, expect, it, vi } from 'vitest'

import {
  ASSISTANCE_DRAFT_SCHEMA_VERSION,
  ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
  AssistanceModelFailure,
  type AssistanceRuntimeProvenance,
  AssistanceService,
  ruleDraftProposalSchema
} from '@/ai/assistance'

const runtime: AssistanceRuntimeProvenance = {
  providerConfigId: 'provider:fixture',
  modelId: 'model:fixture',
  modelVersion: 'model@1',
  routeVersion: 'route@1',
  promptVersion: 'assistance-prompt@1',
  outputSchemaVersion: 'assistance-output@1',
  capabilityVersion: 'capability@1',
  executionKind: 'local',
  generatedAt: '2026-07-31T00:00:00.000Z'
}

const modelDraft = {
  schemaVersion: ASSISTANCE_DRAFT_SCHEMA_VERSION,
  rule: {
    effect: 'reduce',
    scope: {
      platforms: ['youtube'],
      surfaces: ['youtube:home']
    },
    description: 'Vídeos com manchetes sensacionalistas',
    examples: ['Você não vai acreditar'],
    exclusions: ['Comunicados oficiais'],
    threshold: 0.78
  },
  inferredFields: [
    {
      field: 'rule.description',
      confidence: 0.82,
      evidenceCodes: ['user-intent']
    }
  ],
  ambiguousFields: [],
  missingFields: []
}

describe('assistance contracts', () => {
  it('attaches trusted identity, revision and provenance locally', async () => {
    const provider = {
      generateDraft: vi.fn().mockResolvedValue(modelDraft),
      explain: vi.fn()
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'draft:trusted',
      fingerprint: async () => 'sha256:input'
    })

    const result = await service.generateDraft({
      request: {
        origin: 'natural-language',
        baseRevision: 12,
        platform: 'youtube',
        surface: 'youtube:home',
        intent: 'Reduza vídeos com manchetes sensacionalistas',
        trustedContext: {
          platforms: ['youtube'],
          surfaces: ['youtube:home']
        },
        allowedEvidenceCodes: ['user-intent']
      },
      runtime
    })

    expect(result).toMatchObject({
      state: 'draft-ready',
      proposal: {
        draftId: 'draft:trusted',
        baseRevision: 12,
        origin: 'natural-language',
        contextFields: [
          { field: 'rule.scope.platforms' },
          { field: 'rule.scope.surfaces' }
        ],
        provenance: {
          providerConfigId: 'provider:fixture',
          inputFingerprint: 'sha256:input',
          profileRevision: 12
        }
      }
    })
    expect(
      ruleDraftProposalSchema.parse(
        result.state === 'draft-ready' ? result.proposal : null
      )
    ).toBeDefined()
    expect(JSON.stringify(provider.generateDraft.mock.calls)).not.toContain(
      'provider:fixture'
    )
  })

  it('rejects action fields, unknown evidence and oversized intent', async () => {
    const provider = {
      generateDraft: vi
        .fn()
        .mockResolvedValueOnce({ ...modelDraft, save: true })
        .mockResolvedValueOnce({
          ...modelDraft,
          inferredFields: [
            {
              field: 'rule.description',
              confidence: 0.9,
              evidenceCodes: ['invented']
            }
          ]
        }),
      explain: vi.fn()
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'draft:fixture',
      fingerprint: async () => 'sha256:fixture'
    })
    const request = {
      origin: 'natural-language' as const,
      baseRevision: 1,
      platform: 'youtube' as const,
      surface: 'youtube:home' as const,
      intent: 'Reduza clickbait',
      trustedContext: {},
      allowedEvidenceCodes: ['user-intent']
    }

    await expect(service.generateDraft({ request, runtime })).resolves.toEqual({
      state: 'rejected',
      code: 'invalid-output',
      preservedIntent: request.intent
    })
    await expect(service.generateDraft({ request, runtime })).resolves.toEqual({
      state: 'rejected',
      code: 'invalid-output',
      preservedIntent: request.intent
    })
    await expect(
      service.generateDraft({
        request: { ...request, intent: 'a'.repeat(16 * 1024 + 1) },
        runtime
      })
    ).resolves.toMatchObject({
      state: 'rejected',
      code: 'input-too-large'
    })
    expect(provider.generateDraft).toHaveBeenCalledTimes(2)
  })

  it('marks scope expansion, effect escalation and protected removal locally', async () => {
    const provider = {
      generateDraft: vi.fn().mockResolvedValue({
        ...modelDraft,
        rule: {
          ...modelDraft.rule,
          effect: 'block',
          scope: { platforms: [], surfaces: [] },
          exclusions: []
        }
      }),
      explain: vi.fn()
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'draft:policy',
      fingerprint: async () => 'sha256:policy'
    })

    const result = await service.generateDraft({
      request: {
        origin: 'correction',
        baseRevision: 3,
        platform: 'youtube',
        surface: 'youtube:home',
        intent: 'Isso ficou amplo demais',
        trustedContext: {
          effect: 'reduce',
          platforms: ['youtube'],
          surfaces: ['youtube:home'],
          protectedExclusions: ['Comunicados oficiais']
        },
        allowedEvidenceCodes: ['user-intent']
      },
      runtime
    })

    expect(result).toMatchObject({
      state: 'review-required',
      proposal: {
        warnings: [
          'scope-expansion',
          'effect-escalation',
          'protected-exception'
        ]
      }
    })
  })

  it('keeps provider terminal states distinct and preserves the intent', async () => {
    const provider = {
      generateDraft: vi
        .fn()
        .mockRejectedValue(new AssistanceModelFailure('refused')),
      explain: vi.fn()
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'draft:fixture',
      fingerprint: async () => 'sha256:fixture'
    })

    await expect(
      service.generateDraft({
        request: {
          origin: 'natural-language',
          baseRevision: 1,
          platform: 'reddit',
          surface: 'reddit:home',
          intent: 'Reduza posts repetitivos',
          trustedContext: {},
          allowedEvidenceCodes: []
        },
        runtime
      })
    ).resolves.toEqual({
      state: 'rejected',
      code: 'refused',
      preservedIntent: 'Reduza posts repetitivos'
    })
  })

  it('requires three explicit corrections before a batch reaches the model', async () => {
    const provider = {
      generateDraft: vi.fn().mockResolvedValue(modelDraft),
      explain: vi.fn()
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'draft:batch',
      fingerprint: async () => 'sha256:batch'
    })

    await expect(
      service.generateDraft({
        request: {
          origin: 'batch',
          baseRevision: 2,
          platform: 'youtube',
          surface: 'youtube:home',
          intent: 'Agrupe estas correções',
          trustedContext: {},
          allowedEvidenceCodes: []
        },
        runtime
      })
    ).resolves.toMatchObject({
      state: 'rejected',
      code: 'invalid-input'
    })
    expect(provider.generateDraft).not.toHaveBeenCalled()
  })

  it('returns a read-only explanation without rule or action fields', async () => {
    const provider = {
      generateDraft: vi.fn(),
      explain: vi.fn().mockResolvedValue({
        schemaVersion: ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
        summary: 'A regra explícita de canal foi aplicada.',
        signalSources: [
          {
            sourceKind: 'deterministic-rule',
            sourceRef: 'rule:channel',
            evidenceCodes: ['rule-match']
          }
        ],
        appliedRuleRefs: ['rule:channel'],
        limitations: []
      })
    }
    const service = new AssistanceService({
      provider,
      createId: () => 'explanation:trusted',
      fingerprint: async () => 'sha256:explanation'
    })

    const result = await service.explain({
      request: {
        baseRevision: 9,
        platform: 'youtube',
        surface: 'youtube:home',
        contentId: 'youtube:item',
        decision: 'hide',
        evidenceCodes: ['rule-match'],
        appliedRuleRefs: ['rule:channel']
      },
      runtime
    })

    expect(result).toMatchObject({
      state: 'explanation-ready',
      explanation: {
        explanationId: 'explanation:trusted',
        baseRevision: 9
      }
    })
    expect(JSON.stringify(result)).not.toContain('"rule":')
    expect(JSON.stringify(result)).not.toContain('"effect":')
    expect(JSON.stringify(result)).not.toContain('"mutation":')
  })
})
