import { describe, expect, it } from 'vitest'

import {
  fingerprintSyncEntity,
  sealSyncEnvelope,
  verifySyncEnvelope
} from '@/sync/canonical'
import {
  emptySyncProfile,
  portableProviderDescriptorSchema,
  type SyncEnvelope,
  type SyncProfile
} from '@/sync/contracts'
import { mergeSyncEnvelopes } from '@/sync/three-way-merge'

const at = '2026-07-31T12:00:00.000Z'
const provider = (displayName: string) => ({
  providerConfigId: 'provider:one',
  displayName,
  kind: 'openai' as const,
  execution: 'cloud' as const,
  endpointOrigin: 'https://api.openai.com',
  policyUrl: 'https://openai.com/policies/privacy-policy'
})

async function envelope(
  profile: SyncProfile,
  overrides: { generation?: number; syncProfileId?: string } = {}
) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: overrides.syncProfileId ?? 'sync:profile',
    generation: overrides.generation ?? 0,
    profile,
    tombstones: []
  })
}

function withProvider(displayName: string) {
  return { ...emptySyncProfile(), portableProviders: [provider(displayName)] }
}

describe('sync envelope and three-way merge', () => {
  it('canonicalizes collection order and detects digest tampering', async () => {
    const first = await envelope({
      ...emptySyncProfile(),
      exclusions: [
        { id: 'exclusion:b', value: { value: 2 } },
        { id: 'exclusion:a', value: { value: 1 } }
      ]
    })
    const second = await envelope({
      ...emptySyncProfile(),
      exclusions: [...first.profile.exclusions].reverse()
    })

    expect(first.digest).toBe(second.digest)
    await expect(verifySyncEnvelope(first)).resolves.toMatchObject({
      valid: true
    })
    await expect(
      verifySyncEnvelope({
        ...first,
        profile: { ...first.profile, exclusions: [] }
      })
    ).resolves.toEqual({ valid: false, code: 'digest-mismatch' })
  })

  it('rejects portable provider secrets and connection state', () => {
    expect(
      portableProviderDescriptorSchema.safeParse({
        ...provider('Provider'),
        credentialRef: 'credential:secret'
      }).success
    ).toBe(false)
    expect(
      portableProviderDescriptorSchema.safeParse({
        ...provider('Provider'),
        status: 'ready'
      }).success
    ).toBe(false)
  })

  it.each([
    ['unchanged', 'A', 'A', 'A', 'A', false],
    ['local change', 'A', 'B', 'A', 'B', false],
    ['remote change', 'A', 'A', 'B', 'B', false],
    ['coalesced change', 'A', 'B', 'B', 'B', false],
    ['concurrent conflict', 'A', 'B', 'C', null, true]
  ])(
    'handles %s',
    async (_case, baseName, localName, remoteName, expected, conflict) => {
      const base = await envelope(withProvider(baseName))
      const local = await envelope(withProvider(localName))
      const remote = await envelope(withProvider(remoteName))

      const result = await mergeSyncEnvelopes({ base, local, remote })

      expect(
        result.candidate?.profile.portableProviders[0]?.displayName ?? null
      ).toBe(expected)
      expect(result.conflicts.length > 0).toBe(conflict)
    }
  )

  it('merges a one-sided tombstone and blocks delete-versus-edit', async () => {
    const base = await envelope(withProvider('A'))
    const baseFingerprint = await fingerprintSyncEntity(provider('A'))
    const local = await sealSyncEnvelope({
      ...withoutDigest(base),
      profile: emptySyncProfile(),
      tombstones: [
        {
          entityType: 'portableProviders',
          entityId: 'provider:one',
          deletedInGeneration: 0,
          baseFingerprint,
          deletedAt: at
        }
      ]
    })
    const unchanged = await mergeSyncEnvelopes({ base, local, remote: base })
    expect(unchanged.candidate?.profile.portableProviders).toEqual([])
    expect(unchanged.candidate?.tombstones).toHaveLength(1)

    const remote = await envelope(withProvider('Remote edit'))
    const conflicted = await mergeSyncEnvelopes({ base, local, remote })
    expect(conflicted.candidate).toBeNull()
    expect(conflicted.conflicts[0]).toMatchObject({
      entityType: 'portableProviders',
      entityId: 'provider:one',
      reason: 'concurrent-change'
    })
  })

  it('rejects mismatched profiles and generations before entity merge', async () => {
    const base = await envelope(emptySyncProfile())
    const profileMismatch = await envelope(emptySyncProfile(), {
      syncProfileId: 'sync:other'
    })
    const generationMismatch = await envelope(emptySyncProfile(), {
      generation: 1
    })

    expect(
      (await mergeSyncEnvelopes({ base, local: base, remote: profileMismatch }))
        .conflicts[0]?.reason
    ).toBe('profile-mismatch')
    expect(
      (
        await mergeSyncEnvelopes({
          base,
          local: base,
          remote: generationMismatch
        })
      ).conflicts[0]?.reason
    ).toBe('generation-mismatch')
  })
})

function withoutDigest(envelopeValue: SyncEnvelope) {
  const { digest: _digest, ...payload } = envelopeValue
  return payload
}
