import type {
  ProfileEnvelope,
  SchemaVersion
} from '@/storage/contracts/profile-envelope'

export const MIGRATION_SNAPSHOT_ID = 'latest-pre-migration'
export const MIGRATION_EVIDENCE_ID = 'latest'
export const MIGRATION_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export type MigrationPhase =
  | 'preflight'
  | 'snapshotting'
  | 'snapshot-ready'
  | 'applying'
  | 'validating-target'
  | 'committed'
  | 'cleanup-pending'
  | 'complete'
  | 'blocked'
  | 'blocked-unreadable'
  | 'failed'

export type MigrationJournal = {
  operationId: string
  manifestId: string
  sourceVersion: SchemaVersion
  targetVersion: SchemaVersion
  phase: MigrationPhase
  sourceDigest: string
  targetDigest?: string
  createdAt: string
  updatedAt: string
  code?: string
  summary?: {
    rules: number
    feedbackExamples: number
  }
}

export type MigrationSnapshot = {
  id: typeof MIGRATION_SNAPSHOT_ID
  operationId: string
  createdAt: string
  expiresAt: string
  profile: ProfileEnvelope
  digest: string
  counts: {
    rules: number
    feedbackExamples: number
  }
  validated: true
}

export type MigrationEvidence = {
  id: typeof MIGRATION_EVIDENCE_ID
  operationId: string
  createdAt: string
  reason: string
  sourceFingerprint: string
}

export type MigrationCompatibility =
  | 'backward-readable-minor'
  | 'forward-only-minor'
  | 'incompatible-major'

export type MigrationManifest = {
  id: string
  sourceVersion: SchemaVersion
  targetVersion: SchemaVersion
  compatibility: MigrationCompatibility
  affectedStores: readonly string[]
  sourceProductVersion: string
  targetProductVersion: string
  recoveryNotes: string
  migrate(source: ProfileEnvelope, at: string): ProfileEnvelope
}

export interface MigrationStore {
  readActiveProfile(): Promise<unknown>
  replaceActiveProfile(profile: ProfileEnvelope): Promise<void>
  readMigrationJournal(
    operationId: string
  ): Promise<MigrationJournal | undefined>
  writeMigrationJournal(journal: MigrationJournal): Promise<void>
  readMigrationSnapshot(): Promise<MigrationSnapshot | undefined>
  replaceMigrationSnapshot(snapshot: MigrationSnapshot): Promise<void>
  clearMigrationSnapshot(): Promise<void>
  writeMigrationEvidence(evidence: MigrationEvidence): Promise<void>
  clearAllLocalData(): Promise<void>
}
