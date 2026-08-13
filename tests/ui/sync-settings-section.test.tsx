import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { browserBuiltInProvider } from '@/ai/browser/catalog'
import type { SettingsRuntimeResponse } from '@/application/settings/runtime-contracts'
import { disconnectedSyncConnection } from '@/sync/connection'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import type { SettingsRuntimeClient } from '@/ui/settings/runtime'
import { SyncSettingsSection } from '@/ui/settings/SyncSettingsSection'

const copy = new Proxy(
  {
    syncConflictBulkReviewBody: (count: number) => `bulk:${count}`,
    syncRecoveryDiffLabel: (added: number, changed: number, removed: number) =>
      `diff:${added}:${changed}:${removed}`,
    syncRecoveryRevisionLabel: (revision: number) => `revision:${revision}`,
    syncRemoteDeleteReviewBody: (target: string) => `delete:${target}`,
    syncStateLabel: (state: string) => `state:${state}`
  },
  {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : String(key)
  }
) as SettingsPanelCopy

const provider = {
  ...browserBuiltInProvider(),
  providerConfigId: 'provider:sync',
  displayName: 'User sync',
  kind: 'user-proxy' as const,
  execution: 'cloud' as const,
  endpointOrigin: 'https://sync.example',
  credentialMode: 'session-only' as const,
  credentialRef: 'credential:sync',
  status: 'ready' as const
}

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

async function mount(
  props: Partial<ComponentProps<typeof SyncSettingsSection>> & {
    runtime: SettingsRuntimeClient
  }
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => {
    root.render(
      <SyncSettingsSection
        conflict={null}
        connection={disconnectedSyncConnection()}
        copy={copy}
        onRefresh={vi.fn(async () => undefined)}
        providers={[provider, browserBuiltInProvider()]}
        recoveries={[]}
        {...props}
      />
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

async function click(target: HTMLButtonElement | HTMLInputElement) {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

async function change(
  control: HTMLInputElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setter?.call(control, value)
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true
      })
    )
  })
}

beforeEach(() => {
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

describe('sync settings section', () => {
  it('requires consent and origin permission before connecting', async () => {
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'sync-connect',
        value: { state: 'connected', connection: disconnectedSyncConnection() }
      })
    )
    const requestProviderPermission = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const container = await mount({
      runtime: {
        request,
        requestPlatformPermission: vi.fn(async () => true),
        requestProviderPermission
      },
      recoveries: [
        {
          id: 'recovery:1',
          operationId: 'operation:1',
          createdAt: '2026-07-31T12:00:00.000Z',
          revision: 4,
          diff: null
        }
      ]
    })
    const connect = button(container, 'syncConnectAction')
    expect(connect.disabled).toBe(true)
    const consent = [...container.querySelectorAll('input')].find(input =>
      input.labels?.[0]?.textContent?.includes('syncConsentLabel')
    )
    if (!(consent instanceof HTMLInputElement)) {
      throw new Error('Sync consent not found')
    }
    await click(consent)
    expect(connect.disabled).toBe(false)
    await click(connect)
    expect(container.textContent).toContain('syncPermissionTitle')
    expect(request).not.toHaveBeenCalled()
    await click(connect)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync.connect',
        providerConfigId: 'provider:sync',
        remoteObjectId: 'profile.json',
        scheduleMinutes: 15
      })
    )

    await click(button(container, 'syncRecoveryRestoreAction'))
    expect(container.textContent).toContain('syncRecoveryReviewTitle')
    await click(button(container, 'removeProviderCancelAction'))
    expect(container.textContent).not.toContain('syncRecoveryReviewTitle')
  })

  it('updates schedule, synchronizes and reviews disconnect on a connected remote', async () => {
    const connected = {
      ...disconnectedSyncConnection(),
      configured: true,
      enabled: true,
      runtimeState: 'idle' as const,
      providerConfigId: 'provider:sync',
      endpointPath: '/contentlens.json',
      remoteObjectId: 'contentlens.json',
      scheduleMinutes: 15,
      retention: 'User controlled',
      revocation: 'Delete token',
      consentedAt: '2026-07-31T12:00:00.000Z'
    }
    const request = vi.fn(async (message): Promise<SettingsRuntimeResponse> => {
      if (message.type === 'sync.now') {
        return {
          kind: 'sync-run',
          value: { state: 'confirmed', attempts: 1, digest: 'a'.repeat(64) }
        }
      }
      if (message.type === 'sync.disconnect') {
        return { kind: 'sync-disconnected', value: connected }
      }
      return { kind: 'sync-schedule', value: connected }
    })
    const container = await mount({
      connection: connected,
      runtime: {
        request,
        requestPlatformPermission: vi.fn(async () => true),
        requestProviderPermission: vi.fn(async () => true)
      }
    })
    const schedule = container.querySelector('select')
    if (!(schedule instanceof HTMLSelectElement)) {
      throw new Error('Schedule not found')
    }
    await change(schedule, '60')
    expect(request).toHaveBeenCalledWith({
      type: 'sync.schedule',
      scheduleMinutes: 60
    })
    await click(button(container, 'syncNowAction'))
    expect(container.textContent).toContain('syncCompletedTitle')

    await click(button(container, 'syncDisconnectAction'))
    expect(container.textContent).toContain('syncDisconnectReviewTitle')
    await click(button(container, 'removeProviderCancelAction'))
    expect(container.textContent).not.toContain('syncDisconnectReviewTitle')
    await click(button(container, 'syncDisconnectAction'))
    await click(button(container, 'syncDisconnectConfirmAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sync.disconnect' })
    )
  })

  it('supports individual custom conflict resolution and reviewed bulk remote choice', async () => {
    const connection = {
      ...disconnectedSyncConnection(),
      configured: true,
      enabled: true,
      runtimeState: 'conflict' as const,
      providerConfigId: 'provider:sync',
      endpointPath: '/contentlens.json',
      remoteObjectId: 'contentlens.json',
      retention: 'User controlled',
      revocation: 'Delete token',
      consentedAt: '2026-07-31T12:00:00.000Z'
    }
    const conflict = {
      id: 'conflict:1',
      createdAt: '2026-07-31T12:00:00.000Z',
      conflicts: [
        {
          entityType: 'exclusions' as const,
          entityId: 'item:1',
          reason: 'concurrent-change' as const,
          local: { kind: 'value' as const, value: { id: 'item:1', value: 1 } },
          remote: { kind: 'value' as const, value: { id: 'item:1', value: 2 } }
        }
      ],
      resolutions: []
    }
    const request = vi.fn(
      async (): Promise<SettingsRuntimeResponse> => ({
        kind: 'sync-resolution',
        value: { state: 'confirmed', digest: 'a'.repeat(64) }
      })
    )
    const container = await mount({
      conflict,
      connection,
      runtime: {
        request,
        requestPlatformPermission: vi.fn(async () => true),
        requestProviderPermission: vi.fn(async () => true)
      }
    })
    const choice = [...container.querySelectorAll('select')].find(
      select => select.labels?.[0]?.textContent === 'syncConflictChoiceLabel'
    )
    if (!(choice instanceof HTMLSelectElement)) {
      throw new Error('Conflict choice not found')
    }
    await change(choice, 'custom')
    const custom = [...container.querySelectorAll('input')].find(
      input => input.labels?.[0]?.textContent === 'syncConflictCustomLabel'
    )
    if (!(custom instanceof HTMLInputElement)) {
      throw new Error('Custom conflict value not found')
    }
    await change(custom, '{"id":"item:1","value":3}')
    await click(button(container, 'syncConflictResolveAction'))
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync.resolve',
        resolutions: [
          expect.objectContaining({ choice: 'custom', entityId: 'item:1' })
        ]
      })
    )

    await click(button(container, 'syncConflictUseAllRemoteAction'))
    expect(container.textContent).toContain('bulk:1')
    await click(button(container, 'removeProviderCancelAction'))
    await click(button(container, 'syncConflictUseAllRemoteAction'))
    await click(button(container, 'syncConflictBulkConfirmAction'))
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resolutions: [
          { entityType: 'exclusions', entityId: 'item:1', choice: 'remote' }
        ]
      })
    )
  })
})
