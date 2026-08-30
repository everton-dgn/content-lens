export type PanelSurface = 'chrome-side-panel'

export type PanelUnavailableReason = 'api-unavailable' | 'configuration-failed'

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
