import { DecisionWorkError } from '@/application/decision-pipeline/contracts'
import type { DecisionScheduler } from '@/application/decision-pipeline/scheduler'
import {
  ruleSignalsFromClassification,
  type TextStage
} from '@/application/decision-pipeline/text-stage'
import type { VisualStage } from '@/application/decision-pipeline/visual-stage'
import type {
  DecisionRequestMessage,
  RuntimeDecision
} from '@/application/messages/contracts'
import { projectContentLensSettings } from '@/application/settings/profile-settings'
import type { SemanticRule } from '@/core/rules/contracts/rule'
import { buildRuleIndex, evaluateRules } from '@/core/rules/engine'
import { createServiceWorkerDecisionScheduler } from '@/extension/service-worker/decision-runtime'
import {
  type ProfileEnvelope,
  parseProfileEnvelope
} from '@/storage/contracts/profile-envelope'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const deterministicCapabilityVersion = 'deterministic-rules@1'
const deterministicAdapterVersion = 'youtube-adapter@1'
const deterministicPolicyVersion = 'deterministic-policy@1'

type DecisionRequestServiceOptions = {
  database?: DecisionDatabase
  scheduler?: Pick<DecisionScheduler, 'schedule'>
  textStage?: TextStage
  visualStage?: VisualStage
  now?: () => Date
}

type DecisionDatabase = Pick<
  ContentLensDatabase,
  'readActiveProfile' | 'recordObservations'
> &
  Partial<Pick<ContentLensDatabase, 'findActiveSimilarityBatchAction'>>

function workIdFor(
  message: DecisionRequestMessage,
  profileRevision: number,
  textStageVersion: string,
  visualStageVersion: string,
  similarityBatchActionId: string
) {
  return [
    'decision',
    message.item.id,
    message.pageInstanceId,
    String(profileRevision),
    deterministicCapabilityVersion,
    deterministicAdapterVersion,
    deterministicPolicyVersion,
    textStageVersion,
    visualStageVersion,
    similarityBatchActionId
  ].join('\u0000')
}

function decisionReason(
  action: RuntimeDecision['action'],
  resolution: ReturnType<typeof evaluateRules>['resolution'],
  similarityPolicyApplied: boolean
) {
  if (similarityPolicyApplied) {
    return 'similarity-policy' as const
  }
  if (resolution === 'semantic' || resolution === 'preference') {
    return 'model-policy' as const
  }
  if (action === 'show') {
    return 'default-show' as const
  }
  return action === 'review'
    ? ('rule-conflict' as const)
    : ('deterministic-rule' as const)
}

export class DecisionRequestService {
  readonly #database: DecisionDatabase
  readonly #scheduler: Pick<DecisionScheduler, 'schedule'>
  readonly #textStage: TextStage | undefined
  readonly #visualStage: VisualStage | undefined
  readonly #now: () => Date

  constructor(options: DecisionRequestServiceOptions = {}) {
    this.#database = options.database ?? new ContentLensDatabase()
    this.#scheduler =
      options.scheduler ?? createServiceWorkerDecisionScheduler()
    this.#textStage = options.textStage
    this.#visualStage = options.visualStage
    this.#now = options.now ?? (() => new Date())
  }

  async decide(
    message: DecisionRequestMessage
  ): Promise<RuntimeDecision | undefined> {
    const rawProfile = await this.#database.readActiveProfile()
    let profile: ProfileEnvelope | undefined
    if (rawProfile !== undefined) {
      const parsed = parseProfileEnvelope(rawProfile)
      if (!parsed.success) {
        throw new Error('Active profile is unreadable')
      }
      profile = parsed.data
    }

    const profileRevision = profile?.revision ?? 0
    const settings = projectContentLensSettings(
      profile?.settings ?? {}
    ).settings
    const platformSettings = settings.platforms[message.platform]
    if (
      platformSettings.state !== 'enabled' ||
      platformSettings.surfaces[message.item.surface] !== true
    ) {
      return undefined
    }
    const rules = buildRuleIndex(profile?.rules ?? [])
    const semanticRules = (profile?.rules ?? []).filter(
      (rule): rule is SemanticRule => rule.kind === 'semantic' && rule.enabled
    )
    const decisionTime = this.#now().toISOString()
    const similarityBatchAction =
      await this.#database.findActiveSimilarityBatchAction?.(
        message.item.id,
        decisionTime
      )
    const scheduled = this.#scheduler.schedule({
      workId: workIdFor(
        message,
        profileRevision,
        this.#textStage?.version ?? 'text-stage-disabled',
        this.#visualStage?.version ?? 'visual-stage-disabled',
        similarityBatchAction?.id ?? 'similarity-batch-disabled'
      ),
      capability: 'deterministic-rules',
      optional: false,
      priority: 'deterministic-visible',
      binding: {
        contentId: message.item.id,
        pageInstanceId: message.pageInstanceId,
        profileRevision,
        capabilityVersion: deterministicCapabilityVersion,
        adapterVersion: deterministicAdapterVersion,
        policyVersion: deterministicPolicyVersion
      },
      run: async signal => {
        let evaluated = evaluateRules({
          item: message.item,
          index: rules.index,
          profileRevision
        })
        if (evaluated.resolution === 'default-show' && this.#textStage) {
          const text = await this.#textStage.classify({
            item: message.item,
            semanticRules,
            profileRevision,
            pageInstanceId: message.pageInstanceId,
            settings,
            signal
          })
          if (text.state === 'signals') {
            evaluated = evaluateRules({
              item: message.item,
              index: rules.index,
              profileRevision,
              signals: ruleSignalsFromClassification(text.signals)
            })
          }
        }
        if (evaluated.resolution === 'default-show' && this.#visualStage) {
          const visual = await this.#visualStage.classify({
            item: message.item,
            semanticRules,
            profileRevision,
            pageInstanceId: message.pageInstanceId,
            settings,
            signal
          })
          if (visual.state === 'signals') {
            evaluated = evaluateRules({
              item: message.item,
              index: rules.index,
              profileRevision,
              signals: ruleSignalsFromClassification(visual.signals)
            })
          }
        }
        let decision = {
          ...evaluated.decision,
          decidedAt: decisionTime
        }
        const similarityPolicyApplied = Boolean(
          similarityBatchAction &&
            evaluated.resolution === 'default-show' &&
            decision.action === 'show'
        )
        if (similarityPolicyApplied && similarityBatchAction) {
          decision = {
            ...decision,
            action: 'hide',
            score: 0,
            confidence: 1,
            reasons: [
              ...decision.reasons,
              {
                source: 'user-feedback',
                label: 'Confirmed Hide similar batch policy applies'
              } as const
            ],
            classifierVersion: `${decision.classifierVersion};similarity=${similarityBatchAction.policyVersion}`,
            policyVersion: `${decision.policyVersion};similarity=${similarityBatchAction.policyVersion}`
          }
        }
        const recorded = await this.#database.recordObservations([
          {
            content: message.item,
            decision
          }
        ])
        if (
          recorded.state !== 'recorded' ||
          recorded.count !== 1 ||
          recorded.persisted.content !== 1 ||
          recorded.persisted.decisions !== 1
        ) {
          throw new DecisionWorkError('permanent', 'observation-not-persisted')
        }
        return {
          action: decision.action,
          profileRevision,
          reasonCode: decisionReason(
            decision.action,
            evaluated.resolution,
            similarityPolicyApplied
          )
        }
      }
    })

    if (!('completion' in scheduled)) {
      if (scheduled.state === 'backpressure' || scheduled.state === 'skipped') {
        return undefined
      }
      throw new Error(`Decision scheduling rejected: ${scheduled.state}`)
    }

    const outcome = await scheduled.completion
    if (outcome.state === 'committed') {
      return outcome.value
    }
    if (
      outcome.state === 'cancelled' ||
      outcome.state === 'discarded' ||
      outcome.state === 'shed'
    ) {
      return undefined
    }
    throw new Error(`Decision work did not commit: ${outcome.state}`)
  }
}
