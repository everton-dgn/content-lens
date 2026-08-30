import { configureChromePanel } from './chrome'
import { reportPanelIssue } from './report'
import type { PanelIssueReporter, PanelSetupResult } from './types'

export const configurePanelAction = async (
  reportIssue: PanelIssueReporter = reportPanelIssue
): Promise<PanelSetupResult> => {
  const result = await configureChromePanel()

  if (result.status === 'unsupported') {
    reportIssue(result)
  }

  return result
}
