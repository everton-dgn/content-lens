import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import type { SettingsRequestMessage } from '@/application/settings/runtime-contracts'
import { createServiceWorkerRuntime } from '@/extension/service-worker/runtime'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const at = '2026-07-31T14:00:00.000Z'

const message = (input: object): SettingsRequestMessage =>
  ({
    namespace: 'contentlens.runtime.v1',
    version: 1,
    ...input
  }) as SettingsRequestMessage

const createRuntime = async (
  databaseName: string,
  onAdapterActivationReconciled: (outcome: {
    locale: string
  }) => Promise<void> | void
) => {
  const database = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName
  })
  await database.saveProfile(
    createLocalProfile({ at, profileId: `profile:${databaseName}` })
  )

  return createServiceWorkerRuntime({
    alarmsApi: { create: vi.fn(async () => undefined) },
    browser: 'chrome',
    database,
    onAdapterActivationReconciled,
    permissionApi: {
      contains: vi.fn(async () => true),
      getAll: vi.fn(async () => ({ origins: [], permissions: [] })),
      remove: vi.fn(async () => true),
      request: vi.fn(async () => true)
    },
    scriptingApi: {
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined)
    }
  })
}

describe('adapter activation broadcast', () => {
  it('reports the stored language on every reconciliation', async () => {
    const reconciled = vi.fn()
    const runtime = await createRuntime(
      'contentlens-activation-broadcast',
      reconciled
    )

    await runtime.reconcileAdapterActivation()

    expect(reconciled).toHaveBeenCalledOnce()
    expect(reconciled).toHaveBeenLastCalledWith(
      expect.objectContaining({ locale: 'auto' })
    )
  })

  it('reaches open platform tabs when a saved language changes', async () => {
    const reconciled = vi.fn()
    const runtime = await createRuntime(
      'contentlens-activation-language',
      reconciled
    )

    const snapshot = await runtime.settings.handle(
      message({ type: 'settings.snapshot', requestId: 'snapshot:initial' })
    )
    if (snapshot.kind !== 'snapshot') {
      throw new Error('Expected a ready settings snapshot')
    }
    const settings = structuredClone(snapshot.value.settings.settings)
    settings.interface.locale = 'pt_BR'

    const saved = await runtime.settings.handle(
      message({
        type: 'settings.save',
        requestId: 'settings:save-locale',
        operationId: 'operation:settings:save-locale',
        expectedRevision: snapshot.value.settings.revision,
        at,
        settings,
        reviewedConsentKeys: []
      })
    )

    expect(saved.kind).toBe('settings-save')
    // The overlay copy travels with this broadcast, so a saved language that
    // never reaches it would leave open tabs on the previous one.
    expect(reconciled).toHaveBeenLastCalledWith(
      expect.objectContaining({ locale: 'pt_BR' })
    )
  })
})
