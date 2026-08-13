import { browser } from 'wxt/browser'

import { installedAdapterOriginMap } from '@/adapters/registry'
import {
  ADAPTER_CONTROL_PORT_NAME,
  type AdapterControlMessage
} from '@/application/adapter-activation/runtime-control'
import {
  CONTENT_LENS_MESSAGE_NAMESPACE,
  type RuntimeMessageResponse
} from '@/application/messages/contracts'
import type { ContentItem, Platform } from '@/core/content/contracts'
import {
  type PlatformSurface,
  platformSurfaceSchema
} from '@/core/content/surfaces'
import {
  type DomRuntimeFocusAnchor,
  type DomRuntimeSessionActions,
  startDomContentRuntime
} from '@/extension/content-script/dom-runtime'
import {
  enabledInstalledRouteSurfaces,
  installedDomRuntimeDefinition
} from '@/extension/content-script/installed-runtime'
import {
  type PlatformContentLifecycle,
  startPlatformContentLifecycle
} from '@/extension/content-script/platform-lifecycle'
import { sendRuntimeMessageWithRetry } from '@/extension/content-script/runtime-messaging'
import { t } from '@/i18n/runtime'

const runtimeKey = Symbol.for('contentlens.platform.runtime')
const runtimeMessageAttempts = 3
const runtimeMessageRetryDelayMs = 50

type ContentRuntimeGlobal = typeof globalThis & {
  [runtimeKey]?: {
    dispose(): void
  }
}

function requestId(pageInstanceId: string) {
  return `${pageInstanceId}:${crypto.randomUUID()}`
}

function isControlMessage(
  input: unknown,
  platform: Platform
): input is AdapterControlMessage {
  if (
    !(
      typeof input === 'object' &&
      input !== null &&
      'type' in input &&
      input.type === 'adapter.control' &&
      'platform' in input &&
      input.platform === platform &&
      'state' in input &&
      (input.state === 'active' || input.state === 'inactive')
    )
  ) {
    return false
  }
  if (input.state === 'inactive') {
    return 'code' in input && typeof input.code === 'string'
  }
  return (
    'surfaces' in input &&
    Array.isArray(input.surfaces) &&
    input.surfaces.every(
      surface =>
        platformSurfaceSchema.safeParse(surface).success &&
        surface.startsWith(`${platform}:`)
    )
  )
}

export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    const runtimeGlobal = globalThis as ContentRuntimeGlobal
    runtimeGlobal[runtimeKey]?.dispose()
    const platform = installedAdapterOriginMap.platformFor(location.href)
    const definition = platform
      ? installedDomRuntimeDefinition(platform)
      : undefined
    if (!definition) {
      return
    }
    const sessionActions: DomRuntimeSessionActions = new Map()
    let disposed = false
    let enabledSurfaces = new Set<PlatformSurface>()
    let lifecycle: PlatformContentLifecycle | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let controlPort: ReturnType<typeof browser.runtime.connect> | undefined

    const stop = () => {
      lifecycle?.dispose()
      lifecycle = undefined
    }
    const start = () => {
      if (disposed || lifecycle) {
        return
      }
      lifecycle = startPlatformContentLifecycle<DomRuntimeFocusAnchor>({
        browserName: import.meta.env.BROWSER,
        createRuntime: ({ pageInstanceId, restoreFocus, surface }) =>
          startDomContentRuntime(document, {
            adapter: definition.adapter,
            copy: {
              actionsLabel: t('injectedActionsLabel'),
              decisionConflict: t('injectedDecisionConflict'),
              decisionFailed: t('injectedDecisionFailed'),
              decisionPending: t('injectedDecisionPending'),
              hiddenHeading: t('injectedHiddenHeading'),
              hideForSession: t('injectedHideForSession'),
              reasonForRule: t('injectedReasonRule'),
              reasonForSession: t('injectedReasonSession'),
              reveal: t('injectedReveal')
            },
            pageInstanceId,
            enabledSurfaces: [...enabledSurfaces],
            requestDecision: async (
              item: ContentItem,
              candidatePageInstanceId: string
            ) => {
              const message = {
                namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
                version: 1,
                type: 'decision.request',
                platform: item.platform,
                requestId: requestId(candidatePageInstanceId),
                pageInstanceId: candidatePageInstanceId,
                item
              } as const
              const response = await sendRuntimeMessageWithRetry(
                input =>
                  browser.runtime.sendMessage(
                    input
                  ) as Promise<RuntimeMessageResponse>,
                message,
                {
                  attempts: runtimeMessageAttempts,
                  delayMs: runtimeMessageRetryDelayMs
                }
              )
              if (response.state === 'rejected') {
                throw new Error(`Decision request rejected: ${response.code}`)
              }
              return response.decision
            },
            ...(restoreFocus ? { restoreFocus } : {}),
            sessionActions,
            surface
          }),
        document,
        location,
        matchLocation: url => {
          const match = definition.matchLocation(url)
          return match.state !== 'unsupported' &&
            enabledInstalledRouteSurfaces(match.surface, enabledSurfaces)
              .length === 0
            ? { state: 'unsupported', code: 'surface-disabled' }
            : match
        },
        platform: definition.platform,
        spaEvents: definition.spaEvents,
        target: globalThis
      })
    }
    const connect = () => {
      if (disposed) {
        return
      }
      const port = browser.runtime.connect({
        name: ADAPTER_CONTROL_PORT_NAME
      })
      controlPort = port
      port.onMessage.addListener(message => {
        if (!isControlMessage(message, definition.platform)) {
          return
        }
        if (message.state === 'active') {
          enabledSurfaces = new Set(message.surfaces)
          stop()
          start()
        } else {
          enabledSurfaces.clear()
          stop()
        }
      })
      port.onDisconnect.addListener(() => {
        if (controlPort !== port || disposed) {
          return
        }
        controlPort = undefined
        stop()
        reconnectTimer = setTimeout(connect, 250)
      })
    }

    runtimeGlobal[runtimeKey] = {
      dispose() {
        if (disposed) {
          return
        }
        disposed = true
        stop()
        if (reconnectTimer !== undefined) {
          clearTimeout(reconnectTimer)
        }
        controlPort?.disconnect()
        controlPort = undefined
      }
    }
    connect()
  }
})
