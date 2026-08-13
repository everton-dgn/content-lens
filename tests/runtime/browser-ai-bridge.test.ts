import { describe, expect, it, vi } from 'vitest'

import {
  BROWSER_AI_PORT_NAME,
  BrowserAiBridgeClient,
  type BrowserAiRuntimePort,
  startBrowserAiBridgeHost
} from '@/ai/browser/bridge'

class PortEvent<T extends (...args: never[]) => void> {
  readonly listeners = new Set<T>()

  addListener(listener: T) {
    this.listeners.add(listener)
  }

  removeListener(listener: T) {
    this.listeners.delete(listener)
  }

  emit(...args: Parameters<T>) {
    for (const listener of this.listeners) {
      listener(...args)
    }
  }
}

function portPair() {
  const leftMessage = new PortEvent<(message: unknown) => void>()
  const rightMessage = new PortEvent<(message: unknown) => void>()
  const leftDisconnect = new PortEvent<() => void>()
  const rightDisconnect = new PortEvent<() => void>()
  const left: BrowserAiRuntimePort = {
    name: BROWSER_AI_PORT_NAME,
    postMessage: message => rightMessage.emit(message),
    onMessage: leftMessage,
    onDisconnect: leftDisconnect
  }
  const right: BrowserAiRuntimePort = {
    name: BROWSER_AI_PORT_NAME,
    postMessage: message => leftMessage.emit(message),
    onMessage: rightMessage,
    onDisconnect: rightDisconnect
  }
  return {
    left,
    right,
    disconnect() {
      leftDisconnect.emit()
      rightDisconnect.emit()
    }
  }
}

const request = {
  task: 'assistance-explain' as const,
  prompt: 'fixture',
  language: 'en' as const,
  responseConstraint: {
    type: 'object',
    properties: { answer: { type: 'string' } }
  }
}

describe('browser AI document bridge', () => {
  it('returns unavailable when no extension document is connected', async () => {
    const client = new BrowserAiBridgeClient()
    await expect(client.execute(request)).resolves.toEqual({
      state: 'unavailable',
      code: 'document-unavailable'
    })
  })

  it('round-trips a bounded request through the connected document', async () => {
    const ports = portPair()
    const executor = {
      execute: vi.fn().mockResolvedValue({
        state: 'output',
        value: { answer: 'ok' }
      })
    }
    const host = startBrowserAiBridgeHost({
      port: ports.right,
      executor
    })
    const client = new BrowserAiBridgeClient({
      createId: () => 'browser-ai:request'
    })
    expect(client.attach(ports.left)).toBe(true)

    await expect(client.execute(request)).resolves.toEqual({
      state: 'output',
      value: { answer: 'ok' }
    })
    expect(executor.execute).toHaveBeenCalledWith({
      ...request,
      signal: expect.any(AbortSignal)
    })

    host.dispose()
  })

  it('cancels in-flight work and settles pending calls on disconnect', async () => {
    const ports = portPair()
    let executionSignal: AbortSignal | undefined
    const host = startBrowserAiBridgeHost({
      port: ports.right,
      executor: {
        execute: async input => {
          executionSignal = input.signal
          await new Promise<void>(resolve => {
            input.signal?.addEventListener('abort', () => resolve(), {
              once: true
            })
          })
          return { state: 'failed', code: 'cancelled' }
        }
      }
    })
    const client = new BrowserAiBridgeClient({
      createId: () => 'browser-ai:cancel'
    })
    client.attach(ports.left)
    const controller = new AbortController()
    const pending = client.execute({ ...request, signal: controller.signal })
    await Promise.resolve()
    controller.abort()

    await expect(pending).resolves.toEqual({
      state: 'failed',
      code: 'cancelled'
    })
    expect(executionSignal?.aborted).toBe(true)

    const pendingAfterAttach = client.execute(request)
    ports.disconnect()
    await expect(pendingAfterAttach).resolves.toEqual({
      state: 'unavailable',
      code: 'document-unavailable'
    })
    host.dispose()
  })
})
