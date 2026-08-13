import type { ContentItem } from '@/core/content/contracts'
import type { ExactRule, Rule } from '@/core/rules/contracts/rule'
import {
  buildRuleIndex,
  dryRunRuleChanges,
  evaluateRules
} from '@/core/rules/engine'

export type RuleEffect = ExactRule['effect']

export type RuleDraft = {
  createdAt?: string
  effect: RuleEffect
  id?: string
  value: string
}

export type RulePreviewOutcome = {
  after: 'show' | 'hide'
  before: 'show' | 'hide'
  changed: boolean
  kind: 'match' | 'protected'
  matched: boolean
  platform: ContentItem['platform']
  surface: ContentItem['surface']
  title: string
}

export type RulePreview = {
  candidate: ExactRule
  dryRun: true
  outcomes: [RulePreviewOutcome, RulePreviewOutcome]
}

export type RuleFlowFeedback =
  | { kind: 'saved'; rule: ExactRule }
  | { kind: 'undo-pending'; rule: ExactRule }
  | { kind: 'undone' }
  | { kind: 'failed' }

export type RuleFlowState =
  | {
      decisionCount: number
      feedback?: RuleFlowFeedback
      screen: 'list'
    }
  | {
      decisionCount: number
      draft: RuleDraft
      screen: 'editor'
    }
  | {
      decisionCount: number
      failure?: boolean
      pending?: boolean
      preview: RulePreview
      screen: 'preview'
    }

export type RuleFlowAction =
  | { type: 'start'; draft?: RuleDraft }
  | { type: 'cancel' }
  | { type: 'update'; draft: RuleDraft }
  | { type: 'preview'; preview: RulePreview }
  | { type: 'back-to-editor' }
  | { type: 'saved'; rule: ExactRule }
  | { type: 'save-pending' }
  | { type: 'save-failed' }
  | { type: 'undo-pending'; rule: ExactRule }
  | { type: 'undone' }
  | { type: 'undo-failed' }

export const initialRuleFlowState: RuleFlowState = {
  decisionCount: 0,
  screen: 'list'
}

export const starterRuleDraft = (): RuleDraft => ({
  effect: 'block',
  value: ''
})

export function ruleFlowReducer(
  state: RuleFlowState,
  action: RuleFlowAction
): RuleFlowState {
  switch (action.type) {
    case 'start':
      return {
        screen: 'editor',
        decisionCount: state.decisionCount + 1,
        draft: action.draft ?? starterRuleDraft()
      }
    case 'cancel':
      return {
        screen: 'list',
        decisionCount: state.decisionCount
      }
    case 'update':
      return state.screen === 'editor'
        ? { ...state, draft: action.draft }
        : state
    case 'preview':
      return {
        screen: 'preview',
        decisionCount: state.decisionCount + 1,
        preview: action.preview
      }
    case 'back-to-editor':
      return state.screen === 'preview'
        ? {
            screen: 'editor',
            decisionCount: state.decisionCount,
            draft: {
              createdAt: state.preview.candidate.createdAt,
              effect: state.preview.candidate.effect,
              id: state.preview.candidate.id,
              value: state.preview.candidate.value
            }
          }
        : state
    case 'saved':
      return {
        screen: 'list',
        decisionCount: state.decisionCount + 1,
        feedback: { kind: 'saved', rule: action.rule }
      }
    case 'save-pending':
      return state.screen === 'preview'
        ? { ...state, failure: false, pending: true }
        : state
    case 'save-failed':
      return state.screen === 'preview'
        ? { ...state, failure: true, pending: false }
        : state
    case 'undo-pending':
      return {
        screen: 'list',
        decisionCount: state.decisionCount,
        feedback: { kind: 'undo-pending', rule: action.rule }
      }
    case 'undone':
      return {
        screen: 'list',
        decisionCount: state.decisionCount,
        feedback: { kind: 'undone' }
      }
    case 'undo-failed':
      return {
        screen: 'list',
        decisionCount: state.decisionCount,
        feedback: { kind: 'failed' }
      }
  }
}

export function draftFromRule(rule: ExactRule): RuleDraft {
  return {
    createdAt: rule.createdAt,
    effect: rule.effect,
    id: rule.id,
    value: rule.value
  }
}

export function exactRuleFromDraft(
  draft: RuleDraft,
  input: { at: string; id: string }
): ExactRule {
  const value = draft.value.trim()
  return {
    id: draft.id ?? input.id,
    enabled: true,
    scope: {
      platforms: ['youtube'],
      surfaces: ['youtube:home', 'youtube:search', 'youtube:recommendations']
    },
    createdAt: draft.createdAt ?? input.at,
    updatedAt: input.at,
    kind: 'exact',
    effect: draft.effect,
    field: 'title',
    value,
    caseSensitive: false
  }
}

function previewItems(
  candidate: ExactRule,
  at: string,
  protectedTitle: string
): [ContentItem, ContentItem] {
  return [
    {
      id: 'preview:matched',
      platform: 'youtube',
      identity: {
        status: 'stable',
        platformContentId: 'preview:matched'
      },
      surface: 'youtube:home',
      title: candidate.value,
      media: [],
      observedAt: at,
      context: {}
    },
    {
      id: 'preview:protected',
      platform: 'youtube',
      identity: {
        status: 'stable',
        platformContentId: 'preview:protected'
      },
      surface: 'youtube:home',
      title: protectedTitle,
      media: [],
      observedAt: at,
      context: {}
    }
  ]
}

export function previewExactRule(
  rules: readonly Rule[],
  candidate: ExactRule,
  profileRevision: number,
  at: string,
  protectedTitle = 'Content outside this rule'
): RulePreview {
  const candidateRules = [
    ...rules.filter(rule => rule.id !== candidate.id),
    candidate
  ]
  const items = previewItems(candidate, at, protectedTitle)
  const currentIndex = buildRuleIndex(rules)
  const candidateIndex = buildRuleIndex(candidateRules)
  const dryRun = dryRunRuleChanges({
    currentIndex: currentIndex.index,
    candidateRules,
    items,
    currentProfileRevision: profileRevision,
    candidateProfileRevision: profileRevision + 1
  })

  const outcomes = items.map((item, index) => {
    const before = evaluateRules({
      item,
      index: currentIndex.index,
      profileRevision,
      dryRun: true
    }).decision
    const after = evaluateRules({
      item,
      index: candidateIndex.index,
      profileRevision: profileRevision + 1,
      dryRun: true
    }).decision

    return {
      kind: index === 0 ? ('match' as const) : ('protected' as const),
      before: before.action === 'hide' ? ('hide' as const) : ('show' as const),
      after: after.action === 'hide' ? ('hide' as const) : ('show' as const),
      changed: dryRun.changes.some(change => change.contentId === item.id),
      matched: after.matchedRuleIds.includes(candidate.id),
      platform: item.platform,
      surface: item.surface,
      title: item.title ?? protectedTitle
    }
  }) as [RulePreviewOutcome, RulePreviewOutcome]

  return {
    candidate,
    dryRun: dryRun.dryRun,
    outcomes
  }
}
