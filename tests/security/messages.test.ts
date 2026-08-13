import { describe, expect, it, vi } from 'vitest'

import { AdapterOriginMap } from '@/adapters/registry'
import {
  CONTENT_LENS_MESSAGE_NAMESPACE,
  type DecisionRequestMessage,
  MAX_RUNTIME_MESSAGE_BYTES,
  type RssCancelMessage,
  type RssRevalidateMessage
} from '@/application/messages/contracts'
import {
  createRuntimeMessageListener,
  type RuntimeMessageSender
} from '@/application/messages/runtime'
import type { SettingsRequestMessage } from '@/application/settings/runtime-contracts'
import type { ContentItem } from '@/core/content/contracts'

const extensionId = 'content-lens-test-extension'
const timestamp = '2026-07-29T22:30:00.000Z'
const originMap = new AdapterOriginMap([
  {
    origin: 'https://www.youtube.com',
    platform: 'youtube'
  },
  {
    origin: 'https://www.linkedin.com',
    platform: 'linkedin'
  }
])

const item: ContentItem = {
  id: 'youtube:video:secure-message',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'secure-message'
  },
  surface: 'youtube:home',
  title: 'A normalized title',
  media: [],
  observedAt: timestamp,
  context: {}
}

const message: DecisionRequestMessage = {
  namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
  version: 1,
  type: 'decision.request',
  platform: 'youtube',
  requestId: 'request:secure-message',
  pageInstanceId: 'page:secure-message',
  item
}

const sender: RuntimeMessageSender = {
  id: extensionId,
  frameId: 0,
  url: 'https://www.youtube.com/',
  tab: {
    id: 7,
    url: 'https://www.youtube.com/'
  }
}
const extensionPageUrl = `chrome-extension://${extensionId}/sidepanel.html`
const optionsPageUrl = `chrome-extension://${extensionId}/options.html`
const rssMessage: RssRevalidateMessage = {
  namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
  version: 1,
  type: 'rss.revalidate',
  requestId: 'request:rss-revalidate',
  feedId: 'rss-feed:00000000-0000-4000-8000-000000000001'
}
const rssCancelMessage: RssCancelMessage = {
  namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
  version: 1,
  type: 'rss.cancel',
  requestId: 'request:rss-cancel',
  feedId: rssMessage.feedId
}
const settingsSnapshotMessage: SettingsRequestMessage = {
  namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
  version: 1,
  type: 'settings.snapshot',
  requestId: 'request:settings-snapshot'
}

function invoke(
  listener: ReturnType<typeof createRuntimeMessageListener>,
  input: unknown,
  inputSender: RuntimeMessageSender
) {
  return new Promise<unknown>(resolve => {
    const asynchronous = listener(input, inputSender, resolve)
    if (asynchronous !== true) {
      queueMicrotask(() => resolve(undefined))
    }
  })
}

describe('runtime message security boundary', () => {
  it('accepts Settings only from the exact extension page', async () => {
    const onDecisionRequest = vi.fn()
    const onSettingsRequest = vi.fn(async () => ({
      kind: 'unavailable' as const,
      code: 'profile-not-found' as const
    }))
    const listener = createRuntimeMessageListener({
      extensionId,
      extensionPageUrl,
      originMap,
      onDecisionRequest,
      onSettingsRequest,
      now: () => 1_000
    })

    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        url: extensionPageUrl
      })
    ).resolves.toEqual({
      state: 'acknowledged',
      requestId: settingsSnapshotMessage.requestId,
      settings: { kind: 'unavailable', code: 'profile-not-found' }
    })
    expect(onSettingsRequest).toHaveBeenCalledWith(settingsSnapshotMessage)

    await expect(
      invoke(listener, settingsSnapshotMessage, sender)
    ).resolves.toEqual({ state: 'rejected', code: 'untrusted-sender' })
    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        url: `${extensionPageUrl}?forged=1`
      })
    ).resolves.toEqual({ state: 'rejected', code: 'untrusted-sender' })
    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        frameId: 0,
        url: extensionPageUrl,
        tab: { id: 11, url: extensionPageUrl }
      })
    ).resolves.toMatchObject({
      state: 'acknowledged',
      requestId: settingsSnapshotMessage.requestId
    })
    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        frameId: 0,
        url: extensionPageUrl,
        tab: { id: 11, url: optionsPageUrl }
      })
    ).resolves.toEqual({ state: 'rejected', code: 'untrusted-sender' })
    expect(onSettingsRequest).toHaveBeenCalledTimes(2)
    expect(onDecisionRequest).not.toHaveBeenCalled()
  })

  it('accepts Settings from the exact options page allowlist', async () => {
    const onSettingsRequest = vi.fn(async () => ({
      kind: 'unavailable' as const,
      code: 'profile-not-found' as const
    }))
    const listener = createRuntimeMessageListener({
      extensionId,
      extensionPageUrls: [extensionPageUrl, optionsPageUrl],
      originMap,
      onDecisionRequest: vi.fn(),
      onSettingsRequest,
      now: () => 1_000
    })

    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        url: optionsPageUrl
      })
    ).resolves.toMatchObject({
      state: 'acknowledged',
      requestId: settingsSnapshotMessage.requestId
    })
    await expect(
      invoke(listener, settingsSnapshotMessage, {
        id: extensionId,
        url: `${optionsPageUrl}?forged=1`
      })
    ).resolves.toEqual({ state: 'rejected', code: 'untrusted-sender' })
    expect(onSettingsRequest).toHaveBeenCalledOnce()
  })

  it('rejects malformed credential messages before any secret handler runs', async () => {
    const onDecisionRequest = vi.fn()
    const onSettingsRequest = vi.fn()
    const listener = createRuntimeMessageListener({
      extensionId,
      extensionPageUrl,
      originMap,
      onDecisionRequest,
      onSettingsRequest,
      now: () => 1_000
    })
    const malformed = {
      namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
      version: 1,
      type: 'provider.credential',
      requestId: 'request:credential-malformed',
      providerConfigId: 'provider:fixture',
      mode: 'session-only',
      value: 'credential-canary',
      leakedCopy: 'credential-canary'
    }

    await expect(
      invoke(listener, malformed, {
        id: extensionId,
        url: extensionPageUrl
      })
    ).resolves.toEqual({ state: 'rejected', code: 'invalid-message' })
    expect(onSettingsRequest).not.toHaveBeenCalled()
  })

  it('accepts RSS revalidation only from the exact extension page', async () => {
    const onDecisionRequest = vi.fn()
    const onRssCancel = vi.fn(async () => true)
    const onRssRevalidate = vi.fn(async (feedId: string) => ({
      state: 'unavailable' as const,
      feedId,
      code: 'dns-api-unavailable' as const,
      durationMs: 0
    }))
    const listener = createRuntimeMessageListener({
      extensionId,
      extensionPageUrl,
      originMap,
      onDecisionRequest,
      onRssCancel,
      onRssRevalidate,
      now: () => 1_000
    })

    expect(
      await invoke(listener, rssMessage, {
        id: extensionId,
        url: extensionPageUrl
      })
    ).toEqual({
      state: 'acknowledged',
      requestId: rssMessage.requestId,
      rss: {
        state: 'unavailable',
        feedId: rssMessage.feedId,
        code: 'dns-api-unavailable',
        durationMs: 0
      }
    })
    expect(onRssRevalidate).toHaveBeenCalledWith(rssMessage.feedId)
    expect(onDecisionRequest).not.toHaveBeenCalled()

    await expect(
      invoke(listener, rssMessage, {
        id: extensionId,
        frameId: 0,
        url: 'https://www.youtube.com/',
        tab: { id: 7, url: 'https://www.youtube.com/' }
      })
    ).resolves.toEqual({ state: 'rejected', code: 'untrusted-sender' })
    expect(onRssRevalidate).toHaveBeenCalledOnce()

    await expect(
      invoke(listener, rssCancelMessage, {
        id: extensionId,
        url: extensionPageUrl
      })
    ).resolves.toEqual({
      state: 'acknowledged',
      requestId: rssCancelMessage.requestId
    })
    expect(onRssCancel).toHaveBeenCalledWith(rssCancelMessage.feedId)

    await expect(invoke(listener, rssCancelMessage, sender)).resolves.toEqual({
      state: 'rejected',
      code: 'untrusted-sender'
    })
    expect(onRssCancel).toHaveBeenCalledOnce()
  })

  it('accepts one validated decision request from the extension content script', async () => {
    const onDecisionRequest = vi.fn()
    const listener = createRuntimeMessageListener({
      extensionId,
      originMap,
      onDecisionRequest,
      now: () => 1_000
    })

    expect(await invoke(listener, message, sender)).toEqual({
      state: 'acknowledged',
      requestId: message.requestId
    })
    expect(onDecisionRequest).toHaveBeenCalledWith(message)
  })

  it('accepts another registered platform through the same guard', async () => {
    const onDecisionRequest = vi.fn()
    const listener = createRuntimeMessageListener({
      extensionId,
      originMap,
      onDecisionRequest,
      now: () => 1_000
    })
    const linkedinMessage: DecisionRequestMessage = {
      ...message,
      platform: 'linkedin',
      requestId: 'request:linkedin',
      item: {
        ...item,
        id: 'linkedin:post:fixture',
        platform: 'linkedin',
        surface: 'linkedin:feed'
      }
    }
    const linkedinSender: RuntimeMessageSender = {
      ...sender,
      url: 'https://www.linkedin.com/feed/',
      tab: {
        id: 8,
        url: 'https://www.linkedin.com/feed/'
      }
    }

    expect(
      await invoke(listener, linkedinMessage, linkedinSender)
    ).toMatchObject({
      state: 'acknowledged',
      requestId: 'request:linkedin'
    })
    expect(onDecisionRequest).toHaveBeenCalledWith(linkedinMessage)
  })

  it.each([
    {
      name: 'unknown extension sender',
      input: message,
      inputSender: { ...sender, id: 'attacker-extension' },
      code: 'untrusted-sender'
    },
    {
      name: 'page sender without a tab',
      input: message,
      inputSender: {
        id: extensionId,
        frameId: 0,
        url: 'https://www.youtube.com/'
      },
      code: 'untrusted-sender'
    },
    {
      name: 'subframe sender',
      input: message,
      inputSender: { ...sender, frameId: 3 },
      code: 'untrusted-sender'
    },
    {
      name: 'foreign origin',
      input: message,
      inputSender: {
        ...sender,
        url: 'https://github.com/',
        tab: { id: 7, url: 'https://github.com/' }
      },
      code: 'untrusted-sender'
    },
    {
      name: 'sender and tab origins disagree',
      input: message,
      inputSender: {
        ...sender,
        tab: { id: 7, url: 'https://www.linkedin.com/feed/' }
      },
      code: 'untrusted-sender'
    },
    {
      name: 'unknown message type',
      input: { ...message, type: 'profile.replace' },
      inputSender: sender,
      code: 'unknown-message-type'
    },
    {
      name: 'invalid schema',
      input: { ...message, requestId: '' },
      inputSender: sender,
      code: 'invalid-message'
    },
    {
      name: 'wrong namespace',
      input: { ...message, namespace: 'attacker.runtime.v1' },
      inputSender: sender,
      code: 'invalid-namespace'
    },
    {
      name: 'wrong platform namespace',
      input: { ...message, platform: 'reddit' },
      inputSender: sender,
      code: 'untrusted-sender'
    },
    {
      name: 'item platform differs from message platform',
      input: {
        ...message,
        item: {
          ...message.item,
          platform: 'linkedin',
          surface: 'linkedin:feed'
        }
      },
      inputSender: sender,
      code: 'invalid-message'
    },
    {
      name: 'surface differs from item platform',
      input: {
        ...message,
        item: {
          ...message.item,
          surface: 'reddit:home'
        }
      },
      inputSender: sender,
      code: 'invalid-message'
    }
  ])(
    'rejects $name without reaching application code',
    async ({ input, inputSender, code }) => {
      const onDecisionRequest = vi.fn()
      const listener = createRuntimeMessageListener({
        extensionId,
        originMap,
        onDecisionRequest,
        now: () => 1_000
      })

      expect(await invoke(listener, input, inputSender)).toEqual({
        state: 'rejected',
        code
      })
      expect(onDecisionRequest).not.toHaveBeenCalled()
    }
  )

  it('rejects oversized payloads before schema validation or mutation', async () => {
    const onDecisionRequest = vi.fn()
    const listener = createRuntimeMessageListener({
      extensionId,
      originMap,
      onDecisionRequest,
      now: () => 1_000
    })
    const oversized = {
      ...message,
      item: {
        ...item,
        title: 'x'.repeat(MAX_RUNTIME_MESSAGE_BYTES)
      }
    }

    expect(await invoke(listener, oversized, sender)).toEqual({
      state: 'rejected',
      code: 'message-too-large'
    })
    expect(onDecisionRequest).not.toHaveBeenCalled()
  })

  it('rate-limits valid messages per tab and frame without logging payloads', async () => {
    const onDecisionRequest = vi.fn()
    let now = 1_000
    const listener = createRuntimeMessageListener({
      extensionId,
      originMap,
      onDecisionRequest,
      now: () => now,
      rateLimit: {
        maximum: 2,
        windowMs: 60_000
      }
    })

    expect(
      await invoke(listener, { ...message, requestId: 'request:1' }, sender)
    ).toMatchObject({ state: 'acknowledged' })
    expect(
      await invoke(listener, { ...message, requestId: 'request:2' }, sender)
    ).toMatchObject({ state: 'acknowledged' })
    expect(
      await invoke(listener, { ...message, requestId: 'request:3' }, sender)
    ).toEqual({
      state: 'rejected',
      code: 'rate-limited'
    })
    expect(onDecisionRequest).toHaveBeenCalledTimes(2)

    now += 60_001
    expect(
      await invoke(listener, { ...message, requestId: 'request:4' }, sender)
    ).toMatchObject({ state: 'acknowledged' })
    expect(onDecisionRequest).toHaveBeenCalledTimes(3)
  })

  it('charges invalid recognized messages against the sender quota', async () => {
    const onDecisionRequest = vi.fn()
    const listener = createRuntimeMessageListener({
      extensionId,
      originMap,
      onDecisionRequest,
      now: () => 1_000,
      rateLimit: {
        maximum: 2,
        windowMs: 60_000
      }
    })
    const invalid = { ...message, requestId: '' }

    expect(await invoke(listener, invalid, sender)).toEqual({
      state: 'rejected',
      code: 'invalid-message'
    })
    expect(await invoke(listener, invalid, sender)).toEqual({
      state: 'rejected',
      code: 'invalid-message'
    })
    expect(await invoke(listener, message, sender)).toEqual({
      state: 'rejected',
      code: 'rate-limited'
    })
    expect(onDecisionRequest).not.toHaveBeenCalled()
  })
})
