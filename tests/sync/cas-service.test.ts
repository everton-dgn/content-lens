import { describe, expect, it, vi } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { SyncCasService, type SyncStore } from '@/sync/cas-service'
import { emptySyncProfile, type SyncEnvelope } from '@/sync/contracts'

const at = '2026-07-31T12:00:00.000Z'

async function envelope(id: string, value: number) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:profile',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id, value: { value } }]
    },
    tombstones: []
  })
}

function store(input: { local: SyncEnvelope; base?: SyncEnvelope }) {
  let local = input.local
  const api = {
    readLocal: vi.fn(async () => local),
    readBase: vi.fn(async () => input.base),
    commitLocal: vi.fn(async ({ candidate }: { candidate: SyncEnvelope }) => {
      local = candidate
    }),
    confirmBase: vi.fn(async () => undefined),
    writeConflictDraft: vi.fn(async () => undefined),
    writeJournal: vi.fn(async () => undefined)
  } satisfies SyncStore
  return api
}

describe('sync compare-and-swap service', () => {
  it('pushes with the exact token from the remote read and confirms the base', async () => {
    const base = await envelope('entity:base', 1)
    const local = await envelope('entity:local', 2)
    const remote = await envelope('entity:remote', 3)
    const syncStore = store({ base, local })
    const compareAndSwap = vi.fn(async () => ({
      state: 'committed' as const,
      versionToken: 'version:confirmed'
    }))
    const onState = vi.fn(
      async (_state: 'pulling' | 'merging' | 'pushing') => undefined
    )
    const service = new SyncCasService({
      store: syncStore,
      transport: {
        read: vi.fn(async () => ({
          envelope: remote,
          versionToken: 'version:read'
        })),
        compareAndSwap,
        confirm: vi.fn(async ({ expectedVersionToken }) => ({
          state: 'confirmed' as const,
          versionToken: expectedVersionToken
        }))
      },
      onState
    })

    await expect(service.synchronize(at)).resolves.toMatchObject({
      state: 'confirmed',
      attempts: 1
    })
    expect(compareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersionToken: 'version:read' })
    )
    expect(syncStore.commitLocal).toHaveBeenCalledTimes(1)
    expect(syncStore.confirmBase).toHaveBeenCalledWith(
      expect.objectContaining({
        versionToken: 'version:confirmed',
        confirmedAt: at
      })
    )
    expect(onState.mock.calls.map(([state]) => state)).toEqual([
      'pulling',
      'merging',
      'pushing',
      'pulling'
    ])
  })

  it('re-reads and re-merges after mismatch without reusing the stale token', async () => {
    const base = await envelope('entity:base', 1)
    const local = await envelope('entity:local', 2)
    const firstRemote = await envelope('entity:first-remote', 3)
    const secondRemote = await envelope('entity:second-remote', 4)
    const syncStore = store({ base, local })
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        envelope: firstRemote,
        versionToken: 'version:first'
      })
      .mockResolvedValueOnce({
        envelope: secondRemote,
        versionToken: 'version:second'
      })
    const compareAndSwap = vi
      .fn()
      .mockResolvedValueOnce({ state: 'mismatch' })
      .mockResolvedValueOnce({
        state: 'committed',
        versionToken: 'version:confirmed'
      })
    const service = new SyncCasService({
      store: syncStore,
      transport: {
        read,
        compareAndSwap,
        confirm: vi.fn(async ({ expectedVersionToken }) => ({
          state: 'confirmed' as const,
          versionToken: expectedVersionToken
        }))
      }
    })

    await expect(service.synchronize(at)).resolves.toMatchObject({
      state: 'confirmed',
      attempts: 2
    })
    expect(
      compareAndSwap.mock.calls.map(([call]) => call.expectedVersionToken)
    ).toEqual(['version:first', 'version:second'])
    expect(syncStore.commitLocal).toHaveBeenCalledTimes(2)
  })

  it('stops after three mismatches and never confirms an uncommitted remote', async () => {
    const base = await envelope('entity:base', 1)
    const local = await envelope('entity:local', 2)
    const remote = await envelope('entity:remote', 3)
    const syncStore = store({ base, local })
    const compareAndSwap = vi.fn(async () => ({ state: 'mismatch' as const }))
    const service = new SyncCasService({
      store: syncStore,
      transport: {
        read: vi.fn(async () => ({
          envelope: remote,
          versionToken: crypto.randomUUID()
        })),
        compareAndSwap,
        confirm: vi.fn(async () => ({ state: 'mismatch' as const }))
      }
    })

    await expect(service.synchronize(at)).resolves.toEqual({
      state: 'degraded',
      attempts: 3,
      code: 'cas-retry-exhausted'
    })
    expect(compareAndSwap).toHaveBeenCalledTimes(3)
    expect(syncStore.confirmBase).not.toHaveBeenCalled()
  })

  it('does not mutate local state for an invalid remote or missing base', async () => {
    const local = await envelope('entity:local', 2)
    const withoutBase = store({ local })
    const transport = {
      read: vi.fn(async () => ({ envelope: local, versionToken: 'version' })),
      compareAndSwap: vi.fn(async () => ({ state: 'mismatch' as const })),
      confirm: vi.fn(async () => ({ state: 'mismatch' as const }))
    }
    await expect(
      new SyncCasService({ store: withoutBase, transport }).synchronize(at)
    ).resolves.toMatchObject({ state: 'degraded', code: 'missing-base' })
    expect(transport.read).not.toHaveBeenCalled()

    const withBase = store({ local, base: local })
    const invalidTransport = {
      ...transport,
      read: vi.fn(async () => ({
        envelope: { invalid: true },
        versionToken: 'bad'
      }))
    }
    await expect(
      new SyncCasService({
        store: withBase,
        transport: invalidTransport
      }).synchronize(at)
    ).resolves.toMatchObject({ state: 'degraded', code: 'invalid-remote' })
    expect(withBase.commitLocal).not.toHaveBeenCalled()
  })

  it('advances the base only after confirming the exact remote digest', async () => {
    const base = await envelope('entity:base', 1)
    const local = await envelope('entity:local', 2)
    const remote = await envelope('entity:remote', 3)
    const syncStore = store({ base, local })
    const confirm = vi.fn(async () => ({ state: 'mismatch' as const }))
    const service = new SyncCasService({
      store: syncStore,
      transport: {
        read: vi.fn(async () => ({
          envelope: remote,
          versionToken: `"version:${crypto.randomUUID()}"`
        })),
        compareAndSwap: vi.fn(async () => ({
          state: 'committed' as const,
          versionToken: `"version:${crypto.randomUUID()}"`
        })),
        confirm
      }
    })

    await expect(service.synchronize(at)).resolves.toEqual({
      state: 'degraded',
      attempts: 3,
      code: 'confirmation-mismatch'
    })
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(syncStore.confirmBase).not.toHaveBeenCalled()
  })
})
