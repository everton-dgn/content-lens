import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import {
  type DiagnosticEvent,
  MAX_DIAGNOSTIC_RECORDS
} from '@/diagnostics/contracts'
import { DiagnosticStore, diagnosticSignature } from '@/diagnostics/store'

const baseEvent: DiagnosticEvent = {
  schemaVersion: 1,
  code: 'rule-save-failed',
  severity: 'error',
  recovery: 'retryable',
  reportable: true,
  component: 'rule-management',
  capability: 'deterministic-rules',
  phase: 'save',
  scopeClass: 'global',
  occurredAt: '2026-08-04T12:00:00.000Z',
  correlationId: '11111111-2222-4333-8444-555555555555',
  productVersion: '0.1.0',
  versionDomains: { database: '6', profile: '1.3', rules: '1' }
}

const event = (overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent => ({
  ...baseEvent,
  ...overrides
})

const openStore = () =>
  new DiagnosticStore({
    databaseName: `diagnostics-${Math.random().toString(36).slice(2)}`,
    factory: new IDBFactory()
  })

describe('diagnostic signature', () => {
  it('collapses equivalent failures onto one signature', () => {
    const first = diagnosticSignature(event())
    const second = diagnosticSignature(
      event({ occurredAt: '2026-08-04T18:00:00.000Z' })
    )

    expect(first).toBe(second)
  })

  it('separates failures that differ in scope, code or product major', () => {
    const signature = diagnosticSignature(event())

    expect(diagnosticSignature(event({ code: 'rule-remove-failed' }))).not.toBe(
      signature
    )
    expect(
      diagnosticSignature(
        event({ scopeClass: 'platform', scopeKey: 'youtube' })
      )
    ).not.toBe(signature)
    expect(diagnosticSignature(event({ productVersion: '1.0.0' }))).not.toBe(
      signature
    )
  })

  it('keeps the same signature across patch and minor versions', () => {
    expect(diagnosticSignature(event({ productVersion: '0.9.9' }))).toBe(
      diagnosticSignature(event({ productVersion: '0.1.0' }))
    )
  })

  it('marks an absent scope key explicitly instead of leaving a gap', () => {
    expect(diagnosticSignature(event())).toContain('|none|')
  })
})

describe('diagnostic store', () => {
  it('aggregates a repeated failure instead of storing it twice', async () => {
    const store = openStore()

    const first = await store.record(event())
    const second = await store.record(
      event({ occurredAt: '2026-08-04T13:00:00.000Z' })
    )

    expect(first.count).toBe(1)
    expect(second.count).toBe(2)
    expect(second.firstOccurredAt).toBe('2026-08-04T12:00:00.000Z')
    expect(second.lastOccurredAt).toBe('2026-08-04T13:00:00.000Z')
    await expect(store.list()).resolves.toHaveLength(1)
    store.close()
  })

  it('returns the most recent failure first', async () => {
    const store = openStore()

    await store.record(event({ occurredAt: '2026-08-04T10:00:00.000Z' }))
    await store.record(
      event({
        code: 'rule-remove-failed',
        occurredAt: '2026-08-04T11:00:00.000Z',
        phase: 'remove'
      })
    )

    const records = await store.list()

    expect(records.map(record => record.code)).toEqual([
      'rule-remove-failed',
      'rule-save-failed'
    ])
    store.close()
  })

  it('filters by capability, code, component, severity and time', async () => {
    const store = openStore()

    await store.record(event())
    await store.record(
      event({
        capability: 'local-profile',
        code: 'storage-unavailable',
        component: 'runtime',
        occurredAt: '2026-08-04T14:00:00.000Z',
        phase: 'load',
        severity: 'critical'
      })
    )

    await expect(
      store.list({ capability: 'local-profile' })
    ).resolves.toHaveLength(1)
    await expect(
      store.list({ code: 'rule-save-failed' })
    ).resolves.toHaveLength(1)
    await expect(store.list({ component: 'runtime' })).resolves.toHaveLength(1)
    await expect(store.list({ severity: 'critical' })).resolves.toHaveLength(1)
    await expect(
      store.list({ since: '2026-08-04T13:00:00.000Z' })
    ).resolves.toHaveLength(1)
    await expect(store.list({ severity: 'info' })).resolves.toHaveLength(0)
    store.close()
  })

  it('combines filters instead of widening the result', async () => {
    const store = openStore()

    await store.record(event())
    await store.record(event({ code: 'rule-remove-failed', phase: 'remove' }))

    await expect(
      store.list({ code: 'rule-remove-failed', severity: 'error' })
    ).resolves.toHaveLength(1)
    await expect(
      store.list({ code: 'rule-remove-failed', severity: 'critical' })
    ).resolves.toHaveLength(0)
    store.close()
  })

  it('hands out copies, so a caller cannot mutate stored state', async () => {
    const store = openStore()
    await store.record(event())

    const [record] = await store.list()
    if (record) {
      record.count = 99
    }

    const [again] = await store.list()
    expect(again?.count).toBe(1)
    store.close()
  })

  it('drops records older than the retention window', async () => {
    const store = openStore()

    await store.record(event({ occurredAt: '2026-07-01T12:00:00.000Z' }))
    await store.record(
      event({
        code: 'rule-remove-failed',
        occurredAt: '2026-08-04T12:00:00.000Z',
        phase: 'remove'
      })
    )

    const records = await store.list()

    expect(records).toHaveLength(1)
    expect(records[0]?.code).toBe('rule-remove-failed')
    store.close()
  })

  it('keeps the record count within its documented bound', async () => {
    const store = openStore()

    for (let index = 0; index <= MAX_DIAGNOSTIC_RECORDS; index += 1) {
      // The product major is part of the signature, so each one aggregates apart.
      await store.record(event({ productVersion: `${index}.0.0` }))
    }

    await expect(store.list()).resolves.toHaveLength(MAX_DIAGNOSTIC_RECORDS)
    store.close()
  })

  it('exports the filtered records under the export schema', async () => {
    const store = openStore()
    await store.record(event())
    await store.record(event({ code: 'rule-remove-failed', phase: 'remove' }))

    const exported = await store.export('2026-08-04T20:00:00.000Z', {
      code: 'rule-save-failed'
    })

    expect(exported.schemaVersion).toBe(1)
    expect(exported.exportedAt).toBe('2026-08-04T20:00:00.000Z')
    expect(exported.records).toHaveLength(1)
    store.close()
  })

  it('clears every record without closing the database', async () => {
    const store = openStore()
    await store.record(event())

    await store.clear()
    await expect(store.list()).resolves.toHaveLength(0)

    await store.record(event())
    await expect(store.list()).resolves.toHaveLength(1)
    store.close()
  })

  it('reopens after close and shares one connection across concurrent calls', async () => {
    const store = openStore()
    await store.record(event())
    store.close()

    const [first, second] = await Promise.all([store.list(), store.list()])

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    store.close()
  })
})
