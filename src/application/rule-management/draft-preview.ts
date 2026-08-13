import {
  type RuleDraftProposal,
  ruleDraftProposalSchema
} from '@/ai/assistance/contracts'
import type { ContentItem } from '@/core/content/contracts'
import type { Rule, SemanticRule } from '@/core/rules/contracts/rule'
import {
  buildRuleIndex,
  dryRunRuleChanges,
  evaluateRules,
  type RuleSignals
} from '@/core/rules/engine'

export function previewAssistedRuleDraft(input: {
  draft: RuleDraftProposal
  currentRevision: number
  currentRules: readonly Rule[]
  currentContentId?: string
  items: readonly ContentItem[]
  signalsByContentId?: Readonly<Record<string, RuleSignals>>
  at: string
}) {
  const draft = ruleDraftProposalSchema.parse(input.draft)
  if (draft.baseRevision !== input.currentRevision) {
    return {
      state: 'stale' as const,
      reason: 'profile-revision' as const,
      expectedRevision: draft.baseRevision,
      currentRevision: input.currentRevision
    }
  }
  if (
    draft.provenance.contentId &&
    input.currentContentId !== draft.provenance.contentId
  ) {
    return {
      state: 'stale' as const,
      reason: 'content-identity' as const,
      expectedContentId: draft.provenance.contentId,
      currentContentId: input.currentContentId
    }
  }

  const candidate: SemanticRule = {
    id: draft.draftId,
    kind: 'semantic',
    enabled: true,
    effect: draft.rule.effect,
    scope: draft.rule.scope,
    description: draft.rule.description,
    examples: draft.rule.examples,
    exclusions: draft.rule.exclusions,
    threshold: draft.rule.threshold,
    createdAt: input.at,
    updatedAt: input.at
  }
  const candidateRules = [
    ...input.currentRules.filter(rule => rule.id !== candidate.id),
    candidate
  ]
  const currentIndex = buildRuleIndex(input.currentRules).index
  const dryRun = dryRunRuleChanges({
    currentIndex,
    candidateRules,
    items: input.items,
    currentProfileRevision: input.currentRevision,
    candidateProfileRevision: input.currentRevision,
    signalsByContentId: input.signalsByContentId
  })
  if (dryRun.quarantined.length > 0) {
    return {
      state: 'invalid' as const,
      reason: 'candidate-rule' as const
    }
  }

  const candidateIndex = buildRuleIndex(candidateRules).index
  const protectedExceptions = input.items.flatMap(item => {
    const evaluation = evaluateRules({
      item,
      index: candidateIndex,
      profileRevision: input.currentRevision,
      signals: input.signalsByContentId?.[item.id],
      dryRun: true
    })
    const draftScore =
      input.signalsByContentId?.[item.id]?.semanticScores?.[draft.draftId]
    if (
      evaluation.resolution !== 'explicit-allow' ||
      draftScore === undefined ||
      draftScore < draft.rule.threshold
    ) {
      return []
    }
    return [
      {
        contentId: item.id,
        resolution: 'explicit-allow' as const,
        ruleIds: evaluation.decision.matchedRuleIds
      }
    ]
  })

  return {
    state: 'preview-ready' as const,
    baseRevision: draft.baseRevision,
    draftId: draft.draftId,
    estimatedReach: dryRun.changes.length,
    representativeMatches: dryRun.changes
      .filter(change => change.afterRuleIds.includes(draft.draftId))
      .slice(0, 3),
    protectedExceptions: protectedExceptions.slice(0, 3),
    changes: dryRun.changes,
    candidate,
    dryRun: true as const
  }
}
