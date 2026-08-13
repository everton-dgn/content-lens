import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import { modelDescriptorSchema } from '@/ai/models/contracts'
import { providerDescriptorSchema } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { DecisionScheduler } from '@/application/decision-pipeline/scheduler'
import {
  createSettingsCapabilitySnapshot,
  SettingsCapabilitySnapshotStore
} from '@/application/settings'

const firstAt = '2026-07-31T06:30:00.000Z'
const secondAt = '2026-07-31T06:31:00.000Z'

function environment() {
  return {
    providers: new ProviderRegistry([
      providerDescriptorSchema.parse({
        schemaVersion: 1,
        providerConfigId: 'provider:cloud',
        displayName: 'Cloud provider',
        kind: 'openai-compatible',
        execution: 'cloud',
        endpointOrigin: 'https://provider.example',
        credentialMode: 'session-only',
        credentialRef: 'credential:must-not-leak',
        policyUrl: 'https://provider.example/privacy',
        policyReviewedAt: firstAt,
        createdAt: firstAt,
        updatedAt: firstAt,
        status: 'ready'
      })
    ]),
    catalog: new ModelCatalog([
      modelDescriptorSchema.parse({
        providerConfigId: 'provider:cloud',
        modelId: 'cloud-text',
        displayName: 'Cloud text',
        declaredVersion: '1',
        executionKind: 'cloud',
        catalogSource: 'user',
        lastCheckedAt: firstAt,
        status: 'available',
        capabilities: [
          {
            task: 'classification-text',
            modalities: ['text'],
            languages: ['en', 'pt', 'es'],
            imageMimeTypes: [],
            maxInputBytes: 128_000,
            maxOutputBytes: 16_000,
            structuredOutput: true,
            evidence: 'declared',
            source: 'user',
            verifiedAt: null
          }
        ]
      })
    ])
  }
}

describe('settings capability snapshots', () => {
  it('publishes a sanitized immutable provider and model snapshot', async () => {
    const snapshot = await createSettingsCapabilitySnapshot({
      profileRevision: 4,
      publishedAt: firstAt,
      ...environment()
    })
    const store = new SettingsCapabilitySnapshotStore()

    expect(store.publish(snapshot)).toMatchObject({
      state: 'published',
      snapshot: {
        schemaVersion: 1,
        profileRevision: 4,
        capabilityVersion: expect.stringMatching(
          /^settings-capabilities@[a-f0-9]{64}$/
        ),
        providers: [
          {
            providerConfigId: 'provider:cloud',
            credentialState: 'configured'
          }
        ],
        models: [{ modelId: 'cloud-text' }]
      }
    })
    expect(JSON.stringify(store.current())).not.toContain(
      'credential:must-not-leak'
    )

    const snapshotProvider = snapshot.providers[0]
    if (!snapshotProvider) {
      throw new Error('Expected provider capability')
    }
    snapshotProvider.displayName = 'mutated outside'
    expect(store.current()?.providers[0]?.displayName).toBe('Cloud provider')
  })

  it('discards work bound to the snapshot replaced during execution', async () => {
    const currentEnvironment = environment()
    const first = await createSettingsCapabilitySnapshot({
      profileRevision: 4,
      publishedAt: firstAt,
      ...currentEnvironment
    })
    const second = await createSettingsCapabilitySnapshot({
      profileRevision: 5,
      publishedAt: secondAt,
      ...currentEnvironment
    })
    const store = new SettingsCapabilitySnapshotStore()
    store.publish(first)
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const scheduler = new DecisionScheduler({
      capacity: 2,
      concurrency: 1,
      isCurrent: binding => store.matches(binding)
    })
    const scheduled = scheduler.schedule({
      workId: 'work:settings-snapshot',
      capability: 'classification-text',
      optional: true,
      priority: 'optional-visible',
      binding: {
        contentId: 'youtube:video:snapshot',
        pageInstanceId: 'page:snapshot',
        profileRevision: first.profileRevision,
        capabilityVersion: first.capabilityVersion,
        adapterVersion: 'youtube-adapter@1',
        policyVersion: 'decision-policy@1'
      },
      run: async () => {
        await gate
        return 'hide'
      }
    })
    await Promise.resolve()

    expect(store.publish(second)).toMatchObject({
      state: 'published',
      snapshot: { profileRevision: 5 }
    })
    release?.()
    if (!('completion' in scheduled)) {
      throw new Error('Expected scheduled completion')
    }
    await expect(scheduled.completion).resolves.toEqual({
      state: 'discarded',
      reason: 'stale-binding',
      attempts: 1
    })
    expect(store.matches(first)).toBe(false)
    expect(store.matches(second)).toBe(true)
  })

  it('ignores stale publication and accepts an idempotent replay', async () => {
    const currentEnvironment = environment()
    const first = await createSettingsCapabilitySnapshot({
      profileRevision: 4,
      publishedAt: firstAt,
      ...currentEnvironment
    })
    const second = await createSettingsCapabilitySnapshot({
      profileRevision: 5,
      publishedAt: secondAt,
      ...currentEnvironment
    })
    const store = new SettingsCapabilitySnapshotStore()

    store.publish(second)
    expect(store.publish(first)).toEqual({
      state: 'ignored',
      reason: 'stale-profile-revision'
    })
    expect(store.publish(second)).toMatchObject({
      state: 'unchanged',
      snapshot: { profileRevision: 5 }
    })
  })
})
