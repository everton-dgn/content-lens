export type PanelSurface = 'chrome-side-panel' | 'firefox-sidebar'

export type PanelUnavailableReason =
  | 'api-unavailable'
  | 'configuration-failed'
  | 'open-failed'

export type PanelSetupResult =
  | {
      status: 'supported'
      surface: PanelSurface
    }
  | {
      status: 'unsupported'
      surface: PanelSurface
      reason: PanelUnavailableReason
    }

export type PanelIssueReporter = (
  issue: Extract<PanelSetupResult, { status: 'unsupported' }>
) => void

export type ChromePanelApi = {
  sidePanel?: {
    setPanelBehavior: (options: {
      openPanelOnActionClick: boolean
    }) => Promise<void>
  }
}

type ActionClickEvent = {
  addListener: (listener: () => void) => void
}

export type FirefoxPanelApi = {
  action?: {
    onClicked: ActionClickEvent
  }
  browserAction?: {
    onClicked: ActionClickEvent
  }
  sidebarAction?: {
    open: () => Promise<void>
  }
}
