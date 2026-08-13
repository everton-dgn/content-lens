import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureChromePanel } from './chrome'
import { configureFirefoxPanel } from './firefox'
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

    await expect(configurePanelAction('chrome')).resolves.toEqual({
      status: 'supported',
      surface: 'chrome-side-panel'
    })
    expect(setPanelBehavior).toHaveBeenCalledOnce()
  })

  it('reports an unsupported result through the shared adapter', async () => {
    const reportIssue = vi.fn()
    vi.stubGlobal('chrome', {})

    await expect(configurePanelAction('chrome', reportIssue)).resolves.toEqual({
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

  it('opens the Firefox sidebar from the browser action handler', async () => {
    let clickListener: (() => void) | undefined
    const open = vi.fn().mockResolvedValue(undefined)

    await expect(
      configureFirefoxPanel({
        browserAction: {
          onClicked: {
            addListener: listener => {
              clickListener = listener
            }
          }
        },
        sidebarAction: { open }
      })
    ).resolves.toEqual({
      status: 'supported',
      surface: 'firefox-sidebar'
    })

    expect(clickListener).toBeTypeOf('function')
    clickListener?.()
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
  })

  it('reports a Firefox sidebar open failure with static metadata', async () => {
    let clickListener: (() => void) | undefined
    const reportIssue = vi.fn()

    await configureFirefoxPanel(
      {
        action: {
          onClicked: {
            addListener: listener => {
              clickListener = listener
            }
          }
        },
        sidebarAction: {
          open: vi.fn().mockRejectedValue(new Error('denied'))
        }
      },
      reportIssue
    )

    clickListener?.()
    await vi.waitFor(() =>
      expect(reportIssue).toHaveBeenCalledWith({
        status: 'unsupported',
        surface: 'firefox-sidebar',
        reason: 'open-failed'
      })
    )
  })

  it('keeps Firefox unsupported when its sidebar API is absent', async () => {
    await expect(
      configureFirefoxPanel({
        browserAction: {
          onClicked: {
            addListener: vi.fn()
          }
        }
      })
    ).resolves.toEqual({
      status: 'unsupported',
      surface: 'firefox-sidebar',
      reason: 'api-unavailable'
    })
  })

  it('keeps Firefox unsupported when listener registration fails', async () => {
    await expect(
      configureFirefoxPanel({
        action: {
          onClicked: {
            addListener: () => {
              throw new Error('denied')
            }
          }
        },
        sidebarAction: {
          open: vi.fn().mockResolvedValue(undefined)
        }
      })
    ).resolves.toEqual({
      status: 'unsupported',
      surface: 'firefox-sidebar',
      reason: 'configuration-failed'
    })
  })

  it('uses the global Firefox API through the shared adapter', async () => {
    const addListener = vi.fn()
    vi.stubGlobal('browser', {
      action: {
        onClicked: {
          addListener
        }
      },
      sidebarAction: {
        open: vi.fn().mockResolvedValue(undefined)
      }
    })

    await expect(configurePanelAction('firefox')).resolves.toEqual({
      status: 'supported',
      surface: 'firefox-sidebar'
    })
    expect(addListener).toHaveBeenCalledOnce()
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
