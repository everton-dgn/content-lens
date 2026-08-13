import { describe, expect, it, vi } from 'vitest'

import type { DecisionWorkInput } from '@/application/decision-pipeline/contracts'
import type { ScheduleResult } from '@/application/decision-pipeline/scheduler'
import { DecisionScheduler } from '@/application/decision-pipeline/scheduler'
import { DecisionRequestService } from '@/application/decision-pipeline/service'
import type { TextStage } from '@/application/decision-pipeline/text-stage'
import type { VisualStage } from '@/application/decision-pipeline/visual-stage'
import type { DecisionRequestMessage } from '@/application/messages/contracts'
import { emptyClassificationSignals } from '@/core/decisions/signals'
import { createDefaultSettings } from '@/core/settings'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'

const timestamp = '2026-07-29T22:40:00.000Z'
const message: DecisionRequestMessage = {
  namespace: 'contentlens.runtime.v1',
  version: 1,
  type: 'decision.request',
  platform: 'youtube',
  requestId: 'request:decision-service',
  pageInstanceId: 'page:decision-service',
  item: {
    id: 'youtube:video:decision01',
    platform: 'youtube',
    identity: {
      status: 'stable',
      platformContentId: 'decision01'
    },
    surface: 'youtube:home',
    title: 'Blocked title',
    media: [],
    observedAt: timestamp,
    context: {}
  }
}

type DecisionDatabase = Pick<
  ContentLensDatabase,
  'readActiveProfile' | 'recordObservations'
> &
  Partial<Pick<ContentLensDatabase, 'findActiveSimilarityBatchAction'>>

function database(
  activeProfile: unknown,
  recordResult:
    | {
        state: 'recorded'
        count: number
        persisted: { content: number; decisions: number }
      }
    | { state: 'invalid' } = {
    state: 'recorded',
    count: 1,
    persisted: { content: 1, decisions: 1 }
  }
): DecisionDatabase {
  return {
    readActiveProfile: vi.fn(async () => activeProfile),
    recordObservations: vi.fn(async () => recordResult)
  }
}

function quietScheduler(
  state: 'cancelled' | 'shed' | 'skipped'
): Pick<DecisionScheduler, 'schedule'> {
  return {
    schedule: <Value>(
      _input: DecisionWorkInput<Value>
    ): ScheduleResult<Value> => {
      if (state === 'skipped') {
        return { state, reason: 'circuit-open' }
      }
      return {
        state: 'scheduled',
        completion: Promise.resolve(
          state === 'cancelled'
            ? { state, committedEffects: [] }
            : { state, reason: 'overload', attempts: 0 }
        )
      }
    }
  }
}

function textSignals(
  semanticRuleMatches: Array<{
    ruleId: string
    score: number
    evidenceRefs: string[]
  }>
) {
  const empty = emptyClassificationSignals({
    provenance: {
      sourceKind: 'text-model',
      sourceId: 'provider:model',
      sourceVersion: 'model@1',
      observedAt: timestamp,
      inputFingerprint: 'sha256:text-stage-fixture',
      scope: {
        platform: 'youtube',
        surface: 'youtube:home',
        contentId: message.item.id,
        task: 'classification-text'
      },
      evidenceRefs: []
    },
    classifierVersion: 'text-classifier@1',
    modelVersion: 'model@1'
  })
  return { ...empty, semanticRuleMatches }
}

function visualSignals(
  semanticRuleMatches: Array<{
    ruleId: string
    score: number
    evidenceRefs: string[]
  }>
) {
  const empty = emptyClassificationSignals({
    provenance: {
      sourceKind: 'vision-model',
      sourceId: 'provider:vision-model',
      sourceVersion: 'vision-model@1',
      observedAt: timestamp,
      inputFingerprint: 'sha256:visual-stage-fixture',
      scope: {
        platform: 'youtube',
        surface: 'youtube:home',
        contentId: message.item.id,
        task: 'classification-vision'
      },
      evidenceRefs: []
    },
    classifierVersion: 'vision-classifier@1',
    modelVersion: 'vision-model@1'
  })
  return { ...empty, semanticRuleMatches }
}

describe('decision request service', () => {
  it('does no work for a disabled platform or surface', async () => {
    const settings = createDefaultSettings()
    settings.platforms.youtube.state = 'disabled'
    const store = database({
      schemaVersion: { major: 1, minor: 0 },
      profileId: 'profile:disabled-platform',
      revision: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
      rules: [],
      feedbackExamples: [],
      settings: {
        platforms: settings.platforms
      }
    })
    const classify = vi.fn<TextStage['classify']>()
    const service = new DecisionRequestService({
      database: store,
      textStage: { version: 'text-stage@1', classify }
    })

    await expect(service.decide(message)).resolves.toBeUndefined()
    expect(classify).not.toHaveBeenCalled()
    expect(store.recordObservations).not.toHaveBeenCalled()

    settings.platforms.youtube.state = 'enabled'
    settings.platforms.youtube.surfaces['youtube:home'] = false
    const surfaceStore = database({
      schemaVersion: { major: 1, minor: 0 },
      profileId: 'profile:disabled-surface',
      revision: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      rules: [],
      feedbackExamples: [],
      settings: {
        platforms: settings.platforms
      }
    })
    const surfaceService = new DecisionRequestService({
      database: surfaceStore,
      textStage: { version: 'text-stage@1', classify }
    })

    await expect(surfaceService.decide(message)).resolves.toBeUndefined()
    expect(surfaceStore.recordObservations).not.toHaveBeenCalled()
  })

  it('evaluates a readable deterministic profile and records the decision', async () => {
    const store = database({
      schemaVersion: { major: 1, minor: 0 },
      profileId: 'profile:runtime',
      revision: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
      rules: [
        {
          id: 'rule:block-title',
          enabled: true,
          scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
          createdAt: timestamp,
          updatedAt: timestamp,
          kind: 'exact',
          effect: 'block',
          field: 'title',
          value: 'Blocked title',
          caseSensitive: true
        }
      ],
      feedbackExamples: [],
      settings: {}
    })
    const service = new DecisionRequestService({
      database: store,
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toEqual({
      action: 'hide',
      profileRevision: 4,
      reasonCode: 'deterministic-rule'
    })
    expect(store.recordObservations).toHaveBeenCalledOnce()
  })

  it('uses the visible baseline when no profile exists', async () => {
    const service = new DecisionRequestService({
      database: database(undefined),
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toEqual({
      action: 'show',
      profileRevision: 0,
      reasonCode: 'default-show'
    })
  })

  it('applies a confirmed local Hide similar policy only after deterministic fallthrough', async () => {
    const store = {
      ...database(undefined),
      findActiveSimilarityBatchAction: vi.fn(async () => ({
        id: 'similarity-batch:one',
        clusterId: 'cluster:one',
        action: 'hide' as const,
        contentIds: [message.item.id],
        preservedContentIds: ['youtube:video:representative'],
        policyVersion: 'similarity-batch-policy-v1',
        acceptedAt: timestamp,
        expiresAt: '2026-08-29T22:40:00.000Z'
      }))
    }
    const service = new DecisionRequestService({
      database: store,
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toMatchObject({
      action: 'hide',
      profileRevision: 0,
      reasonCode: 'similarity-policy'
    })
    expect(store.recordObservations).toHaveBeenCalledWith([
      expect.objectContaining({
        decision: expect.objectContaining({
          action: 'hide',
          reasons: [expect.objectContaining({ source: 'user-feedback' })]
        })
      })
    ])
  })

  it('skips text classification when an exact rule already resolves the item', async () => {
    const classify = vi.fn<TextStage['classify']>()
    const classifyVisual = vi.fn<VisualStage['classify']>()
    const service = new DecisionRequestService({
      database: database({
        schemaVersion: { major: 1, minor: 0 },
        profileId: 'profile:deterministic-first',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        rules: [
          {
            id: 'rule:block-title',
            enabled: true,
            scope: {},
            createdAt: timestamp,
            updatedAt: timestamp,
            kind: 'exact',
            effect: 'block',
            field: 'title',
            value: 'Blocked title',
            caseSensitive: true
          }
        ],
        feedbackExamples: [],
        settings: {}
      }),
      textStage: { version: 'text-stage@1', classify },
      visualStage: {
        version: 'visual-stage@1',
        classify: classifyVisual
      },
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toMatchObject({
      action: 'hide',
      reasonCode: 'deterministic-rule'
    })
    expect(classify).not.toHaveBeenCalled()
    expect(classifyVisual).not.toHaveBeenCalled()
  })

  it('lets policy apply semantic signals only after deterministic fallthrough', async () => {
    const classify = vi.fn<TextStage['classify']>(async () => ({
      state: 'signals',
      signals: textSignals([
        {
          ruleId: 'rule:semantic-low-signal',
          score: 0.92,
          evidenceRefs: []
        }
      ])
    }))
    const service = new DecisionRequestService({
      database: database({
        schemaVersion: { major: 1, minor: 0 },
        profileId: 'profile:text-stage',
        revision: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        rules: [
          {
            id: 'rule:semantic-low-signal',
            enabled: true,
            scope: {},
            createdAt: timestamp,
            updatedAt: timestamp,
            kind: 'semantic',
            effect: 'block',
            description: 'Block shallow summaries.',
            examples: [],
            exclusions: [],
            threshold: 0.8
          }
        ],
        feedbackExamples: [],
        settings: {}
      }),
      textStage: { version: 'text-stage@1', classify },
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toEqual({
      action: 'hide',
      profileRevision: 2,
      reasonCode: 'model-policy'
    })
    expect(classify).toHaveBeenCalledOnce()
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        item: message.item,
        pageInstanceId: message.pageInstanceId,
        profileRevision: 2
      })
    )
  })

  it('keeps the visible baseline when the text stage abstains', async () => {
    const classify = vi.fn<TextStage['classify']>(async () => ({
      state: 'abstained',
      abstention: { code: 'provider-unavailable' }
    }))
    const service = new DecisionRequestService({
      database: database(undefined),
      textStage: { version: 'text-stage@1', classify },
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toEqual({
      action: 'show',
      profileRevision: 0,
      reasonCode: 'default-show'
    })
    expect(classify).toHaveBeenCalledOnce()
  })

  it('applies visual signals only after deterministic and text fallthrough', async () => {
    const classifyText = vi.fn<TextStage['classify']>(async () => ({
      state: 'abstained',
      abstention: { code: 'provider-unavailable' }
    }))
    const classifyVisual = vi.fn<VisualStage['classify']>(async () => ({
      state: 'signals',
      signals: visualSignals([
        {
          ruleId: 'rule:visual-clickbait',
          score: 0.94,
          evidenceRefs: []
        }
      ])
    }))
    const service = new DecisionRequestService({
      database: database({
        schemaVersion: { major: 1, minor: 0 },
        profileId: 'profile:visual-stage',
        revision: 6,
        createdAt: timestamp,
        updatedAt: timestamp,
        rules: [
          {
            id: 'rule:visual-clickbait',
            enabled: true,
            scope: {},
            createdAt: timestamp,
            updatedAt: timestamp,
            kind: 'semantic',
            effect: 'block',
            description: 'Block exaggerated visual clickbait.',
            examples: [],
            exclusions: [],
            threshold: 0.9
          }
        ],
        feedbackExamples: [],
        settings: {}
      }),
      textStage: { version: 'text-stage@1', classify: classifyText },
      visualStage: {
        version: 'visual-stage@1',
        classify: classifyVisual
      },
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toEqual({
      action: 'hide',
      profileRevision: 6,
      reasonCode: 'model-policy'
    })
    expect(classifyText).toHaveBeenCalledOnce()
    expect(classifyVisual).toHaveBeenCalledOnce()
    expect(classifyVisual).toHaveBeenCalledWith(
      expect.objectContaining({
        item: message.item,
        pageInstanceId: message.pageInstanceId,
        profileRevision: 6
      })
    )
  })

  it('preserves an explicit rule conflict for the injected recovery state', async () => {
    const rule = {
      enabled: true,
      scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
      createdAt: timestamp,
      updatedAt: timestamp,
      kind: 'identity',
      platform: 'youtube',
      identityType: 'author',
      identityId: 'author:conflict'
    } as const
    const service = new DecisionRequestService({
      database: database({
        schemaVersion: { major: 1, minor: 0 },
        profileId: 'profile:conflict',
        revision: 5,
        createdAt: timestamp,
        updatedAt: timestamp,
        rules: [
          { ...rule, id: 'rule:block-author', effect: 'block' },
          { ...rule, id: 'rule:promote-author', effect: 'promote' }
        ],
        feedbackExamples: [],
        settings: {}
      }),
      now: () => new Date(timestamp)
    })

    await expect(
      service.decide({
        ...message,
        item: {
          ...message.item,
          author: {
            platform: 'youtube',
            authorId: 'author:conflict',
            displayName: 'Conflicting author'
          }
        }
      })
    ).resolves.toEqual({
      action: 'review',
      profileRevision: 5,
      reasonCode: 'rule-conflict'
    })
  })

  it('rejects an unreadable profile so the content script can fail open', async () => {
    const service = new DecisionRequestService({
      database: database({ revision: 'corrupt' })
    })

    await expect(service.decide(message)).rejects.toThrow(
      'Active profile is unreadable'
    )
  })

  it('rejects partial observation persistence instead of disguising it as success', async () => {
    const service = new DecisionRequestService({
      database: database(undefined, {
        state: 'recorded',
        count: 1,
        persisted: { content: 1, decisions: 0 }
      })
    })

    await expect(service.decide(message)).rejects.toThrow(
      'Decision work did not commit: failed'
    )
  })

  it('defers quietly when required work meets scheduler backpressure', async () => {
    const scheduler = new DecisionScheduler({
      capacity: 1,
      concurrency: 1,
      autoStart: false
    })
    scheduler.schedule({
      workId: 'work:occupies-capacity',
      capability: 'deterministic-rules',
      optional: false,
      priority: 'deterministic-visible',
      binding: {
        contentId: 'youtube:video:occupied',
        pageInstanceId: 'page:occupied',
        profileRevision: 0,
        capabilityVersion: 'deterministic-rules@1',
        adapterVersion: 'youtube-adapter@1',
        policyVersion: 'deterministic-policy@1'
      },
      run: async () => undefined
    })
    const store = database(undefined)
    const service = new DecisionRequestService({
      database: store,
      scheduler,
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toBeUndefined()
    expect(store.recordObservations).not.toHaveBeenCalled()
  })

  it('defers quietly when a completed decision binding is stale', async () => {
    const scheduler = new DecisionScheduler({
      capacity: 1,
      concurrency: 1,
      isCurrent: () => false
    })
    const service = new DecisionRequestService({
      database: database(undefined),
      scheduler,
      now: () => new Date(timestamp)
    })

    await expect(service.decide(message)).resolves.toBeUndefined()
  })

  it.each(['skipped', 'cancelled', 'shed'] as const)(
    'defers quietly when scheduled work is %s',
    async state => {
      const store = database(undefined)
      const service = new DecisionRequestService({
        database: store,
        scheduler: quietScheduler(state),
        now: () => new Date(timestamp)
      })

      await expect(service.decide(message)).resolves.toBeUndefined()
      expect(store.recordObservations).not.toHaveBeenCalled()
    }
  )

  it('coalesces evaluation and durable observation into one operation', async () => {
    const store = database(undefined)
    const service = new DecisionRequestService({
      database: store,
      now: () => new Date(timestamp)
    })

    await expect(
      Promise.all([service.decide(message), service.decide(message)])
    ).resolves.toEqual([
      {
        action: 'show',
        profileRevision: 0,
        reasonCode: 'default-show'
      },
      {
        action: 'show',
        profileRevision: 0,
        reasonCode: 'default-show'
      }
    ])
    expect(store.recordObservations).toHaveBeenCalledOnce()
  })
})
