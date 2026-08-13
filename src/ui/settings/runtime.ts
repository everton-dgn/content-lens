import { browser } from 'wxt/browser'

import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type {
  SettingsRequestMessage,
  SettingsRuntimeResponse
} from '@/application/settings/runtime-contracts'
import { INSTALLED_ADAPTER_ORIGINS } from '@/config/adapter-origins'
import type { Platform } from '@/core/content/contracts'

type SettingsMessageInput = SettingsRequestMessage extends infer Message
  ? Message extends SettingsRequestMessage
    ? Omit<Message, 'namespace' | 'requestId' | 'version'>
    : never
  : never

type RuntimeResponse = {
  state: 'acknowledged' | 'rejected'
  code?: string
  settings?: SettingsRuntimeResponse
}

export type SettingsRuntimeClient = {
  request(message: SettingsMessageInput): Promise<SettingsRuntimeResponse>
  requestPlatformPermission(platform: Platform): Promise<boolean>
  requestProviderPermission(provider: ProviderDescriptor): Promise<boolean>
}

const exactOriginPattern = (origin: string) => `${new URL(origin).origin}/*`

export const browserSettingsRuntime: SettingsRuntimeClient = {
  async request(message) {
    const response = (await browser.runtime.sendMessage({
      ...message,
      namespace: 'contentlens.runtime.v1',
      requestId: `settings:${crypto.randomUUID()}`,
      version: 1
    })) as RuntimeResponse
    if (response.state !== 'acknowledged' || !response.settings) {
      throw new Error(response.code ?? 'settings-request-failed')
    }
    return response.settings
  },

  requestPlatformPermission(platform) {
    const origins = INSTALLED_ADAPTER_ORIGINS.filter(
      entry => entry.platform === platform
    ).map(({ origin }) => exactOriginPattern(origin))
    if (origins.length === 0) {
      return Promise.resolve(true)
    }
    return browser.permissions.request({ origins })
  },

  requestProviderPermission(provider) {
    if (provider.execution === 'browser') {
      return Promise.resolve(true)
    }
    const dataCollection =
      provider.credentialMode === 'none' ? [] : ['authenticationInfo']
    return browser.permissions.request({
      origins: [exactOriginPattern(provider.endpointOrigin)],
      ...(import.meta.env.BROWSER === 'firefox' && dataCollection.length > 0
        ? { data_collection: dataCollection }
        : {})
    })
  }
}
