import { describe, expect, it } from 'vitest'

import { browserBuiltInModel } from '@/ai/browser/catalog'
import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import {
  materializeImportedSyncEnvelope,
  reconcileMergedSyncEnvelope
} from '@/sync/materialize-import'

const importedAt = '2026-07-31T12:00:00.000Z'

async function envelope() {
  const model = {
    ...browserBuiltInModel(),
    providerConfigId: 'provider:portable',
    modelId: 'portable-model',
    executionKind: 'cloud' as const,
    catalogSource: 'user' as const
  }
  const {
    lastCheckedAt: _lastCheckedAt,
    status: _status,
    ...portableModel
  } = model
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:portable',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      portableProviders: [
        {
          providerConfigId: 'provider:portable',
          displayName: 'Portable provider',
          kind: 'openai-compatible',
          execution: 'cloud',
          endpointOrigin: 'https://provider.example',
          policyUrl: null
        }
      ],
      modelCatalog: [portableModel],
      modelBindings: [
        {
          id: 'binding:one',
          platform: 'youtube',
          task: 'classification-text',
          providerConfigId: 'provider:portable',
          modelId: 'portable-model',
          active: true
        }
      ]
    },
    tombstones: []
  })
}

describe('sync import materialization', () => {
  it('locks imported providers, clears consent and deactivates bindings', async () => {
    const materialized = materializeImportedSyncEnvelope(
      await envelope(),
      importedAt
    )

    expect(materialized.providers[0]).toMatchObject({
      providerConfigId: 'provider:portable',
      status: 'locked',
      credentialMode: 'session-only',
      credentialRef: null,
      lastConnectionTest: null
    })
    expect(materialized.consents).toEqual([])
    expect(materialized.modelBindings[0]).toMatchObject({ active: false })
    expect(JSON.stringify(materialized)).not.toMatch(
      /authorization|credentialRef":"[^n]|password|secret|token/iu
    )
  })

  it('rejects model and binding references that cannot be reconnected', async () => {
    const source = await envelope()
    expect(() =>
      materializeImportedSyncEnvelope(
        {
          ...source,
          profile: {
            ...source.profile,
            portableProviders: []
          }
        },
        importedAt
      )
    ).toThrow('unknown provider')
  })

  it('preserves only matching local credentials during a merge', async () => {
    const source = await envelope()
    const current = {
      schemaVersion: 1 as const,
      providers: [
        {
          schemaVersion: 1 as const,
          providerConfigId: 'provider:portable',
          displayName: 'Local provider',
          kind: 'openai-compatible' as const,
          execution: 'cloud' as const,
          endpointOrigin: 'https://provider.example',
          credentialMode: 'external-vault' as const,
          credentialRef: 'credential:local',
          policyUrl: null,
          policyReviewedAt: null,
          createdAt: importedAt,
          updatedAt: importedAt,
          status: 'ready' as const,
          lastConnectionTest: null
        }
      ],
      models: [],
      consents: [],
      credentials: [
        {
          schemaVersion: 1 as const,
          reference: 'credential:local',
          mode: 'external-vault' as const,
          binding: {
            providerConfigId: 'provider:portable',
            endpointOrigin: 'https://provider.example'
          },
          externalReference: 'vault:item:local',
          proxyCredentialMode: 'none' as const
        }
      ]
    }
    const matching = reconcileMergedSyncEnvelope(source, current, importedAt)
    expect(matching).toMatchObject({
      providers: [{ status: 'ready', credentialRef: 'credential:local' }],
      credentials: [{ reference: 'credential:local' }]
    })

    const { digest: _digest, ...payload } = source
    const changedBinding = await sealSyncEnvelope({
      ...payload,
      profile: {
        ...source.profile,
        portableProviders: source.profile.portableProviders.map(provider => ({
          ...provider,
          endpointOrigin: 'https://other.example'
        }))
      }
    })
    const changed = reconcileMergedSyncEnvelope(
      changedBinding,
      current,
      importedAt
    )
    expect(changed).toMatchObject({
      providers: [{ status: 'locked', credentialRef: null }],
      credentials: []
    })
  })
})
