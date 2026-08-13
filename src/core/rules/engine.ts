import type { ContentItem } from '@/core/content/contracts'
import type {
  Decision,
  DecisionAction,
  Evidence
} from '@/core/decisions/contracts'
import { comparePortableStrings } from '@/core/operations/fingerprint'
import {
  type ExactRule,
  type IdentityRule,
  type PreferenceRule,
  type Rule,
  ruleSchema,
  type SemanticRule
} from '@/core/rules/contracts/rule'

type RuleResolution =
  | 'session-reveal'
  | 'explicit-allow'
  | 'identity'
  | 'exact'
  | 'semantic'
  | 'preference'
  | 'default-show'

type RuleConflict = {
  ruleIds: string[]
  actions: DecisionAction[]
  resolutionAction: 'review-rules'
}

export type RuleSignals = {
  semanticScores?: Readonly<Record<string, number>>
  semanticExclusions?: ReadonlySet<string>
  preferenceScores?: Readonly<Record<string, number>>
}

export type RuleEvaluationInput = {
  item: ContentItem
  index: RuleIndex
  profileRevision: number
  sessionRevealedContentIds?: ReadonlySet<string>
  signals?: RuleSignals
  dryRun?: boolean
}

export type RuleEvaluation = {
  resolved: true
  resolution: RuleResolution
  decision: Decision
  matchedRules: Rule[]
  dryRun: boolean
  conflict?: RuleConflict
}

export type QuarantinedRule = {
  inputIndex: number
  ruleId?: string
  issues: string[]
}

type IndexedRules = {
  rules: Rule[]
  identity: Map<string, IdentityRule[]>
  exact: Map<string, ExactRule[]>
  semantic: Map<string, SemanticRule>
  preference: Map<string, PreferenceRule[]>
}

type MatchedRule = {
  rule: Rule
  action: DecisionAction
  confidence: number
  score?: number
}

type MatchedSemanticRule = MatchedRule & {
  rule: SemanticRule
}

const ACTION_SCORES: Record<DecisionAction, number> = {
  show: 0.5,
  promote: 1,
  reduce: 0.25,
  hide: 0,
  review: 0.5
}

function identityKey(
  platform: string,
  identityType: 'author' | 'channel',
  identityId: string
) {
  return `${platform}\u0000${identityType}\u0000${identityId}`
}

function exactKey(
  field: ExactRule['field'],
  caseSensitive: boolean,
  value: string
) {
  const normalized = caseSensitive ? value : value.toLowerCase()
  return `${field}\u0000${caseSensitive ? 'case' : 'fold'}\u0000${normalized}`
}

export function preferenceSignalKey(
  target: PreferenceRule['target'],
  targetId: string
) {
  return `${target}\u0000${targetId}`
}

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
    return
  }
  map.set(key, [value])
}

function sortMapValues<T extends { id: string }>(map: Map<string, T[]>) {
  for (const values of map.values()) {
    values.sort((left, right) => comparePortableStrings(left.id, right.id))
  }
}

function hostnameFromUrl(value: string | undefined) {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

export class RuleIndex {
  readonly ruleIds: readonly string[]
  readonly size: number

  readonly #identity: ReadonlyMap<string, readonly IdentityRule[]>
  readonly #exact: ReadonlyMap<string, readonly ExactRule[]>
  readonly #semantic: ReadonlyMap<string, SemanticRule>
  readonly #preference: ReadonlyMap<string, readonly PreferenceRule[]>

  constructor(indexed: IndexedRules) {
    this.ruleIds = Object.freeze(indexed.rules.map(rule => rule.id))
    this.size = this.ruleIds.length
    this.#identity = indexed.identity
    this.#exact = indexed.exact
    this.#semantic = indexed.semantic
    this.#preference = indexed.preference
  }

  identityRules(item: ContentItem): readonly IdentityRule[] {
    const matches: IdentityRule[] = []
    if (item.author) {
      matches.push(
        ...(this.#identity.get(
          identityKey(item.platform, 'author', item.author.authorId)
        ) ?? [])
      )
    }
    if (item.channel) {
      matches.push(
        ...(this.#identity.get(
          identityKey(item.platform, 'channel', item.channel.channelId)
        ) ?? [])
      )
    }
    return matches
  }

  exactRules(item: ContentItem): readonly ExactRule[] {
    const matches: ExactRule[] = []
    const values: Array<[ExactRule['field'], string | undefined]> = [
      ['title', item.title],
      ['body', item.body],
      ['domain', hostnameFromUrl(item.canonicalUrl)]
    ]

    for (const [field, value] of values) {
      if (value === undefined) {
        continue
      }
      matches.push(
        ...(this.#exact.get(exactKey(field, true, value)) ?? []),
        ...(this.#exact.get(exactKey(field, false, value)) ?? [])
      )
    }
    return matches
  }

  semanticRule(ruleId: string) {
    return this.#semantic.get(ruleId)
  }

  preferenceRules(signalKey: string): readonly PreferenceRule[] {
    return this.#preference.get(signalKey) ?? []
  }
}

function quarantineIssues(
  inputIndex: number,
  input: unknown,
  issues: string[]
): QuarantinedRule {
  const ruleId =
    typeof input === 'object' &&
    input !== null &&
    'id' in input &&
    typeof input.id === 'string' &&
    input.id.length > 0
      ? input.id
      : undefined

  return {
    inputIndex,
    ...(ruleId ? { ruleId } : {}),
    issues
  }
}

function freezeRule(rule: Rule): Rule {
  if (rule.scope.platforms) {
    Object.freeze(rule.scope.platforms)
  }
  if (rule.scope.surfaces) {
    Object.freeze(rule.scope.surfaces)
  }
  Object.freeze(rule.scope)
  if (rule.kind === 'semantic') {
    Object.freeze(rule.examples)
    Object.freeze(rule.exclusions)
  }
  return Object.freeze(rule)
}

export function buildRuleIndex(inputs: readonly unknown[]) {
  const parsed: Array<{ inputIndex: number; rule: Rule }> = []
  const quarantined: QuarantinedRule[] = []

  for (const [inputIndex, input] of inputs.entries()) {
    const result = ruleSchema.safeParse(input)
    if (!result.success) {
      quarantined.push(
        quarantineIssues(
          inputIndex,
          input,
          result.error.issues.map(
            issue => `${issue.path.join('.') || '<root>'}:${issue.code}`
          )
        )
      )
      continue
    }
    parsed.push({ inputIndex, rule: result.data })
  }

  const idCounts = new Map<string, number>()
  for (const { rule } of parsed) {
    idCounts.set(rule.id, (idCounts.get(rule.id) ?? 0) + 1)
  }

  const activeRules: Rule[] = []
  for (const entry of parsed) {
    if ((idCounts.get(entry.rule.id) ?? 0) > 1) {
      quarantined.push(
        quarantineIssues(entry.inputIndex, entry.rule, ['id:duplicate'])
      )
      continue
    }
    if (entry.rule.enabled) {
      activeRules.push(freezeRule(entry.rule))
    }
  }
  activeRules.sort((left, right) => comparePortableStrings(left.id, right.id))

  const indexed: IndexedRules = {
    rules: activeRules,
    identity: new Map(),
    exact: new Map(),
    semantic: new Map(),
    preference: new Map()
  }

  for (const rule of activeRules) {
    switch (rule.kind) {
      case 'identity':
        appendMapValue(
          indexed.identity,
          identityKey(rule.platform, rule.identityType, rule.identityId),
          rule
        )
        break
      case 'exact':
        appendMapValue(
          indexed.exact,
          exactKey(rule.field, rule.caseSensitive, rule.value),
          rule
        )
        break
      case 'semantic':
        indexed.semantic.set(rule.id, rule)
        break
      case 'preference':
        appendMapValue(
          indexed.preference,
          preferenceSignalKey(rule.target, rule.targetId),
          rule
        )
        break
    }
  }

  sortMapValues(indexed.identity)
  sortMapValues(indexed.exact)
  sortMapValues(indexed.preference)
  quarantined.sort((left, right) => left.inputIndex - right.inputIndex)

  return {
    index: new RuleIndex(indexed),
    quarantined
  }
}

function scopeMatches(rule: Rule, item: ContentItem) {
  const { platforms, surfaces } = rule.scope
  const platformMatches =
    !platforms || platforms.length === 0 || platforms.includes(item.platform)
  const surfaceMatches =
    !surfaces || surfaces.length === 0 || surfaces.includes(item.surface)
  return platformMatches && surfaceMatches
}

function isNormalizedScore(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function ruleAction(rule: Rule): DecisionAction | undefined {
  switch (rule.kind) {
    case 'identity':
    case 'semantic':
      return rule.effect === 'allow'
        ? 'show'
        : rule.effect === 'block'
          ? 'hide'
          : rule.effect
    case 'exact':
      return rule.effect === 'allow' ? 'show' : 'hide'
    case 'preference':
      return undefined
  }
}

function evidenceFor(match: MatchedRule): Evidence {
  const labels: Record<Rule['kind'], string> = {
    identity: 'Explicit identity rule applies',
    exact: 'Exact content rule applies',
    semantic: 'Semantic rule applies',
    preference: 'Preference rule applies'
  }

  return {
    source: 'deterministic-rule',
    label: labels[match.rule.kind],
    ...(match.score === undefined ? {} : { score: match.score }),
    ruleId: match.rule.id
  }
}

function decision(
  item: ContentItem,
  profileRevision: number,
  action: DecisionAction,
  matches: readonly MatchedRule[],
  extraEvidence: readonly Evidence[] = []
): Decision {
  const ordered = [...matches].sort((left, right) =>
    comparePortableStrings(left.rule.id, right.rule.id)
  )
  const confidence =
    ordered.length > 0
      ? Math.min(...ordered.map(match => match.confidence))
      : action === 'review'
        ? 0
        : 1

  return {
    contentId: item.id,
    action,
    score: ACTION_SCORES[action],
    confidence,
    reasons: [...ordered.map(evidenceFor), ...extraEvidence],
    matchedRuleIds: ordered.map(match => match.rule.id),
    decidedAt: item.observedAt,
    classifierVersion: `rule-engine@1;profile=${profileRevision}`,
    policyVersion: 'deterministic-policy@1',
    profileRevision
  }
}

function resolveBucket(
  input: RuleEvaluationInput,
  resolution: RuleResolution,
  matches: MatchedRule[]
): RuleEvaluation {
  const ordered = [...matches].sort((left, right) =>
    comparePortableStrings(left.rule.id, right.rule.id)
  )
  const actions = [...new Set(ordered.map(match => match.action))].sort()
  if (actions.length > 1) {
    const conflict: RuleConflict = {
      ruleIds: ordered.map(match => match.rule.id),
      actions,
      resolutionAction: 'review-rules'
    }
    return {
      resolved: true,
      resolution,
      decision: decision(input.item, input.profileRevision, 'review', ordered, [
        {
          source: 'deterministic-rule',
          label: 'Conflicting explicit rules require review'
        }
      ]),
      matchedRules: ordered.map(match => match.rule),
      dryRun: input.dryRun ?? false,
      conflict
    }
  }

  const action = actions[0] ?? 'show'
  return {
    resolved: true,
    resolution,
    decision: decision(input.item, input.profileRevision, action, ordered),
    matchedRules: ordered.map(match => match.rule),
    dryRun: input.dryRun ?? false
  }
}

export function evaluateRules(input: RuleEvaluationInput): RuleEvaluation {
  if (input.sessionRevealedContentIds?.has(input.item.id)) {
    return {
      resolved: true,
      resolution: 'session-reveal',
      decision: decision(
        input.item,
        input.profileRevision,
        'show',
        [],
        [
          {
            source: 'user-feedback',
            label: 'Revealed for this session'
          }
        ]
      ),
      matchedRules: [],
      dryRun: input.dryRun ?? false
    }
  }

  const identityRules = input.index
    .identityRules(input.item)
    .filter(rule => scopeMatches(rule, input.item))
  const exactRules = input.index
    .exactRules(input.item)
    .filter(rule => scopeMatches(rule, input.item))
  const semanticRules: MatchedSemanticRule[] = []
  for (const [ruleId, score] of Object.entries(
    input.signals?.semanticScores ?? {}
  )) {
    const rule = input.index.semanticRule(ruleId)
    if (
      !rule ||
      !scopeMatches(rule, input.item) ||
      !isNormalizedScore(score) ||
      score < rule.threshold ||
      input.signals?.semanticExclusions?.has(ruleId)
    ) {
      continue
    }
    const action = ruleAction(rule)
    if (action) {
      semanticRules.push({ rule, action, confidence: score, score })
    }
  }

  const allowRules: MatchedRule[] = [
    ...identityRules
      .filter(rule => rule.effect === 'allow')
      .map(rule => ({ rule, action: 'show' as const, confidence: 1 })),
    ...exactRules
      .filter(rule => rule.effect === 'allow')
      .map(rule => ({ rule, action: 'show' as const, confidence: 1 }))
  ]
  if (allowRules.length > 0) {
    return resolveBucket(input, 'explicit-allow', allowRules)
  }

  const identityMatches = identityRules
    .filter(rule => rule.effect !== 'allow')
    .map(rule => ({
      rule,
      action: ruleAction(rule) ?? 'review',
      confidence: 1
    }))
  if (identityMatches.length > 0) {
    return resolveBucket(input, 'identity', identityMatches)
  }

  const exactMatches = exactRules
    .filter(rule => rule.effect === 'block')
    .map(rule => ({ rule, action: 'hide' as const, confidence: 1 }))
  if (exactMatches.length > 0) {
    return resolveBucket(input, 'exact', exactMatches)
  }

  if (semanticRules.length > 0) {
    return resolveBucket(input, 'semantic', semanticRules)
  }

  const preferenceMatches: MatchedRule[] = []
  for (const [signalKey, signalScore] of Object.entries(
    input.signals?.preferenceScores ?? {}
  )) {
    if (!isNormalizedScore(signalScore) || signalScore === 0) {
      continue
    }
    for (const rule of input.index.preferenceRules(signalKey)) {
      if (!scopeMatches(rule, input.item)) {
        continue
      }
      const weightedScore = rule.weight * signalScore
      if (!Number.isFinite(weightedScore) || weightedScore === 0) {
        continue
      }
      preferenceMatches.push({
        rule,
        action: weightedScore > 0 ? 'promote' : 'reduce',
        confidence: Math.min(1, Math.abs(signalScore))
      })
    }
  }
  if (preferenceMatches.length > 0) {
    return resolveBucket(input, 'preference', preferenceMatches)
  }

  return {
    resolved: true,
    resolution: 'default-show',
    decision: decision(input.item, input.profileRevision, 'show', []),
    matchedRules: [],
    dryRun: input.dryRun ?? false
  }
}

export type DryRunRuleChangesInput = {
  currentIndex: RuleIndex
  candidateRules: readonly unknown[]
  items: readonly ContentItem[]
  currentProfileRevision: number
  candidateProfileRevision: number
  signalsByContentId?: Readonly<Record<string, RuleSignals>>
  sessionRevealedContentIds?: ReadonlySet<string>
}

export function dryRunRuleChanges(input: DryRunRuleChangesInput) {
  const candidate = buildRuleIndex(input.candidateRules)
  const changes = input.items.flatMap(item => {
    const common = {
      item,
      signals: input.signalsByContentId?.[item.id],
      sessionRevealedContentIds: input.sessionRevealedContentIds,
      dryRun: true
    }
    const before = evaluateRules({
      ...common,
      index: input.currentIndex,
      profileRevision: input.currentProfileRevision
    })
    const after = evaluateRules({
      ...common,
      index: candidate.index,
      profileRevision: input.candidateProfileRevision
    })

    if (
      before.decision.action === after.decision.action &&
      before.resolution === after.resolution &&
      before.decision.matchedRuleIds.join('\u0000') ===
        after.decision.matchedRuleIds.join('\u0000')
    ) {
      return []
    }

    return [
      {
        contentId: item.id,
        before: before.decision.action,
        after: after.decision.action,
        beforeRuleIds: before.decision.matchedRuleIds,
        afterRuleIds: after.decision.matchedRuleIds
      }
    ]
  })

  return {
    dryRun: true as const,
    changes,
    quarantined: candidate.quarantined
  }
}
