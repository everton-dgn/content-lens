import { describe, expect, it, vi } from 'vitest'

import {
  BROWSER_AI_PORT_NAME,
  BrowserAiBridgeClient,
  type BrowserAiRuntimePort,
  MAX_BROWSER_AI_BRIDGE_BYTES,
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
    for (const listener of [...this.listeners]) {
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
  return { left, leftMessage, right, rightMessage }
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

const oversizedConstraint = {
  type: 'object',
  filler: 'x'.repeat(MAX_BROWSER_AI_BRIDGE_BYTES + 1)
}

describe('browser AI bridge client attachment', () => {
  it('refuses a port opened under another name', () => {
    const client = new BrowserAiBridgeClient()

    expect(client.attach({ ...portPair().left, name: 'some.other.port' })).toBe(
      false
    )
  })

  it('replaces the previous port when a second one attaches', async () => {
    const first = portPair()
    const second = portPair()
    const client = new BrowserAiBridgeClient({ createId: () => 'request:1' })
    client.attach(first.left)
    const pending = client.execute(request)

    // Attaching detaches the old port, which settles anything still in flight.
    client.attach(second.left)
    await expect(pending).resolves.toEqual({
      state: 'unavailable',
      code: 'document-unavailable'
    })
    expect(first.leftMessage.listeners.size).toBe(0)
  })

  it('mints its own request identifier when the caller supplies none', async () => {
    const ports = portPair()
    const seen: unknown[] = []
    ports.rightMessage.addListener(message => {
      seen.push(message)
    })
    const client = new BrowserAiBridgeClient()
    client.attach(ports.left)
    void client.execute(request)
    await Promise.resolve()

    expect(seen).toEqual([
      expect.objectContaining({
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
        )
      })
    ])
  })
})

describe('browser AI bridge client rejection', () => {
  const attached = () => {
    const ports = portPair()
    const client = new BrowserAiBridgeClient({ createId: () => 'request:1' })
    client.attach(ports.left)
    return { client, ports }
  }

  it('refuses a request whose caller already cancelled', async () => {
    const { client } = attached()
    const controller = new AbortController()
    controller.abort()

    await expect(
      client.execute({ ...request, signal: controller.signal })
    ).resolves.toEqual({ state: 'failed', code: 'cancelled' })
  })

  it('refuses a payload the contract does not accept', async () => {
    const { client } = attached()

    await expect(
      client.execute({
        ...request,
        language: 'fr' as unknown as typeof request.language
      })
    ).resolves.toEqual({ state: 'failed', code: 'unsupported-input' })
  })

  it('refuses a request larger than the bridge allows', async () => {
    const { client } = attached()

    await expect(
      client.execute({ ...request, responseConstraint: oversizedConstraint })
    ).resolves.toEqual({ state: 'failed', code: 'unsupported-input' })
  })

  it('reports the document as unavailable when the port throws', async () => {
    const ports = portPair()
    const client = new BrowserAiBridgeClient({ createId: () => 'request:1' })
    client.attach({
      ...ports.left,
      postMessage: () => {
        throw new Error('the port went away mid-send')
      }
    })

    await expect(client.execute(request)).resolves.toEqual({
      state: 'unavailable',
      code: 'document-unavailable'
    })
  })

  it('carries an image through when the request has one', async () => {
    const ports = portPair()
    const executor = {
      execute: vi.fn().mockResolvedValue({ state: 'output', value: 1 })
    }
    const host = startBrowserAiBridgeHost({ port: ports.right, executor })
    const client = new BrowserAiBridgeClient({ createId: () => 'request:1' })
    client.attach(ports.left)

    await client.execute({
      ...request,
      image: { mimeType: 'image/png', dataBase64: 'AAAA' }
    })

    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        image: { mimeType: 'image/png', dataBase64: 'AAAA' }
      })
    )
    host.dispose()
  })
})

describe('browser AI bridge client responses', () => {
  it('ignores a message that is not a bridge response', async () => {
    const ports = portPair()
    const client = new BrowserAiBridgeClient({ createId: () => 'request:1' })
    client.attach(ports.left)
    const pending = client.execute(request)

    ports.leftMessage.emit({ hello: 'world' })
    ports.leftMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.response',
      requestId: 'request:unknown',
      result: { state: 'output', value: 1 }
    })
    // Neither message matched anything in flight, so the call is still open.
    client.detach()

    await expect(pending).resolves.toEqual({
      state: 'unavailable',
      code: 'document-unavailable'
    })
  })
})

describe('browser AI bridge host rejection', () => {
  const hostWith = (
    execute: (input: {
      signal?: AbortSignal
    }) => Promise<never> | Promise<{ state: 'output'; value: unknown }>
  ) => {
    const ports = portPair()
    const responses: unknown[] = []
    ports.leftMessage.addListener(message => {
      responses.push(message)
    })
    const host = startBrowserAiBridgeHost({
      port: ports.right,
      executor: { execute }
    })
    return { host, ports, responses }
  }

  it('ignores a message that is neither a request nor a cancel', async () => {
    const execute = vi.fn(async () => ({ state: 'output' as const, value: 1 }))
    const { host, ports } = hostWith(execute)

    ports.rightMessage.emit({ namespace: BROWSER_AI_PORT_NAME, version: 2 })
    await Promise.resolve()

    expect(execute).not.toHaveBeenCalled()
    host.dispose()
  })

  it('ignores a request larger than the bridge allows', async () => {
    const execute = vi.fn(async () => ({ state: 'output' as const, value: 1 }))
    const { host, ports } = hostWith(execute)

    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: 'request:oversized',
      payload: { ...request, responseConstraint: oversizedConstraint }
    })
    await Promise.resolve()

    expect(execute).not.toHaveBeenCalled()
    host.dispose()
  })

  it('ignores a request it cannot even measure', async () => {
    const execute = vi.fn(async () => ({ state: 'output' as const, value: 1 }))
    const { host, ports } = hostWith(execute)

    // The response constraint takes unknown values, so a BigInt passes the
    // schema and then makes the size check throw.
    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: 'request:unmeasurable',
      payload: { ...request, responseConstraint: { limit: 1n } }
    })
    await Promise.resolve()

    expect(execute).not.toHaveBeenCalled()
    host.dispose()
  })

  it('reports an executor failure as a provider outage', async () => {
    const { host, ports, responses } = hostWith(async () => {
      throw new Error('the model runtime threw')
    })

    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: 'request:thrown',
      payload: request
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(responses).toEqual([
      expect.objectContaining({
        requestId: 'request:thrown',
        result: { state: 'failed', code: 'provider-unavailable' }
      })
    ])
    host.dispose()
  })

  it('stays quiet when the request was cancelled before the executor threw', async () => {
    const { host, ports, responses } = hostWith(async () => {
      throw new Error('the model runtime threw')
    })

    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: 'request:cancelled',
      payload: request
    })
    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.cancel',
      requestId: 'request:cancelled'
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(responses).toEqual([])
    host.dispose()
  })

  it('stays quiet when the request was cancelled before the executor resolved', async () => {
    const { host, ports, responses } = hostWith(async () => ({
      state: 'output' as const,
      value: 1
    }))

    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: 'request:raced',
      payload: request
    })
    ports.rightMessage.emit({
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.cancel',
      requestId: 'request:raced'
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(responses).toEqual([])
    host.dispose()
  })
})
