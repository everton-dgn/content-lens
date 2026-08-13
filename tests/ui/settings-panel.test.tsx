import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  browserBuiltInModel,
  browserBuiltInProvider
} from '@/ai/browser/catalog'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { listProviderTemplates } from '@/ai/providers/templates'
import type {
  SettingsRuntimeResponse,
  SettingsRuntimeSnapshot
} from '@/application/settings/runtime-contracts'
import { createDefaultSettings } from '@/core/settings'
import { disconnectedSyncConnection } from '@/sync/connection'
import type { SectionNavVariant } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import {
  getPlatformSurfaceLabel,
  getProviderConnectionTitle
} from '@/ui/settings/copy'
import { routeValue } from '@/ui/settings/model'
import type { SettingsRuntimeClient } from '@/ui/settings/runtime'
import { SettingsPanel } from '@/ui/settings/SettingsPanel'
import { ThemeContext } from '@/ui/styles/ThemeProvider'

vi.mock('@/i18n/runtime', () => ({
  t: (key: string) => key
}))

const copy = new Proxy(
  {
    catalogRefreshedBody: (_count: number) => 'catalogRefreshedBody',
    fallbackPositionLabel: (position: number) =>
      `fallbackPositionLabel:${position}`,
    generalModelCount: (count: number) => `generalModelCount:${count}`,
    generalProviderCount: (count: number) => `generalProviderCount:${count}`,
    hoursLabel: (hours: number) => `hoursLabel:${hours}`,
    providerModelCount: (count: number) => `providerModelCount:${count}`,
    syncStateLabel: (state: string) => `syncStateLabel:${state}`,
    syncConflictBulkReviewBody: (count: number) =>
      `syncConflictBulkReviewBody:${count}`,
    syncRecoveryRevisionLabel: (revision: number) =>
      `syncRecoveryRevisionLabel:${revision}`,
    syncRecoveryDiffLabel: (added: number, changed: number, removed: number) =>
      `syncRecoveryDiffLabel:${added}:${changed}:${removed}`,
    syncRemoteDeleteReviewBody: (target: string) =>
      `syncRemoteDeleteReviewBody:${target}`
  },
  {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : String(key)
  }
) as SettingsPanelCopy

const snapshot: SettingsRuntimeSnapshot = {
  state: 'ready',
  settings: {
    state: 'ready',
    revision: 0,
    settings: createDefaultSettings(),
    capabilitySnapshot: {} as never,
    source: 'default',
    issues: []
  },
  providers: {
    providers: [browserBuiltInProvider()],
    models: [browserBuiltInModel()],
    credentials: [],
    consents: []
  },
  templates: [],
  sync: disconnectedSyncConnection(),
  syncConflict: null,
  syncRecoveries: []
}

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []
const profileChanged = async () => undefined
const setTheme = vi.fn()

async function mount(
  runtime: SettingsRuntimeClient,
  callbacks: {
    navigationVariant?: Extract<SectionNavVariant, 'compact' | 'tabs'>
    onOpenData?(): void
    onOpenFeeds?(): void
  } = {}
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => {
    root.render(
      <ThemeContext value={{ resolvedTheme: 'dark', setTheme, theme: 'dark' }}>
        <SettingsPanel
          copy={copy}
          {...callbacks}
          onProfileChanged={profileChanged}
          runtime={runtime}
        />
      </ThemeContext>
    )
    await Promise.resolve()
  })
  return container
}

function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(
    candidate => candidate.textContent === label
  )
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return found
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

beforeEach(() => {
  setTheme.mockReset()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => view.root.unmount())
      view.container.remove()
    }
  }
})

describe('Settings panel', () => {
  it('preserves the active theme when unmounted before the snapshot arrives', async () => {
    let resolveRequest:
      | ((response: SettingsRuntimeResponse) => void)
      | undefined
    const request = vi.fn(
      () =>
        new Promise<SettingsRuntimeResponse>(resolve => {
          resolveRequest = resolve
        })
    )
    await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })
    const view = mounted.pop()
    if (!view) {
      throw new Error('Mounted settings panel not found')
    }

    await act(async () => view.root.unmount())
    view.container.remove()
    expect(setTheme).not.toHaveBeenCalled()

    await act(async () => {
      resolveRequest?.({ kind: 'snapshot', value: snapshot })
      await Promise.resolve()
    })
    expect(setTheme).not.toHaveBeenCalled()
  })

  it('keeps theme previews local and broadcasts only the saved value', async () => {
    const darkSettings = createDefaultSettings()
    darkSettings.interface.colorMode = 'dark'
    const savedSnapshot: SettingsRuntimeSnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        revision: 1,
        settings: darkSettings
      }
    }
    let saved = false
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'settings.save') {
        saved = true
        return {
          kind: 'settings-save',
          value: {
            revision: 1,
            state: 'committed',
            value: { settingsSchemaVersion: 1 }
          },
          activation: []
        }
      }
      return { kind: 'snapshot', value: saved ? savedSnapshot : snapshot }
    })
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabInterface'))
    const colorMode = container.querySelector('select')
    if (!(colorMode instanceof HTMLSelectElement)) {
      throw new Error('Color mode selector not found')
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    await act(async () => {
      valueSetter?.call(colorMode, 'dark')
      colorMode.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setTheme).toHaveBeenLastCalledWith('dark', { broadcast: false })
    expect(setTheme.mock.calls).not.toContainEqual(['dark'])

    await click(button(container, 'saveAction'))
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'))
    expect(setTheme.mock.calls.filter(call => call.length === 1)).toEqual([
      ['dark']
    ])
  })

  it('recovers from a failed initial snapshot through the visible retry', async () => {
    const request = vi
      .fn<SettingsRuntimeClient['request']>()
      .mockRejectedValueOnce(new Error('database-unavailable'))
      .mockResolvedValue({ kind: 'snapshot', value: snapshot })
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    expect(container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(container.textContent).toContain('errorTitle')
    await click(button(container, 'retryAction'))
    expect(container.textContent).toContain('generalTitle')
    expect(container.textContent).toContain('generalProviderCount:1')
    expect(container.textContent).toContain('generalModelCount:1')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('localizes every visible platform surface and connection outcome', () => {
    expect(getPlatformSurfaceLabel('linkedin:promoted-posts')).toBe(
      'settingsSurfaceLinkedinPromotedPosts'
    )
    expect(
      getProviderConnectionTitle('provider-connection-authentication-failed')
    ).toBe('settingsConnectionAuthenticationFailedTitle')
  })

  it('exposes six settings groups, providers, five model tasks and six platforms', async () => {
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'snapshot',
        value: snapshot
      })
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    expect(container.textContent).toContain('generalTitle')
    expect(
      container.querySelectorAll('.cl-section-nav [aria-current="page"]')
    ).toHaveLength(1)
    await click(button(container, 'tabAiProviders'))
    expect(container.textContent).toContain('providersTitle')
    await click(button(container, 'tabModels'))
    expect(
      container.querySelectorAll('[data-slot="select-field"]')
    ).toHaveLength(6)
    expect(container.textContent).toContain('modelTasksLabel')
    expect(container.querySelector('[data-slot="data-list"]')).not.toBeNull()
    expect(container.textContent).toContain('gemini-nano')
    expect(
      [...container.querySelectorAll('[data-slot="data-list"] code')].map(
        node => node.textContent
      )
    ).toEqual(
      expect.arrayContaining([
        'gemini-nano',
        '65,536',
        '2026-05-19T00:00:00.000Z'
      ])
    )
    expect(container.textContent).toContain('modelVerificationDeclared')

    await click(button(container, 'tabPlatforms'))
    const platformSelect = container.querySelector('select')
    expect(platformSelect?.querySelectorAll('option')).toHaveLength(6)
    expect(container.textContent).toContain('platformRoutingTitle')

    await click(button(container, 'tabInterface'))
    expect(container.textContent).toContain('interfaceTitle')
    expect(
      container.querySelectorAll('[data-slot="select-field"]')
    ).toHaveLength(2)
  })

  it('uses the compact sidepanel navigation without changing the default settings layout', async () => {
    const runtime = {
      request: vi.fn(async () => ({
        kind: 'snapshot' as const,
        value: snapshot
      })),
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    }
    const compact = await mount(runtime, {
      navigationVariant: 'compact',
      onOpenData: vi.fn(),
      onOpenFeeds: vi.fn()
    })

    const compactNavigation = compact.querySelector(
      '.cl-section-nav[data-variant="compact"]'
    )
    expect(compactNavigation?.querySelectorAll('button')).toHaveLength(6)
    expect(compactNavigation?.querySelectorAll('svg')).toHaveLength(6)
    expect(
      compact
        .querySelector('.settings-overview')
        ?.getAttribute('data-presentation')
    ).toBe('sidepanel')

    const standard = await mount(runtime)
    expect(
      standard.querySelector('.cl-section-nav')?.getAttribute('data-variant')
    ).toBe('tabs')
    expect(standard.querySelector('.cl-section-nav svg')).toBeNull()
    expect(
      standard
        .querySelector('.settings-overview')
        ?.getAttribute('data-presentation')
    ).toBe('default')
  })

  it('updates platform and interface controls and opens data shortcuts', async () => {
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'snapshot',
        value: snapshot
      })
    )
    const requestPlatformPermission = vi.fn(async () => false)
    const onOpenData = vi.fn()
    const onOpenFeeds = vi.fn()
    const container = await mount(
      {
        request,
        requestPlatformPermission,
        requestProviderPermission: vi.fn(async () => true)
      },
      { onOpenData, onOpenFeeds }
    )

    await click(button(container, 'feedsShortcutAction'))
    await click(button(container, 'dataShortcutAction'))
    expect(onOpenFeeds).toHaveBeenCalledOnce()
    expect(onOpenData).toHaveBeenCalledOnce()

    await click(button(container, 'tabPlatforms'))
    const platform = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'platformSelectLabel'
    )
    const activation = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'platformActivationLabel'
    )
    if (!platform || !activation) {
      throw new Error('Platform controls not found')
    }
    const selectSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    await act(async () => {
      selectSetter?.call(activation, 'paused')
      activation.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button(container, 'permissionRequestAction'))
    expect(requestPlatformPermission).toHaveBeenCalledWith('youtube')
    expect(container.textContent).toContain('permissionDenied')

    const firstSurface = container.querySelector<HTMLInputElement>(
      '[data-slot="toggle-field"] input'
    )
    await act(async () => firstSurface?.click())

    const currentPlatform = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'platformSelectLabel'
    )
    if (!currentPlatform) {
      throw new Error('Current platform selector not found')
    }
    const rssIndex = [...currentPlatform.options].findIndex(
      option => option.value === 'rss'
    )
    expect(rssIndex).toBeGreaterThanOrEqual(0)
    await act(async () => {
      currentPlatform.selectedIndex = rssIndex
      currentPlatform.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('settingsSurfaceRssFeedEntry')
    expect(container.textContent).not.toContain('permissionRequestAction')

    await click(button(container, 'tabInterface'))
    expect(container.textContent).toContain('unsavedTitle')
    await click(button(container, 'unsavedDiscardAction'))
    expect(container.textContent).toContain('interfaceTitle')

    const advanced = container.querySelector<HTMLButtonElement>(
      '[data-slot="switch-field"][role="switch"]'
    )
    if (!advanced) {
      throw new Error('Advanced mode switch not found')
    }
    await act(async () => advanced.click())
    const interfaceSelects = container.querySelectorAll('select')
    await act(async () => {
      selectSetter?.call(interfaceSelects[0], 'dark')
      interfaceSelects[0]?.dispatchEvent(new Event('change', { bubbles: true }))
      selectSetter?.call(interfaceSelects[1], 'pt_BR')
      interfaceSelects[1]?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(advanced.getAttribute('aria-checked')).toBe('true')
    expect(interfaceSelects[0]?.value).toBe('dark')
    expect(interfaceSelects[1]?.value).toBe('pt_BR')
    expect(container.textContent).toContain('saveAction')
  })

  it('opens the same local data surface from privacy and diagnostics', async () => {
    const onOpenData = vi.fn()
    const container = await mount(
      {
        request: vi.fn(async () => ({
          kind: 'snapshot' as const,
          value: snapshot
        })),
        requestPlatformPermission: vi.fn(async () => true),
        requestProviderPermission: vi.fn(async () => true)
      },
      { onOpenData }
    )

    await click(button(container, 'tabPrivacyData'))
    await click(button(container, 'privacyDataAction'))
    await click(button(container, 'tabDiagnostics'))
    await click(button(container, 'diagnosticsAction'))
    expect(onOpenData).toHaveBeenCalledTimes(2)
  })

  it('sends one transactional save command from the primary action', async () => {
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'settings.save'
          ? ({
              kind: 'settings-save',
              value: {
                revision: 1,
                state: 'committed',
                operationId: message.operationId,
                value: { settingsSchemaVersion: 1 },
                effects: []
              },
              activation: []
            } as SettingsRuntimeResponse)
          : { kind: 'snapshot', value: snapshot }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabInterface'))
    const advancedMode =
      container.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!advancedMode) {
      throw new Error('Advanced mode toggle not found')
    }
    await act(async () => advancedMode.click())
    await click(button(container, 'saveAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings.save',
        expectedRevision: 0,
        reviewedConsentKeys: []
      })
    )
    expect(container.textContent).toContain('savedTitle')
  })

  it('adds search when more than eight models are eligible', async () => {
    const models = Array.from({ length: 9 }, (_, index) => ({
      ...browserBuiltInModel(),
      modelId: `model-${index}`,
      displayName: `Model ${index}`
    }))
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'snapshot',
        value: {
          ...snapshot,
          providers: { ...snapshot.providers, models }
        }
      })
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'tabModels'))
    expect(container.querySelectorAll('[data-slot="combobox"]')).toHaveLength(4)
    const firstCombobox = container.querySelector('[data-slot="combobox"]')
    const trigger = firstCombobox?.querySelector('button[role="combobox"]')
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Model combobox trigger not found')
    }
    await click(trigger)
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    if (!search) {
      throw new Error('Model search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(search, 'Model 8')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
  })

  it('edits ordered fallbacks only through advanced routing disclosure', async () => {
    const models = Array.from({ length: 3 }, (_, index) => ({
      ...browserBuiltInModel(),
      modelId: `route-model-${index}`,
      displayName: `Route model ${index}`
    }))
    const settings = createDefaultSettings()
    settings.interface.advancedMode = true
    settings.routing.globalRoutes['classification-text'] = {
      state: 'route',
      primary: {
        providerConfigId: models[0]?.providerConfigId ?? '',
        modelId: models[0]?.modelId ?? ''
      },
      fallbacks: [],
      allowCloudFallback: false,
      allowHigherCostFallback: false
    }
    const routeSnapshot: SettingsRuntimeSnapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, settings },
      providers: { ...snapshot.providers, models }
    }
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'settings.save'
          ? ({
              kind: 'settings-save',
              value: {
                revision: 1,
                state: 'committed',
                operationId: message.operationId,
                value: { settingsSchemaVersion: 1 },
                effects: []
              },
              activation: []
            } as SettingsRuntimeResponse)
          : { kind: 'snapshot', value: routeSnapshot }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'tabModels'))
    const disclosureRoot = [
      ...container.querySelectorAll('[data-slot="disclosure"]')
    ].find(candidate =>
      candidate
        .querySelector('.cl-disclosure__trigger')
        ?.textContent?.includes('advancedRoutingSummary')
    )
    if (!disclosureRoot) {
      throw new Error('Advanced route disclosure not found')
    }
    const disclosureTrigger = disclosureRoot?.querySelector(
      '.cl-disclosure__trigger'
    )
    if (!(disclosureTrigger instanceof HTMLButtonElement)) {
      throw new Error('Advanced route disclosure trigger not found')
    }
    await click(disclosureTrigger)
    expect(disclosureRoot?.textContent).toContain('deterministicBaselineLabel')
    const fallback = [...(disclosureRoot?.querySelectorAll('label') ?? [])]
      .filter(candidate => candidate.textContent === 'fallbackPositionLabel:1')
      .map(candidate => document.getElementById(candidate.htmlFor))
      .find(candidate => candidate instanceof HTMLSelectElement)
    if (!(fallback instanceof HTMLSelectElement)) {
      throw new Error('First fallback selector not found')
    }
    const selectSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    await act(async () => {
      const fallbackModel = models[1]
      if (!fallbackModel) {
        throw new Error('Fallback model not found')
      }
      selectSetter?.call(fallback, routeValue(fallbackModel))
      fallback.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const cloudSwitch =
      disclosureRoot.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!cloudSwitch) {
      throw new Error('Cloud fallback switch not found')
    }
    await act(async () => cloudSwitch.click())
    const budgetRoot = [
      ...container.querySelectorAll('[data-slot="disclosure"]')
    ].find(candidate =>
      candidate
        .querySelector('.cl-disclosure__trigger')
        ?.textContent?.includes('routingBudgetsSummary')
    )
    if (!budgetRoot) {
      throw new Error('Routing budget disclosure not found')
    }
    const budgetTrigger = budgetRoot?.querySelector('.cl-disclosure__trigger')
    if (!(budgetTrigger instanceof HTMLButtonElement)) {
      throw new Error('Routing budget disclosure trigger not found')
    }
    await click(budgetTrigger)
    const concurrent = [...(budgetRoot?.querySelectorAll('label') ?? [])]
      .filter(candidate => candidate.textContent === 'maxConcurrentGlobalLabel')
      .map(candidate => document.getElementById(candidate.htmlFor))
      .find(candidate => candidate instanceof HTMLSelectElement)
    if (!(concurrent instanceof HTMLSelectElement)) {
      throw new Error('Global concurrency selector not found')
    }
    await act(async () => {
      selectSetter?.call(concurrent, '4')
      concurrent.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button(container, 'saveAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings.save',
        settings: expect.objectContaining({
          routing: expect.objectContaining({
            budgets: expect.objectContaining({ maxConcurrentGlobal: 4 }),
            globalRoutes: expect.objectContaining({
              'classification-text': expect.objectContaining({
                fallbacks: [
                  {
                    providerConfigId: models[1]?.providerConfigId,
                    modelId: models[1]?.modelId
                  }
                ],
                allowCloudFallback: true
              })
            })
          })
        })
      })
    )
  })

  it('updates a supported provider catalog after explicit permission', async () => {
    const openAiProvider = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:openai',
      displayName: 'OpenAI personal',
      kind: 'openai' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://api.openai.com',
      credentialMode: 'session-only' as const,
      credentialRef: 'credential:openai',
      status: 'ready' as const
    }
    const discoveredModel = {
      ...browserBuiltInModel(),
      providerConfigId: openAiProvider.providerConfigId,
      modelId: 'gpt-catalog',
      displayName: 'gpt-catalog',
      executionKind: 'cloud' as const,
      catalogSource: 'provider' as const,
      capabilities: []
    }
    let refreshed = false
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'provider.catalog.refresh') {
        refreshed = true
        return { kind: 'provider-catalog', value: [discoveredModel] }
      }
      return {
        kind: 'snapshot',
        value: {
          ...snapshot,
          providers: {
            ...snapshot.providers,
            providers: [openAiProvider, browserBuiltInProvider()],
            models: refreshed ? [discoveredModel] : []
          }
        }
      }
    })
    const requestProviderPermission = vi.fn(async () => true)
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission
    })

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'catalogRefreshAction'))
    expect(requestProviderPermission).toHaveBeenCalledWith(openAiProvider)
    expect(request).toHaveBeenCalledWith({
      type: 'provider.catalog.refresh',
      providerConfigId: openAiProvider.providerConfigId
    })
    expect(container.textContent).toContain('catalogRefreshedTitle')
    expect(container.textContent).toContain('catalogRefreshedBody')
    await click(button(container, 'tabModels'))
    expect(container.textContent).toContain('gpt-catalog')
  })

  it('creates providers, stores each credential mode and runs an explicit connection test', async () => {
    let customProvider: ProviderDescriptor = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:custom-credentials',
      displayName: 'Custom credentials',
      kind: 'custom' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://provider.example',
      credentialMode: 'none' as const,
      credentialRef: null,
      status: 'unconfigured' as const
    }
    const providers = [customProvider, browserBuiltInProvider()]
    const models: SettingsRuntimeSnapshot['providers']['models'] = []
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'provider.create') {
        const created = {
          ...customProvider,
          providerConfigId: 'provider:created',
          displayName: message.displayName,
          endpointOrigin: message.endpointOrigin ?? 'https://created.example'
        }
        providers.unshift(created)
        return { kind: 'provider', value: created }
      }
      if (message.type === 'provider.credential') {
        customProvider = {
          ...customProvider,
          credentialMode: message.mode,
          credentialRef: `credential:${message.mode}`,
          status: 'ready'
        }
        providers[
          providers.findIndex(
            candidate =>
              candidate.providerConfigId === customProvider.providerConfigId
          )
        ] = customProvider
        return { kind: 'provider', value: customProvider }
      }
      if (message.type === 'provider.test') {
        return {
          kind: 'connection-test',
          value: {
            provider: customProvider,
            result: {
              outcome: 'success',
              code: 'provider-connection-ready',
              checkedAt: '2026-07-31T12:00:00.000Z',
              latencyMs: 12,
              providerStatus: 'ready'
            }
          }
        }
      }
      if (message.type === 'model.register') {
        models.push(message.model)
        return { kind: 'model', value: message.model }
      }
      return {
        kind: 'snapshot',
        value: {
          ...snapshot,
          templates: listProviderTemplates(),
          providers: {
            ...snapshot.providers,
            providers: [...providers],
            models: [...models]
          }
        }
      }
    })
    const requestProviderPermission = vi.fn(async () => false)
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission
    })
    await click(button(container, 'tabAiProviders'))

    const setInput = async (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const setSelect = async (select: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set
      await act(async () => {
        setter?.call(select, value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    const submitForm = async (form: HTMLFormElement) => {
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        )
        await Promise.resolve()
      })
    }

    const template = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'providerTemplateLabel'
    )
    const addForm = button(container, 'addProviderAction').closest('form')
    if (!(template instanceof HTMLSelectElement) || !addForm) {
      throw new Error('Provider creation form not found')
    }
    await setSelect(template, 'custom')
    const addInputs = addForm.querySelectorAll('input')
    const providerName = addInputs.item(0)
    const providerOrigin = addInputs.item(1)
    if (!providerName || !providerOrigin) {
      throw new Error('Provider creation inputs not found')
    }
    await setInput(providerName, 'Created provider')
    await setInput(providerOrigin, 'https://created.example')
    await submitForm(addForm)
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'provider.create' })
      )
    )

    const providerSelect = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'providerSelectLabel'
    )
    if (!(providerSelect instanceof HTMLSelectElement)) {
      throw new Error('Provider selector not found')
    }
    await setSelect(providerSelect, customProvider.providerConfigId)
    const credentialMode = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'credentialModeLabel'
    )
    if (!(credentialMode instanceof HTMLSelectElement)) {
      throw new Error('Credential mode not found')
    }

    await setSelect(credentialMode, 'passphrase-wrapped')
    const wrappedForm = button(container, 'saveCredentialAction').closest(
      'form'
    )
    const wrappedInputs = wrappedForm?.querySelectorAll('input')
    if (!wrappedForm || !wrappedInputs || wrappedInputs.length < 2) {
      throw new Error('Wrapped credential form not found')
    }
    await setInput(wrappedInputs.item(0), 'provider-secret')
    await setInput(wrappedInputs.item(1), 'provider-passphrase')
    await submitForm(wrappedForm)
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'provider.credential',
          mode: 'passphrase-wrapped'
        })
      )
    )

    const currentMode = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'credentialModeLabel'
    )
    if (!(currentMode instanceof HTMLSelectElement)) {
      throw new Error('Refreshed credential mode not found')
    }
    await setSelect(currentMode, 'external-vault')
    const externalForm = button(container, 'saveCredentialAction').closest(
      'form'
    )
    const externalInput = externalForm?.querySelector('input')
    if (!externalForm || !(externalInput instanceof HTMLInputElement)) {
      throw new Error('External credential form not found')
    }
    await setInput(externalInput, 'vault://contentlens/provider')
    await submitForm(externalForm)
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'provider.credential',
          mode: 'external-vault'
        })
      )
    )

    await click(button(container, 'providerPermissionAction'))
    expect(requestProviderPermission).toHaveBeenCalled()
    expect(container.textContent).toContain('permissionDenied')

    const modelInput = [...container.querySelectorAll('input')].find(
      input => input.labels?.[0]?.textContent === 'modelIdLabel'
    )
    const quota = [...container.querySelectorAll('input')].find(
      input => input.labels?.[0]?.textContent === 'quotaAcknowledgement'
    )
    if (
      !(modelInput instanceof HTMLInputElement) ||
      !(quota instanceof HTMLInputElement)
    ) {
      throw new Error('Connection test controls not found')
    }
    await setInput(modelInput, 'model:test')
    await click(quota)
    await click(button(container, 'testConnectionAction'))
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'provider.test',
          modelId: 'model:test'
        })
      )
    )
    expect(container.textContent).toContain('settingsConnectionReadyTitle')

    await click(button(container, 'tabModels'))
    const modelForm = button(container, 'addModelAction').closest('form')
    const modelFields = modelForm?.querySelectorAll('input')
    if (!modelForm || !modelFields || modelFields.length < 4) {
      throw new Error('Model registration form not found')
    }
    await setInput(modelFields.item(0), 'custom-vision-model')
    await setInput(modelFields.item(1), 'Custom vision model')
    await click(modelFields.item(3))
    await submitForm(modelForm)
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'model.register',
          model: expect.objectContaining({
            modelId: 'custom-vision-model',
            capabilities: expect.arrayContaining([
              expect.objectContaining({
                task: 'classification-vision',
                modalities: ['text', 'image']
              })
            ])
          })
        })
      )
    )
    expect(container.textContent).toContain('custom-vision-model')
  })

  it('previews provider impact, focuses cancel and removes only after confirmation', async () => {
    const customProvider = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:custom',
      displayName: 'Custom provider',
      kind: 'custom' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://provider.example',
      status: 'ready' as const
    }
    let removed = false
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'provider.remove.preview') {
        return {
          kind: 'provider-removal-preview',
          value: {
            blocked: false,
            models: ['custom-model'],
            providerConfigId: customProvider.providerConfigId,
            routes: []
          }
        }
      }
      if (message.type === 'provider.remove') {
        removed = true
        return {
          kind: 'provider-removed',
          value: { provider: customProvider, removedModels: [] }
        }
      }
      if (message.type === 'provider.update') {
        return {
          kind: 'provider',
          value: { ...customProvider, displayName: message.displayName }
        }
      }
      return {
        kind: 'snapshot',
        value: {
          ...snapshot,
          providers: {
            ...snapshot.providers,
            providers: removed
              ? [browserBuiltInProvider()]
              : [customProvider, browserBuiltInProvider()]
          }
        }
      }
    })
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    const editForm = button(container, 'editProviderAction').closest('form')
    const displayName = editForm?.querySelector<HTMLInputElement>('input')
    if (!displayName) {
      throw new Error('Provider display name input not found')
    }
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      inputSetter?.call(displayName, 'Renamed custom provider')
      displayName.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(container, 'editProviderAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'provider.update',
        displayName: 'Renamed custom provider'
      })
    )
    const review = button(container, 'removeProviderReviewAction')
    await click(review)
    expect(container.textContent).toContain('removeProviderReviewTitle')
    expect(container.textContent).toContain('custom-model')
    expect(button(container, 'removeProviderCancelAction')).toBe(
      document.activeElement
    )
    await click(button(container, 'removeProviderCancelAction'))
    expect(button(container, 'removeProviderReviewAction')).toBe(
      document.activeElement
    )

    await click(button(container, 'removeProviderReviewAction'))
    await click(button(container, 'removeProviderConfirmAction'))
    expect(request).toHaveBeenCalledWith({
      type: 'provider.remove',
      providerConfigId: customProvider.providerConfigId
    })
    expect(container.textContent).toContain('providerRemovedTitle')
  })

  it('disconnects a provider only after explicit confirmation', async () => {
    const customProvider = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:disconnect',
      displayName: 'Disconnect provider',
      kind: 'custom' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://provider.example',
      status: 'ready' as const
    }
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'provider.disconnect'
          ? { kind: 'provider', value: customProvider }
          : {
              kind: 'snapshot',
              value: {
                ...snapshot,
                providers: {
                  ...snapshot.providers,
                  providers: [customProvider, browserBuiltInProvider()]
                }
              }
            }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    const disconnect = button(container, 'disconnectAction')
    await click(disconnect)

    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'provider.disconnect' })
    )
    expect(container.textContent).toContain('disconnectReviewTitle')
    expect(button(container, 'removeProviderCancelAction')).toBe(
      document.activeElement
    )

    await click(button(container, 'removeProviderCancelAction'))
    expect(disconnect).toBe(document.activeElement)

    await click(disconnect)
    await click(button(container, 'disconnectConfirmAction'))
    expect(request).toHaveBeenCalledWith({
      type: 'provider.disconnect',
      providerConfigId: customProvider.providerConfigId
    })
  })

  it('blocks provider removal while a route still depends on it', async () => {
    const customProvider = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:routed',
      displayName: 'Routed provider',
      kind: 'custom' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://provider.example',
      status: 'ready' as const
    }
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'provider.remove.preview'
          ? {
              kind: 'provider-removal-preview',
              value: {
                blocked: true,
                models: ['routed-model'],
                providerConfigId: customProvider.providerConfigId,
                routes: [
                  {
                    modelId: 'routed-model',
                    platform: 'youtube',
                    role: 'primary',
                    task: 'classification-text'
                  }
                ]
              }
            }
          : {
              kind: 'snapshot',
              value: {
                ...snapshot,
                providers: {
                  ...snapshot.providers,
                  providers: [customProvider, browserBuiltInProvider()]
                }
              }
            }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'removeProviderReviewAction'))

    expect(container.textContent).toContain('removeProviderBlockedTitle')
    expect(container.textContent).toContain('routed-model')
    expect(container.textContent).toContain('settingsPlatformYoutube')
    expect(container.textContent).not.toContain('removeProviderConfirmAction')
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'provider.remove' })
    )

    await click(button(container, 'removeProviderReviewRoutesAction'))
    expect(container.textContent).toContain('globalRoutesTitle')
  })

  it('requires save, discard or continue before leaving a dirty section', async () => {
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'snapshot',
        value: snapshot
      })
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabInterface'))
    const advancedMode =
      container.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!advancedMode) {
      throw new Error('Advanced mode toggle not found')
    }
    await act(async () => advancedMode.click())
    await click(button(container, 'tabAiProviders'))

    expect(container.textContent).toContain('unsavedTitle')
    expect(container.textContent).toContain('interfaceTitle')
    expect(button(container, 'unsavedContinueAction')).toBe(
      document.activeElement
    )

    await click(button(container, 'unsavedContinueAction'))
    expect(container.textContent).not.toContain('unsavedTitle')
    expect(container.textContent).toContain('interfaceTitle')

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'unsavedDiscardAction'))
    expect(container.textContent).toContain('providersTitle')
    await click(button(container, 'tabModels'))
    expect(container.textContent).toContain('globalRoutesTitle')
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings.save' })
    )
  })

  it('keeps the current AI subsection visible while a dirty route is reviewed', async () => {
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'snapshot',
        value: snapshot
      })
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    await click(button(container, 'tabModels'))
    const route = [...container.querySelectorAll('label')]
      .filter(
        candidate => candidate.textContent === 'settingsTaskClassificationText'
      )
      .map(candidate =>
        candidate.htmlFor
          ? container.querySelector(`#${CSS.escape(candidate.htmlFor)}`)
          : null
      )
      .find(
        (candidate): candidate is HTMLSelectElement =>
          candidate instanceof HTMLSelectElement
      )
    if (!route) {
      throw new Error('Text classification route not found')
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(route, routeValue(browserBuiltInModel()))
      route.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await click(button(container, 'tabProviders'))
    expect(container.textContent).toContain('unsavedTitle')
    expect(container.textContent).toContain('globalRoutesTitle')
    expect(container.textContent).not.toContain('providersTitle')

    await click(button(container, 'unsavedDiscardAction'))
    expect(container.textContent).toContain('providersTitle')
  })

  it('saves a provider form draft before leaving its section', async () => {
    let customProvider: ProviderDescriptor = {
      ...browserBuiltInProvider(),
      providerConfigId: 'provider:draft',
      displayName: 'Draft provider',
      kind: 'custom' as const,
      execution: 'cloud' as const,
      endpointOrigin: 'https://provider.example',
      status: 'ready' as const
    }
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'provider.update') {
        customProvider = {
          ...customProvider,
          displayName: message.displayName,
          endpointOrigin: message.endpointOrigin
        }
        return { kind: 'provider', value: customProvider }
      }
      return {
        kind: 'snapshot',
        value: {
          ...snapshot,
          providers: {
            ...snapshot.providers,
            providers: [customProvider, browserBuiltInProvider()]
          }
        }
      }
    })
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabAiProviders'))
    const editForm = button(container, 'editProviderAction').closest('form')
    const displayName = editForm?.querySelector<HTMLInputElement>('input')
    if (!displayName) {
      throw new Error('Provider display name input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(displayName, 'Saved provider draft')
      displayName.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await click(button(container, 'tabPlatforms'))
    expect(container.textContent).toContain('unsavedTitle')
    expect(container.textContent).toContain('providersTitle')

    await click(button(container, 'unsavedSaveAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'provider.update',
        displayName: 'Saved provider draft'
      })
    )
    expect(container.textContent).toContain('platformSelectLabel')
  })

  it('reviews and restores a sync recovery snapshot without automatic push', async () => {
    const recoverySnapshot = {
      ...snapshot,
      syncRecoveries: [
        {
          id: 'sync-recovery:operation:test',
          operationId: 'operation:test',
          createdAt: '2026-07-31T12:00:00.000Z',
          revision: 7,
          diff: { added: 1, changed: 2, removed: 3, unchanged: 4 }
        }
      ]
    } satisfies SettingsRuntimeSnapshot
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'sync.recovery.restore'
          ? {
              kind: 'sync-recovery-restored',
              value: { state: 'restored', revision: 8, automaticPush: false }
            }
          : { kind: 'snapshot', value: recoverySnapshot }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabPrivacyData'))
    expect(container.textContent).toContain('syncRecoveryRevisionLabel:7')
    expect(container.textContent).toContain('syncRecoveryDiffLabel:1:2:3')
    await click(button(container, 'syncRecoveryRestoreAction'))
    expect(container.textContent).toContain('syncRecoveryReviewTitle')
    expect(
      [...container.querySelectorAll('button')].some(
        candidate => candidate.textContent === 'syncConnectAction'
      )
    ).toBe(false)
    await click(button(container, 'syncRecoveryConfirmAction'))

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync.recovery.restore',
        snapshotId: 'sync-recovery:operation:test'
      })
    )
  })

  it('requires confirmation before applying one side to every sync conflict', async () => {
    const conflictSnapshot = {
      ...snapshot,
      sync: {
        ...disconnectedSyncConnection(),
        configured: true,
        enabled: true,
        runtimeState: 'conflict' as const,
        providerConfigId: 'provider:sync',
        endpointPath: '/contentlens.json',
        remoteObjectId: 'contentlens.json',
        retention: 'User controlled',
        revocation: 'Revoke token',
        consentedAt: '2026-07-31T12:00:00.000Z'
      },
      syncConflict: {
        id: 'sync-conflict:profile',
        createdAt: '2026-07-31T12:00:00.000Z',
        conflicts: [
          {
            entityType: 'exclusions',
            entityId: 'shared',
            reason: 'concurrent-change',
            local: { kind: 'value', value: { id: 'shared', value: 1 } },
            remote: { kind: 'value', value: { id: 'shared', value: 2 } }
          }
        ],
        resolutions: []
      }
    } satisfies SettingsRuntimeSnapshot
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'sync.resolve'
          ? {
              kind: 'sync-resolution',
              value: { state: 'confirmed', digest: 'a'.repeat(64) }
            }
          : { kind: 'snapshot', value: conflictSnapshot }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabPrivacyData'))
    await click(button(container, 'syncConflictUseAllLocalAction'))
    expect(container.textContent).toContain('syncConflictBulkReviewBody:1')
    await click(button(container, 'syncConflictBulkConfirmAction'))

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync.resolve',
        resolutions: [
          {
            entityType: 'exclusions',
            entityId: 'shared',
            choice: 'local'
          }
        ]
      })
    )
  })

  it('requires the exact remote object name before deletion', async () => {
    const connectedSnapshot = {
      ...snapshot,
      sync: {
        ...disconnectedSyncConnection(),
        configured: true,
        enabled: true,
        runtimeState: 'idle' as const,
        providerConfigId: 'provider:sync',
        endpointPath: '/contentlens.json',
        remoteObjectId: 'contentlens.json',
        retention: 'User controlled',
        revocation: 'Revoke token',
        consentedAt: '2026-07-31T12:00:00.000Z'
      }
    } satisfies SettingsRuntimeSnapshot
    const request = vi.fn(
      async (message): Promise<SettingsRuntimeResponse> =>
        message.type === 'sync.remote.delete'
          ? {
              kind: 'sync-remote-deleted',
              value: {
                state: 'deleted',
                connection: disconnectedSyncConnection()
              }
            }
          : { kind: 'snapshot', value: connectedSnapshot }
    )
    const container = await mount({
      request,
      requestPlatformPermission: vi.fn(async () => true),
      requestProviderPermission: vi.fn(async () => true)
    })

    await click(button(container, 'tabPrivacyData'))
    await click(button(container, 'syncRemoteDeleteAction'))
    const confirm = button(container, 'syncRemoteDeleteConfirmAction')
    expect(confirm.disabled).toBe(true)
    const input = [...container.querySelectorAll('input')].find(
      candidate =>
        candidate.labels?.[0]?.textContent ===
        'syncRemoteDeleteConfirmationLabel'
    )
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Remote deletion confirmation input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(input, 'contentlens.json')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(confirm.disabled).toBe(false)
    await click(confirm)

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync.remote.delete',
        confirmedRemoteObjectId: 'contentlens.json'
      })
    )
  })
})
