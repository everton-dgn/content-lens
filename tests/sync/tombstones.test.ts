import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import {
  compactTombstones,
  compareSyncGeneration,
  deleteSyncEntity,
  tombstoneKey
} from '@/sync/tombstones'

async function envelope() {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:tombstones',
    generation: 4,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'exclusion:one', value: { phrase: 'spoiler' } }]
    },
    tombstones: []
  })
}

describe('sync tombstones and generations', () => {
  it('turns an explicit deletion into a generation-bound fingerprint', async () => {
    const current = await envelope()
    const result = await deleteSyncEntity({
      envelope: current,
      entityType: 'exclusions',
      entityId: 'exclusion:one',
      deletedAt: '2026-07-31T12:00:00.000Z'
    })

    expect(result.state).toBe('deleted')
    if (result.state !== 'deleted') {
      throw new Error('Expected a tombstone')
    }
    expect(result.envelope.profile.exclusions).toEqual([])
    expect(result.tombstone).toMatchObject({
      deletedInGeneration: 4,
      entityId: 'exclusion:one',
      entityType: 'exclusions'
    })
    expect(result.tombstone.baseFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('compacts only an explicit selection after every safety precondition', async () => {
    const deleted = await deleteSyncEntity({
      envelope: await envelope(),
      entityType: 'exclusions',
      entityId: 'exclusion:one',
      deletedAt: '2026-07-31T12:00:00.000Z'
    })
    if (deleted.state !== 'deleted') {
      throw new Error('Expected a tombstone')
    }
    const key = tombstoneKey(deleted.tombstone)
    const compacted = await compactTombstones({
      envelope: deleted.envelope,
      confirmedRemoteDigest: deleted.envelope.digest,
      recoverySnapshotDigest: 'snapshot:digest',
      selectedKeys: [key],
      knownDevices: [
        { deviceId: 'device:one', confirmedGeneration: 4, revoked: false }
      ],
      conflictCount: 0,
      pendingOperationCount: 0
    })

    expect(compacted.state).toBe('compacted')
    if (compacted.state !== 'compacted') {
      throw new Error('Expected compaction')
    }
    expect(compacted.envelope.generation).toBe(5)
    expect(compacted.envelope.tombstones).toEqual([])
    expect(compareSyncGeneration(4, 5)).toBe('generation-behind')
  })

  it('blocks compaction when remote, recovery, conflicts, operations or devices are unsafe', async () => {
    const deleted = await deleteSyncEntity({
      envelope: await envelope(),
      entityType: 'exclusions',
      entityId: 'exclusion:one',
      deletedAt: '2026-07-31T12:00:00.000Z'
    })
    if (deleted.state !== 'deleted') {
      throw new Error('Expected a tombstone')
    }
    const baseline = {
      envelope: deleted.envelope,
      confirmedRemoteDigest: deleted.envelope.digest,
      recoverySnapshotDigest: 'snapshot:digest',
      selectedKeys: [tombstoneKey(deleted.tombstone)],
      knownDevices: [
        { deviceId: 'device:one', confirmedGeneration: 4, revoked: false }
      ],
      conflictCount: 0,
      pendingOperationCount: 0
    }

    await expect(
      compactTombstones({ ...baseline, confirmedRemoteDigest: 'stale' })
    ).resolves.toMatchObject({ code: 'remote-unconfirmed' })
    await expect(
      compactTombstones({ ...baseline, recoverySnapshotDigest: undefined })
    ).resolves.toMatchObject({ code: 'recovery-snapshot-required' })
    await expect(
      compactTombstones({ ...baseline, conflictCount: 1 })
    ).resolves.toMatchObject({ code: 'conflict-present' })
    await expect(
      compactTombstones({ ...baseline, pendingOperationCount: 1 })
    ).resolves.toMatchObject({ code: 'operation-pending' })
    await expect(
      compactTombstones({
        ...baseline,
        knownDevices: [
          { deviceId: 'device:old', confirmedGeneration: 3, revoked: false }
        ]
      })
    ).resolves.toMatchObject({ code: 'device-behind' })
  })
})
