import type { AdapterOriginMap } from '@/adapters/registry'
import type { PlatformActivationResult } from '@/application/adapter-activation/browser-content-scripts'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'
import type { InjectedOverlayCopy } from '@/i18n/overlay-copy'

export const ADAPTER_CONTROL_PORT_NAME = 'contentlens.adapter-control.v1'

export type AdapterControlMessage =
  | {
      type: 'adapter.control'
      platform: Platform
      state: 'active'
      surfaces: readonly PlatformSurface[]
      copy: InjectedOverlayCopy
    }
  | {
      type: 'adapter.control'
      platform: Platform
      state: 'inactive'
      code: PlatformActivationResult extends infer Result
        ? Result extends { state: 'inactive'; code: infer Code }
          ? Code
          : never
        : never
    }
  | {
      type: 'adapter.control'
      platform: Platform
      state: 'inactive'
      code: 'activation-unverified'
    }

export type AdapterControlPort = {
  name: string
  sender?: {
    frameId?: number
    id?: string
    tab?: {
      id?: number
      url?: string
    }
    url?: string
  }
  onDisconnect: {
    addListener(listener: () => void): void
  }
  postMessage(message: AdapterControlMessage): void
}

type TrustedPort = {
  platform: Platform
  port: AdapterControlPort
}

export class AdapterRuntimeControlHub {
  readonly #extensionId: string
  readonly #originMap: Pick<AdapterOriginMap, 'platformFor'>
  readonly #ports = new Set<TrustedPort>()
  readonly #states = new Map<Platform, AdapterControlMessage>()

  constructor(options: {
    extensionId: string
    originMap: Pick<AdapterOriginMap, 'platformFor'>
  }) {
    this.#extensionId = options.extensionId
    this.#originMap = options.originMap
  }

  attach(port: AdapterControlPort): boolean {
    const platform = this.#trustedPlatform(port)
    if (!platform) {
      return false
    }
    const trusted = { platform, port }
    this.#ports.add(trusted)
    port.onDisconnect.addListener(() => {
      this.#ports.delete(trusted)
    })
    port.postMessage(
      this.#states.get(platform) ?? {
        type: 'adapter.control',
        platform,
        state: 'inactive',
        code: 'activation-unverified'
      }
    )
    return true
  }

  publish(
    results: readonly PlatformActivationResult[],
    copy: InjectedOverlayCopy,
    enabledSurfaces: Readonly<
      Partial<Record<Platform, readonly PlatformSurface[]>>
    > = {}
  ) {
    for (const result of results) {
      const message: AdapterControlMessage =
        result.state === 'active'
          ? {
              type: 'adapter.control',
              platform: result.platform,
              state: 'active',
              surfaces: enabledSurfaces[result.platform] ?? [],
              copy
            }
          : {
              type: 'adapter.control',
              platform: result.platform,
              state: 'inactive',
              code: result.code
            }
      this.#states.set(result.platform, message)
    }
    for (const trusted of [...this.#ports]) {
      const state = this.#states.get(trusted.platform)
      if (!state) {
        continue
      }
      try {
        trusted.port.postMessage(state)
      } catch {
        this.#ports.delete(trusted)
      }
    }
  }

  #trustedPlatform(port: AdapterControlPort): Platform | undefined {
    if (port.name !== ADAPTER_CONTROL_PORT_NAME) {
      return undefined
    }
    const sender = port.sender
    const senderPlatform = this.#originMap.platformFor(sender?.url)
    const tabPlatform = this.#originMap.platformFor(sender?.tab?.url)
    if (
      sender?.id !== this.#extensionId ||
      sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) ||
      (sender.tab?.id ?? -1) < 0 ||
      !senderPlatform ||
      senderPlatform !== tabPlatform
    ) {
      return undefined
    }
    return senderPlatform
  }
}
