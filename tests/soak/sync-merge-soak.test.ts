import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import {
  emptySyncProfile,
  type SyncEnvelope,
  type Tombstone
} from '@/sync/contracts'
import { mergeSyncEnvelopes } from '@/sync/three-way-merge'

const at = '2026-07-31T12:00:00.000Z'

type Value = { id: string; value: { value: number } }
type MutableSide = {
  values: Map<string, Value>
  tombstones: Map<string, Tombstone>
}

function randomSequence(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

function baseFingerprint(index: number) {
  return index.toString(16).padStart(64, '0')
}

function snapshot(side: MutableSide, base: SyncEnvelope) {
  const { digest: _digest, ...payload } = base
  return sealSyncEnvelope({
    ...payload,
    profile: {
      ...emptySyncProfile(),
      exclusions: [...side.values.values()]
    },
    tombstones: [...side.tombstones.values()]
  })
}

function stateIds(envelope: SyncEnvelope) {
  return new Set([
    ...envelope.profile.exclusions.map(entity => entity.id),
    ...envelope.tombstones.map(tombstone => tombstone.entityId)
  ])
}

describe('sync merge soak', () => {
  it('preserves or explicitly conflicts every state after 10,000 deterministic operations', async () => {
    const baseValues = Array.from({ length: 500 }, (_, index) => ({
      id: `entity:${index}`,
      value: { value: 0 }
    }))
    const base = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: 'sync:soak',
      generation: 0,
      profile: { ...emptySyncProfile(), exclusions: baseValues },
      tombstones: []
    })
    const local: MutableSide = {
      values: new Map(baseValues.map(value => [value.id, value])),
      tombstones: new Map()
    }
    const remote: MutableSide = {
      values: new Map(baseValues.map(value => [value.id, value])),
      tombstones: new Map()
    }
    const random = randomSequence(0x5eedc0de)

    for (let operation = 0; operation < 10_000; operation += 1) {
      const side = random() % 2 === 0 ? local : remote
      const index = random() % 500
      const entityId = `entity:${index}`
      const action = random() % 3
      if (action === 0) {
        side.tombstones.delete(entityId)
        side.values.set(entityId, {
          id: entityId,
          value: { value: operation + 1 }
        })
      } else if (action === 1) {
        side.values.delete(entityId)
        side.tombstones.set(entityId, {
          entityType: 'exclusions',
          entityId,
          deletedInGeneration: 0,
          baseFingerprint: baseFingerprint(index),
          deletedAt: at
        })
      } else if (side.tombstones.has(entityId)) {
        const restoredId = `restored:${operation}`
        side.values.set(restoredId, {
          id: restoredId,
          value: { value: operation + 1 }
        })
      }
    }
    local.tombstones.delete('entity:0')
    remote.tombstones.delete('entity:0')
    local.values.set('entity:0', {
      id: 'entity:0',
      value: { value: 10_001 }
    })
    remote.values.set('entity:0', {
      id: 'entity:0',
      value: { value: 10_002 }
    })

    const localEnvelope = await snapshot(local, base)
    const remoteEnvelope = await snapshot(remote, base)
    const result = await mergeSyncEnvelopes({
      base,
      local: localEnvelope,
      remote: remoteEnvelope
    })
    const expectedIds = new Set([
      ...stateIds(base),
      ...stateIds(localEnvelope),
      ...stateIds(remoteEnvelope)
    ])
    const accountedIds = new Set([
      ...result.draft.profile.exclusions.map(entity => entity.id),
      ...result.draft.tombstones.map(tombstone => tombstone.entityId),
      ...result.conflicts.map(conflict => conflict.entityId)
    ])

    expect(accountedIds).toEqual(expectedIds)
    expect(
      result.conflicts.every(
        conflict => conflict.reason === 'concurrent-change'
      )
    ).toBe(true)
    expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('keeps the merge result stable across a 24-hour clock divergence', async () => {
    const base = await sealSyncEnvelope({
      schemaVersion: 1,
      syncProfileId: 'sync:clock-soak',
      generation: 0,
      profile: {
        ...emptySyncProfile(),
        exclusions: [{ id: 'entity:clock', value: { value: 1 } }]
      },
      tombstones: []
    })
    const local = await sealSyncEnvelope({
      ...withoutDigest(base),
      profile: emptySyncProfile(),
      tombstones: [
        {
          entityType: 'exclusions',
          entityId: 'entity:clock',
          deletedInGeneration: 0,
          baseFingerprint: 'a'.repeat(64),
          deletedAt: at
        }
      ]
    })
    const localTombstone = local.tombstones[0]
    if (!localTombstone) {
      throw new Error('Expected a local tombstone')
    }
    const remote = await sealSyncEnvelope({
      ...withoutDigest(local),
      tombstones: [
        {
          ...localTombstone,
          deletedAt: '2026-08-01T12:00:00.000Z'
        }
      ]
    })

    const result = await mergeSyncEnvelopes({ base, local, remote })

    expect(result.conflicts).toEqual([])
    expect(result.candidate?.tombstones).toHaveLength(1)
  })
})

function withoutDigest(envelope: SyncEnvelope) {
  const { digest: _digest, ...payload } = envelope
  return payload
}
