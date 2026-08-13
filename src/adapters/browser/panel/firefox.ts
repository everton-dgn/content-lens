import { reportPanelIssue } from './report'
import type {
  FirefoxPanelApi,
  PanelIssueReporter,
  PanelSetupResult
} from './types'

const surface = 'firefox-sidebar' as const

const getFirefoxApi = (): FirefoxPanelApi =>
  (globalThis as typeof globalThis & { browser?: FirefoxPanelApi }).browser ??
  {}

export const configureFirefoxPanel = (
  api: FirefoxPanelApi = getFirefoxApi(),
  reportIssue: PanelIssueReporter = reportPanelIssue
): Promise<PanelSetupResult> => {
  const action = api.action ?? api.browserAction
  const sidebarAction = api.sidebarAction

  if (!action || !sidebarAction) {
    return Promise.resolve({
      status: 'unsupported',
      surface,
      reason: 'api-unavailable'
    })
  }

  try {
    action.onClicked.addListener(() => {
      void sidebarAction.open().catch(() =>
        reportIssue({
          status: 'unsupported',
          surface,
          reason: 'open-failed'
        })
      )
    })

    return Promise.resolve({
      status: 'supported',
      surface
    })
  } catch {
    return Promise.resolve({
      status: 'unsupported',
      surface,
      reason: 'configuration-failed'
    })
  }
}
