import type { ContentItem } from '@/core/content/contracts'
import type { Decision } from '@/core/decisions/contracts'
import type { ClassificationSignals } from '@/core/decisions/signals'

export type AcceptedHideThreshold = {
  capabilityVersion: string
  classifierVersion: string
  platform: ContentItem['platform']
  surface: ContentItem['surface']
  language: string
  threshold: number
  accepted: boolean
}

export type DecisionProfile = {
  revision: number
  policyVersion: string
  reduceThreshold: number
  hideThresholds: readonly AcceptedHideThreshold[]
}

function probabilisticRisk(signals: ClassificationSignals) {
  const candidates = [
    signals.quality.noise,
    signals.quality.clickbait,
    signals.quality.aiGenerated,
    ...signals.semanticRuleMatches.map(match => match.score)
  ].filter((score): score is number => score !== undefined)
  return Math.max(0, ...candidates)
}

function acceptedHideThreshold(input: {
  item: ContentItem
  signals: ClassificationSignals
  profile: DecisionProfile
  capabilityVersion: string
}) {
  return input.profile.hideThresholds.find(
    threshold =>
      threshold.accepted &&
      threshold.capabilityVersion === input.capabilityVersion &&
      threshold.classifierVersion === input.signals.classifierVersion &&
      threshold.platform === input.item.platform &&
      threshold.surface === input.item.surface &&
      (threshold.language === '*' || threshold.language === input.item.language)
  )
}

export function decideFromSignals(input: {
  item: ContentItem
  signals: ClassificationSignals
  profile: DecisionProfile
  capabilityVersion: string
  decidedAt: string
}): Decision {
  const risk = probabilisticRisk(input.signals)
  const threshold = acceptedHideThreshold(input)
  const action =
    threshold &&
    risk >= threshold.threshold &&
    input.signals.confidence !== null &&
    input.signals.confidence >= threshold.threshold
      ? 'hide'
      : risk >= input.profile.reduceThreshold
        ? 'reduce'
        : 'show'
  return {
    contentId: input.item.id,
    action,
    score: 1 - risk,
    confidence: input.signals.confidence ?? 0,
    reasons:
      action === 'show'
        ? []
        : [
            {
              source: input.signals.provenance.sourceKind,
              label:
                action === 'hide'
                  ? 'Accepted calibrated threshold applies'
                  : 'Probabilistic signal exceeds reduce threshold',
              score: risk
            }
          ],
    matchedRuleIds: input.signals.semanticRuleMatches.map(
      match => match.ruleId
    ),
    decidedAt: input.decidedAt,
    classifierVersion: input.signals.classifierVersion,
    policyVersion: input.profile.policyVersion,
    profileRevision: input.profile.revision
  }
}
