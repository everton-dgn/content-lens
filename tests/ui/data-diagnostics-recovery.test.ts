import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { RecoveryService } from '@/application/recovery/service'
import { diagnosticEventSchema } from '@/diagnostics/contracts'
import { DiagnosticService } from '@/diagnostics/service'
import { DiagnosticStore } from '@/diagnostics/store'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import {
  serializeDiagnosticExport,
  serializePortableProfile
} from '@/ui/data/portability'

const at = '2026-07-30T02:00:00.000Z'
const correlationId = '00000000-0000-4000-8000-000000000001'

function database(factory: IDBFactory, name: string) {
  return new ContentLensDatabase({ factory, databaseName: name })
}

function diagnostics(factory: IDBFactory, name: string) {
  return new DiagnosticService(
    new DiagnosticStore({ factory, databaseName: name }),
    {
      productVersion: '0.0.0',
      randomId: () => correlationId
    }
  )
}

describe('portable data', () => {
  it('previews and imports only the portable profile schema', async () => {
    const factory = new IDBFactory()
    const source = createLocalProfile({ at, profileId: 'profile:source' })
    const target = database(factory, 'contentlens-data-import')
    await target.saveProfile(
      createLocalProfile({ at, profileId: 'profile:target' })
    )
    const serialized = serializePortableProfile({
      ...source,
      rules: [
        {
          id: 'rule:exact:portable',
          enabled: true,
          scope: { platforms: ['youtube'], surfaces: ['youtube:home'] },
          createdAt: at,
          updatedAt: at,
          kind: 'exact',
          effect: 'block',
          field: 'title',
          value: 'synthetic phrase',
          caseSensitive: false
        }
      ]
    })

    const preview = await target.importProfile(serialized, {
      mode: 'dry-run',
      at
    })
    const imported = await target.importProfile(serialized, {
      mode: 'replace',
      at,
      operationId: 'operation:profile:import'
    })
    const replayedImport = await target.importProfile(serialized, {
      mode: 'replace',
      at,
      operationId: 'operation:profile:import'
    })

    expect(preview).toMatchObject({
      state: 'valid',
      summary: { rules: 1, feedbackExamples: 0, profileIdChanges: true }
    })
    expect(imported).toMatchObject({ state: 'imported' })
    expect(replayedImport).toEqual(imported)
    expect(await target.exportProfile()).toMatchObject({
      profileId: 'profile:source',
      rules: [{ id: 'rule:exact:portable' }]
    })
    expect(await target.readImportSnapshot()).toMatchObject({
      profile: { profileId: 'profile:target' }
    })
    const restoreOptions = {
      at,
      operationId: 'operation:profile:import-restore'
    }
    const restored = await target.restoreImportSnapshot(restoreOptions)
    const replayedRestore = await target.restoreImportSnapshot(restoreOptions)
    expect(restored).toMatchObject({
      state: 'restored'
    })
    expect(replayedRestore).toEqual(restored)
    expect(await target.exportProfile()).toMatchObject({
      profileId: 'profile:target',
      rules: []
    })
    expect(await target.readImportSnapshot()).toBeUndefined()
    expect(serialized).not.toMatch(
      /diagnostic|cache|contentHistory|correlationId|snapshot/iu
    )
  })
})

describe('sanitized diagnostics', () => {
  it('records an uncertain durable response as informational evidence', async () => {
    const factory = new IDBFactory()
    const service = diagnostics(factory, 'contentlens-diagnostics-uncertain')

    await service.record('operation-response-uncertain', {
      occurredAt: at,
      scopeKey: 'profile'
    })

    expect(await service.list()).toEqual([
      expect.objectContaining({
        code: 'operation-response-uncertain',
        count: 1,
        recovery: 'retryable',
        severity: 'info'
      })
    ])
  })

  it('aggregates one hundred identical failures without prohibited fields', async () => {
    const factory = new IDBFactory()
    const service = diagnostics(factory, 'contentlens-diagnostics-aggregate')

    for (let count = 0; count < 100; count += 1) {
      await service.record('rule-save-failed', {
        occurredAt: at,
        scopeKey: 'rules'
      })
    }
    const records = await service.list()
    const exported = await service.export(at)
    const serialized = serializeDiagnosticExport(exported)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      code: 'rule-save-failed',
      count: 100,
      scopeKey: 'rules'
    })
    expect(serialized).not.toMatch(
      /https?:|authorization|cookie|contentTitle|profileId|query/iu
    )
  })

  it('rejects unknown raw content fields at the schema boundary', () => {
    expect(
      diagnosticEventSchema.safeParse({
        schemaVersion: 1,
        code: 'unexpected-ui-error',
        severity: 'error',
        recovery: 'retryable',
        reportable: true,
        component: 'sidepanel',
        capability: 'local-profile',
        phase: 'load',
        scopeClass: 'global',
        occurredAt: at,
        correlationId,
        productVersion: '0.0.0',
        versionDomains: {
          database: '2',
          profile: '1.0',
          rules: '1'
        },
        url: 'prohibited test value',
        contentTitle: 'private title'
      }).success
    ).toBe(false)
  })

  it('clears diagnostics without changing the portable profile', async () => {
    const factory = new IDBFactory()
    const profileDatabase = database(factory, 'contentlens-profile-isolated')
    const service = diagnostics(factory, 'contentlens-diagnostics-isolated')
    const profile = createLocalProfile({
      at,
      profileId: 'profile:isolated'
    })
    await profileDatabase.saveProfile(profile)
    await service.record('storage-unavailable', {
      occurredAt: at,
      scopeKey: 'indexed-db'
    })

    await service.clear()

    expect(await service.list()).toEqual([])
    expect(await profileDatabase.exportProfile()).toEqual(profile)
  })
})

describe('recovery presentation authority', () => {
  it('prefers export for a readable profile and requires reset confirmation', async () => {
    const factory = new IDBFactory()
    const profileDatabase = database(factory, 'contentlens-recovery-ui')
    const profile = createLocalProfile({
      at,
      profileId: 'profile:recovery-ui'
    })
    await profileDatabase.saveProfile(profile)
    const recovery = new RecoveryService(profileDatabase)

    expect(await recovery.inspect(at)).toEqual({
      state: 'readable',
      primaryAction: 'export-profile',
      actions: ['export-profile', 'reset'],
      preserved: ['profile', 'rules', 'feedback']
    })
    expect(await recovery.reset({ confirmed: false })).toEqual({
      state: 'confirmation-required'
    })
    expect(await profileDatabase.exportProfile()).toEqual(profile)
  })
})
