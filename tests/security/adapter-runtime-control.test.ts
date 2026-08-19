import { describe, expect, it, vi } from 'vitest'

import { installedAdapterOriginMap } from '@/adapters/registry'
import {
  ADAPTER_CONTROL_PORT_NAME,
  type AdapterControlMessage,
  type AdapterControlPort,
  AdapterRuntimeControlHub
} from '@/application/adapter-activation/runtime-control'
import type { InjectedOverlayCopy } from '@/i18n/overlay-copy'

const overlayCopy: InjectedOverlayCopy = {
  actionsLabel: 'actions',
  decisionConflict: 'conflict',
  decisionFailed: 'failed',
  decisionPending: 'pending',
  hiddenHeading: 'hidden',
  hideForSession: 'hide',
  reasonForRule: 'rule',
  reasonForSession: 'session',
  reveal: 'reveal'
}

function port(overrides: Partial<AdapterControlPort> = {}) {
  let disconnect: () => void = () => undefined
  const postMessage = vi.fn<(message: AdapterControlMessage) => void>()
  const value: AdapterControlPort = {
    name: ADAPTER_CONTROL_PORT_NAME,
    sender: {
      frameId: 0,
      id: 'extension-id',
      tab: { id: 7, url: 'https://www.reddit.com/r/all' },
      url: 'https://www.reddit.com/r/all'
    },
    onDisconnect: {
      addListener: listener => {
        disconnect = listener
      }
    },
    postMessage,
    ...overrides
  }
  return { disconnect: () => disconnect(), port: value, postMessage }
}

describe('adapter runtime control hub', () => {
  it('keeps a trusted content script inactive until activation is verified', () => {
    const channel = port()
    const hub = new AdapterRuntimeControlHub({
      extensionId: 'extension-id',
      originMap: installedAdapterOriginMap
    })

    expect(hub.attach(channel.port)).toBe(true)
    expect(channel.postMessage).toHaveBeenCalledWith({
      type: 'adapter.control',
      platform: 'reddit',
      state: 'inactive',
      code: 'activation-unverified'
    })

    hub.publish(
      [
        {
          state: 'active',
          platform: 'reddit',
          origins: ['https://www.reddit.com/*']
        }
      ],
      overlayCopy,
      { reddit: ['reddit:home', 'reddit:all'] }
    )
    expect(channel.postMessage).toHaveBeenLastCalledWith({
      type: 'adapter.control',
      platform: 'reddit',
      state: 'active',
      surfaces: ['reddit:home', 'reddit:all'],
      copy: overlayCopy
    })
  })

  it('rejects subframes, lookalikes and platform mismatches', () => {
    const hub = new AdapterRuntimeControlHub({
      extensionId: 'extension-id',
      originMap: installedAdapterOriginMap
    })
    const subframe = port({
      sender: {
        frameId: 1,
        id: 'extension-id',
        tab: { id: 7, url: 'https://www.reddit.com/r/all' },
        url: 'https://www.reddit.com/r/all'
      }
    })
    const lookalike = port({
      sender: {
        frameId: 0,
        id: 'extension-id',
        tab: { id: 7, url: 'https://www.reddit.com.evil.test/r/all' },
        url: 'https://www.reddit.com.evil.test/r/all'
      }
    })
    const mismatch = port({
      sender: {
        frameId: 0,
        id: 'extension-id',
        tab: { id: 7, url: 'https://x.com/home' },
        url: 'https://www.reddit.com/r/all'
      }
    })

    expect(hub.attach(subframe.port)).toBe(false)
    expect(hub.attach(lookalike.port)).toBe(false)
    expect(hub.attach(mismatch.port)).toBe(false)
    expect(subframe.postMessage).not.toHaveBeenCalled()
    expect(lookalike.postMessage).not.toHaveBeenCalled()
    expect(mismatch.postMessage).not.toHaveBeenCalled()
  })

  it('pushes revocation immediately and stops after disconnect', () => {
    const channel = port()
    const hub = new AdapterRuntimeControlHub({
      extensionId: 'extension-id',
      originMap: installedAdapterOriginMap
    })
    hub.attach(channel.port)
    hub.publish(
      [
        {
          state: 'inactive',
          platform: 'reddit',
          code: 'host-permission-missing'
        }
      ],
      overlayCopy
    )
    expect(channel.postMessage).toHaveBeenLastCalledWith({
      type: 'adapter.control',
      platform: 'reddit',
      state: 'inactive',
      code: 'host-permission-missing'
    })

    channel.disconnect()
    channel.postMessage.mockClear()
    hub.publish(
      [
        {
          state: 'active',
          platform: 'reddit',
          origins: ['https://www.reddit.com/*']
        }
      ],
      overlayCopy
    )
    expect(channel.postMessage).not.toHaveBeenCalled()
  })
})
