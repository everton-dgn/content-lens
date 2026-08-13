import { describe, expect, it, vi } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import type { SyncResolutionStore } from '@/sync/cas-service'
import { createSyncConflictDraft } from '@/sync/conflict-draft'
import { disconnectedSyncConnection } from '@/sync/connection'
import { emptySyncProfile } from '@/sync/contracts'
import type { SyncProvider } from '@/sync/providers/contracts'
import { UserOwnedSyncService } from '@/sync/service'

const at = '2026-07-31T12:00:00.000Z'

async function envelope(value: number) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:conflict-service',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'shared', value: { value } }]
    },
    tombstones: []
  })
}

async function fixture(commitState: 'committed' | 'mismatch') {
  const base = await envelope(1)
  const local = await envelope(2)
  const remote = await envelope(3)
  const draft = await createSyncConflictDraft({
    base,
    local,
    remote,
    remoteVersionToken: '"remote:3"',
    at
  })
  const clearConflictDraft = vi.fn(async () => undefined)
  const store = {
    readLocal: vi.fn(async () => local),
    readBase: vi.fn(async () => base),
    commitLocal: vi.fn(async () => undefined),
    confirmBase: vi.fn(async () => undefined),
    writeConflictDraft: vi.fn(async () => undefined),
    writeJournal: vi.fn(async () => undefined),
    readConflictDraft: vi.fn(async () => draft),
    saveConflictResolutions: vi.fn(async () => undefined),
    clearConflictDraft
  } satisfies SyncResolutionStore
  const compareAndSwap = vi.fn(async () =>
    commitState === 'committed'
      ? { state: 'committed' as const, versionToken: '"remote:4"' }
      : { state: 'mismatch' as const }
  )
  const provider = {
    metadata: {
      providerConfigId: 'provider:sync',
      displayName: 'Sync',
      endpointOrigin: 'https://sync.example',
      policyUrl: null,
      retention: 'User controlled',
      revocation: 'Revoke token',
      casMethod: 'test',
      maxBytes: 1_000_000
    },
    connect: vi.fn(async () => ({ state: 'idle' as const })),
    disconnect: vi.fn(async () => undefined),
    read: vi.fn(async () => ({
      envelope: remote,
      versionToken: '"remote:3"',
      byteLength: 1
    })),
    initialize: vi.fn(async () => ({ state: 'mismatch' as const })),
    compareAndSwap,
    confirm: vi.fn(async () => ({
      state: 'confirmed' as const,
      versionToken: '"remote:4"'
    })),
    getStatus: vi.fn(() => ({ state: 'idle' as const }))
  } satisfies SyncProvider
  let connection = {
    ...disconnectedSyncConnection(),
    configured: true,
    enabled: true,
    runtimeState: 'conflict' as const,
    providerConfigId: 'provider:sync',
    endpointPath: '/contentlens.json',
    remoteObjectId: 'contentlens.json',
    retention: 'User controlled',
    revocation: 'Revoke token',
    consentedAt: at
  }
  const service = new UserOwnedSyncService({
    repository: {
      readSyncConnection: async () => connection,
      writeSyncConnection: async input => {
        connection = input as typeof connection
        return { state: 'stored' }
      }
    },
    providerFactory: async () => provider,
    storeFactory: () => store
  })
  return { service, store, compareAndSwap, clearConflictDraft }
}

describe('sync conflict service', () => {
  it('persists choices, pushes with the draft token and clears only after confirmation', async () => {
    const { service, store, compareAndSwap, clearConflictDraft } =
      await fixture('committed')

    await expect(
      service.resolveConflict({
        at,
        resolutions: [
          { entityType: 'exclusions', entityId: 'shared', choice: 'local' }
        ]
      })
    ).resolves.toMatchObject({ state: 'confirmed' })
    expect(store.saveConflictResolutions).toHaveBeenCalledOnce()
    expect(compareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersionToken: '"remote:3"' })
    )
    expect(store.confirmBase).toHaveBeenCalledOnce()
    expect(clearConflictDraft).toHaveBeenCalledOnce()
  })

  it('keeps the draft when the remote token became stale', async () => {
    const { service, store, clearConflictDraft } = await fixture('mismatch')

    await expect(
      service.resolveConflict({
        at,
        resolutions: [
          { entityType: 'exclusions', entityId: 'shared', choice: 'remote' }
        ]
      })
    ).resolves.toEqual({ state: 'conflict', code: 'stale-remote' })
    expect(store.confirmBase).not.toHaveBeenCalled()
    expect(clearConflictDraft).not.toHaveBeenCalled()
  })
})
