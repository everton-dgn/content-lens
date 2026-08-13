import type { OperationCommitResult } from './operation-journal'

const databaseName = 'contentlens-phase0-runtime'
const databaseVersion = 1

interface StoredEffect {
  effectId: string
  operationId: string
}

interface StoredOperation {
  effectId: string
  operationId: string
  state: 'committed'
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
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
          transaction.error ?? new Error('IndexedDB transaction aborted.')
        ),
      { once: true }
    )
    transaction.addEventListener(
      'error',
      () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true }
    )
  })

export const openRuntimeDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains('effects')) {
        database.createObjectStore('effects', { keyPath: 'effectId' })
      }
      if (!database.objectStoreNames.contains('operations')) {
        database.createObjectStore('operations', { keyPath: 'operationId' })
      }
    })
    request.addEventListener('success', () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      'error',
      () =>
        reject(request.error ?? new Error('Runtime database failed to open.')),
      { once: true }
    )
  })

const countEffects = async (database: IDBDatabase): Promise<number> => {
  const transaction = database.transaction('effects', 'readonly')
  const count = await requestResult(transaction.objectStore('effects').count())
  await transactionDone(transaction)
  return count
}

export const commitIndexedDbOperation = async (
  operationId: string,
  effectId: string
): Promise<OperationCommitResult & { effectCount: number }> => {
  const database = await openRuntimeDatabase()

  try {
    const transaction = database.transaction(
      ['effects', 'operations'],
      'readwrite'
    )
    const operations = transaction.objectStore('operations')
    const existing = (await requestResult(operations.get(operationId))) as
      | StoredOperation
      | undefined

    if (existing) {
      await transactionDone(transaction)
      return {
        effectCount: await countEffects(database),
        effectId: existing.effectId,
        operationId,
        replayed: true,
        state: 'committed'
      }
    }

    const effect: StoredEffect = { effectId, operationId }
    transaction.objectStore('effects').add(effect)
    operations.add({
      effectId,
      operationId,
      state: 'committed'
    } satisfies StoredOperation)
    await transactionDone(transaction)

    return {
      effectCount: await countEffects(database),
      effectId,
      operationId,
      replayed: false,
      state: 'committed'
    }
  } finally {
    database.close()
  }
}

export const probeIndexedDb = async (): Promise<boolean> => {
  const database = await openRuntimeDatabase()
  database.close()
  return true
}
