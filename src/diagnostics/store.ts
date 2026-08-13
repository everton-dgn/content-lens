import {
  DIAGNOSTIC_RETENTION_DAYS,
  type DiagnosticAggregate,
  type DiagnosticEvent,
  type DiagnosticFilters,
  diagnosticAggregateSchema,
  diagnosticExportSchema,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_RECORDS
} from '@/diagnostics/contracts'

const DATABASE_NAME = 'contentlens-diagnostics'
const DATABASE_VERSION = 1
const STORE_NAME = 'events'

type DiagnosticStoreOptions = {
  databaseName?: string
  factory?: IDBFactory
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Diagnostic request failed')),
      { once: true }
    )
  })

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () =>
        reject(
          transaction.error ?? new Error('Diagnostic transaction aborted')
        ),
      { once: true }
    )
    transaction.addEventListener(
      'error',
      () =>
        reject(transaction.error ?? new Error('Diagnostic transaction failed')),
      { once: true }
    )
  })

function productMajor(version: string) {
  return version.split('.')[0] ?? '0'
}

export function diagnosticSignature(event: DiagnosticEvent) {
  return [
    event.code,
    event.component,
    event.capability,
    event.phase,
    event.scopeClass,
    event.scopeKey ?? 'none',
    productMajor(event.productVersion)
  ].join('|')
}

function matchesFilters(
  record: DiagnosticAggregate,
  filters: DiagnosticFilters
) {
  return (
    (filters.capability === undefined ||
      record.capability === filters.capability) &&
    (filters.code === undefined || record.code === filters.code) &&
    (filters.component === undefined ||
      record.component === filters.component) &&
    (filters.severity === undefined || record.severity === filters.severity) &&
    (filters.since === undefined || record.lastOccurredAt >= filters.since)
  )
}

export class DiagnosticStore {
  readonly #databaseName: string
  readonly #factory: IDBFactory
  #database?: IDBDatabase
  #opening?: Promise<IDBDatabase>

  constructor(options: DiagnosticStoreOptions = {}) {
    this.#databaseName = options.databaseName ?? DATABASE_NAME
    this.#factory = options.factory ?? indexedDB
  }

  async record(event: DiagnosticEvent) {
    const signature = diagnosticSignature(event)
    const database = await this.#open()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORE_NAME)
    const existing = (await requestResult(store.get(signature))) as
      | DiagnosticAggregate
      | undefined
    const aggregate = diagnosticAggregateSchema.parse({
      ...event,
      signature,
      count: (existing?.count ?? 0) + 1,
      firstOccurredAt: existing?.firstOccurredAt ?? event.occurredAt,
      lastOccurredAt: event.occurredAt
    })
    store.put(aggregate)
    await done
    await this.#enforceBounds(event.occurredAt)
    return aggregate
  }

  async list(filters: DiagnosticFilters = {}) {
    const database = await this.#open()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const records = (await requestResult(
      transaction.objectStore(STORE_NAME).getAll()
    )) as DiagnosticAggregate[]
    await done
    return records
      .filter(record => matchesFilters(record, filters))
      .sort((left, right) =>
        right.lastOccurredAt.localeCompare(left.lastOccurredAt)
      )
      .map(record => structuredClone(record))
  }

  async export(exportedAt: string, filters: DiagnosticFilters = {}) {
    return diagnosticExportSchema.parse({
      schemaVersion: 1,
      exportedAt,
      records: await this.list(filters)
    })
  }

  async clear() {
    const database = await this.#open()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORE_NAME).clear()
    await done
  }

  close() {
    this.#database?.close()
    this.#database = undefined
    this.#opening = undefined
  }

  async #enforceBounds(now: string) {
    const records = await this.list()
    const cutoff =
      Date.parse(now) - DIAGNOSTIC_RETENTION_DAYS * 24 * 60 * 60 * 1_000
    const keep = new Set<string>()
    const encoder = new TextEncoder()
    let bytes = 0

    for (const record of records) {
      const recordBytes = encoder.encode(JSON.stringify(record)).byteLength
      if (
        Date.parse(record.lastOccurredAt) < cutoff ||
        keep.size >= MAX_DIAGNOSTIC_RECORDS ||
        bytes + recordBytes > MAX_DIAGNOSTIC_BYTES
      ) {
        continue
      }
      keep.add(record.signature)
      bytes += recordBytes
    }

    const remove = records.filter(record => !keep.has(record.signature))
    if (remove.length === 0) {
      return
    }
    const database = await this.#open()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORE_NAME)
    for (const record of remove) {
      store.delete(record.signature)
    }
    await done
  }

  async #open() {
    if (this.#database) {
      return this.#database
    }
    if (this.#opening) {
      return this.#opening
    }
    this.#opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          const store = request.result.createObjectStore(STORE_NAME, {
            keyPath: 'signature'
          })
          store.createIndex('lastOccurredAt', 'lastOccurredAt')
        }
      })
      request.addEventListener(
        'success',
        () => {
          this.#database = request.result
          this.#opening = undefined
          resolve(request.result)
        },
        { once: true }
      )
      request.addEventListener(
        'error',
        () => {
          this.#opening = undefined
          reject(request.error ?? new Error('Diagnostic database open failed'))
        },
        { once: true }
      )
    })
    return this.#opening
  }
}
