import {
  MAX_RSS_RECENT_ENTRIES_PER_FEED,
  type RssRuntimeState,
  rssFeedIdSchema,
  rssRuntimeStateSchema
} from '@/adapters/rss'
import {
  type ContentItem,
  contentItemSchema,
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'
import { type Decision, decisionSchema } from '@/core/decisions/contracts'
import {
  type NativeFeedbackAttempt,
  nativeFeedbackAttemptSchema
} from '@/core/feedback/native-contracts'
import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'
import type {
  OperationCommand,
  OperationEffect,
  OperationResponse,
  UserSafeError
} from '@/core/operations/journal'
import {
  MAX_SIMILARITY_BYTES,
  type SimilarityBatchAction,
  similarityBatchActionSchema
} from '@/core/similarity/contracts'
import {
  type PortableJsonValue,
  type ProfileEnvelope,
  parseProfileEnvelope,
  portableJsonValueSchema,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'
import {
  ACTIVE_GRAPH_RUNTIME_ID,
  GRAPH_STORE_NAMES,
  type GraphDerivedState,
  graphDerivedStateSchema,
  type StoredGraphRuntime
} from '@/storage/indexed-db/graph-store'
import {
  NATIVE_FEEDBACK_STORE_NAMES,
  retainNativeFeedbackAttempts
} from '@/storage/indexed-db/native-feedback-store'
import {
  ACTIVE_SIMILARITY_RUNTIME_ID,
  SIMILARITY_STORE_NAMES,
  type SimilarityDerivedState,
  type StoredSimilarityRuntime,
  similarityDerivedStateSchema
} from '@/storage/indexed-db/similarity-store'
import {
  MIGRATION_SNAPSHOT_ID,
  type MigrationEvidence,
  type MigrationJournal,
  type MigrationSnapshot,
  type MigrationStore
} from '@/storage/migrations/contracts'
import { validateMigrationSnapshot } from '@/storage/migrations/runner'
import {
  PROVIDER_STATE_SCHEMA_VERSION,
  type ProviderStateSnapshot,
  providerStateSnapshotSchema
} from '@/storage/provider-state/contracts'
import { verifySyncEnvelope } from '@/sync/canonical'
import {
  type SyncConflictDraft,
  validateSyncConflictDraft
} from '@/sync/conflict-draft'
import {
  disconnectedSyncConnection,
  type SyncConnection,
  syncConnectionSchema
} from '@/sync/connection'
import { type SyncEnvelope, syncEnvelopeSchema } from '@/sync/contracts'
import { type SyncJournalRecord, syncJournalRecordSchema } from '@/sync/journal'
import { reconcileMergedSyncEnvelope } from '@/sync/materialize-import'
import { materializeImportedProfile } from '@/sync/materialize-profile'

export const MAX_RECENT_DECISIONS = 10_000
export const MAX_CONTENT_HISTORY = 10_000
export const MAX_CACHE_ENTRIES = 10_000
export const MAX_OPERATION_RECORDS = 10_000

export const CONTENT_LENS_DATABASE_VERSION = 6
const PROFILE_KEY = 'active'
const LATEST_IMPORT_SNAPSHOT_KEY = 'latest-pre-import'
const LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY = 'latest-pre-portable-import'
const ACTIVE_SYNC_IDENTITY_KEY = 'active-sync-identity'
const ACTIVE_SYNC_ENVELOPE_KEY = 'active-sync-envelope'
const ACTIVE_SYNC_CONNECTION_KEY = 'active-sync-connection'
const syncBaseKey = (syncProfileId: string) => `sync-base:${syncProfileId}`
const syncConflictKey = (syncProfileId: string) =>
  `sync-conflict:${syncProfileId}`
const syncJournalKey = (syncProfileId: string) =>
  `sync-journal:${syncProfileId}`
const syncTransportKey = (syncProfileId: string) =>
  `sync-transport:${syncProfileId}`
const syncRecoveryKey = (operationId: string) => `sync-recovery:${operationId}`

const STORES = {
  profile: 'profile',
  rules: 'rules',
  feedback: 'feedback',
  decisions: 'decisions',
  content: 'content',
  cache: 'cache',
  snapshots: 'snapshots',
  operations: 'operations',
  migrationSnapshots: 'migrationSnapshots',
  migrationJournals: 'migrationJournals',
  migrationEvidence: 'migrationEvidence',
  providers: 'providers',
  models: 'models',
  consents: 'consents',
  credentials: 'credentials',
  rssEntries: 'rssEntries',
  rssRuntime: 'rssRuntime',
  similarityVectors: SIMILARITY_STORE_NAMES.vectors,
  similarityRelations: SIMILARITY_STORE_NAMES.relations,
  similaritySuppressions: SIMILARITY_STORE_NAMES.suppressions,
  similarityClusters: SIMILARITY_STORE_NAMES.clusters,
  similarityBatchActions: SIMILARITY_STORE_NAMES.batchActions,
  similarityRuntime: SIMILARITY_STORE_NAMES.runtime,
  similarityCheckpoints: SIMILARITY_STORE_NAMES.checkpoints,
  graphNodes: GRAPH_STORE_NAMES.nodes,
  graphEdges: GRAPH_STORE_NAMES.edges,
  graphRuntime: GRAPH_STORE_NAMES.runtime,
  graphCheckpoints: GRAPH_STORE_NAMES.checkpoints,
  nativeFeedbackAttempts: NATIVE_FEEDBACK_STORE_NAMES.attempts,
  nativeFeedbackRuntime: NATIVE_FEEDBACK_STORE_NAMES.runtime
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

type StoredProfile = Omit<ProfileEnvelope, 'rules' | 'feedbackExamples'> & {
  key: typeof PROFILE_KEY
}

type StoredDecision = Decision & {
  cacheKey: string
}

type CacheEntry = {
  id: string
  updatedAt: string
  value: PortableJsonValue
}

type StoredConsent = {
  id: string
  receipt: ProviderStateSnapshot['consents'][number]
}

type StoredRssEntries = {
  feedId: string
  updatedAt: string
  entries: ContentItem[]
}

export type ImportSnapshot = {
  id: typeof LATEST_IMPORT_SNAPSHOT_KEY
  createdAt: string
  profile: ProfileEnvelope
}

export type PortableImportSnapshot = {
  id: typeof LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY
  createdAt: string
  profile: ProfileEnvelope
  providerState: ProviderStateSnapshot
  syncIdentity?: SyncIdentityRecord
  syncBase?: SyncBaseRecord
}

export type PortableConfiguration = {
  mode: 'merge' | 'replace'
  profile: ProfileEnvelope
  providerState: ProviderStateSnapshot
  activeEnvelope: SyncEnvelope
  baseEnvelope: SyncEnvelope
}

export type SyncIdentityRecord = {
  id: typeof ACTIVE_SYNC_IDENTITY_KEY
  syncProfileId: string
  generation: number
}

export type SyncBaseRecord = {
  id: string
  syncProfileId: string
  generation: number
  envelope: SyncEnvelope
  confirmedDigest: string
  confirmedAt: string
}

export type SyncActiveRecord = {
  id: typeof ACTIVE_SYNC_ENVELOPE_KEY
  envelope: SyncEnvelope
  updatedAt: string
}

export type SyncTransportStateRecord = {
  id: string
  syncProfileId: string
  providerConfigId: string
  remoteObjectId: string
  versionToken: string
  lastConfirmedDigest: string
  confirmedAt: string
}

export type SyncRecoverySnapshot = {
  id: string
  operationId: string
  createdAt: string
  profile: ProfileEnvelope
  providerState: ProviderStateSnapshot
  syncIdentity?: SyncIdentityRecord
  syncBase?: SyncBaseRecord
  activeSync?: SyncActiveRecord
}

type StoredOperation = {
  operationId: string
  type: string
  targetFingerprint: string
  state: 'acknowledged' | 'committed' | 'failed'
  attempt: number
  createdAt: string
  updatedAt: string
  retryable: boolean
  error?: UserSafeError
  result?: unknown
  revision?: number
  committedEffects: OperationEffect[]
}

export type ObservationInput = {
  content: unknown
  decision?: unknown
}

export type CacheEntryInput = {
  id: string
  updatedAt: string
  value: unknown
}

export type ImportMode = 'dry-run' | 'replace' | 'merge'

export type DeleteScope =
  | 'cache'
  | 'derived-intelligence'
  | 'history'
  | 'feedback'
  | 'rules-and-profile'
  | 'provider-state'
  | 'recovery'
  | 'all'

type DatabaseLimits = {
  recentDecisions: number
  contentHistory: number
  cacheEntries: number
  operationRecords: number
}

type DatabaseOptions = {
  factory?: IDBFactory
  databaseName?: string
  limits?: Partial<DatabaseLimits>
}

type ImportOptions = {
  mode: ImportMode
  at: string
  operationId?: string
}

type ClearOptions = {
  at: string
}

export type DurableMutationOptions = {
  at: string
  operationId: string
}

type ProfileMutation<T> = (current: ProfileEnvelope) => {
  profile: ProfileEnvelope
  value: T
  effects?: OperationEffect[]
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      { once: true }
    )
  })

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true }
    )
    transaction.addEventListener(
      'error',
      () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true }
    )
  })

function ensureStore(
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: StoreName,
  keyPath: string | string[]
) {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath })
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  options?: IDBIndexParameters
) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options)
  }
}

function createStores(database: IDBDatabase, transaction: IDBTransaction) {
  const profile = ensureStore(database, transaction, STORES.profile, 'key')
  ensureIndex(profile, 'updatedAt', 'updatedAt')

  const rules = ensureStore(database, transaction, STORES.rules, 'id')
  ensureIndex(rules, 'kind', 'kind')
  ensureIndex(rules, 'platform', 'platform')
  ensureIndex(rules, 'identityId', 'identityId')
  ensureIndex(rules, 'updatedAt', 'updatedAt')

  const feedback = ensureStore(database, transaction, STORES.feedback, 'id')
  ensureIndex(feedback, 'createdAt', 'createdAt')

  const decisions = ensureStore(
    database,
    transaction,
    STORES.decisions,
    'cacheKey'
  )
  ensureIndex(decisions, 'decidedAt', 'decidedAt')

  const content = ensureStore(database, transaction, STORES.content, 'id')
  ensureIndex(content, 'observedAt', 'observedAt')

  const cache = ensureStore(database, transaction, STORES.cache, 'id')
  ensureIndex(cache, 'updatedAt', 'updatedAt')

  const snapshots = ensureStore(database, transaction, STORES.snapshots, 'id')
  ensureIndex(snapshots, 'createdAt', 'createdAt')

  const operations = ensureStore(
    database,
    transaction,
    STORES.operations,
    'operationId'
  )
  ensureIndex(operations, 'updatedAt', 'updatedAt')

  const migrationSnapshots = ensureStore(
    database,
    transaction,
    STORES.migrationSnapshots,
    'id'
  )
  ensureIndex(migrationSnapshots, 'createdAt', 'createdAt')
  const migrationJournals = ensureStore(
    database,
    transaction,
    STORES.migrationJournals,
    'operationId'
  )
  ensureIndex(migrationJournals, 'updatedAt', 'updatedAt')
  const migrationEvidence = ensureStore(
    database,
    transaction,
    STORES.migrationEvidence,
    'id'
  )
  ensureIndex(migrationEvidence, 'createdAt', 'createdAt')

  const providers = ensureStore(
    database,
    transaction,
    STORES.providers,
    'providerConfigId'
  )
  ensureIndex(providers, 'updatedAt', 'updatedAt')

  const models = ensureStore(database, transaction, STORES.models, [
    'providerConfigId',
    'modelId'
  ])
  ensureIndex(models, 'providerConfigId', 'providerConfigId')
  ensureIndex(models, 'lastCheckedAt', 'lastCheckedAt')

  const consents = ensureStore(database, transaction, STORES.consents, 'id')
  ensureIndex(consents, 'providerConfigId', 'receipt.key.providerConfigId')

  const credentials = ensureStore(
    database,
    transaction,
    STORES.credentials,
    'reference'
  )
  ensureIndex(credentials, 'providerConfigId', 'binding.providerConfigId')

  const rssEntries = ensureStore(
    database,
    transaction,
    STORES.rssEntries,
    'feedId'
  )
  ensureIndex(rssEntries, 'updatedAt', 'updatedAt')

  const rssRuntime = ensureStore(
    database,
    transaction,
    STORES.rssRuntime,
    'feedId'
  )
  ensureIndex(rssRuntime, 'updatedAt', 'updatedAt')
  ensureIndex(rssRuntime, 'nextAttemptAt', 'nextAttemptAt')

  const similarityVectors = ensureStore(
    database,
    transaction,
    STORES.similarityVectors,
    'id'
  )
  ensureIndex(similarityVectors, 'contentId', 'contentId')
  ensureIndex(similarityVectors, 'expiresAt', 'expiresAt')
  const similarityRelations = ensureStore(
    database,
    transaction,
    STORES.similarityRelations,
    'relationId'
  )
  ensureIndex(similarityRelations, 'validUntil', 'validUntil')
  ensureIndex(similarityRelations, 'leftContentId', 'leftContentId')
  ensureIndex(similarityRelations, 'rightContentId', 'rightContentId')
  const similaritySuppressions = ensureStore(
    database,
    transaction,
    STORES.similaritySuppressions,
    'id'
  )
  ensureIndex(
    similaritySuppressions,
    'relationFingerprint',
    'relationFingerprint'
  )
  const similarityClusters = ensureStore(
    database,
    transaction,
    STORES.similarityClusters,
    'clusterId'
  )
  ensureIndex(
    similarityClusters,
    'representativeContentId',
    'representativeContentId'
  )
  const similarityBatchActions = ensureStore(
    database,
    transaction,
    STORES.similarityBatchActions,
    'id'
  )
  ensureIndex(similarityBatchActions, 'contentIds', 'contentIds', {
    multiEntry: true
  })
  ensureIndex(similarityBatchActions, 'expiresAt', 'expiresAt')
  ensureStore(database, transaction, STORES.similarityRuntime, 'id')
  const similarityCheckpoints = ensureStore(
    database,
    transaction,
    STORES.similarityCheckpoints,
    'id'
  )
  ensureIndex(similarityCheckpoints, 'updatedAt', 'updatedAt')

  const graphNodes = ensureStore(database, transaction, STORES.graphNodes, 'id')
  ensureIndex(graphNodes, 'kind', 'kind')
  ensureIndex(graphNodes, 'validUntil', 'validUntil')
  const graphEdges = ensureStore(database, transaction, STORES.graphEdges, 'id')
  ensureIndex(graphEdges, 'from', 'from')
  ensureIndex(graphEdges, 'to', 'to')
  ensureIndex(graphEdges, 'validUntil', 'validUntil')
  ensureStore(database, transaction, STORES.graphRuntime, 'id')
  const graphCheckpoints = ensureStore(
    database,
    transaction,
    STORES.graphCheckpoints,
    'id'
  )
  ensureIndex(graphCheckpoints, 'updatedAt', 'updatedAt')

  const nativeFeedbackAttempts = ensureStore(
    database,
    transaction,
    STORES.nativeFeedbackAttempts,
    'attemptId'
  )
  ensureIndex(nativeFeedbackAttempts, 'updatedAt', 'updatedAt')
  ensureIndex(nativeFeedbackAttempts, 'state', 'state')
  ensureIndex(nativeFeedbackAttempts, 'operationId', 'operationId')
  ensureStore(database, transaction, STORES.nativeFeedbackRuntime, 'id')
}

function consentStorageId(receipt: ProviderStateSnapshot['consents'][number]) {
  return JSON.stringify(receipt.key)
}

function operationFailure<T>(
  code: string,
  message: string,
  retryable: boolean
): OperationResponse<T> {
  return {
    state: 'failed',
    error: { code, message },
    retryable
  }
}

function operationMatches(
  operation: StoredOperation,
  command: OperationCommand
) {
  return (
    operation.type === command.type &&
    operation.targetFingerprint === command.targetFingerprint
  )
}

function operationResponse<T>(
  operation: StoredOperation
): OperationResponse<T> {
  switch (operation.state) {
    case 'acknowledged':
      return {
        state: 'pending',
        operationId: operation.operationId
      }
    case 'committed':
      return {
        state: 'committed',
        value: structuredClone(operation.result) as T,
        revision: operation.revision ?? 0
      }
    case 'failed':
      return {
        state: 'failed',
        error: structuredClone(
          operation.error ?? {
            code: 'operation-failed',
            message: 'The operation could not be saved'
          }
        ),
        retryable: operation.retryable
      }
  }
}

function storedProfile(profile: ProfileEnvelope): StoredProfile {
  const { rules: _rules, feedbackExamples: _feedback, ...metadata } = profile
  return {
    key: PROFILE_KEY,
    ...metadata
  }
}

function scheduleProfileWrite(
  transaction: IDBTransaction,
  profile: ProfileEnvelope
) {
  const profileStore = transaction.objectStore(STORES.profile)
  const rules = transaction.objectStore(STORES.rules)
  const feedback = transaction.objectStore(STORES.feedback)

  profileStore.clear()
  rules.clear()
  feedback.clear()
  profileStore.put(storedProfile(profile))
  for (const rule of profile.rules) {
    rules.put(rule)
  }
  for (const example of profile.feedbackExamples) {
    feedback.put(example)
  }
}

function scheduleProviderStateWrite(
  transaction: IDBTransaction,
  state: ProviderStateSnapshot
) {
  const providers = transaction.objectStore(STORES.providers)
  const models = transaction.objectStore(STORES.models)
  const consents = transaction.objectStore(STORES.consents)
  const credentials = transaction.objectStore(STORES.credentials)
  providers.clear()
  models.clear()
  consents.clear()
  credentials.clear()
  for (const provider of state.providers) {
    providers.put(provider)
  }
  for (const model of state.models) {
    models.put(model)
  }
  for (const receipt of state.consents) {
    consents.put({
      id: consentStorageId(receipt),
      receipt
    } satisfies StoredConsent)
  }
  for (const credential of state.credentials) {
    credentials.put(credential)
  }
}

async function readProviderStateFromTransaction(
  transaction: IDBTransaction
): Promise<ProviderStateSnapshot> {
  const [providers, models, storedConsents, credentials] = await Promise.all([
    requestResult(transaction.objectStore(STORES.providers).getAll()),
    requestResult(transaction.objectStore(STORES.models).getAll()),
    requestResult(transaction.objectStore(STORES.consents).getAll()),
    requestResult(transaction.objectStore(STORES.credentials).getAll())
  ])
  return providerStateSnapshotSchema.parse({
    schemaVersion: PROVIDER_STATE_SCHEMA_VERSION,
    providers,
    models,
    consents: (storedConsents as StoredConsent[]).map(({ receipt }) => receipt),
    credentials
  })
}

function mergedProviderStatePreservesLocalSecrets(
  current: ProviderStateSnapshot,
  candidate: ProviderStateSnapshot
) {
  const currentProviders = new Map(
    current.providers.map(provider => [provider.providerConfigId, provider])
  )
  const currentCredentials = new Map(
    current.credentials.map(credential => [
      credential.reference,
      JSON.stringify(credential)
    ])
  )
  const currentConsents = new Set(
    current.consents.map(receipt => JSON.stringify(receipt))
  )
  return (
    candidate.credentials.every(
      credential =>
        currentCredentials.get(credential.reference) ===
        JSON.stringify(credential)
    ) &&
    candidate.consents.every(receipt =>
      currentConsents.has(JSON.stringify(receipt))
    ) &&
    candidate.providers.every(provider => {
      if (!provider.credentialRef) {
        return true
      }
      const local = currentProviders.get(provider.providerConfigId)
      return (
        local !== undefined &&
        local.endpointOrigin === provider.endpointOrigin &&
        local.kind === provider.kind &&
        local.execution === provider.execution &&
        local.credentialMode === provider.credentialMode &&
        local.credentialRef === provider.credentialRef &&
        local.status === provider.status
      )
    })
  )
}

async function readRawProfileFromTransaction(
  transaction: IDBTransaction
): Promise<unknown> {
  const [metadata, rules, feedbackExamples] = await Promise.all([
    requestResult(
      transaction.objectStore(STORES.profile).get(PROFILE_KEY)
    ) as Promise<StoredProfile | undefined>,
    requestResult(transaction.objectStore(STORES.rules).getAll()),
    requestResult(transaction.objectStore(STORES.feedback).getAll())
  ])
  if (!metadata) {
    return undefined
  }

  const { key: _key, ...portableMetadata } = metadata
  return {
    ...portableMetadata,
    rules: (rules as ProfileEnvelope['rules']).sort((left, right) =>
      comparePortableStrings(left.id, right.id)
    ),
    feedbackExamples: (
      feedbackExamples as ProfileEnvelope['feedbackExamples']
    ).sort((left, right) => comparePortableStrings(left.id, right.id))
  }
}

async function readProfileFromTransaction(
  transaction: IDBTransaction
): Promise<ProfileEnvelope | undefined> {
  const raw = await readRawProfileFromTransaction(transaction)
  return raw === undefined ? undefined : profileEnvelopeSchema.parse(raw)
}

async function trimOldest(
  store: IDBObjectStore,
  indexName: string,
  maximum: number
) {
  const count = await requestResult(store.count())
  let remaining = count - maximum
  if (remaining <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const cursorRequest = store.index(indexName).openCursor()
    cursorRequest.addEventListener('error', () => reject(cursorRequest.error), {
      once: true
    })
    cursorRequest.addEventListener('success', () => {
      const cursor = cursorRequest.result
      if (!cursor || remaining <= 0) {
        resolve()
        return
      }
      cursor.delete()
      remaining -= 1
      cursor.continue()
    })
  })
}

function newest<T>(
  values: readonly T[],
  maximum: number,
  timestamp: (value: T) => string,
  identity: (value: T) => string
) {
  if (values.length <= maximum) {
    return values
  }
  return [...values]
    .sort((left, right) => {
      const byTime = comparePortableStrings(timestamp(left), timestamp(right))
      return byTime === 0
        ? comparePortableStrings(identity(left), identity(right))
        : byTime
    })
    .slice(-maximum)
}

function importSummary(
  current: ProfileEnvelope | undefined,
  incoming: ProfileEnvelope
) {
  return {
    currentRevision: current?.revision ?? null,
    incomingRevision: incoming.revision,
    rules: incoming.rules.length,
    feedbackExamples: incoming.feedbackExamples.length,
    profileIdChanges:
      current !== undefined && current.profileId !== incoming.profileId
  }
}

export class ContentLensDatabase implements MigrationStore {
  readonly #factory: IDBFactory
  readonly #databaseName: string
  readonly #limits: DatabaseLimits
  #database?: IDBDatabase
  #opening?: Promise<IDBDatabase>

  constructor(options: DatabaseOptions = {}) {
    this.#factory = options.factory ?? indexedDB
    this.#databaseName = options.databaseName ?? 'contentlens'
    this.#limits = {
      recentDecisions: options.limits?.recentDecisions ?? MAX_RECENT_DECISIONS,
      contentHistory:
        options.limits?.contentHistory ??
        options.limits?.recentDecisions ??
        MAX_CONTENT_HISTORY,
      cacheEntries: options.limits?.cacheEntries ?? MAX_CACHE_ENTRIES,
      operationRecords:
        options.limits?.operationRecords ?? MAX_OPERATION_RECORDS
    }
  }

  async saveProfile(input: unknown) {
    const profile = profileEnvelopeSchema.parse(input)
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.profile, STORES.rules, STORES.feedback],
      'readwrite'
    )
    const done = transactionDone(transaction)
    scheduleProfileWrite(transaction, profile)
    await done
  }

  async exportProfile() {
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.profile, STORES.rules, STORES.feedback],
      'readonly'
    )
    const done = transactionDone(transaction)
    const profile = await readProfileFromTransaction(transaction)
    await done
    return profile
  }

  async readActiveProfile() {
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.profile, STORES.rules, STORES.feedback],
      'readonly'
    )
    const done = transactionDone(transaction)
    const profile = await readRawProfileFromTransaction(transaction)
    await done
    return profile
  }

  async replaceActiveProfile(profile: ProfileEnvelope) {
    await this.saveProfile(profile)
  }

  async readMigrationJournal(operationId: string) {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationJournals,
      'readonly'
    )
    const done = transactionDone(transaction)
    const journal = (await requestResult(
      transaction.objectStore(STORES.migrationJournals).get(operationId)
    )) as MigrationJournal | undefined
    await done
    return journal
  }

  async writeMigrationJournal(journal: MigrationJournal) {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationJournals,
      'readwrite'
    )
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.migrationJournals).put(journal)
    await done
  }

  async readMigrationSnapshot() {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationSnapshots,
      'readonly'
    )
    const done = transactionDone(transaction)
    const snapshots = (await requestResult(
      transaction.objectStore(STORES.migrationSnapshots).getAll()
    )) as MigrationSnapshot[]
    await done
    return snapshots[0]
  }

  async replaceMigrationSnapshot(snapshot: MigrationSnapshot) {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationSnapshots,
      'readwrite'
    )
    const done = transactionDone(transaction)
    const snapshots = transaction.objectStore(STORES.migrationSnapshots)
    snapshots.clear()
    snapshots.put(snapshot)
    await done
  }

  async clearMigrationSnapshot() {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationSnapshots,
      'readwrite'
    )
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.migrationSnapshots).clear()
    await done
  }

  async writeMigrationEvidence(evidence: MigrationEvidence) {
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.migrationEvidence,
      'readwrite'
    )
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORES.migrationEvidence)
    store.clear()
    store.put(evidence)
    await done
  }

  async clearAllLocalData() {
    await this.deleteAll()
  }

  async replaceProviderState(input: unknown) {
    const state = providerStateSnapshotSchema.parse(input)
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.providers, STORES.models, STORES.consents, STORES.credentials],
      'readwrite'
    )
    const done = transactionDone(transaction)
    scheduleProviderStateWrite(transaction, state)
    await done
  }

  async readProviderState(): Promise<ProviderStateSnapshot> {
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.providers, STORES.models, STORES.consents, STORES.credentials],
      'readonly'
    )
    const done = transactionDone(transaction)
    const state = await readProviderStateFromTransaction(transaction)
    await done
    return state
  }

  async readSyncIdentity(): Promise<SyncIdentityRecord | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const value = (await requestResult(
      transaction.objectStore(STORES.snapshots).get(ACTIVE_SYNC_IDENTITY_KEY)
    )) as SyncIdentityRecord | undefined
    await done
    return value
  }

  async ensureSyncIdentity(): Promise<SyncIdentityRecord> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORES.snapshots)
    const existing = (await requestResult(
      store.get(ACTIVE_SYNC_IDENTITY_KEY)
    )) as SyncIdentityRecord | undefined
    if (existing) {
      await done
      return existing
    }
    const created = {
      id: ACTIVE_SYNC_IDENTITY_KEY,
      syncProfileId: `sync:${crypto.randomUUID()}`,
      generation: 0
    } satisfies SyncIdentityRecord
    store.put(created)
    await done
    return created
  }

  async readSyncBase(
    syncProfileId: string
  ): Promise<SyncBaseRecord | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const value = (await requestResult(
      transaction.objectStore(STORES.snapshots).get(syncBaseKey(syncProfileId))
    )) as SyncBaseRecord | undefined
    await done
    if (!value) {
      return undefined
    }
    const envelope = syncEnvelopeSchema.safeParse(value.envelope)
    const verified = await verifySyncEnvelope(value.envelope)
    return envelope.success &&
      verified.valid &&
      envelope.data.syncProfileId === value.syncProfileId &&
      envelope.data.generation === value.generation &&
      envelope.data.digest === value.confirmedDigest
      ? value
      : undefined
  }

  async writeSyncConflictDraft(input: unknown) {
    const draft = await validateSyncConflictDraft(input)
    if (!draft) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.snapshots).put(draft)
    await done
    return { state: 'stored' as const }
  }

  async readSyncConflictDraft(
    syncProfileId: string
  ): Promise<SyncConflictDraft | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult(
      transaction
        .objectStore(STORES.snapshots)
        .get(syncConflictKey(syncProfileId))
    )
    await done
    return validateSyncConflictDraft(value)
  }

  async clearSyncConflictDraft(syncProfileId: string) {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    transaction
      .objectStore(STORES.snapshots)
      .delete(syncConflictKey(syncProfileId))
    await done
  }

  async writeSyncJournal(input: unknown) {
    const journal = syncJournalRecordSchema.safeParse(input)
    if (!journal.success) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.snapshots).put(journal.data)
    await done
    return { state: 'stored' as const }
  }

  async readSyncJournal(
    syncProfileId: string
  ): Promise<SyncJournalRecord | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult(
      transaction
        .objectStore(STORES.snapshots)
        .get(syncJournalKey(syncProfileId))
    )
    await done
    const parsed = syncJournalRecordSchema.safeParse(value)
    return parsed.success ? parsed.data : undefined
  }

  async readActiveSyncEnvelope(): Promise<SyncEnvelope | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const record = (await requestResult(
      transaction.objectStore(STORES.snapshots).get(ACTIVE_SYNC_ENVELOPE_KEY)
    )) as SyncActiveRecord | undefined
    await done
    const verified = await verifySyncEnvelope(record?.envelope)
    return verified.valid ? verified.envelope : undefined
  }

  async readSyncConnection(): Promise<SyncConnection> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(STORES.snapshots).get(ACTIVE_SYNC_CONNECTION_KEY)
    )
    await done
    const parsed = syncConnectionSchema.safeParse(value)
    return parsed.success ? parsed.data : disconnectedSyncConnection()
  }

  async writeSyncConnection(input: unknown) {
    const connection = syncConnectionSchema.safeParse(input)
    if (!connection.success) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.snapshots).put(connection.data)
    await done
    return { state: 'stored' as const }
  }

  async readSyncTransportState(
    syncProfileId: string
  ): Promise<SyncTransportStateRecord | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const record = (await requestResult(
      transaction
        .objectStore(STORES.snapshots)
        .get(syncTransportKey(syncProfileId))
    )) as SyncTransportStateRecord | undefined
    await done
    return record &&
      record.id === syncTransportKey(syncProfileId) &&
      record.syncProfileId === syncProfileId &&
      record.versionToken.length > 0 &&
      record.versionToken.length <= 1_024 &&
      !/[\r\n]/.test(record.versionToken) &&
      /^[a-f0-9]{64}$/.test(record.lastConfirmedDigest) &&
      isoTimestampSchema.safeParse(record.confirmedAt).success
      ? record
      : undefined
  }

  async commitSyncCandidate(
    candidateInput: unknown,
    options: DurableMutationOptions & { journal?: SyncJournalRecord }
  ) {
    const candidate = await verifySyncEnvelope(candidateInput)
    const journal = options.journal
      ? syncJournalRecordSchema.safeParse(options.journal)
      : undefined
    if (
      !candidate.valid ||
      !isoTimestampSchema.safeParse(options.at).success ||
      options.operationId.length === 0 ||
      options.operationId.length > 256 ||
      (journal !== undefined &&
        (!journal.success ||
          journal.data.phase !== 'local-committed' ||
          journal.data.syncProfileId !== candidate.envelope.syncProfileId ||
          journal.data.candidateDigest !== candidate.envelope.digest))
    ) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.profile,
        STORES.rules,
        STORES.feedback,
        STORES.providers,
        STORES.models,
        STORES.consents,
        STORES.credentials,
        STORES.snapshots
      ],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const currentProfile = await readProfileFromTransaction(transaction)
    const currentProviderState =
      await readProviderStateFromTransaction(transaction)
    if (!currentProfile) {
      transaction.abort()
      await done.catch(() => undefined)
      return { state: 'unavailable' as const }
    }
    const snapshots = transaction.objectStore(STORES.snapshots)
    const [syncIdentity, activeSync] = (await Promise.all([
      requestResult(snapshots.get(ACTIVE_SYNC_IDENTITY_KEY)),
      requestResult(snapshots.get(ACTIVE_SYNC_ENVELOPE_KEY))
    ])) as [SyncIdentityRecord | undefined, SyncActiveRecord | undefined]
    const syncBase = syncIdentity
      ? ((await requestResult(
          snapshots.get(syncBaseKey(syncIdentity.syncProfileId))
        )) as SyncBaseRecord | undefined)
      : undefined
    const recoveryId = syncRecoveryKey(options.operationId)
    const existingRecovery = await requestResult(snapshots.get(recoveryId))
    if (!existingRecovery) {
      snapshots.put({
        id: recoveryId,
        operationId: options.operationId,
        createdAt: options.at,
        profile: currentProfile,
        providerState: currentProviderState,
        syncIdentity,
        syncBase,
        activeSync
      } satisfies SyncRecoverySnapshot)
    }
    let profile: ProfileEnvelope
    let providerState: ProviderStateSnapshot
    try {
      profile = materializeImportedProfile({
        current: currentProfile,
        envelope: candidate.envelope,
        importedAt: options.at
      })
      providerState = reconcileMergedSyncEnvelope(
        candidate.envelope,
        currentProviderState,
        options.at
      )
    } catch {
      transaction.abort()
      await done.catch(() => undefined)
      return { state: 'invalid' as const }
    }
    scheduleProfileWrite(transaction, profile)
    scheduleProviderStateWrite(transaction, providerState)
    snapshots.put({
      id: ACTIVE_SYNC_ENVELOPE_KEY,
      envelope: candidate.envelope,
      updatedAt: options.at
    } satisfies SyncActiveRecord)
    snapshots.put({
      id: ACTIVE_SYNC_IDENTITY_KEY,
      syncProfileId: candidate.envelope.syncProfileId,
      generation: candidate.envelope.generation
    } satisfies SyncIdentityRecord)
    if (journal?.success) {
      snapshots.put(journal.data)
    }
    await done
    return { state: 'committed' as const, revision: profile.revision }
  }

  async confirmSyncBase(input: {
    envelope: unknown
    providerConfigId: string
    remoteObjectId: string
    versionToken: string
    confirmedAt: string
  }) {
    const envelope = await verifySyncEnvelope(input.envelope)
    if (
      !envelope.valid ||
      !isoTimestampSchema.safeParse(input.confirmedAt).success ||
      input.providerConfigId.length === 0 ||
      input.remoteObjectId.length === 0 ||
      input.versionToken.length === 0 ||
      input.versionToken.length > 1_024 ||
      /[\r\n]/.test(input.versionToken)
    ) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readwrite')
    const done = transactionDone(transaction)
    const snapshots = transaction.objectStore(STORES.snapshots)
    snapshots.put({
      id: syncBaseKey(envelope.envelope.syncProfileId),
      syncProfileId: envelope.envelope.syncProfileId,
      generation: envelope.envelope.generation,
      envelope: envelope.envelope,
      confirmedDigest: envelope.envelope.digest,
      confirmedAt: input.confirmedAt
    } satisfies SyncBaseRecord)
    snapshots.put({
      id: ACTIVE_SYNC_ENVELOPE_KEY,
      envelope: envelope.envelope,
      updatedAt: input.confirmedAt
    } satisfies SyncActiveRecord)
    snapshots.put({
      id: ACTIVE_SYNC_IDENTITY_KEY,
      syncProfileId: envelope.envelope.syncProfileId,
      generation: envelope.envelope.generation
    } satisfies SyncIdentityRecord)
    snapshots.put({
      id: syncTransportKey(envelope.envelope.syncProfileId),
      syncProfileId: envelope.envelope.syncProfileId,
      providerConfigId: input.providerConfigId,
      remoteObjectId: input.remoteObjectId,
      versionToken: input.versionToken,
      lastConfirmedDigest: envelope.envelope.digest,
      confirmedAt: input.confirmedAt
    } satisfies SyncTransportStateRecord)
    await done
    return { state: 'confirmed' as const }
  }

  async listSyncRecoverySnapshots(): Promise<SyncRecoverySnapshot[]> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const values = (await requestResult(
      transaction.objectStore(STORES.snapshots).getAll()
    )) as unknown[]
    await done
    const snapshots: SyncRecoverySnapshot[] = []
    for (const value of values) {
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !value.id.startsWith('sync-recovery:')
      ) {
        continue
      }
      const snapshot = value as SyncRecoverySnapshot
      const profile = profileEnvelopeSchema.safeParse(snapshot.profile)
      const providerState = providerStateSnapshotSchema.safeParse(
        snapshot.providerState
      )
      const active = snapshot.activeSync
        ? await verifySyncEnvelope(snapshot.activeSync.envelope)
        : undefined
      if (
        profile.success &&
        providerState.success &&
        isoTimestampSchema.safeParse(snapshot.createdAt).success &&
        (!active || active.valid)
      ) {
        snapshots.push(snapshot)
      }
    }
    return snapshots.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    )
  }

  async restoreSyncRecoverySnapshot(
    snapshotId: string,
    options: DurableMutationOptions
  ) {
    if (
      !snapshotId.startsWith('sync-recovery:') ||
      snapshotId.length > 512 ||
      !isoTimestampSchema.safeParse(options.at).success ||
      options.operationId.length === 0 ||
      options.operationId.length > 256
    ) {
      return { state: 'invalid' as const }
    }
    const available = await this.listSyncRecoverySnapshots()
    const selected = available.find(snapshot => snapshot.id === snapshotId)
    if (!selected) {
      return { state: 'snapshot-unavailable' as const }
    }
    const snapshotProfile = profileEnvelopeSchema.safeParse(selected.profile)
    const snapshotProviderState = providerStateSnapshotSchema.safeParse(
      selected.providerState
    )
    const snapshotActive = selected.activeSync
      ? await verifySyncEnvelope(selected.activeSync.envelope)
      : undefined
    if (
      !snapshotProfile.success ||
      !snapshotProviderState.success ||
      (snapshotActive && !snapshotActive.valid)
    ) {
      return { state: 'invalid' as const }
    }

    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.profile,
        STORES.rules,
        STORES.feedback,
        STORES.providers,
        STORES.models,
        STORES.consents,
        STORES.credentials,
        STORES.snapshots
      ],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const currentProfile = await readProfileFromTransaction(transaction)
    const currentProviderState =
      await readProviderStateFromTransaction(transaction)
    if (!currentProfile) {
      transaction.abort()
      await done.catch(() => undefined)
      return { state: 'unavailable' as const }
    }
    const snapshots = transaction.objectStore(STORES.snapshots)
    const [syncIdentity, activeSync, connection] = (await Promise.all([
      requestResult(snapshots.get(ACTIVE_SYNC_IDENTITY_KEY)),
      requestResult(snapshots.get(ACTIVE_SYNC_ENVELOPE_KEY)),
      requestResult(snapshots.get(ACTIVE_SYNC_CONNECTION_KEY))
    ])) as [
      SyncIdentityRecord | undefined,
      SyncActiveRecord | undefined,
      SyncConnection | undefined
    ]
    const syncBase = syncIdentity
      ? ((await requestResult(
          snapshots.get(syncBaseKey(syncIdentity.syncProfileId))
        )) as SyncBaseRecord | undefined)
      : undefined
    snapshots.put({
      id: syncRecoveryKey(options.operationId),
      operationId: options.operationId,
      createdAt: options.at,
      profile: currentProfile,
      providerState: currentProviderState,
      syncIdentity,
      syncBase,
      activeSync
    } satisfies SyncRecoverySnapshot)

    const restoredProfile = profileEnvelopeSchema.parse({
      ...snapshotProfile.data,
      profileId: currentProfile.profileId,
      createdAt: currentProfile.createdAt,
      revision: currentProfile.revision + 1,
      updatedAt: options.at
    })
    scheduleProfileWrite(transaction, restoredProfile)
    scheduleProviderStateWrite(transaction, snapshotProviderState.data)
    if (snapshotActive?.valid) {
      snapshots.put({
        id: ACTIVE_SYNC_ENVELOPE_KEY,
        envelope: snapshotActive.envelope,
        updatedAt: options.at
      } satisfies SyncActiveRecord)
    } else {
      snapshots.delete(ACTIVE_SYNC_ENVELOPE_KEY)
    }
    const parsedConnection = syncConnectionSchema.safeParse(connection)
    if (parsedConnection.success) {
      snapshots.put(
        syncConnectionSchema.parse({
          ...parsedConnection.data,
          enabled: false,
          runtimeState: 'conflict',
          lastErrorCode: 'recovery-restored-review-required'
        })
      )
    }
    await done
    return {
      state: 'restored' as const,
      revision: restoredProfile.revision,
      automaticPush: false as const
    }
  }

  async replacePortableConfiguration(
    input: PortableConfiguration,
    options: DurableMutationOptions
  ) {
    const profile = profileEnvelopeSchema.safeParse(input.profile)
    const providerState = providerStateSnapshotSchema.safeParse(
      input.providerState
    )
    const activeEnvelope = syncEnvelopeSchema.safeParse(input.activeEnvelope)
    const baseEnvelope = syncEnvelopeSchema.safeParse(input.baseEnvelope)
    const [verifiedActiveEnvelope, verifiedBaseEnvelope] = await Promise.all([
      verifySyncEnvelope(input.activeEnvelope),
      verifySyncEnvelope(input.baseEnvelope)
    ])
    const providerStateIsPortable =
      providerState.success &&
      (input.mode === 'merge' ||
        (providerState.data.credentials.length === 0 &&
          providerState.data.consents.length === 0 &&
          providerState.data.providers.every(
            provider =>
              provider.status === 'locked' && provider.credentialRef === null
          )))
    if (
      !profile.success ||
      !providerState.success ||
      !activeEnvelope.success ||
      !baseEnvelope.success ||
      !verifiedActiveEnvelope.valid ||
      !verifiedBaseEnvelope.valid ||
      activeEnvelope.data.syncProfileId !== baseEnvelope.data.syncProfileId ||
      activeEnvelope.data.generation !== baseEnvelope.data.generation ||
      !providerStateIsPortable ||
      !isoTimestampSchema.safeParse(options.at).success
    ) {
      return { state: 'invalid' as const, code: 'invalid-portable-state' }
    }
    const command: OperationCommand = {
      operationId: options.operationId,
      type: 'portable.import.replace',
      targetFingerprint: await fingerprintPortableValue({
        profile: profile.data,
        providerState: providerState.data,
        mode: input.mode,
        activeDigest: activeEnvelope.data.digest,
        baseDigest: baseEnvelope.data.digest
      }),
      at: options.at
    }
    if (!this.#operationCommandIsValid(command)) {
      return { state: 'invalid' as const, code: 'invalid-operation' }
    }

    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.profile,
        STORES.rules,
        STORES.feedback,
        STORES.providers,
        STORES.models,
        STORES.consents,
        STORES.credentials,
        STORES.snapshots,
        STORES.operations
      ],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const operations = transaction.objectStore(STORES.operations)
    const existing = (await requestResult(
      operations.get(command.operationId)
    )) as StoredOperation | undefined
    if (existing) {
      await done
      if (!operationMatches(existing, command)) {
        return { state: 'failed' as const, code: 'operation-id-conflict' }
      }
      const replay = operationResponse<{ revision: number }>(existing)
      return replay.state === 'committed'
        ? {
            state: 'imported' as const,
            revision: replay.value.revision
          }
        : replay
    }
    const currentProfile = await readProfileFromTransaction(transaction)
    const currentProviderState =
      await readProviderStateFromTransaction(transaction)
    if (!currentProfile) {
      await done
      return { state: 'failed' as const, code: 'profile-unavailable' }
    }
    if (
      input.mode === 'merge' &&
      !mergedProviderStatePreservesLocalSecrets(
        currentProviderState,
        providerState.data
      )
    ) {
      await done
      return { state: 'invalid' as const, code: 'invalid-portable-state' }
    }

    const snapshots = transaction.objectStore(STORES.snapshots)
    const currentSyncIdentity = (await requestResult(
      snapshots.get(ACTIVE_SYNC_IDENTITY_KEY)
    )) as SyncIdentityRecord | undefined
    const currentSyncBase = currentSyncIdentity
      ? ((await requestResult(
          snapshots.get(syncBaseKey(currentSyncIdentity.syncProfileId))
        )) as SyncBaseRecord | undefined)
      : undefined
    snapshots.put({
      id: LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY,
      createdAt: options.at,
      profile: currentProfile,
      providerState: currentProviderState,
      syncIdentity: currentSyncIdentity,
      syncBase: currentSyncBase
    } satisfies PortableImportSnapshot)
    const nextIdentity = {
      id: ACTIVE_SYNC_IDENTITY_KEY,
      syncProfileId: activeEnvelope.data.syncProfileId,
      generation: activeEnvelope.data.generation
    } satisfies SyncIdentityRecord
    snapshots.put(nextIdentity)
    snapshots.put({
      id: syncBaseKey(baseEnvelope.data.syncProfileId),
      syncProfileId: baseEnvelope.data.syncProfileId,
      generation: baseEnvelope.data.generation,
      envelope: baseEnvelope.data,
      confirmedDigest: baseEnvelope.data.digest,
      confirmedAt: options.at
    } satisfies SyncBaseRecord)
    scheduleProfileWrite(transaction, profile.data)
    scheduleProviderStateWrite(transaction, providerState.data)
    operations.put({
      operationId: command.operationId,
      type: command.type,
      targetFingerprint: command.targetFingerprint,
      state: 'committed',
      attempt: 1,
      createdAt: command.at,
      updatedAt: command.at,
      retryable: false,
      result: { revision: profile.data.revision },
      revision: profile.data.revision,
      committedEffects: [
        {
          kind: 'profile.imported',
          targetId: profile.data.profileId
        }
      ]
    } satisfies StoredOperation)
    await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    await done
    return { state: 'imported' as const, revision: profile.data.revision }
  }

  async readPortableImportSnapshot(): Promise<
    PortableImportSnapshot | undefined
  > {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const snapshot = (await requestResult(
      transaction
        .objectStore(STORES.snapshots)
        .get(LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY)
    )) as PortableImportSnapshot | undefined
    await done
    return snapshot
  }

  async restorePortableImportSnapshot(options: DurableMutationOptions) {
    if (!isoTimestampSchema.safeParse(options.at).success) {
      return { state: 'failed' as const, code: 'invalid-operation' }
    }
    const command: OperationCommand = {
      operationId: options.operationId,
      type: 'portable.import.restore',
      targetFingerprint: LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY,
      at: options.at
    }
    if (!this.#operationCommandIsValid(command)) {
      return { state: 'failed' as const, code: 'invalid-operation' }
    }

    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.profile,
        STORES.rules,
        STORES.feedback,
        STORES.providers,
        STORES.models,
        STORES.consents,
        STORES.credentials,
        STORES.snapshots,
        STORES.operations
      ],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const operations = transaction.objectStore(STORES.operations)
    const existing = (await requestResult(
      operations.get(command.operationId)
    )) as StoredOperation | undefined
    if (existing) {
      await done
      if (!operationMatches(existing, command)) {
        return { state: 'failed' as const, code: 'operation-id-conflict' }
      }
      const replay = operationResponse<{ revision: number }>(existing)
      return replay.state === 'committed'
        ? {
            state: 'restored' as const,
            revision: replay.value.revision
          }
        : replay
    }

    const snapshots = transaction.objectStore(STORES.snapshots)
    const snapshot = (await requestResult(
      snapshots.get(LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY)
    )) as PortableImportSnapshot | undefined
    const currentProfile = await readProfileFromTransaction(transaction)
    const currentProviderState =
      await readProviderStateFromTransaction(transaction)
    const currentSyncIdentity = (await requestResult(
      snapshots.get(ACTIVE_SYNC_IDENTITY_KEY)
    )) as SyncIdentityRecord | undefined
    const currentSyncBase = currentSyncIdentity
      ? ((await requestResult(
          snapshots.get(syncBaseKey(currentSyncIdentity.syncProfileId))
        )) as SyncBaseRecord | undefined)
      : undefined
    const snapshotProfile = profileEnvelopeSchema.safeParse(snapshot?.profile)
    const snapshotProviderState = providerStateSnapshotSchema.safeParse(
      snapshot?.providerState
    )
    const snapshotSyncBase = snapshot?.syncBase
      ? syncEnvelopeSchema.safeParse(snapshot.syncBase.envelope)
      : undefined
    if (
      !snapshot ||
      !currentProfile ||
      !snapshotProfile.success ||
      !snapshotProviderState.success ||
      (snapshotSyncBase !== undefined && !snapshotSyncBase.success)
    ) {
      await done
      return { state: 'snapshot-unavailable' as const }
    }
    const restoredProfile = profileEnvelopeSchema.parse({
      ...snapshotProfile.data,
      profileId: currentProfile.profileId,
      createdAt: currentProfile.createdAt,
      revision: currentProfile.revision + 1,
      updatedAt: options.at
    })
    snapshots.put({
      id: LATEST_PORTABLE_IMPORT_SNAPSHOT_KEY,
      createdAt: options.at,
      profile: currentProfile,
      providerState: currentProviderState,
      syncIdentity: currentSyncIdentity,
      syncBase: currentSyncBase
    } satisfies PortableImportSnapshot)
    if (currentSyncIdentity) {
      snapshots.delete(syncBaseKey(currentSyncIdentity.syncProfileId))
    }
    if (snapshot.syncIdentity) {
      snapshots.put(snapshot.syncIdentity)
    } else {
      snapshots.delete(ACTIVE_SYNC_IDENTITY_KEY)
    }
    if (snapshot.syncBase) {
      snapshots.put(snapshot.syncBase)
    }
    scheduleProfileWrite(transaction, restoredProfile)
    scheduleProviderStateWrite(transaction, snapshotProviderState.data)
    operations.put({
      operationId: command.operationId,
      type: command.type,
      targetFingerprint: command.targetFingerprint,
      state: 'committed',
      attempt: 1,
      createdAt: command.at,
      updatedAt: command.at,
      retryable: false,
      result: { revision: restoredProfile.revision },
      revision: restoredProfile.revision,
      committedEffects: [
        {
          kind: 'profile.import-restored',
          targetId: restoredProfile.profileId
        }
      ]
    } satisfies StoredOperation)
    await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    await done
    return { state: 'restored' as const, revision: restoredProfile.revision }
  }

  async replaceRecentRssEntries(
    feedIdInput: string,
    inputs: readonly unknown[]
  ) {
    const feedId = rssFeedIdSchema.safeParse(feedIdInput)
    if (!feedId.success) {
      return { state: 'invalid' as const }
    }
    const parsed: ContentItem[] = []
    for (const input of inputs) {
      const item = contentItemSchema.safeParse(input)
      if (
        !item.success ||
        item.data.platform !== 'rss' ||
        item.data.surface !== 'rss:feed-entry' ||
        item.data.context.feedId !== feedId.data
      ) {
        return { state: 'invalid' as const }
      }
      parsed.push(item.data)
    }
    const byId = new Map(parsed.map(item => [item.id, item]))
    const entries = [
      ...newest(
        [...byId.values()],
        MAX_RSS_RECENT_ENTRIES_PER_FEED,
        item => item.publishedAt ?? item.observedAt,
        item => item.id
      )
    ]
    const updatedAt = entries.reduce(
      (latest, item) =>
        comparePortableStrings(item.observedAt, latest) > 0
          ? item.observedAt
          : latest,
      entries[0]?.observedAt ?? new Date(0).toISOString()
    )
    const database = await this.#open()
    const transaction = database.transaction(STORES.rssEntries, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.rssEntries).put({
      feedId: feedId.data,
      updatedAt,
      entries
    } satisfies StoredRssEntries)
    await done
    return { state: 'recorded' as const, count: entries.length }
  }

  async readRecentRssEntries(feedIdInput: string): Promise<ContentItem[]> {
    const feedId = rssFeedIdSchema.safeParse(feedIdInput)
    if (!feedId.success) {
      return []
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.rssEntries, 'readonly')
    const done = transactionDone(transaction)
    const stored = (await requestResult(
      transaction.objectStore(STORES.rssEntries).get(feedId.data)
    )) as StoredRssEntries | undefined
    await done
    if (!stored || stored.feedId !== feedId.data) {
      return []
    }
    const entries = stored.entries.flatMap(input => {
      const parsedEntry = contentItemSchema.safeParse(input)
      return parsedEntry.success &&
        parsedEntry.data.platform === 'rss' &&
        parsedEntry.data.context.feedId === feedId.data
        ? [parsedEntry.data]
        : []
    })
    return structuredClone(entries)
  }

  async replaceRssRuntimeState(input: unknown) {
    const state = rssRuntimeStateSchema.parse(input)
    const database = await this.#open()
    const transaction = database.transaction(STORES.rssRuntime, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.rssRuntime).put(state)
    await done
  }

  async readRssRuntimeStates(): Promise<RssRuntimeState[]> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.rssRuntime, 'readonly')
    const done = transactionDone(transaction)
    const values = await requestResult(
      transaction.objectStore(STORES.rssRuntime).getAll()
    )
    await done
    return values.flatMap(input => {
      const parsed = rssRuntimeStateSchema.safeParse(input)
      return parsed.success ? [parsed.data] : []
    })
  }

  async clearRssFeedData(feedIdInput: string, atInput: string) {
    const feedId = rssFeedIdSchema.safeParse(feedIdInput)
    const at = isoTimestampSchema.safeParse(atInput)
    if (!feedId.success || !at.success) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.rssEntries, STORES.rssRuntime],
      'readwrite'
    )
    const done = transactionDone(transaction)
    transaction.objectStore(STORES.rssEntries).put({
      feedId: feedId.data,
      updatedAt: at.data,
      entries: []
    } satisfies StoredRssEntries)
    transaction.objectStore(STORES.rssRuntime).put({
      schemaVersion: 1,
      feedId: feedId.data,
      state: 'removed',
      consecutiveFailures: 0,
      updatedAt: at.data
    } satisfies RssRuntimeState)
    await done
    return { state: 'cleared' as const }
  }

  async importProfile(input: unknown, options: ImportOptions) {
    if (options.mode === 'merge') {
      return {
        state: 'unsupported' as const,
        mode: 'merge' as const
      }
    }
    if (!isoTimestampSchema.safeParse(options.at).success) {
      return {
        state: 'invalid' as const,
        code: 'invalid-import-time',
        issues: ['Import time is invalid']
      }
    }

    const parsed = parseProfileEnvelope(input)
    if (!parsed.success) {
      return {
        state: 'invalid' as const,
        code: parsed.code,
        issues: parsed.issues
      }
    }

    if (options.mode === 'dry-run') {
      const currentRaw = await this.readActiveProfile()
      const parsedCurrent =
        currentRaw === undefined ? undefined : parseProfileEnvelope(currentRaw)
      const current =
        parsedCurrent?.success === true ? parsedCurrent.data : undefined
      return {
        state: 'valid' as const,
        summary: importSummary(current, parsed.data)
      }
    }

    const command = options.operationId
      ? {
          operationId: options.operationId,
          type: 'profile.import',
          targetFingerprint: await fingerprintPortableValue({
            mode: 'replace',
            profile: parsed.data
          }),
          at: options.at
        }
      : undefined
    if (command && !this.#operationCommandIsValid(command)) {
      return {
        state: 'invalid' as const,
        code: 'invalid-operation',
        issues: ['Import operation metadata is invalid']
      }
    }

    const database = await this.#open()
    const stores = [
      STORES.profile,
      STORES.rules,
      STORES.feedback,
      STORES.snapshots,
      ...(command ? [STORES.operations] : [])
    ]
    const transaction = database.transaction(stores, 'readwrite')
    const done = transactionDone(transaction)
    const operations = command
      ? transaction.objectStore(STORES.operations)
      : undefined
    if (command && operations) {
      const existing = (await requestResult(
        operations.get(command.operationId)
      )) as StoredOperation | undefined
      if (existing) {
        await done
        if (!operationMatches(existing, command)) {
          return {
            state: 'failed' as const,
            code: 'operation-id-conflict'
          }
        }
        const replay =
          operationResponse<ReturnType<typeof importSummary>>(existing)
        if (replay.state === 'committed') {
          return {
            state: 'imported' as const,
            summary: replay.value
          }
        }
        if (replay.state === 'pending') {
          return replay
        }
        return {
          state: 'failed' as const,
          code:
            replay.state === 'failed'
              ? replay.error.code
              : 'import-operation-failed'
        }
      }
    }
    const transactionCurrentRaw =
      await readRawProfileFromTransaction(transaction)
    const transactionCurrent =
      transactionCurrentRaw === undefined
        ? undefined
        : profileEnvelopeSchema.safeParse(transactionCurrentRaw)
    const current =
      transactionCurrent?.success === true ? transactionCurrent.data : undefined
    const summary = importSummary(current, parsed.data)
    const snapshots = transaction.objectStore(STORES.snapshots)
    snapshots.delete(LATEST_IMPORT_SNAPSHOT_KEY)
    if (transactionCurrent?.success) {
      snapshots.put({
        id: LATEST_IMPORT_SNAPSHOT_KEY,
        createdAt: options.at,
        profile: transactionCurrent.data
      } satisfies ImportSnapshot)
    }
    scheduleProfileWrite(transaction, parsed.data)
    if (command && operations) {
      operations.put({
        operationId: command.operationId,
        type: command.type,
        targetFingerprint: command.targetFingerprint,
        state: 'committed',
        attempt: 1,
        createdAt: command.at,
        updatedAt: command.at,
        retryable: false,
        result: summary,
        revision: parsed.data.revision,
        committedEffects: [
          {
            kind: 'profile.imported',
            targetId: parsed.data.profileId
          }
        ]
      } satisfies StoredOperation)
      await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    }
    await done

    return {
      state: 'imported' as const,
      summary
    }
  }

  async readImportSnapshot(): Promise<ImportSnapshot | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.snapshots, 'readonly')
    const done = transactionDone(transaction)
    const snapshot = (await requestResult(
      transaction.objectStore(STORES.snapshots).get(LATEST_IMPORT_SNAPSHOT_KEY)
    )) as ImportSnapshot | undefined
    await done
    return snapshot
  }

  async restoreImportSnapshot(options?: DurableMutationOptions) {
    const command = options
      ? {
          operationId: options.operationId,
          type: 'profile.import.restore',
          targetFingerprint: LATEST_IMPORT_SNAPSHOT_KEY,
          at: options.at
        }
      : undefined
    if (command && !this.#operationCommandIsValid(command)) {
      return { state: 'failed' as const, code: 'invalid-operation' }
    }
    const database = await this.#open()
    const stores = [
      STORES.profile,
      STORES.rules,
      STORES.feedback,
      STORES.snapshots,
      ...(command ? [STORES.operations] : [])
    ]
    const transaction = database.transaction(stores, 'readwrite')
    const done = transactionDone(transaction)
    const operations = command
      ? transaction.objectStore(STORES.operations)
      : undefined
    if (command && operations) {
      const existing = (await requestResult(
        operations.get(command.operationId)
      )) as StoredOperation | undefined
      if (existing) {
        await done
        if (!operationMatches(existing, command)) {
          return {
            state: 'failed' as const,
            code: 'operation-id-conflict'
          }
        }
        const replay = operationResponse<{ revision: number }>(existing)
        if (replay.state === 'committed') {
          return {
            state: 'restored' as const,
            revision: replay.value.revision
          }
        }
        if (replay.state === 'pending') {
          return replay
        }
        return {
          state: 'failed' as const,
          code:
            replay.state === 'failed'
              ? replay.error.code
              : 'snapshot-restore-failed'
        }
      }
    }
    const snapshots = transaction.objectStore(STORES.snapshots)
    const snapshot = (await requestResult(
      snapshots.get(LATEST_IMPORT_SNAPSHOT_KEY)
    )) as ImportSnapshot | undefined
    if (!snapshot) {
      await done
      return { state: 'snapshot-unavailable' as const }
    }
    const parsed = profileEnvelopeSchema.safeParse(snapshot.profile)
    if (!parsed.success) {
      await done
      return { state: 'invalid-snapshot' as const }
    }
    scheduleProfileWrite(transaction, parsed.data)
    snapshots.delete(LATEST_IMPORT_SNAPSHOT_KEY)
    if (command && operations) {
      operations.put({
        operationId: command.operationId,
        type: command.type,
        targetFingerprint: command.targetFingerprint,
        state: 'committed',
        attempt: 1,
        createdAt: command.at,
        updatedAt: command.at,
        retryable: false,
        result: { revision: parsed.data.revision },
        revision: parsed.data.revision,
        committedEffects: [
          {
            kind: 'profile.import-restored',
            targetId: parsed.data.profileId
          }
        ]
      } satisfies StoredOperation)
      await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    }
    await done
    return {
      state: 'restored' as const,
      revision: parsed.data.revision
    }
  }

  async restoreMigrationSnapshot(options: DurableMutationOptions) {
    const command: OperationCommand = {
      operationId: options.operationId,
      type: 'profile.migration.restore',
      targetFingerprint: 'latest-migration-snapshot',
      at: options.at
    }
    if (!this.#operationCommandIsValid(command)) {
      return { state: 'failed' as const, code: 'invalid-operation' }
    }
    const replay = await this.#readOperation<{ revision: number }>(command)
    if (replay) {
      if (replay.state === 'committed') {
        return {
          state: 'restored' as const,
          revision: replay.value.revision
        }
      }
      if (replay.state === 'pending') {
        return replay
      }
      return {
        state: 'failed' as const,
        code:
          replay.state === 'failed'
            ? replay.error.code
            : 'migration-restore-failed'
      }
    }

    const snapshot = await this.readMigrationSnapshot()
    if (!snapshot) {
      return { state: 'snapshot-unavailable' as const }
    }
    const validation = await validateMigrationSnapshot(snapshot, options.at)
    if (!validation.valid) {
      return {
        state: 'invalid-snapshot' as const,
        code: validation.code
      }
    }

    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.profile,
        STORES.rules,
        STORES.feedback,
        STORES.migrationSnapshots,
        STORES.operations
      ],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const operations = transaction.objectStore(STORES.operations)
    const existing = (await requestResult(
      operations.get(command.operationId)
    )) as StoredOperation | undefined
    if (existing) {
      await done
      if (!operationMatches(existing, command)) {
        return { state: 'failed' as const, code: 'operation-id-conflict' }
      }
      const concurrentReplay = operationResponse<{ revision: number }>(existing)
      if (concurrentReplay.state === 'committed') {
        return {
          state: 'restored' as const,
          revision: concurrentReplay.value.revision
        }
      }
      if (concurrentReplay.state === 'pending') {
        return concurrentReplay
      }
      return {
        state: 'failed' as const,
        code:
          concurrentReplay.state === 'failed'
            ? concurrentReplay.error.code
            : 'migration-restore-failed'
      }
    }
    const currentSnapshot = (await requestResult(
      transaction
        .objectStore(STORES.migrationSnapshots)
        .get(MIGRATION_SNAPSHOT_ID)
    )) as MigrationSnapshot | undefined
    if (
      !currentSnapshot ||
      currentSnapshot.operationId !== snapshot.operationId ||
      currentSnapshot.digest !== snapshot.digest
    ) {
      await done
      return { state: 'snapshot-unavailable' as const }
    }

    scheduleProfileWrite(transaction, validation.profile)
    transaction.objectStore(STORES.migrationSnapshots).clear()
    operations.put({
      operationId: command.operationId,
      type: command.type,
      targetFingerprint: command.targetFingerprint,
      state: 'committed',
      attempt: 1,
      createdAt: command.at,
      updatedAt: command.at,
      retryable: false,
      result: { revision: validation.profile.revision },
      revision: validation.profile.revision,
      committedEffects: [
        {
          kind: 'profile.migration-restored',
          targetId: validation.profile.profileId
        }
      ]
    } satisfies StoredOperation)
    await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    await done
    return {
      state: 'restored' as const,
      revision: validation.profile.revision
    }
  }

  async recordObservations(inputs: readonly ObservationInput[]) {
    const observations: Array<{
      content: ContentItem
      decision?: Decision
    }> = []
    for (const input of inputs) {
      const parsedContent = contentItemSchema.safeParse(input.content)
      const parsedDecision =
        input.decision === undefined
          ? undefined
          : decisionSchema.safeParse(input.decision)
      if (
        !parsedContent.success ||
        (parsedDecision !== undefined && !parsedDecision.success)
      ) {
        return {
          state: 'invalid' as const
        }
      }
      observations.push({
        content: parsedContent.data,
        ...(parsedDecision ? { decision: parsedDecision.data } : {})
      })
    }

    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.content, STORES.decisions],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const contentStore = transaction.objectStore(STORES.content)
    const decisions = transaction.objectStore(STORES.decisions)
    const contentToStore = newest(
      observations.map(observation => observation.content),
      this.#limits.contentHistory,
      item => item.observedAt,
      item => item.id
    )
    const decisionsToStore = newest(
      observations.flatMap(observation =>
        observation.decision ? [observation.decision] : []
      ),
      this.#limits.recentDecisions,
      item => item.decidedAt,
      item => item.contentId
    )
    for (const item of contentToStore) {
      contentStore.put(item)
    }
    for (const item of decisionsToStore) {
      decisions.put({
        ...item,
        cacheKey: `${item.contentId}\u0000${item.classifierVersion}`
      } satisfies StoredDecision)
    }
    await trimOldest(contentStore, 'observedAt', this.#limits.contentHistory)
    await trimOldest(decisions, 'decidedAt', this.#limits.recentDecisions)
    await done
    return {
      state: 'recorded' as const,
      count: observations.length,
      persisted: {
        content: contentToStore.length,
        decisions: decisionsToStore.length
      }
    }
  }

  async putCacheEntries(inputs: readonly CacheEntryInput[]) {
    const entries: CacheEntry[] = []
    for (const input of inputs) {
      const id = nonEmptyStringSchema.safeParse(input.id)
      const updatedAt = isoTimestampSchema.safeParse(input.updatedAt)
      const value = portableJsonValueSchema.safeParse(input.value)
      if (!id.success || !updatedAt.success || !value.success) {
        return { state: 'invalid' as const }
      }
      entries.push({
        id: id.data,
        updatedAt: updatedAt.data,
        value: value.data
      })
    }

    const database = await this.#open()
    const transaction = database.transaction(STORES.cache, 'readwrite')
    const done = transactionDone(transaction)
    const cache = transaction.objectStore(STORES.cache)
    for (const entry of entries) {
      cache.put(entry)
    }
    await trimOldest(cache, 'updatedAt', this.#limits.cacheEntries)
    await done
    return { state: 'recorded' as const, count: entries.length }
  }

  async readRecentContent(limit = this.#limits.contentHistory) {
    const boundedLimit = Math.min(
      Math.max(0, Math.floor(limit)),
      this.#limits.contentHistory
    )
    const database = await this.#open()
    const transaction = database.transaction(STORES.content, 'readonly')
    const done = transactionDone(transaction)
    const stored = await requestResult(
      transaction.objectStore(STORES.content).getAll()
    )
    await done
    return stored
      .map(item => contentItemSchema.safeParse(item))
      .filter(item => item.success)
      .map(item => item.data)
      .sort(
        (left, right) =>
          comparePortableStrings(right.observedAt, left.observedAt) ||
          comparePortableStrings(left.id, right.id)
      )
      .slice(0, boundedLimit)
      .map(item => structuredClone(item))
  }

  async replaceSimilarityDerivedState(input: unknown) {
    const parsed = similarityDerivedStateSchema.safeParse(input)
    if (!parsed.success) {
      return { state: 'invalid' as const }
    }
    const database = await this.#open()
    const names = [
      STORES.similarityVectors,
      STORES.similarityRelations,
      STORES.similaritySuppressions,
      STORES.similarityClusters,
      STORES.similarityBatchActions,
      STORES.similarityRuntime,
      STORES.similarityCheckpoints,
      STORES.graphNodes,
      STORES.graphEdges
    ]
    const transaction = database.transaction(names, 'readwrite')
    const done = transactionDone(transaction)
    const [graphNodes, graphEdges] = await Promise.all([
      requestResult(transaction.objectStore(STORES.graphNodes).getAll()),
      requestResult(transaction.objectStore(STORES.graphEdges).getAll())
    ])
    const graphBytes = new TextEncoder().encode(
      JSON.stringify([graphNodes, graphEdges])
    ).byteLength
    if (graphBytes + parsed.data.runtime.byteLength > MAX_SIMILARITY_BYTES) {
      await done
      return { state: 'limit-exceeded' as const }
    }
    const vectors = transaction.objectStore(STORES.similarityVectors)
    const relations = transaction.objectStore(STORES.similarityRelations)
    const suppressions = transaction.objectStore(STORES.similaritySuppressions)
    const clusters = transaction.objectStore(STORES.similarityClusters)
    const batchActions = transaction.objectStore(STORES.similarityBatchActions)
    const runtime = transaction.objectStore(STORES.similarityRuntime)
    const checkpoints = transaction.objectStore(STORES.similarityCheckpoints)
    vectors.clear()
    relations.clear()
    suppressions.clear()
    clusters.clear()
    batchActions.clear()
    runtime.clear()
    checkpoints.clear()
    for (const vector of parsed.data.vectors) {
      vectors.put(vector)
    }
    for (const relation of parsed.data.relations) {
      relations.put(relation)
    }
    for (const suppression of parsed.data.suppressions) {
      suppressions.put(suppression)
    }
    for (const cluster of parsed.data.clusters) {
      clusters.put(cluster)
    }
    for (const batchAction of parsed.data.batchActions) {
      batchActions.put(batchAction)
    }
    runtime.put({
      ...parsed.data.runtime,
      id: ACTIVE_SIMILARITY_RUNTIME_ID
    } satisfies StoredSimilarityRuntime)
    if (parsed.data.checkpoint) {
      checkpoints.put(parsed.data.checkpoint)
    }
    await done
    return { state: 'replaced' as const }
  }

  async readSimilarityDerivedState(): Promise<
    | { state: 'ready'; data: SimilarityDerivedState }
    | { state: 'missing' | 'corrupt' }
  > {
    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.similarityVectors,
        STORES.similarityRelations,
        STORES.similaritySuppressions,
        STORES.similarityClusters,
        STORES.similarityBatchActions,
        STORES.similarityRuntime,
        STORES.similarityCheckpoints
      ],
      'readonly'
    )
    const done = transactionDone(transaction)
    const [
      vectors,
      relations,
      suppressions,
      clusters,
      batchActions,
      storedRuntime,
      checkpoints
    ] = await Promise.all([
      requestResult(transaction.objectStore(STORES.similarityVectors).getAll()),
      requestResult(
        transaction.objectStore(STORES.similarityRelations).getAll()
      ),
      requestResult(
        transaction.objectStore(STORES.similaritySuppressions).getAll()
      ),
      requestResult(
        transaction.objectStore(STORES.similarityClusters).getAll()
      ),
      requestResult(
        transaction.objectStore(STORES.similarityBatchActions).getAll()
      ),
      requestResult(
        transaction
          .objectStore(STORES.similarityRuntime)
          .get(ACTIVE_SIMILARITY_RUNTIME_ID)
      ),
      requestResult(
        transaction.objectStore(STORES.similarityCheckpoints).getAll()
      )
    ])
    await done
    if (!storedRuntime) {
      return vectors.length ||
        relations.length ||
        suppressions.length ||
        clusters.length ||
        batchActions.length
        ? { state: 'corrupt' }
        : { state: 'missing' }
    }
    const { id: _id, ...runtime } = storedRuntime as StoredSimilarityRuntime
    const parsed = similarityDerivedStateSchema.safeParse({
      vectors,
      relations,
      suppressions,
      clusters,
      batchActions,
      runtime,
      checkpoint: checkpoints[0] ?? null
    })
    return parsed.success
      ? { state: 'ready', data: parsed.data }
      : { state: 'corrupt' }
  }

  async replaceGraphDerivedState(input: unknown) {
    const parsed = graphDerivedStateSchema.safeParse(input)
    if (!parsed.success) {
      return { state: 'invalid' as const }
    }
    const graphBytes = new TextEncoder().encode(
      JSON.stringify([
        parsed.data.nodes,
        parsed.data.edges,
        parsed.data.manifest,
        parsed.data.checkpoint
      ])
    ).byteLength
    const database = await this.#open()
    const names = [
      STORES.graphNodes,
      STORES.graphEdges,
      STORES.graphRuntime,
      STORES.graphCheckpoints,
      STORES.similarityRuntime
    ]
    const transaction = database.transaction(names, 'readwrite')
    const done = transactionDone(transaction)
    const storedSimilarity = (await requestResult(
      transaction
        .objectStore(STORES.similarityRuntime)
        .get(ACTIVE_SIMILARITY_RUNTIME_ID)
    )) as StoredSimilarityRuntime | undefined
    if (
      graphBytes + (storedSimilarity?.byteLength ?? 0) >
      MAX_SIMILARITY_BYTES
    ) {
      await done
      return { state: 'limit-exceeded' as const }
    }
    const nodes = transaction.objectStore(STORES.graphNodes)
    const edges = transaction.objectStore(STORES.graphEdges)
    const runtime = transaction.objectStore(STORES.graphRuntime)
    const checkpoints = transaction.objectStore(STORES.graphCheckpoints)
    nodes.clear()
    edges.clear()
    runtime.clear()
    checkpoints.clear()
    for (const node of parsed.data.nodes) {
      nodes.put(node)
    }
    for (const edge of parsed.data.edges) {
      edges.put(edge)
    }
    runtime.put({
      ...parsed.data.manifest,
      id: ACTIVE_GRAPH_RUNTIME_ID
    } satisfies StoredGraphRuntime)
    if (parsed.data.checkpoint) {
      checkpoints.put(parsed.data.checkpoint)
    }
    await done
    return { state: 'replaced' as const }
  }

  async findActiveSimilarityBatchAction(
    contentIdInput: string,
    nowInput: string
  ): Promise<SimilarityBatchAction | undefined> {
    const contentId = nonEmptyStringSchema.safeParse(contentIdInput)
    const now = isoTimestampSchema.safeParse(nowInput)
    if (!contentId.success || !now.success) {
      return undefined
    }
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.similarityBatchActions,
      'readonly'
    )
    const done = transactionDone(transaction)
    const candidates = await requestResult(
      transaction
        .objectStore(STORES.similarityBatchActions)
        .index('contentIds')
        .getAll(contentId.data)
    )
    await done
    return candidates
      .map(candidate => similarityBatchActionSchema.safeParse(candidate))
      .filter(candidate => candidate.success)
      .map(candidate => candidate.data)
      .filter(
        candidate => Date.parse(candidate.expiresAt) > Date.parse(now.data)
      )
      .sort((left, right) =>
        comparePortableStrings(right.acceptedAt, left.acceptedAt)
      )[0]
  }

  async readGraphDerivedState(): Promise<
    | { state: 'ready'; data: GraphDerivedState }
    | { state: 'missing' | 'corrupt' }
  > {
    const database = await this.#open()
    const transaction = database.transaction(
      [
        STORES.graphNodes,
        STORES.graphEdges,
        STORES.graphRuntime,
        STORES.graphCheckpoints
      ],
      'readonly'
    )
    const done = transactionDone(transaction)
    const [nodes, edges, storedRuntime, checkpoints] = await Promise.all([
      requestResult(transaction.objectStore(STORES.graphNodes).getAll()),
      requestResult(transaction.objectStore(STORES.graphEdges).getAll()),
      requestResult(
        transaction
          .objectStore(STORES.graphRuntime)
          .get(ACTIVE_GRAPH_RUNTIME_ID)
      ),
      requestResult(transaction.objectStore(STORES.graphCheckpoints).getAll())
    ])
    await done
    if (!storedRuntime) {
      return nodes.length || edges.length
        ? { state: 'corrupt' }
        : { state: 'missing' }
    }
    const { id: _id, ...manifest } = storedRuntime as StoredGraphRuntime
    const parsed = graphDerivedStateSchema.safeParse({
      nodes,
      edges,
      manifest,
      checkpoint: checkpoints[0] ?? null
    })
    return parsed.success
      ? { state: 'ready', data: parsed.data }
      : { state: 'corrupt' }
  }

  async clearDerivedIntelligence() {
    const database = await this.#open()
    const names = [
      STORES.similarityVectors,
      STORES.similarityRelations,
      STORES.similaritySuppressions,
      STORES.similarityClusters,
      STORES.similarityBatchActions,
      STORES.similarityRuntime,
      STORES.similarityCheckpoints,
      STORES.graphNodes,
      STORES.graphEdges,
      STORES.graphRuntime,
      STORES.graphCheckpoints
    ]
    const transaction = database.transaction(names, 'readwrite')
    const done = transactionDone(transaction)
    for (const name of names) {
      transaction.objectStore(name).clear()
    }
    await done
    return { state: 'cleared' as const }
  }

  async getNativeFeedbackAttempt(
    attemptIdInput: string
  ): Promise<NativeFeedbackAttempt | undefined> {
    const attemptId = nonEmptyStringSchema.safeParse(attemptIdInput)
    if (!attemptId.success) return undefined
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.nativeFeedbackAttempts,
      'readonly'
    )
    const done = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(STORES.nativeFeedbackAttempts).get(attemptId.data)
    )
    await done
    const parsed = nativeFeedbackAttemptSchema.safeParse(value)
    return parsed.success ? structuredClone(parsed.data) : undefined
  }

  async listNativeFeedbackAttempts(now: string) {
    if (!isoTimestampSchema.safeParse(now).success) return []
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.nativeFeedbackAttempts,
      'readonly'
    )
    const done = transactionDone(transaction)
    const values = await requestResult(
      transaction.objectStore(STORES.nativeFeedbackAttempts).getAll()
    )
    await done
    return retainNativeFeedbackAttempts(
      values
        .map(value => nativeFeedbackAttemptSchema.safeParse(value))
        .filter(value => value.success)
        .map(value => value.data),
      now
    )
  }

  async putNativeFeedbackAttempt(input: NativeFeedbackAttempt): Promise<void> {
    const attempt = nativeFeedbackAttemptSchema.parse(input)
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.nativeFeedbackAttempts,
      'readwrite'
    )
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORES.nativeFeedbackAttempts)
    const current = await requestResult(store.getAll())
    const retained = retainNativeFeedbackAttempts(
      [
        ...current
          .map(value => nativeFeedbackAttemptSchema.safeParse(value))
          .filter(value => value.success)
          .map(value => value.data)
          .filter(value => value.attemptId !== attempt.attemptId),
        attempt
      ],
      attempt.updatedAt
    )
    store.clear()
    for (const value of retained) store.put(value)
    await done
  }

  async cancelPendingNativeFeedback(at: string): Promise<number> {
    if (!isoTimestampSchema.safeParse(at).success) return 0
    const database = await this.#open()
    const transaction = database.transaction(
      STORES.nativeFeedbackAttempts,
      'readwrite'
    )
    const done = transactionDone(transaction)
    const store = transaction.objectStore(STORES.nativeFeedbackAttempts)
    const values = await requestResult(
      store.index('state').getAll('pending-review')
    )
    let cancelled = 0
    for (const value of values) {
      const parsed = nativeFeedbackAttemptSchema.safeParse(value)
      if (!parsed.success) continue
      store.put({
        ...parsed.data,
        state: 'cancelled',
        terminalReason: 'feature-disabled',
        updatedAt: at
      })
      cancelled += 1
    }
    await done
    return cancelled
  }

  nativeFeedbackAttemptStore() {
    return {
      get: (attemptId: string) => this.getNativeFeedbackAttempt(attemptId),
      put: (attempt: NativeFeedbackAttempt) =>
        this.putNativeFeedbackAttempt(attempt),
      cancelPending: (at: string) => this.cancelPendingNativeFeedback(at),
      list: (at: string) => this.listNativeFeedbackAttempts(at)
    }
  }

  async readCacheEntry(
    idInput: string
  ): Promise<PortableJsonValue | undefined> {
    const id = nonEmptyStringSchema.safeParse(idInput)
    if (!id.success) {
      return undefined
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.cache, 'readonly')
    const done = transactionDone(transaction)
    const entry = (await requestResult(
      transaction.objectStore(STORES.cache).get(id.data)
    )) as CacheEntry | undefined
    await done
    const parsed = portableJsonValueSchema.safeParse(entry?.value)
    return parsed.success ? structuredClone(parsed.data) : undefined
  }

  async counts() {
    const database = await this.#open()
    const names = Object.values(STORES)
    const transaction = database.transaction(names, 'readonly')
    const done = transactionDone(transaction)
    const counts = await Promise.all(
      names.map(name => requestResult(transaction.objectStore(name).count()))
    )
    await done
    return Object.fromEntries(
      names.map((name, index) => [name, counts[index] ?? 0])
    ) as Record<StoreName, number>
  }

  async clear(scope: DeleteScope, options: ClearOptions) {
    if (!isoTimestampSchema.safeParse(options.at).success) {
      return { state: 'invalid' as const }
    }
    if (scope === 'all') {
      await this.deleteAll()
      return { state: 'cleared' as const }
    }
    const database = await this.#open()

    if (
      scope === 'cache' ||
      scope === 'derived-intelligence' ||
      scope === 'history'
    ) {
      const names =
        scope === 'history'
          ? [
              STORES.content,
              STORES.decisions,
              STORES.nativeFeedbackAttempts,
              STORES.nativeFeedbackRuntime
            ]
          : scope === 'derived-intelligence'
            ? [
                STORES.similarityVectors,
                STORES.similarityRelations,
                STORES.similaritySuppressions,
                STORES.similarityClusters,
                STORES.similarityBatchActions,
                STORES.similarityRuntime,
                STORES.similarityCheckpoints,
                STORES.graphNodes,
                STORES.graphEdges,
                STORES.graphRuntime,
                STORES.graphCheckpoints
              ]
            : [
                STORES.cache,
                STORES.similarityVectors,
                STORES.similarityRelations,
                STORES.similaritySuppressions,
                STORES.similarityClusters,
                STORES.similarityBatchActions,
                STORES.similarityRuntime,
                STORES.similarityCheckpoints,
                STORES.graphNodes,
                STORES.graphEdges,
                STORES.graphRuntime,
                STORES.graphCheckpoints
              ]
      const transaction = database.transaction(names, 'readwrite')
      const done = transactionDone(transaction)
      for (const name of names) {
        transaction.objectStore(name).clear()
      }
      await done
      return { state: 'cleared' as const }
    }

    if (scope === 'recovery') {
      const transaction = database.transaction(
        [
          STORES.snapshots,
          STORES.operations,
          STORES.migrationSnapshots,
          STORES.migrationJournals,
          STORES.migrationEvidence
        ],
        'readwrite'
      )
      const done = transactionDone(transaction)
      transaction.objectStore(STORES.snapshots).clear()
      transaction.objectStore(STORES.operations).clear()
      transaction.objectStore(STORES.migrationSnapshots).clear()
      transaction.objectStore(STORES.migrationJournals).clear()
      transaction.objectStore(STORES.migrationEvidence).clear()
      await done
      return { state: 'cleared' as const }
    }

    if (scope === 'provider-state') {
      const transaction = database.transaction(
        [STORES.providers, STORES.models, STORES.consents, STORES.credentials],
        'readwrite'
      )
      const done = transactionDone(transaction)
      transaction.objectStore(STORES.providers).clear()
      transaction.objectStore(STORES.models).clear()
      transaction.objectStore(STORES.consents).clear()
      transaction.objectStore(STORES.credentials).clear()
      await done
      return { state: 'cleared' as const }
    }

    if (scope === 'rules-and-profile') {
      const transaction = database.transaction(
        [STORES.profile, STORES.rules, STORES.feedback],
        'readwrite'
      )
      const done = transactionDone(transaction)
      transaction.objectStore(STORES.profile).clear()
      transaction.objectStore(STORES.rules).clear()
      transaction.objectStore(STORES.feedback).clear()
      await done
      return { state: 'cleared' as const }
    }

    const transaction = database.transaction(
      [STORES.profile, STORES.feedback],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const metadata = (await requestResult(
      transaction.objectStore(STORES.profile).get(PROFILE_KEY)
    )) as StoredProfile | undefined
    transaction.objectStore(STORES.feedback).clear()
    if (metadata) {
      transaction.objectStore(STORES.profile).put({
        ...metadata,
        revision: metadata.revision + 1,
        updatedAt: options.at
      } satisfies StoredProfile)
    }
    await done
    return { state: 'cleared' as const }
  }

  async readOperationResponse<T>(
    command: OperationCommand
  ): Promise<OperationResponse<T> | undefined> {
    if (!this.#operationCommandIsValid(command)) {
      return operationFailure(
        'invalid-operation',
        'Operation metadata is invalid',
        false
      )
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.operations, 'readonly')
    const done = transactionDone(transaction)
    const existing = (await requestResult(
      transaction.objectStore(STORES.operations).get(command.operationId)
    )) as StoredOperation | undefined
    await done
    if (!existing) {
      return undefined
    }
    return operationMatches(existing, command)
      ? operationResponse<T>(existing)
      : operationFailure(
          'operation-id-conflict',
          'Operation ID is already bound to another target',
          false
        )
  }

  async acknowledgeOperation<T>(
    command: OperationCommand
  ): Promise<OperationResponse<T>> {
    if (!this.#operationCommandIsValid(command)) {
      return operationFailure(
        'invalid-operation',
        'Operation metadata is invalid',
        false
      )
    }
    const database = await this.#open()
    const transaction = database.transaction(STORES.operations, 'readwrite')
    const done = transactionDone(transaction)
    const operations = transaction.objectStore(STORES.operations)
    const existing = (await requestResult(
      operations.get(command.operationId)
    )) as StoredOperation | undefined
    if (existing) {
      await done
      return operationMatches(existing, command)
        ? operationResponse<T>(existing)
        : operationFailure(
            'operation-id-conflict',
            'Operation ID is already bound to another target',
            false
          )
    }

    const acknowledged: StoredOperation = {
      operationId: command.operationId,
      type: command.type,
      targetFingerprint: command.targetFingerprint,
      state: 'acknowledged',
      attempt: 0,
      createdAt: command.at,
      updatedAt: command.at,
      retryable: true,
      committedEffects: []
    }
    operations.put(acknowledged)
    await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
    await done
    return {
      state: 'pending',
      operationId: command.operationId
    }
  }

  async transactProfile<T>(
    command: OperationCommand,
    expectedRevision: number,
    mutate: ProfileMutation<T>
  ): Promise<OperationResponse<T>> {
    if (!this.#operationCommandIsValid(command)) {
      return operationFailure(
        'invalid-operation',
        'Operation metadata is invalid',
        false
      )
    }
    const database = await this.#open()
    const transaction = database.transaction(
      [STORES.profile, STORES.rules, STORES.feedback, STORES.operations],
      'readwrite'
    )
    const done = transactionDone(transaction)
    const operations = transaction.objectStore(STORES.operations)
    const existing = (await requestResult(
      operations.get(command.operationId)
    )) as StoredOperation | undefined
    if (existing && !operationMatches(existing, command)) {
      await done
      return operationFailure(
        'operation-id-conflict',
        'Operation ID is already bound to another target',
        false
      )
    }
    if (existing?.state === 'committed') {
      await done
      return operationResponse(existing)
    }

    try {
      const current = await readProfileFromTransaction(transaction)
      if (!current) {
        throw new ProfileTransactionError(
          'profile-not-found',
          'No active profile is available',
          false
        )
      }
      if (current.revision !== expectedRevision) {
        throw new ProfileTransactionError(
          'stale-profile-revision',
          'The profile changed before this operation',
          false
        )
      }

      const mutation = mutate(current)
      const parsed = profileEnvelopeSchema.safeParse(mutation.profile)
      if (!parsed.success || parsed.data.revision !== current.revision + 1) {
        throw new ProfileTransactionError(
          'invalid-profile-mutation',
          'Profile mutation is invalid',
          false
        )
      }

      scheduleProfileWrite(transaction, parsed.data)
      const committed: StoredOperation = {
        operationId: command.operationId,
        type: command.type,
        targetFingerprint: command.targetFingerprint,
        state: 'committed',
        attempt: (existing?.attempt ?? 0) + 1,
        createdAt: existing?.createdAt ?? command.at,
        updatedAt: command.at,
        retryable: false,
        result: structuredClone(mutation.value),
        revision: parsed.data.revision,
        committedEffects: structuredClone(mutation.effects ?? [])
      }
      operations.put(committed)
      await trimOldest(operations, 'updatedAt', this.#limits.operationRecords)
      await done
      return operationResponse(committed)
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // The transaction can already be inactive after an IndexedDB failure.
      }
      await done.catch(() => undefined)
      const safe =
        error instanceof ProfileTransactionError
          ? error
          : new ProfileTransactionError(
              'storage-transaction-failed',
              'The profile could not be saved',
              true
            )
      return operationFailure(safe.code, safe.message, safe.retryable)
    }
  }

  close() {
    this.#database?.close()
    this.#database = undefined
    this.#opening = undefined
  }

  async deleteAll() {
    this.close()
    await new Promise<void>((resolve, reject) => {
      const request = this.#factory.deleteDatabase(this.#databaseName)
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener(
        'error',
        () => reject(request.error ?? new Error('Database deletion failed')),
        { once: true }
      )
      request.addEventListener('blocked', () => reject(new Error('blocked')), {
        once: true
      })
    })
  }

  async #open() {
    if (this.#database) {
      return this.#database
    }
    if (this.#opening) {
      return this.#opening
    }

    this.#opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false
      const request = this.#factory.open(
        this.#databaseName,
        CONTENT_LENS_DATABASE_VERSION
      )
      request.addEventListener('upgradeneeded', () => {
        if (request.transaction) {
          createStores(request.result, request.transaction)
        }
      })
      request.addEventListener(
        'success',
        () => {
          const database = request.result
          if (settled) {
            database.close()
            return
          }
          settled = true
          database.addEventListener('versionchange', () => {
            database.close()
            if (this.#database === database) {
              this.#database = undefined
            }
          })
          this.#database = database
          this.#opening = undefined
          resolve(database)
        },
        { once: true }
      )
      request.addEventListener(
        'error',
        () => {
          if (settled) {
            return
          }
          settled = true
          this.#opening = undefined
          reject(request.error ?? new Error('ContentLens database failed'))
        },
        { once: true }
      )
      request.addEventListener(
        'blocked',
        () => {
          if (settled) {
            return
          }
          settled = true
          this.#opening = undefined
          reject(new Error('ContentLens database upgrade blocked'))
        },
        { once: true }
      )
    })
    return this.#opening
  }

  #operationCommandIsValid(command: OperationCommand) {
    return (
      nonEmptyStringSchema.safeParse(command.operationId).success &&
      nonEmptyStringSchema.safeParse(command.type).success &&
      nonEmptyStringSchema.safeParse(command.targetFingerprint).success &&
      isoTimestampSchema.safeParse(command.at).success
    )
  }

  async #readOperation<T>(
    command: OperationCommand
  ): Promise<OperationResponse<T> | undefined> {
    const database = await this.#open()
    const transaction = database.transaction(STORES.operations, 'readonly')
    const done = transactionDone(transaction)
    const existing = (await requestResult(
      transaction.objectStore(STORES.operations).get(command.operationId)
    )) as StoredOperation | undefined
    await done
    if (!existing) {
      return undefined
    }
    return operationMatches(existing, command)
      ? operationResponse<T>(existing)
      : operationFailure(
          'operation-id-conflict',
          'Operation ID is already bound to another target',
          false
        )
  }
}

export class ProfileTransactionError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'ProfileTransactionError'
    this.code = code
    this.retryable = retryable
  }
}
