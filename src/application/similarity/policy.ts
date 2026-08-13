import type {
  Decision,
  DecisionAction,
  Evidence
} from '@/core/decisions/contracts'
import type { RuleEvaluation } from '@/core/rules/engine'
import type { ContentSimilarityRelation } from '@/core/similarity/contracts'

export type AcceptedSimilarityPolicy = {
  accepted: boolean
  policyVersion: string
  exactDuplicateAction: Extract<DecisionAction, 'reduce' | 'hide' | 'review'>
  nearDuplicateAction: Extract<DecisionAction, 'reduce' | 'hide' | 'review'>
}

export type SimilarityPolicyInput = {
  decision: Decision
  resolution: RuleEvaluation['resolution']
  relations: readonly ContentSimilarityRelation[]
  policy: AcceptedSimilarityPolicy
  protectedException: boolean
}

const protectedResolutions = new Set<RuleEvaluation['resolution']>([
  'session-reveal',
  'explicit-allow'
])

function relationEvidence(relation: ContentSimilarityRelation): Evidence {
  return {
    source:
      relation.type === 'exact-duplicate' ? 'adapter-observation' : 'embedding',
    label: `${relation.type}:${relation.evidenceCodes.join(',')}`,
    score: relation.score
  }
}

export function applySimilarityPolicy(input: SimilarityPolicyInput): Decision {
  if (
    !input.policy.accepted ||
    input.protectedException ||
    protectedResolutions.has(input.resolution) ||
    input.decision.action !== 'show'
  ) {
    return structuredClone(input.decision)
  }
  const candidates = input.relations
    .filter(
      relation =>
        relation.type === 'exact-duplicate' ||
        relation.type === 'near-duplicate'
    )
    .sort(
      (left, right) =>
        right.confidence - left.confidence || right.score - left.score
    )
  const strongest = candidates[0]
  if (!strongest) {
    return structuredClone(input.decision)
  }
  const requestedAction =
    strongest.type === 'exact-duplicate'
      ? input.policy.exactDuplicateAction
      : input.policy.nearDuplicateAction
  const action =
    strongest.advisoryOnly || strongest.confidence < 0.9
      ? 'review'
      : requestedAction
  return {
    ...structuredClone(input.decision),
    action,
    score: action === 'hide' ? 0 : action === 'reduce' ? 0.25 : 0.5,
    confidence: strongest.confidence,
    reasons: [...input.decision.reasons, ...candidates.map(relationEvidence)],
    classifierVersion: `${input.decision.classifierVersion};similarity=${input.policy.policyVersion}`,
    policyVersion: `${input.decision.policyVersion};similarity=${input.policy.policyVersion}`
  }
}
