import type { ChromePanelApi, PanelSetupResult } from './types'

const surface = 'chrome-side-panel' as const

const getChromeApi = (): ChromePanelApi =>
  (globalThis as typeof globalThis & { chrome?: ChromePanelApi }).chrome ?? {}

export const configureChromePanel = async (
  api: ChromePanelApi = getChromeApi()
): Promise<PanelSetupResult> => {
  if (!api.sidePanel) {
    return {
      status: 'unsupported',
      surface,
      reason: 'api-unavailable'
    }
  }

  try {
    await api.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    })

    return {
      status: 'supported',
      surface
    }
  } catch {
    return {
      status: 'unsupported',
      surface,
      reason: 'configuration-failed'
    }
  }
}
