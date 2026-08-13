import type { PanelSetupResult } from './types'

export const reportPanelIssue = (result: PanelSetupResult): void => {
  if (result.status === 'supported') {
    return
  }

  console.warn('[ContentLens] Panel unavailable.', {
    reason: result.reason,
    surface: result.surface
  })
}
