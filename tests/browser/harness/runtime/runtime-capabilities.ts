import {
  type CapabilityProbeResult,
  deriveRuntimeState,
  type ProbeRuntimeState,
  probeCapability
} from './capability-probe'
import { probeIndexedDb } from './indexeddb-journal'

export interface ExtensionCapabilityEvidence {
  durationMs: number
  results: CapabilityProbeResult[]
  runtimeState: ProbeRuntimeState
}

export const probeExtensionCapabilities =
  async (): Promise<ExtensionCapabilityEvidence> => {
    const startedAt = performance.now()
    const context = {
      browserEnvironment: import.meta.env.BROWSER,
      checkedAt: new Date().toISOString(),
      productVersion: browser.runtime.getManifest().version
    }
    const results = await Promise.all([
      probeCapability(
        {
          fallback: 'Leave platform content visible.',
          id: 'runtime-messaging',
          invalidatedBy: ['extension-update', 'api-failure'],
          required: true,
          run: () =>
            typeof browser.runtime.sendMessage === 'function'
              ? { status: 'available' }
              : { status: 'absent', reason: 'runtime-messaging-absent' }
        },
        context
      ),
      probeCapability(
        {
          fallback: 'Block ContentLens mutations and expose a recovery path.',
          id: 'indexeddb',
          invalidatedBy: ['browser-update', 'storage-failure'],
          required: true,
          run: async () =>
            (await probeIndexedDb())
              ? { status: 'available' }
              : { status: 'absent', reason: 'indexeddb-unavailable' }
        },
        context
      ),
      probeCapability(
        {
          fallback: 'Keep deterministic filtering active.',
          id: 'webgpu',
          invalidatedBy: ['browser-update', 'device-change', 'api-failure'],
          required: false,
          run: async () => {
            const gpu = 'gpu' in navigator ? navigator.gpu : undefined
            if (!gpu) {
              return { status: 'absent', reason: 'webgpu-absent' }
            }

            return (await gpu.requestAdapter())
              ? { status: 'available' }
              : { status: 'absent', reason: 'webgpu-adapter-unavailable' }
          }
        },
        context
      )
    ])

    return {
      durationMs: performance.now() - startedAt,
      results,
      runtimeState: deriveRuntimeState(results)
    }
  }
