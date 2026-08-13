import { z } from 'zod'

import type {
  BrowserPromptExecutor,
  BrowserPromptRequest,
  BrowserPromptResult
} from '@/ai/browser/language-model'
import { modelTaskSchema } from '@/ai/models/contracts'

export const BROWSER_AI_PORT_NAME = 'contentlens.browser-ai.v1'
export const MAX_BROWSER_AI_BRIDGE_BYTES = 8 * 1024 * 1024

type PortEvent<T extends (...args: never[]) => void> = {
  addListener(listener: T): void
  removeListener(listener: T): void
}

export type BrowserAiRuntimePort = {
  name: string
  postMessage(message: unknown): void
  onMessage: PortEvent<(message: unknown) => void>
  onDisconnect: PortEvent<() => void>
}

const imageSchema = z.strictObject({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().max(7 * 1024 * 1024)
})
const payloadSchema = z.strictObject({
  task: modelTaskSchema,
  prompt: z.string().max(128 * 1024),
  language: z.enum(['en', 'es', 'pt_BR', 'unknown']),
  responseConstraint: z.record(z.string(), z.unknown()),
  image: imageSchema.optional()
})
const requestMessageSchema = z.strictObject({
  namespace: z.literal(BROWSER_AI_PORT_NAME),
  version: z.literal(1),
  type: z.literal('browser-ai.request'),
  requestId: z.string().min(1).max(256),
  payload: payloadSchema
})
const cancelMessageSchema = z.strictObject({
  namespace: z.literal(BROWSER_AI_PORT_NAME),
  version: z.literal(1),
  type: z.literal('browser-ai.cancel'),
  requestId: z.string().min(1).max(256)
})
const resultSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('output'),
    value: z.unknown()
  }),
  z.strictObject({
    state: z.literal('unavailable'),
    code: z.enum([
      'api-unavailable',
      'document-unavailable',
      'model-unavailable',
      'language-unsupported',
      'download-user-activation-required'
    ])
  }),
  z.strictObject({
    state: z.literal('failed'),
    code: z.enum([
      'cancelled',
      'timeout',
      'invalid-output',
      'unsupported-input',
      'provider-unavailable'
    ])
  })
])
const responseMessageSchema = z.strictObject({
  namespace: z.literal(BROWSER_AI_PORT_NAME),
  version: z.literal(1),
  type: z.literal('browser-ai.response'),
  requestId: z.string().min(1).max(256),
  result: resultSchema
})

function serializedBytes(value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : new TextEncoder().encode(serialized).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

type PendingRequest = {
  resolve(result: BrowserPromptResult): void
  signal?: AbortSignal
  abort?: () => void
}

export class BrowserAiBridgeClient implements BrowserPromptExecutor {
  readonly #createId: () => string
  readonly #pending = new Map<string, PendingRequest>()
  #port?: BrowserAiRuntimePort

  constructor(options: { createId?: () => string } = {}) {
    this.#createId = options.createId ?? (() => crypto.randomUUID())
  }

  attach(port: BrowserAiRuntimePort) {
    if (port.name !== BROWSER_AI_PORT_NAME) {
      return false
    }
    this.detach()
    this.#port = port
    port.onMessage.addListener(this.#onMessage)
    port.onDisconnect.addListener(this.#onDisconnect)
    return true
  }

  detach() {
    const port = this.#port
    if (port) {
      port.onMessage.removeListener(this.#onMessage)
      port.onDisconnect.removeListener(this.#onDisconnect)
      this.#port = undefined
    }
    this.#settleUnavailable()
  }

  async execute(request: BrowserPromptRequest): Promise<BrowserPromptResult> {
    const port = this.#port
    if (!port) {
      return { state: 'unavailable', code: 'document-unavailable' }
    }
    if (request.signal?.aborted) {
      return { state: 'failed', code: 'cancelled' }
    }
    const payload = payloadSchema.safeParse({
      task: request.task,
      prompt: request.prompt,
      language: request.language,
      responseConstraint: request.responseConstraint,
      ...(request.image ? { image: request.image } : {})
    })
    if (!payload.success) {
      return { state: 'failed', code: 'unsupported-input' }
    }
    const message = {
      namespace: BROWSER_AI_PORT_NAME,
      version: 1,
      type: 'browser-ai.request',
      requestId: this.#createId(),
      payload: payload.data
    } as const
    if (serializedBytes(message) > MAX_BROWSER_AI_BRIDGE_BYTES) {
      return { state: 'failed', code: 'unsupported-input' }
    }
    return new Promise<BrowserPromptResult>(resolve => {
      const abort = request.signal
        ? () => {
            if (!this.#pending.delete(message.requestId)) {
              return
            }
            port.postMessage({
              namespace: BROWSER_AI_PORT_NAME,
              version: 1,
              type: 'browser-ai.cancel',
              requestId: message.requestId
            })
            resolve({ state: 'failed', code: 'cancelled' })
          }
        : undefined
      this.#pending.set(message.requestId, {
        resolve,
        signal: request.signal,
        ...(abort ? { abort } : {})
      })
      request.signal?.addEventListener('abort', abort as () => void, {
        once: true
      })
      try {
        port.postMessage(message)
      } catch {
        this.#settle(message.requestId, {
          state: 'unavailable',
          code: 'document-unavailable'
        })
      }
    })
  }

  readonly #onMessage = (message: unknown) => {
    const parsed = responseMessageSchema.safeParse(message)
    if (!parsed.success) {
      return
    }
    this.#settle(parsed.data.requestId, parsed.data.result)
  }

  readonly #onDisconnect = () => {
    this.detach()
  }

  #settle(requestId: string, result: BrowserPromptResult) {
    const pending = this.#pending.get(requestId)
    if (!pending) {
      return
    }
    this.#pending.delete(requestId)
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener('abort', pending.abort)
    }
    pending.resolve(result)
  }

  #settleUnavailable() {
    for (const requestId of [...this.#pending.keys()]) {
      this.#settle(requestId, {
        state: 'unavailable',
        code: 'document-unavailable'
      })
    }
  }
}

export function startBrowserAiBridgeHost(input: {
  port: BrowserAiRuntimePort
  executor: BrowserPromptExecutor
}) {
  const controllers = new Map<string, AbortController>()
  const onMessage = (message: unknown) => {
    const cancel = cancelMessageSchema.safeParse(message)
    if (cancel.success) {
      controllers.get(cancel.data.requestId)?.abort()
      controllers.delete(cancel.data.requestId)
      return
    }
    const request = requestMessageSchema.safeParse(message)
    if (
      !request.success ||
      serializedBytes(message) > MAX_BROWSER_AI_BRIDGE_BYTES
    ) {
      return
    }
    const controller = new AbortController()
    controllers.set(request.data.requestId, controller)
    void input.executor
      .execute({
        ...request.data.payload,
        signal: controller.signal
      })
      .then(result => {
        if (!controllers.delete(request.data.requestId)) {
          return
        }
        input.port.postMessage({
          namespace: BROWSER_AI_PORT_NAME,
          version: 1,
          type: 'browser-ai.response',
          requestId: request.data.requestId,
          result
        })
      })
      .catch(() => {
        if (!controllers.delete(request.data.requestId)) {
          return
        }
        input.port.postMessage({
          namespace: BROWSER_AI_PORT_NAME,
          version: 1,
          type: 'browser-ai.response',
          requestId: request.data.requestId,
          result: { state: 'failed', code: 'provider-unavailable' }
        })
      })
  }
  const onDisconnect = () => {
    for (const controller of controllers.values()) {
      controller.abort()
    }
    controllers.clear()
  }
  input.port.onMessage.addListener(onMessage)
  input.port.onDisconnect.addListener(onDisconnect)
  return {
    dispose() {
      input.port.onMessage.removeListener(onMessage)
      input.port.onDisconnect.removeListener(onDisconnect)
      onDisconnect()
    }
  }
}
