import { t } from './runtime'

/**
 * Copy rendered inside a platform page. The content script cannot read a
 * catalog of its own without exposing extension files to the page, so the
 * service worker resolves these strings and ships them over the adapter
 * control port.
 */
export type InjectedOverlayCopy = {
  actionsLabel: string
  decisionConflict: string
  decisionFailed: string
  decisionPending: string
  hiddenHeading: string
  hideForSession: string
  reasonForRule: string
  reasonForSession: string
  reveal: string
}

export const injectedOverlayCopyFields = [
  'actionsLabel',
  'decisionConflict',
  'decisionFailed',
  'decisionPending',
  'hiddenHeading',
  'hideForSession',
  'reasonForRule',
  'reasonForSession',
  'reveal'
] as const satisfies readonly (keyof InjectedOverlayCopy)[]

export const getInjectedOverlayCopy = (): InjectedOverlayCopy => ({
  actionsLabel: t('injectedActionsLabel'),
  decisionConflict: t('injectedDecisionConflict'),
  decisionFailed: t('injectedDecisionFailed'),
  decisionPending: t('injectedDecisionPending'),
  hiddenHeading: t('injectedHiddenHeading'),
  hideForSession: t('injectedHideForSession'),
  reasonForRule: t('injectedReasonRule'),
  reasonForSession: t('injectedReasonSession'),
  reveal: t('injectedReveal')
})

export const isInjectedOverlayCopy = (
  value: unknown
): value is InjectedOverlayCopy =>
  typeof value === 'object' &&
  value !== null &&
  injectedOverlayCopyFields.every(
    field => typeof (value as Record<string, unknown>)[field] === 'string'
  )
