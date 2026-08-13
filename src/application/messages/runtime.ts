import type { AdapterOriginMap } from '@/adapters/registry'
import type { RssAcquisitionResult } from '@/adapters/rss'
import {
  CONTENT_LENS_MESSAGE_NAMESPACE,
  DEFAULT_MESSAGE_RATE_LIMIT,
  DEFAULT_MESSAGE_RATE_WINDOW_MS,
  type DecisionRequestMessage,
  decisionRequestMessageSchema,
  MAX_RUNTIME_MESSAGE_BYTES,
  type RuntimeDecision,
  type RuntimeMessageRejectionCode,
  type RuntimeMessageResponse,
  type RuntimeRequestMessage,
  rssCancelMessageSchema,
  rssRevalidateMessageSchema
} from '@/application/messages/contracts'
import {
  type SettingsRequestMessage,
  type SettingsRuntimeResponse,
  settingsRequestMessageSchema
} from '@/application/settings/runtime-contracts'
import type { Platform } from '@/core/content/contracts'

export type RuntimeMessageSender = {
  id?: string
  frameId?: number
  url?: string
  tab?: {
    id?: number
    url?: string
  }
}

type RateLimitOptions = {
  maximum: number
  windowMs: number
}

type RuntimeMessageListenerOptions = {
  extensionPageUrl?: string
  extensionPageUrls?: readonly string[]
  extensionId: string
  originMap: Pick<AdapterOriginMap, 'platformFor'>
  onDecisionRequest(
    message: DecisionRequestMessage
  ): RuntimeDecision | undefined | Promise<RuntimeDecision | undefined>
  onRssRevalidate?(
    feedId: string
  ): RssAcquisitionResult | Promise<RssAcquisitionResult>
  onRssCancel?(feedId: string): boolean | Promise<boolean>
  onSettingsRequest?(
    message: SettingsRequestMessage
  ): SettingsRuntimeResponse | Promise<SettingsRuntimeResponse>
  now?: () => number
  rateLimit?: Partial<RateLimitOptions>
}

type GuardResult =
  | {
      success: true
      message: RuntimeRequestMessage
    }
  | {
      success: false
      code: RuntimeMessageRejectionCode
    }

function rejection(code: RuntimeMessageRejectionCode): RuntimeMessageResponse {
  return {
    state: 'rejected',
    code
  }
}

function serializedMessageBytes(message: unknown) {
  try {
    const serialized = JSON.stringify(message)
    return serialized === undefined
      ? undefined
      : new TextEncoder().encode(serialized).byteLength
  } catch {
    return undefined
  }
}

function trustedSender(
  sender: RuntimeMessageSender,
  extensionId: string,
  originMap: Pick<AdapterOriginMap, 'platformFor'>
): { key: string; platform: Platform } | undefined {
  const senderPlatform = originMap.platformFor(sender.url)
  const tabPlatform = originMap.platformFor(sender.tab?.url)
  if (
    sender.id !== extensionId ||
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id) ||
    (sender.tab?.id ?? -1) < 0 ||
    !senderPlatform ||
    !tabPlatform ||
    senderPlatform !== tabPlatform
  ) {
    return undefined
  }
  return {
    key: `${sender.tab?.id ?? -1}:${sender.frameId}`,
    platform: senderPlatform
  }
}

function trustedExtensionPageSender(
  sender: RuntimeMessageSender,
  extensionId: string,
  extensionPageUrls: readonly string[]
): string | undefined {
  const extensionPageUrl = extensionPageUrls.find(
    candidate => candidate === sender.url
  )
  const tabId = sender.tab?.id
  const trustedTab =
    sender.tab === undefined ||
    (Number.isInteger(tabId) &&
      (tabId ?? -1) >= 0 &&
      sender.tab.url === extensionPageUrl)
  if (
    !extensionPageUrl ||
    sender.id !== extensionId ||
    sender.url !== extensionPageUrl ||
    !trustedTab ||
    (sender.frameId !== undefined && sender.frameId !== 0)
  ) {
    return undefined
  }
  return `extension-page:${extensionPageUrl}:${tabId ?? 'standalone'}`
}

class SlidingWindowRateLimiter {
  static readonly maximumTrackedKeys = 1_024
  readonly #maximum: number
  readonly #windowMs: number
  readonly #acceptedAt = new Map<string, number[]>()

  constructor(options: RateLimitOptions) {
    this.#maximum = options.maximum
    this.#windowMs = options.windowMs
  }

  accept(key: string, at: number) {
    const cutoff = at - this.#windowMs
    for (const [trackedKey, acceptedAt] of this.#acceptedAt) {
      const recentForTrackedKey = acceptedAt.filter(
        accepted => accepted > cutoff
      )
      if (recentForTrackedKey.length === 0) {
        this.#acceptedAt.delete(trackedKey)
      } else if (recentForTrackedKey.length !== acceptedAt.length) {
        this.#acceptedAt.set(trackedKey, recentForTrackedKey)
      }
    }
    if (
      !this.#acceptedAt.has(key) &&
      this.#acceptedAt.size >= SlidingWindowRateLimiter.maximumTrackedKeys
    ) {
      const oldestKey = [...this.#acceptedAt.entries()].sort(
        ([, left], [, right]) => (left.at(-1) ?? 0) - (right.at(-1) ?? 0)
      )[0]?.[0]
      if (oldestKey !== undefined) {
        this.#acceptedAt.delete(oldestKey)
      }
    }
    const recent = (this.#acceptedAt.get(key) ?? []).filter(
      acceptedAt => acceptedAt > cutoff
    )
    if (recent.length >= this.#maximum) {
      this.#acceptedAt.set(key, recent)
      return false
    }
    recent.push(at)
    this.#acceptedAt.set(key, recent)
    return true
  }
}

function createGuard(options: RuntimeMessageListenerOptions) {
  const now = options.now ?? Date.now
  const limiter = new SlidingWindowRateLimiter({
    maximum: options.rateLimit?.maximum ?? DEFAULT_MESSAGE_RATE_LIMIT,
    windowMs: options.rateLimit?.windowMs ?? DEFAULT_MESSAGE_RATE_WINDOW_MS
  })
  const extensionPageUrls = [
    ...(options.extensionPageUrl ? [options.extensionPageUrl] : []),
    ...(options.extensionPageUrls ?? [])
  ]

  return (input: unknown, sender: RuntimeMessageSender): GuardResult => {
    const bytes = serializedMessageBytes(input)
    if (bytes === undefined) {
      return { success: false, code: 'invalid-message' }
    }
    if (bytes > MAX_RUNTIME_MESSAGE_BYTES) {
      return { success: false, code: 'message-too-large' }
    }
    if (
      typeof input !== 'object' ||
      input === null ||
      !('namespace' in input) ||
      input.namespace !== CONTENT_LENS_MESSAGE_NAMESPACE
    ) {
      return { success: false, code: 'invalid-namespace' }
    }
    if (!('type' in input)) {
      return { success: false, code: 'unknown-message-type' }
    }
    if (
      input.type === 'rss.revalidate' ||
      input.type === 'rss.cancel' ||
      input.type === 'settings.snapshot' ||
      input.type === 'settings.save' ||
      input.type === 'provider.create' ||
      input.type === 'provider.credential' ||
      input.type === 'provider.update' ||
      input.type === 'provider.disconnect' ||
      input.type === 'provider.remove.preview' ||
      input.type === 'provider.remove' ||
      input.type === 'provider.catalog.refresh' ||
      input.type === 'provider.test' ||
      input.type === 'provider.consent' ||
      input.type === 'model.register' ||
      input.type === 'sync.connect' ||
      input.type === 'sync.disconnect' ||
      input.type === 'sync.now' ||
      input.type === 'sync.schedule' ||
      input.type === 'sync.resolve' ||
      input.type === 'sync.recovery.restore' ||
      input.type === 'sync.remote.delete'
    ) {
      const key = trustedExtensionPageSender(
        sender,
        options.extensionId,
        extensionPageUrls
      )
      if (!key) {
        return { success: false, code: 'untrusted-sender' }
      }
      if (!limiter.accept(key, now())) {
        return { success: false, code: 'rate-limited' }
      }
      const parsed = input.type.startsWith('rss.')
        ? input.type === 'rss.revalidate'
          ? rssRevalidateMessageSchema.safeParse(input)
          : rssCancelMessageSchema.safeParse(input)
        : settingsRequestMessageSchema.safeParse(input)
      return parsed.success
        ? { success: true, message: parsed.data }
        : { success: false, code: 'invalid-message' }
    }
    if (input.type !== 'decision.request') {
      return { success: false, code: 'unknown-message-type' }
    }

    const trusted = trustedSender(
      sender,
      options.extensionId,
      options.originMap
    )
    if (!trusted) {
      return { success: false, code: 'untrusted-sender' }
    }
    if (!limiter.accept(trusted.key, now())) {
      return { success: false, code: 'rate-limited' }
    }
    if (!('platform' in input) || input.platform !== trusted.platform) {
      return { success: false, code: 'untrusted-sender' }
    }
    const parsed = decisionRequestMessageSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, code: 'invalid-message' }
    }
    return {
      success: true,
      message: parsed.data
    }
  }
}

export function createRuntimeMessageListener(
  options: RuntimeMessageListenerOptions
) {
  const guard = createGuard(options)

  return (
    input: unknown,
    sender: RuntimeMessageSender,
    sendResponse: (response: RuntimeMessageResponse) => void
  ) => {
    const guarded = guard(input, sender)
    if (!guarded.success) {
      sendResponse(rejection(guarded.code))
      return false
    }

    void Promise.resolve()
      .then(async (): Promise<RuntimeMessageResponse> => {
        if (
          guarded.message.type === 'settings.snapshot' ||
          guarded.message.type === 'settings.save' ||
          guarded.message.type === 'provider.create' ||
          guarded.message.type === 'provider.credential' ||
          guarded.message.type === 'provider.update' ||
          guarded.message.type === 'provider.disconnect' ||
          guarded.message.type === 'provider.remove.preview' ||
          guarded.message.type === 'provider.remove' ||
          guarded.message.type === 'provider.catalog.refresh' ||
          guarded.message.type === 'provider.test' ||
          guarded.message.type === 'provider.consent' ||
          guarded.message.type === 'model.register' ||
          guarded.message.type === 'sync.connect' ||
          guarded.message.type === 'sync.disconnect' ||
          guarded.message.type === 'sync.now' ||
          guarded.message.type === 'sync.schedule' ||
          guarded.message.type === 'sync.resolve' ||
          guarded.message.type === 'sync.recovery.restore' ||
          guarded.message.type === 'sync.remote.delete'
        ) {
          if (!options.onSettingsRequest) {
            throw new Error('settings-handler-unavailable')
          }
          return {
            state: 'acknowledged',
            requestId: guarded.message.requestId,
            settings: await options.onSettingsRequest(guarded.message)
          }
        }
        if (guarded.message.type === 'rss.cancel') {
          if (!options.onRssCancel) {
            throw new Error('rss-cancel-handler-unavailable')
          }
          await options.onRssCancel(guarded.message.feedId)
          return {
            state: 'acknowledged',
            requestId: guarded.message.requestId
          }
        }
        if (guarded.message.type === 'rss.revalidate') {
          if (!options.onRssRevalidate) {
            throw new Error('rss-revalidation-handler-unavailable')
          }
          return {
            state: 'acknowledged',
            requestId: guarded.message.requestId,
            rss: await options.onRssRevalidate(guarded.message.feedId)
          }
        }
        const decision = await options.onDecisionRequest(guarded.message)
        return {
          state: 'acknowledged',
          requestId: guarded.message.requestId,
          ...(decision ? { decision } : {})
        }
      })
      .then(sendResponse)
      .catch(() => {
        sendResponse(rejection('processing-failed'))
      })
    return true
  }
}
