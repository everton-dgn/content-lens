import type {
  AssistanceDraftRule,
  DraftFieldRef,
  RuleDraftProposal
} from '@/ai/assistance/contracts'
import type { AssistanceDraftRequest } from '@/ai/assistance/prompt-contract'

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function expandsScope(
  candidate: AssistanceDraftRule['scope'],
  trusted: AssistanceDraftRequest['trustedContext']
) {
  const trustedPlatforms = trusted.platforms
  const trustedSurfaces = trusted.surfaces
  if (trustedPlatforms && trustedPlatforms.length > 0) {
    if (
      candidate.platforms.length === 0 ||
      candidate.platforms.some(platform => !trustedPlatforms.includes(platform))
    ) {
      return true
    }
  }
  if (trustedSurfaces && trustedSurfaces.length > 0) {
    if (
      candidate.surfaces.length === 0 ||
      candidate.surfaces.some(surface => !trustedSurfaces.includes(surface))
    ) {
      return true
    }
  }
  return false
}

function escalatesEffect(
  candidate: AssistanceDraftRule['effect'],
  trusted: AssistanceDraftRequest['trustedContext']
) {
  if (candidate !== 'block') {
    return false
  }
  return trusted.effect === undefined || trusted.effect === 'reduce'
}

function removesProtectedException(
  candidate: AssistanceDraftRule,
  trusted: AssistanceDraftRequest['trustedContext']
) {
  return (trusted.protectedExclusions ?? []).some(
    entry => !candidate.exclusions.includes(entry)
  )
}

export function contextFieldRefs(
  trusted: AssistanceDraftRequest['trustedContext']
): DraftFieldRef[] {
  const refs: DraftFieldRef[] = []
  if (trusted.effect !== undefined) refs.push({ field: 'rule.effect' })
  if (trusted.platforms !== undefined)
    refs.push({ field: 'rule.scope.platforms' })
  if (trusted.surfaces !== undefined)
    refs.push({ field: 'rule.scope.surfaces' })
  if (trusted.description !== undefined)
    refs.push({ field: 'rule.description' })
  if (trusted.examples !== undefined) refs.push({ field: 'rule.examples' })
  if (trusted.exclusions !== undefined) refs.push({ field: 'rule.exclusions' })
  if (trusted.threshold !== undefined) refs.push({ field: 'rule.threshold' })
  return refs
}

export function evaluateDraftPolicy(input: {
  proposal: Omit<RuleDraftProposal, 'warnings'>
  request: AssistanceDraftRequest
}): RuleDraftProposal {
  const warnings: RuleDraftProposal['warnings'] = []
  if (expandsScope(input.proposal.rule.scope, input.request.trustedContext)) {
    warnings.push('scope-expansion')
  }
  if (
    escalatesEffect(input.proposal.rule.effect, input.request.trustedContext)
  ) {
    warnings.push('effect-escalation')
  }
  if (
    removesProtectedException(input.proposal.rule, input.request.trustedContext)
  ) {
    warnings.push('protected-exception')
  }
  return {
    ...input.proposal,
    warnings: unique(warnings)
  }
}
