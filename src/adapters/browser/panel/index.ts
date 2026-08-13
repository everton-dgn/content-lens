import { configureChromePanel } from './chrome'
import { configureFirefoxPanel } from './firefox'
import { reportPanelIssue } from './report'
import type { PanelIssueReporter, PanelSetupResult } from './types'

export type SupportedBrowser = 'chrome' | 'firefox'

export const configurePanelAction = async (
  target: SupportedBrowser,
  reportIssue: PanelIssueReporter = reportPanelIssue
): Promise<PanelSetupResult> => {
  const result =
    target === 'firefox'
      ? await configureFirefoxPanel(undefined, reportIssue)
      : await configureChromePanel()

  if (result.status === 'unsupported') {
    reportIssue(result)
  }

  return result
}
