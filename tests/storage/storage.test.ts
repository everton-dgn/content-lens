import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import { modelDescriptorSchema } from '@/ai/models/contracts'
import { ConsentRepository } from '@/ai/providers/consent'
import { providerDescriptorSchema } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { RuleManagementService } from '@/application/rule-management/service'
import {
  SettingsCapabilitySnapshotStore,
  SettingsManagementService
} from '@/application/settings'
import type { ContentItem } from '@/core/content/contracts'
import type { Decision } from '@/core/decisions/contracts'
import type { ExactRule } from '@/core/rules/contracts/rule'
import { createDefaultSettings } from '@/core/settings'
import { normalizeConsentKey } from '@/security/credentials/contracts'
import {
  MAX_PROFILE_DEPTH,
  MAX_RULES,
  type ProfileEnvelope
} from '@/storage/contracts/profile-envelope'
import {
  ContentLensDatabase,
  MAX_OPERATION_RECORDS,
  MAX_RECENT_DECISIONS
} from '@/storage/indexed-db/database'

const timestamp = '2026-07-29T21:30:00.000Z'

const firstRule: ExactRule = {
  id: 'rule:1',
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'Transfer gossip',
  caseSensitive: false
}

const secondRule: ExactRule = {
  ...firstRule,
  id: 'rule:2',
  effect: 'allow',
  value: 'Tactical analysis'
}

const feedback: ProfileEnvelope['feedbackExamples'][number] = {
  id: 'feedback:1',
  contentId: 'youtube:video:abc',
  action: 'correct-classification',
  correction: {
    topics: ['software-engineering'],
    desiredAction: 'show'
  },
  createdAt: timestamp
}

function profile(overrides: Partial<ProfileEnvelope> = {}): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 0 },
    profileId: 'profile:local',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    rules: [firstRule],
    feedbackExamples: [feedback],
    settings: {
      enabledPlatforms: ['youtube'],
      thresholds: { hide: 0.9 }
    },
    extensions: {
      'content-lens.example': {
        enabled: true
      }
    },
    ...overrides
  }
}

function content(index: number): ContentItem {
  return {
    id: `youtube:video:${index}`,
    platform: 'youtube',
    identity: {
      status: 'stable',
      platformContentId: `video:${index}`
    },
    surface: 'youtube:home',
    title: `Synthetic title ${index}`,
    media: [],
    observedAt: timestamp,
    context: {}
  }
}

function decision(index: number): Decision {
  return {
    contentId: `youtube:video:${index}`,
    action: 'show',
    score: 0.5,
    confidence: 1,
    reasons: [],
    matchedRuleIds: [],
    decidedAt: timestamp,
    classifierVersion: 'rule-engine@1;profile=1',
    policyVersion: 'deterministic-policy@1',
    profileRevision: 1
  }
}

function database(
  name: string,
  limits?: {
    recentDecisions?: number
    contentHistory?: number
    cacheEntries?: number
    operationRecords?: number
  }
) {
  const factory = new IDBFactory()
  return {
    factory,
    repository: new ContentLensDatabase({
      factory,
      databaseName: name,
      limits
    })
  }
}

function replaceRawProfileMetadata(
  factory: IDBFactory,
  name: string,
  metadata: Record<string, unknown>
) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name)
    request.addEventListener('success', () => {
      const connection = request.result
      const transaction = connection.transaction('profile', 'readwrite')
      transaction.objectStore('profile').put({ key: 'active', ...metadata })
      transaction.addEventListener(
        'complete',
        () => {
          connection.close()
          resolve()
        },
        { once: true }
      )
      transaction.addEventListener(
        'error',
        () =>
          reject(transaction.error ?? new Error('raw profile write failed')),
        { once: true }
      )
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('raw database open failed')),
      { once: true }
    )
  })
}

describe('IndexedDB portable profile', () => {
  it('round-trips all portable fields and excludes local-only stores', async () => {
    const { repository } = database('contentlens-storage-roundtrip')
    const expected = profile()

    await repository.saveProfile(expected)
    await repository.recordObservations([
      {
        content: content(1),
        decision: decision(1)
      }
    ])
    await repository.putCacheEntries([
      {
        id: 'cache:1',
        updatedAt: timestamp,
        value: { disposable: true }
      }
    ])

    expect(await repository.exportProfile()).toEqual(expected)
    expect(JSON.stringify(await repository.exportProfile())).not.toContain(
      'disposable'
    )
    expect(await repository.counts()).toMatchObject({
      profile: 1,
      rules: 1,
      feedback: 1,
      content: 1,
      decisions: 1,
      cache: 1
    })
  })

  it('dry-runs and then replaces a valid import with one recovery snapshot', async () => {
    const { repository } = database('contentlens-storage-import')
    const current = profile()
    const incoming = profile({
      revision: 8,
      updatedAt: '2026-07-29T21:31:00.000Z',
      rules: [secondRule],
      feedbackExamples: [],
      settings: { enabledPlatforms: ['youtube', 'reddit'] }
    })
    await repository.saveProfile(current)

    const dryRun = await repository.importProfile(JSON.stringify(incoming), {
      mode: 'dry-run',
      at: timestamp
    })

    expect(dryRun).toMatchObject({
      state: 'valid',
      summary: {
        currentRevision: 1,
        incomingRevision: 8,
        rules: 1,
        feedbackExamples: 0
      }
    })
    expect(await repository.exportProfile()).toEqual(current)
    expect((await repository.counts()).snapshots).toBe(0)

    expect(
      await repository.importProfile(JSON.stringify(incoming), {
        mode: 'replace',
        at: timestamp
      })
    ).toMatchObject({
      state: 'imported',
      summary: {
        incomingRevision: 8
      }
    })
    expect(await repository.exportProfile()).toEqual(incoming)
    expect((await repository.counts()).snapshots).toBe(1)
    expect(await repository.readImportSnapshot()).toMatchObject({
      profile: current
    })

    expect(await repository.restoreImportSnapshot()).toEqual({
      state: 'restored',
      revision: current.revision
    })
    expect(await repository.exportProfile()).toEqual(current)
    expect((await repository.counts()).snapshots).toBe(0)
  })

  it('recovers by importing over an unreadable stored profile', async () => {
    const name = 'contentlens-storage-unreadable-import'
    const { factory, repository } = database(name)
    const current = profile()
    const incoming = profile({ revision: 9 })
    await repository.saveProfile(current)
    repository.close()
    const {
      rules: _rules,
      feedbackExamples: _feedback,
      settings: _settings,
      ...metadata
    } = current
    await replaceRawProfileMetadata(factory, name, metadata)
    const recovered = new ContentLensDatabase({ factory, databaseName: name })

    expect(
      await recovered.importProfile(incoming, {
        mode: 'dry-run',
        at: timestamp
      })
    ).toMatchObject({
      state: 'valid',
      summary: {
        currentRevision: null,
        incomingRevision: 9
      }
    })
    expect(
      await recovered.importProfile(incoming, {
        mode: 'replace',
        at: timestamp
      })
    ).toMatchObject({ state: 'imported' })
    expect(await recovered.exportProfile()).toEqual(incoming)
    expect((await recovered.counts()).snapshots).toBe(0)
  })

  it('keeps the current profile unchanged for every invalid import class', async () => {
    const { repository } = database('contentlens-storage-invalid')
    const current = profile()
    await repository.saveProfile(current)

    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth <= MAX_PROFILE_DEPTH; depth += 1) {
      nested = { child: nested }
    }
    const invalidInputs: unknown[] = [
      '{',
      {
        ...current,
        settings: nested
      },
      {
        ...current,
        rules: Array.from({ length: MAX_RULES + 1 }, (_, index) => ({
          ...firstRule,
          id: `rule:${index}`
        }))
      },
      {
        ...current,
        settings: { threshold: Number.NaN }
      },
      {
        ...current,
        schemaVersion: { major: 2, minor: 0 }
      }
    ]

    for (const input of invalidInputs) {
      expect(
        await repository.importProfile(input, {
          mode: 'replace',
          at: timestamp
        })
      ).toMatchObject({ state: 'invalid' })
      expect(await repository.exportProfile()).toEqual(current)
      expect((await repository.counts()).snapshots).toBe(0)
    }
  })

  it('keeps merge disabled without mutating either profile or snapshots', async () => {
    const { repository } = database('contentlens-storage-merge')
    const current = profile()
    await repository.saveProfile(current)

    expect(
      await repository.importProfile(profile({ revision: 2 }), {
        mode: 'merge',
        at: timestamp
      })
    ).toEqual({
      state: 'unsupported',
      mode: 'merge'
    })
    expect(await repository.exportProfile()).toEqual(current)
    expect((await repository.counts()).snapshots).toBe(0)
  })

  it('imports into an empty database without creating a recovery snapshot', async () => {
    const { repository } = database('contentlens-storage-empty-import')
    const incoming = profile({ revision: 4 })

    expect(
      await repository.importProfile(incoming, {
        mode: 'replace',
        at: timestamp
      })
    ).toMatchObject({ state: 'imported' })
    expect(await repository.exportProfile()).toEqual(incoming)
    expect((await repository.counts()).snapshots).toBe(0)
  })
})

describe('IndexedDB bounded local data and deletion', () => {
  it('bounds growth after 10,000 observations', async () => {
    const recentDecisions = 500
    const { repository } = database('contentlens-storage-bounded', {
      recentDecisions
    })
    await repository.saveProfile(profile())

    const result = await repository.recordObservations(
      Array.from({ length: 10_000 }, (_, index) => ({
        content: content(index),
        decision: decision(index)
      }))
    )

    expect(MAX_RECENT_DECISIONS).toBe(10_000)
    expect(result).toEqual({
      state: 'recorded',
      count: 10_000,
      persisted: {
        content: recentDecisions,
        decisions: recentDecisions
      }
    })
    expect(await repository.counts()).toMatchObject({
      content: recentDecisions,
      decisions: recentDecisions,
      rules: 1,
      feedback: 1
    })
  })

  it('clears cache and history without deleting durable intent', async () => {
    const { repository } = database('contentlens-storage-clear-cache')
    const expected = profile()
    await repository.saveProfile(expected)
    await repository.recordObservations([
      { content: content(1), decision: decision(1) }
    ])
    await repository.putCacheEntries([
      {
        id: 'cache:1',
        updatedAt: timestamp,
        value: { disposable: true }
      }
    ])

    await repository.clear('cache', { at: timestamp })
    expect(await repository.counts()).toMatchObject({
      cache: 0,
      content: 1,
      decisions: 1,
      rules: 1,
      feedback: 1
    })
    expect(await repository.exportProfile()).toEqual(expected)

    await repository.clear('history', { at: timestamp })
    expect(await repository.counts()).toMatchObject({
      content: 0,
      decisions: 0,
      rules: 1,
      feedback: 1
    })
    expect(await repository.exportProfile()).toEqual(expected)
  })

  it('clears feedback atomically with one profile revision', async () => {
    const { repository } = database('contentlens-storage-clear-feedback')
    await repository.saveProfile(profile())

    await repository.clear('feedback', {
      at: '2026-07-29T21:32:00.000Z'
    })

    expect(await repository.exportProfile()).toEqual(
      profile({
        revision: 2,
        updatedAt: '2026-07-29T21:32:00.000Z',
        feedbackExamples: []
      })
    )
  })

  it('rejects invalid local writes and timestamps without mutation', async () => {
    const { repository } = database('contentlens-storage-invalid-local')
    const current = profile()
    await repository.saveProfile(current)

    expect(
      await repository.recordObservations([
        {
          content: {
            ...content(1),
            observedAt: 'not-a-timestamp'
          }
        }
      ])
    ).toEqual({ state: 'invalid' })
    expect(
      await repository.recordObservations([
        {
          content: content(1),
          decision: {
            ...decision(1),
            score: 2
          }
        }
      ])
    ).toEqual({ state: 'invalid' })
    expect(
      await repository.recordObservations([{ content: content(2) }])
    ).toEqual({
      state: 'recorded',
      count: 1,
      persisted: {
        content: 1,
        decisions: 0
      }
    })

    expect(
      await repository.putCacheEntries([
        { id: '', updatedAt: timestamp, value: {} }
      ])
    ).toEqual({ state: 'invalid' })
    expect(
      await repository.putCacheEntries([
        { id: 'cache:invalid-time', updatedAt: 'invalid', value: {} }
      ])
    ).toEqual({ state: 'invalid' })
    expect(
      await repository.putCacheEntries([
        { id: 'cache:invalid-value', updatedAt: timestamp, value: undefined }
      ])
    ).toEqual({ state: 'invalid' })

    expect(
      await repository.importProfile(profile({ revision: 2 }), {
        mode: 'replace',
        at: 'invalid'
      })
    ).toEqual({
      state: 'invalid',
      code: 'invalid-import-time',
      issues: ['Import time is invalid']
    })
    expect(await repository.clear('cache', { at: 'invalid' })).toEqual({
      state: 'invalid'
    })
    expect(await repository.exportProfile()).toEqual(current)
    expect(await repository.counts()).toMatchObject({
      content: 1,
      decisions: 0,
      cache: 0,
      snapshots: 0
    })
  })

  it('clears recovery data and portable intent with separate scopes', async () => {
    const { repository } = database('contentlens-storage-clear-scopes')
    await repository.saveProfile(profile())
    await repository.importProfile(profile({ revision: 2 }), {
      mode: 'replace',
      at: timestamp
    })
    await repository.acknowledgeOperation({
      operationId: 'operation:recovery',
      type: 'test.recovery',
      targetFingerprint: 'fingerprint:recovery',
      at: timestamp
    })
    await repository.putCacheEntries([
      { id: 'cache:preserved', updatedAt: timestamp, value: true }
    ])

    expect(await repository.clear('recovery', { at: timestamp })).toEqual({
      state: 'cleared'
    })
    expect(await repository.counts()).toMatchObject({
      snapshots: 0,
      operations: 0,
      profile: 1,
      rules: 1,
      feedback: 1,
      cache: 1
    })

    expect(
      await repository.clear('rules-and-profile', { at: timestamp })
    ).toEqual({ state: 'cleared' })
    expect(await repository.exportProfile()).toBeUndefined()
    expect(await repository.counts()).toMatchObject({
      profile: 0,
      rules: 0,
      feedback: 0,
      cache: 1
    })
  })

  it('deletes the complete database for the all-data scope', async () => {
    const { factory, repository } = database('contentlens-storage-delete-all')
    await repository.saveProfile(profile())

    await repository.clear('all', { at: timestamp })

    expect(await factory.databases()).toEqual([])
  })
})

describe('persistent rule management operations', () => {
  it('bounds persistent operation records', async () => {
    const operationRecords = 2
    const { repository } = database('contentlens-storage-bounded-operations', {
      operationRecords
    })

    for (let index = 0; index < operationRecords + 1; index += 1) {
      await repository.acknowledgeOperation({
        operationId: `operation:bounded:${index}`,
        type: 'test.bounded',
        targetFingerprint: `fingerprint:${index}`,
        at: `2026-07-29T21:3${index}:00.000Z`
      })
    }

    expect(MAX_OPERATION_RECORDS).toBeGreaterThan(operationRecords)
    expect((await repository.counts()).operations).toBe(operationRecords)
  })

  it('commits revision and operation together, then replays after reopen', async () => {
    const { factory, repository } = database(
      'contentlens-storage-rule-management'
    )
    await repository.saveProfile(profile({ rules: [] }))
    const service = new RuleManagementService(repository)
    const command = {
      operationId: 'operation:rule:save',
      expectedRevision: 1,
      rule: firstRule,
      at: '2026-07-29T21:33:00.000Z'
    }

    expect(await service.acknowledgeSave(command)).toMatchObject({
      state: 'pending'
    })
    expect((await repository.exportProfile())?.rules).toEqual([])

    expect(await service.save(command)).toEqual({
      state: 'committed',
      value: { ruleId: firstRule.id },
      revision: 2
    })
    repository.close()

    const reopened = new ContentLensDatabase({
      factory,
      databaseName: 'contentlens-storage-rule-management'
    })
    expect(await new RuleManagementService(reopened).save(command)).toEqual({
      state: 'committed',
      value: { ruleId: firstRule.id },
      revision: 2
    })
    expect(await reopened.exportProfile()).toEqual(
      profile({
        revision: 2,
        updatedAt: command.at,
        rules: [firstRule]
      })
    )
    expect((await reopened.counts()).operations).toBe(1)
  })

  it('serializes competing revisions without losing an accepted rule', async () => {
    const { repository } = database('contentlens-storage-rule-concurrency')
    await repository.saveProfile(profile({ rules: [] }))
    const service = new RuleManagementService(repository)
    const commands = [firstRule, secondRule].map((rule, index) => ({
      operationId: `operation:rule:concurrent:${index}`,
      expectedRevision: 1,
      rule,
      at: '2026-07-29T21:34:00.000Z'
    }))
    await Promise.all(commands.map(command => service.acknowledgeSave(command)))

    const results = await Promise.all(
      commands.map(command => service.save(command))
    )

    expect(results.map(({ state }) => state).sort()).toEqual([
      'committed',
      'failed'
    ])
    expect(results).toContainEqual({
      state: 'failed',
      error: {
        code: 'stale-profile-revision',
        message: 'The profile changed before this operation'
      },
      retryable: false
    })
    const stored = await repository.exportProfile()
    expect(stored?.revision).toBe(2)
    expect(stored?.rules).toHaveLength(1)
  })

  it('rejects invalid rules before creating persistent operations', async () => {
    const { repository } = database('contentlens-storage-invalid-rule')
    await repository.saveProfile(profile({ rules: [] }))
    const service = new RuleManagementService(repository)
    const command = {
      operationId: 'operation:rule:invalid',
      expectedRevision: 1,
      rule: {
        ...firstRule,
        id: ''
      },
      at: timestamp
    }
    const expected = {
      state: 'failed',
      error: {
        code: 'invalid-rule',
        message: 'Rule input is invalid'
      },
      retryable: false
    }

    expect(await service.acknowledgeSave(command)).toEqual(expected)
    expect(await service.save(command)).toEqual(expected)
    expect((await repository.counts()).operations).toBe(0)
    expect(await repository.exportProfile()).toEqual(profile({ rules: [] }))
  })

  it('rejects reuse of an operation ID for another target', async () => {
    const { repository } = database('contentlens-storage-operation-conflict')
    const first = {
      operationId: 'operation:conflict',
      type: 'test.write',
      targetFingerprint: 'fingerprint:first',
      at: timestamp
    }

    expect(await repository.acknowledgeOperation(first)).toEqual({
      state: 'pending',
      operationId: first.operationId
    })
    expect(
      await repository.acknowledgeOperation({
        ...first,
        targetFingerprint: 'fingerprint:second'
      })
    ).toEqual({
      state: 'failed',
      error: {
        code: 'operation-id-conflict',
        message: 'Operation ID is already bound to another target'
      },
      retryable: false
    })
    expect((await repository.counts()).operations).toBe(1)
  })

  it('loads legacy settings and commits one canonical projection atomically', async () => {
    const { factory, repository } = database(
      'contentlens-storage-settings-management'
    )
    const defaults = createDefaultSettings()
    await repository.saveProfile(
      profile({
        settings: {
          enabledPlatforms: ['youtube'],
          modelRouting: defaults.routing,
          thresholds: { hide: 0.9 }
        }
      })
    )
    const environment = {
      catalog: new ModelCatalog(),
      providers: new ProviderRegistry(),
      consents: new ConsentRepository(),
      capabilitySnapshots: new SettingsCapabilitySnapshotStore()
    }
    const service = new SettingsManagementService(repository, environment)

    expect(await service.load()).toMatchObject({
      state: 'ready',
      revision: 1,
      source: 'legacy',
      settings: defaults,
      capabilitySnapshot: {
        schemaVersion: 1,
        profileRevision: 1,
        providers: [],
        models: []
      }
    })

    const settings = structuredClone(defaults)
    settings.platforms.reddit.state = 'enabled'
    settings.interface.advancedMode = true
    const command = {
      operationId: 'operation:settings:save',
      expectedRevision: 1,
      settings,
      reviewedConsentKeys: [],
      at: '2026-07-29T21:35:00.000Z'
    }

    expect(await service.save(command)).toEqual({
      state: 'committed',
      value: { settingsSchemaVersion: 1 },
      revision: 2
    })
    const stored = await repository.exportProfile()
    expect(stored?.settings).toMatchObject({
      settingsSchemaVersion: 1,
      modelRouting: settings.routing,
      platforms: settings.platforms,
      interface: settings.interface,
      thresholds: { hide: 0.9 }
    })
    expect(stored?.settings).not.toHaveProperty('enabledPlatforms')
    expect(stored?.settings).not.toHaveProperty('routing')
    expect(environment.capabilitySnapshots.current()).toMatchObject({
      profileRevision: 2,
      providers: [],
      models: []
    })

    repository.close()
    const reopened = new ContentLensDatabase({
      factory,
      databaseName: 'contentlens-storage-settings-management'
    })
    expect(
      await new SettingsManagementService(reopened, environment).save(command)
    ).toEqual({
      state: 'committed',
      value: { settingsSchemaVersion: 1 },
      revision: 2
    })
    expect((await reopened.counts()).operations).toBe(1)
  })

  it('loads an unavailable profile and acknowledges valid settings idempotently', async () => {
    const { repository } = database(
      'contentlens-storage-settings-acknowledgement'
    )
    const capabilitySnapshots = new SettingsCapabilitySnapshotStore()
    const service = new SettingsManagementService(repository, {
      catalog: new ModelCatalog(),
      providers: new ProviderRegistry(),
      consents: new ConsentRepository(),
      capabilitySnapshots
    })

    await expect(service.load()).resolves.toEqual({
      state: 'unavailable',
      code: 'profile-not-found'
    })
    await repository.saveProfile(profile())
    await expect(
      service.acknowledgeSave({
        operationId: 'operation:settings:ack-invalid',
        expectedRevision: 1,
        settings: { invalid: true },
        reviewedConsentKeys: [],
        at: timestamp
      })
    ).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'invalid-settings' }
    })

    const command = {
      operationId: 'operation:settings:ack-valid',
      expectedRevision: 1,
      settings: createDefaultSettings(),
      reviewedConsentKeys: [],
      at: '2026-07-31T07:00:00.000Z'
    }
    await expect(service.acknowledgeSave(command)).resolves.toEqual({
      state: 'pending',
      operationId: command.operationId
    })
    expect(capabilitySnapshots.current()).toBeUndefined()
    await expect(service.save(command)).resolves.toMatchObject({
      state: 'committed',
      revision: 2
    })
    await expect(service.acknowledgeSave(command)).resolves.toMatchObject({
      state: 'committed',
      revision: 2
    })
    expect(capabilitySnapshots.current()).toMatchObject({ profileRevision: 2 })
  })

  it('blocks cloud settings without exact consent and publishes only the committed revision', async () => {
    const { repository } = database(
      'contentlens-storage-settings-cloud-consent'
    )
    await repository.saveProfile(profile({ rules: [] }))
    const cloudProvider = providerDescriptorSchema.parse({
      schemaVersion: 1,
      providerConfigId: 'provider:cloud-settings',
      displayName: 'Cloud settings provider',
      kind: 'openai-compatible',
      execution: 'cloud',
      endpointOrigin: 'https://provider.example',
      credentialMode: 'session-only',
      credentialRef: 'credential:cloud-settings',
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'ready'
    })
    const cloudModel = modelDescriptorSchema.parse({
      providerConfigId: cloudProvider.providerConfigId,
      modelId: 'cloud-text',
      displayName: 'Cloud text',
      declaredVersion: '1',
      executionKind: 'cloud',
      catalogSource: 'user',
      lastCheckedAt: timestamp,
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
    const consentKey = normalizeConsentKey({
      providerConfigId: cloudProvider.providerConfigId,
      endpointOrigin: cloudProvider.endpointOrigin,
      task: 'classification-text',
      platform: 'youtube',
      categories: ['title'],
      includeImages: false,
      consentSchemaVersion: 1
    })
    const consents = new ConsentRepository()
    consents.grant({
      key: consentKey,
      providerKind: cloudProvider.kind,
      policyUrl: cloudProvider.policyUrl,
      policyReviewedAt: cloudProvider.policyReviewedAt,
      estimatedFrequency: 'per visible item',
      declaredRetention: 'none',
      consentedAt: timestamp
    })
    const capabilitySnapshots = new SettingsCapabilitySnapshotStore()
    const service = new SettingsManagementService(repository, {
      catalog: new ModelCatalog([cloudModel]),
      providers: new ProviderRegistry([cloudProvider]),
      consents,
      capabilitySnapshots
    })
    const settings = createDefaultSettings()
    settings.routing.globalRoutes['classification-text'] = {
      state: 'route',
      primary: {
        providerConfigId: cloudProvider.providerConfigId,
        modelId: cloudModel.modelId
      },
      fallbacks: [],
      allowCloudFallback: false,
      allowHigherCostFallback: false
    }
    const baseCommand = {
      expectedRevision: 1,
      settings,
      at: '2026-07-31T06:40:00.000Z'
    }

    await expect(
      service.save({
        ...baseCommand,
        operationId: 'operation:settings:cloud:blocked',
        reviewedConsentKeys: []
      })
    ).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'invalid-settings' }
    })
    expect((await repository.counts()).operations).toBe(0)
    expect(capabilitySnapshots.current()).toBeUndefined()

    await expect(
      service.save({
        ...baseCommand,
        operationId: 'operation:settings:cloud:accepted',
        reviewedConsentKeys: [consentKey]
      })
    ).resolves.toEqual({
      state: 'committed',
      value: { settingsSchemaVersion: 1 },
      revision: 2
    })
    expect(capabilitySnapshots.current()).toMatchObject({
      profileRevision: 2,
      providers: [
        {
          providerConfigId: cloudProvider.providerConfigId,
          credentialState: 'configured'
        }
      ],
      models: [{ modelId: cloudModel.modelId }]
    })
    expect(JSON.stringify(capabilitySnapshots.current())).not.toContain(
      cloudProvider.credentialRef
    )
  })

  it('rejects an invalid settings draft without changing the active profile', async () => {
    const { repository } = database(
      'contentlens-storage-settings-invalid-draft'
    )
    const current = profile()
    await repository.saveProfile(current)
    const service = new SettingsManagementService(repository, {
      catalog: new ModelCatalog(),
      providers: new ProviderRegistry(),
      consents: new ConsentRepository(),
      capabilitySnapshots: new SettingsCapabilitySnapshotStore()
    })

    expect(
      await service.save({
        operationId: 'operation:settings:invalid',
        expectedRevision: 1,
        settings: {
          ...createDefaultSettings(),
          [['api', 'Key'].join('')]: ['must', 'never', 'be', 'persisted'].join(
            '-'
          )
        },
        reviewedConsentKeys: [],
        at: timestamp
      })
    ).toEqual({
      state: 'failed',
      error: {
        code: 'invalid-settings',
        message: 'Settings input is invalid'
      },
      retryable: false
    })
    expect(await repository.exportProfile()).toEqual(current)
    expect((await repository.counts()).operations).toBe(0)
  })

  it('preserves the accepted settings when a competing revision is stale', async () => {
    const { repository } = database('contentlens-storage-settings-concurrency')
    await repository.saveProfile(profile())
    const service = new SettingsManagementService(repository, {
      catalog: new ModelCatalog(),
      providers: new ProviderRegistry(),
      consents: new ConsentRepository(),
      capabilitySnapshots: new SettingsCapabilitySnapshotStore()
    })
    const first = createDefaultSettings()
    first.platforms.reddit.state = 'enabled'
    const second = createDefaultSettings()
    second.platforms.linkedin.state = 'enabled'

    const results = await Promise.all([
      service.save({
        operationId: 'operation:settings:first',
        expectedRevision: 1,
        settings: first,
        reviewedConsentKeys: [],
        at: '2026-07-29T21:36:00.000Z'
      }),
      service.save({
        operationId: 'operation:settings:second',
        expectedRevision: 1,
        settings: second,
        reviewedConsentKeys: [],
        at: '2026-07-29T21:36:01.000Z'
      })
    ])

    expect(results.map(({ state }) => state).sort()).toEqual([
      'committed',
      'failed'
    ])
    expect(results).toContainEqual({
      state: 'failed',
      error: {
        code: 'stale-profile-revision',
        message: 'The profile changed before this operation'
      },
      retryable: false
    })
    const loaded = await service.load()
    expect(loaded).toMatchObject({
      state: 'ready',
      revision: 2,
      source: 'canonical'
    })
    if (loaded.state === 'ready') {
      expect(
        [
          loaded.settings.platforms.reddit.state,
          loaded.settings.platforms.linkedin.state
        ].filter(state => state === 'enabled')
      ).toHaveLength(1)
    }
  })
})
