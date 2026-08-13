import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { resolveSyncConflicts } from '@/sync/conflict-resolution'
import { emptySyncProfile } from '@/sync/contracts'
import { mergeSyncEnvelopes } from '@/sync/three-way-merge'

const provider = (displayName: string) => ({
  providerConfigId: 'provider:one',
  displayName,
  kind: 'openai' as const,
  execution: 'cloud' as const,
  endpointOrigin: 'https://api.openai.com',
  policyUrl: null
})

async function envelope(displayName: string) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:conflict',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      portableProviders: [provider(displayName)]
    },
    tombstones: []
  })
}

describe('sync conflict resolution', () => {
  it('resolves every conflict with local, remote or schema-validated custom values', async () => {
    const base = await envelope('Base')
    const local = await envelope('Local')
    const remote = await envelope('Remote')
    const merge = await mergeSyncEnvelopes({ base, local, remote })

    await expect(
      resolveSyncConflicts({
        local,
        merge,
        resolutions: [
          {
            entityType: 'portableProviders',
            entityId: 'provider:one',
            choice: 'local'
          }
        ]
      })
    ).resolves.toMatchObject({
      state: 'resolved',
      candidate: {
        profile: { portableProviders: [{ displayName: 'Local' }] }
      }
    })

    await expect(
      resolveSyncConflicts({
        local,
        merge,
        resolutions: [
          {
            entityType: 'portableProviders',
            entityId: 'provider:one',
            choice: 'custom',
            customValue: provider('Edited final value')
          }
        ]
      })
    ).resolves.toMatchObject({
      state: 'resolved',
      candidate: {
        profile: {
          portableProviders: [{ displayName: 'Edited final value' }]
        }
      }
    })
  })

  it('rejects missing, duplicate and schema-invalid resolutions', async () => {
    const base = await envelope('Base')
    const local = await envelope('Local')
    const remote = await envelope('Remote')
    const merge = await mergeSyncEnvelopes({ base, local, remote })

    await expect(
      resolveSyncConflicts({ local, merge, resolutions: [] })
    ).resolves.toEqual({
      state: 'invalid',
      code: 'incomplete-resolution'
    })
    await expect(
      resolveSyncConflicts({
        local,
        merge,
        resolutions: [
          {
            entityType: 'portableProviders',
            entityId: 'provider:one',
            choice: 'custom',
            customValue: { apiKey: 'forbidden' }
          }
        ]
      })
    ).resolves.toEqual({ state: 'invalid', code: 'invalid-resolution' })
  })
})
