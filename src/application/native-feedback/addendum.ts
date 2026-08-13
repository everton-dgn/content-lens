import type { Platform } from '@/core/content/contracts'
import type {
  NativeFeedbackAction,
  NativeFeedbackCapability
} from '@/core/feedback/native-contracts'

export type NativeFeedbackAddendum = {
  platform: Platform
  adapterVersion: string
  addendumVersion: string
  fixtureVersion: string
  lastLiveSmokeAt: string | null
  capabilities: readonly NativeFeedbackCapability[]
  prohibitedActions: readonly string[]
}

export function unavailableCapability(input: {
  platform: Platform
  surface: string
  adapterVersion: string
  addendumVersion: string
  fixtureVersion: string
  code: string
  actionType?: NativeFeedbackAction
}): NativeFeedbackCapability {
  return {
    state:
      input.platform === 'hacker-news' || input.platform === 'rss'
        ? 'unavailable'
        : 'unsupported',
    platform: input.platform,
    surface: input.surface,
    ...(input.actionType ? { actionType: input.actionType } : {}),
    adapterVersion: input.adapterVersion,
    addendumVersion: input.addendumVersion,
    code: input.code,
    actionLabelPatterns: [],
    targetIdentity: 'stable platform content ID on the current page instance',
    positiveEvidence: 'none verified',
    timeoutMs: 2_000,
    cooldownMs: 24 * 60 * 60 * 1_000,
    reversibility: { kind: 'irreversible' },
    selectors: [],
    fixtureVersion: input.fixtureVersion,
    lastLiveSmokeAt: null
  }
}

export function findAddendumCapability(
  addendum: NativeFeedbackAddendum,
  surface: string,
  actionType: NativeFeedbackAction
): NativeFeedbackCapability {
  return (
    addendum.capabilities.find(
      capability =>
        capability.surface === surface && capability.actionType === actionType
    ) ??
    unavailableCapability({
      platform: addendum.platform,
      surface,
      actionType,
      adapterVersion: addendum.adapterVersion,
      addendumVersion: addendum.addendumVersion,
      fixtureVersion: addendum.fixtureVersion,
      code: 'native-action-not-declared'
    })
  )
}
