import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { browserSettingsRuntime } from '@/ui/settings/runtime'

const browserApi = vi.hoisted(() => ({
  permissions: {
    request: vi.fn(async () => true)
  },
  runtime: {
    sendMessage: vi.fn()
  }
}))

vi.mock('wxt/browser', () => ({ browser: browserApi }))

const provider = (
  overrides: Partial<ProviderDescriptor> = {}
): ProviderDescriptor => ({
  schemaVersion: 1,
  providerConfigId: 'provider:test',
  displayName: 'Test provider',
  kind: 'openai-compatible',
  execution: 'cloud',
  endpointOrigin: ['https', '://models.example.com'].join(''),
  credentialMode: 'session-only',
  credentialRef: 'credential:test',
  policyUrl: null,
  policyReviewedAt: null,
  createdAt: '2026-07-31T12:00:00.000Z',
  updatedAt: '2026-07-31T12:00:00.000Z',
  status: 'ready',
  ...overrides
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('browser settings runtime', () => {
  it('namespaces requests and returns acknowledged settings payloads', async () => {
    browserApi.runtime.sendMessage.mockResolvedValueOnce({
      state: 'acknowledged',
      settings: { kind: 'settings-save', value: { state: 'committed' } }
    })

    await expect(
      browserSettingsRuntime.request({ type: 'settings.snapshot' })
    ).resolves.toMatchObject({ kind: 'settings-save' })
    expect(browserApi.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'contentlens.runtime.v1',
        requestId: expect.stringMatching(/^settings:/),
        type: 'settings.snapshot',
        version: 1
      })
    )
  })

  it('rejects negative acknowledgements and malformed responses', async () => {
    browserApi.runtime.sendMessage.mockResolvedValueOnce({
      state: 'rejected',
      code: 'permission-denied'
    })
    await expect(
      browserSettingsRuntime.request({ type: 'settings.snapshot' })
    ).rejects.toThrow('permission-denied')

    browserApi.runtime.sendMessage.mockResolvedValueOnce({
      state: 'acknowledged'
    })
    await expect(
      browserSettingsRuntime.request({ type: 'settings.snapshot' })
    ).rejects.toThrow('settings-request-failed')
  })

  it('requests installed platform origins and skips hostless RSS', async () => {
    await expect(
      browserSettingsRuntime.requestPlatformPermission('youtube')
    ).resolves.toBe(true)
    expect(browserApi.permissions.request).toHaveBeenCalledWith({
      origins: ['https://www.youtube.com/*']
    })

    browserApi.permissions.request.mockClear()
    await expect(
      browserSettingsRuntime.requestPlatformPermission('rss')
    ).resolves.toBe(true)
    expect(browserApi.permissions.request).not.toHaveBeenCalled()
  })

  it('skips browser providers and requests only the exact remote origin', async () => {
    const modelOrigin = ['https', '://models.example.com'].join('')
    await expect(
      browserSettingsRuntime.requestProviderPermission(
        provider({ execution: 'browser' })
      )
    ).resolves.toBe(true)
    expect(browserApi.permissions.request).not.toHaveBeenCalled()

    await expect(
      browserSettingsRuntime.requestProviderPermission(provider())
    ).resolves.toBe(true)
    expect(browserApi.permissions.request).toHaveBeenCalledWith({
      origins: [`${modelOrigin}/*`]
    })
  })

  it('declares Firefox authentication data collection only for credentials', async () => {
    const modelOrigin = ['https', '://models.example.com'].join('')
    vi.stubEnv('BROWSER', 'firefox')
    await browserSettingsRuntime.requestProviderPermission(provider())
    expect(browserApi.permissions.request).toHaveBeenCalledWith({
      data_collection: ['authenticationInfo'],
      origins: [`${modelOrigin}/*`]
    })

    browserApi.permissions.request.mockClear()
    await browserSettingsRuntime.requestProviderPermission(
      provider({ credentialMode: 'none', credentialRef: null })
    )
    expect(browserApi.permissions.request).toHaveBeenCalledWith({
      origins: [`${modelOrigin}/*`]
    })
  })
})
