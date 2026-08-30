import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureChromePanel } from './chrome'
import { configurePanelAction } from './index'
import { reportPanelIssue } from './report'

describe('panel adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('configures Chrome to open the side panel from the action click', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined)

    await expect(
      configureChromePanel({
        sidePanel: {
          setPanelBehavior
        }
      })
    ).resolves.toEqual({
      status: 'supported',
      surface: 'chrome-side-panel'
    })
    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true
    })
  })

  it('keeps Chrome unsupported when the side panel API is absent', async () => {
    await expect(configureChromePanel({})).resolves.toEqual({
      status: 'unsupported',
      surface: 'chrome-side-panel',
      reason: 'api-unavailable'
    })
  })

  it('keeps Chrome unsupported when behavior configuration fails', async () => {
    await expect(
      configureChromePanel({
        sidePanel: {
          setPanelBehavior: vi.fn().mockRejectedValue(new Error('denied'))
        }
      })
    ).resolves.toEqual({
      status: 'unsupported',
      surface: 'chrome-side-panel',
      reason: 'configuration-failed'
    })
  })

  it('uses the global Chrome API through the shared adapter', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('chrome', {
      sidePanel: {
        setPanelBehavior
      }
    })

    await expect(configurePanelAction()).resolves.toEqual({
      status: 'supported',
      surface: 'chrome-side-panel'
    })
    expect(setPanelBehavior).toHaveBeenCalledOnce()
  })

  it('reports an unsupported result through the shared adapter', async () => {
    const reportIssue = vi.fn()
    vi.stubGlobal('chrome', {})

    await expect(configurePanelAction(reportIssue)).resolves.toEqual({
      status: 'unsupported',
      surface: 'chrome-side-panel',
      reason: 'api-unavailable'
    })
    expect(reportIssue).toHaveBeenCalledWith({
      status: 'unsupported',
      surface: 'chrome-side-panel',
      reason: 'api-unavailable'
    })
  })

  it('reports only unsupported panel setup results', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    reportPanelIssue({
      status: 'supported',
      surface: 'chrome-side-panel'
    })
    expect(warn).not.toHaveBeenCalled()

    reportPanelIssue({
      status: 'unsupported',
      surface: 'chrome-side-panel',
      reason: 'api-unavailable'
    })
    expect(warn).toHaveBeenCalledWith('[ContentLens] Panel unavailable.', {
      reason: 'api-unavailable',
      surface: 'chrome-side-panel'
    })
  })
})
