import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import type { SettingsRequestMessage } from '@/application/settings/runtime-contracts'
import { createServiceWorkerRuntime } from '@/extension/service-worker/runtime'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

const at = '2026-07-31T14:00:00.000Z'
const envelope = {
  namespace: 'contentlens.runtime.v1' as const,
  version: 1 as const
}

type SettingsMessageInput = SettingsRequestMessage extends infer Message
  ? Message extends SettingsRequestMessage
    ? Omit<Message, 'namespace' | 'version'>
    : never
  : never

const message = (input: SettingsMessageInput): SettingsRequestMessage =>
  ({ ...envelope, ...input }) as SettingsRequestMessage

describe('service-worker Settings runtime', () => {
  it('persists provider metadata and settings without returning or storing session secrets', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-settings-runtime'
    })
    await database.saveProfile(
      createLocalProfile({ at, profileId: 'profile:settings-runtime' })
    )
    const runtime = createServiceWorkerRuntime({
      alarmsApi: { create: vi.fn(async () => undefined) },
      browser: 'chrome',
      database,
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

    const initial = await runtime.settings.handle(
      message({ type: 'settings.snapshot', requestId: 'snapshot:initial' })
    )
    expect(initial.kind).toBe('snapshot')
    if (initial.kind !== 'snapshot') {
      throw new Error('Expected a ready settings snapshot')
    }

    const created = await runtime.settings.handle(
      message({
        type: 'provider.create',
        requestId: 'provider:create',
        templateId: 'openai',
        displayName: 'OpenAI personal'
      })
    )
    expect(created.kind).toBe('provider')
    if (created.kind !== 'provider') {
      throw new Error('Expected a provider response')
    }
    const providerConfigId = created.value.providerConfigId
    const secret = 'settings-runtime-session-secret-canary'
    const credential = await runtime.settings.handle(
      message({
        type: 'provider.credential',
        requestId: 'provider:credential',
        providerConfigId,
        mode: 'session-only',
        value: secret
      })
    )

    expect(credential.kind).toBe('provider')
    expect(JSON.stringify(credential)).not.toContain(secret)
    const refreshed = await runtime.settings.handle(
      message({ type: 'settings.snapshot', requestId: 'snapshot:refreshed' })
    )
    expect(refreshed.kind).toBe('snapshot')
    expect(JSON.stringify(refreshed)).not.toContain(secret)
    expect(JSON.stringify(await database.readProviderState())).not.toContain(
      secret
    )

    const saved = await runtime.settings.handle(
      message({
        type: 'settings.save',
        requestId: 'settings:save',
        operationId: 'operation:settings-runtime',
        expectedRevision: initial.value.settings.revision,
        at,
        settings: initial.value.settings.settings,
        reviewedConsentKeys: []
      })
    )
    expect(saved).toMatchObject({
      kind: 'settings-save',
      value: { state: 'committed' }
    })

    const updated = await runtime.settings.handle(
      message({
        type: 'provider.update',
        requestId: 'provider:update',
        providerConfigId,
        displayName: 'OpenAI renamed',
        endpointOrigin: 'https://api.openai.com'
      })
    )
    expect(updated).toMatchObject({
      kind: 'provider',
      value: { displayName: 'OpenAI renamed' }
    })
    const fetchImpl = vi.fn(async (_request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${secret}`
      )
      return new Response(JSON.stringify({ data: [{ id: 'gpt-runtime' }] }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const catalog = await (async () => {
      try {
        return await runtime.settings.handle(
          message({
            type: 'provider.catalog.refresh',
            requestId: 'provider:catalog:refresh',
            providerConfigId
          })
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })()
    expect(catalog).toMatchObject({
      kind: 'provider-catalog',
      value: [{ modelId: 'gpt-runtime', capabilities: [] }]
    })
    expect(JSON.stringify(catalog)).not.toContain(secret)
    const preview = await runtime.settings.handle(
      message({
        type: 'provider.remove.preview',
        requestId: 'provider:remove:preview',
        providerConfigId
      })
    )
    expect(preview).toEqual({
      kind: 'provider-removal-preview',
      value: {
        blocked: false,
        models: ['gpt-runtime'],
        providerConfigId,
        routes: []
      }
    })
    const removed = await runtime.settings.handle(
      message({
        type: 'provider.remove',
        requestId: 'provider:remove',
        providerConfigId
      })
    )
    expect(removed).toMatchObject({
      kind: 'provider-removed',
      value: {
        provider: { providerConfigId, displayName: 'OpenAI renamed' }
      }
    })
    const afterRemoval = await runtime.settings.handle(
      message({
        type: 'settings.snapshot',
        requestId: 'snapshot:after-removal'
      })
    )
    expect(afterRemoval).toMatchObject({ kind: 'snapshot' })
    if (afterRemoval.kind !== 'snapshot') {
      throw new Error('Expected snapshot after provider removal')
    }
    expect(
      afterRemoval.value.providers.providers.some(
        candidate => candidate.providerConfigId === providerConfigId
      )
    ).toBe(false)

    database.close()
  })
})
