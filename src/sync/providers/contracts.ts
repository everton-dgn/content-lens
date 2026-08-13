import type { SyncEnvelope } from '@/sync/contracts'

export const SYNC_RUNTIME_STATES = [
  'disconnected',
  'connecting',
  'idle',
  'pulling',
  'merging',
  'pushing',
  'conflict',
  'degraded'
] as const

export type SyncRuntimeState = (typeof SYNC_RUNTIME_STATES)[number]

export type SyncProviderMetadata = {
  providerConfigId: string
  displayName: string
  endpointOrigin: string
  policyUrl: string | null
  retention: string
  revocation: string
  casMethod: string
  maxBytes: number
}

export type SyncProviderStatus = {
  state: SyncRuntimeState
  code?: SyncProviderErrorCode
  lastConfirmedAt?: string
  lastConfirmedDigest?: string
}

export type SyncProviderErrorCode =
  | 'authentication-required'
  | 'permission-required'
  | 'remote-unavailable'
  | 'rate-limited'
  | 'schema-rejected'
  | 'payload-too-large'
  | 'version-token-missing'
  | 'version-token-invalid'
  | 'redirect-blocked'
  | 'confirmation-mismatch'
  | 'remote-missing'
  | 'remote-delete-unavailable'

export class SyncProviderError extends Error {
  readonly code: SyncProviderErrorCode
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(input: {
    code: SyncProviderErrorCode
    retryable: boolean
    retryAfterMs?: number
  }) {
    super(input.code)
    this.name = 'SyncProviderError'
    this.code = input.code
    this.retryable = input.retryable
    this.retryAfterMs = input.retryAfterMs
  }
}

export type SyncProviderRead = {
  envelope: unknown
  versionToken: string
  byteLength: number
}

export type SyncProviderCommit =
  | { state: 'committed'; versionToken: string }
  | { state: 'mismatch' }

export type SyncProviderConfirmation =
  | { state: 'confirmed'; versionToken: string }
  | { state: 'mismatch' }

export interface SyncProvider {
  readonly metadata: SyncProviderMetadata
  connect(input?: { signal?: AbortSignal }): Promise<SyncProviderStatus>
  disconnect(input?: { revoke?: boolean }): Promise<void>
  read(input?: { signal?: AbortSignal }): Promise<SyncProviderRead>
  compareAndSwap(input: {
    expectedVersionToken: string
    envelope: SyncEnvelope
    signal?: AbortSignal
  }): Promise<SyncProviderCommit>
  initialize(
    envelope: SyncEnvelope,
    input?: { signal?: AbortSignal }
  ): Promise<SyncProviderCommit>
  confirm(input: {
    expectedDigest: string
    expectedVersionToken: string
    signal?: AbortSignal
  }): Promise<SyncProviderConfirmation>
  deleteRemote?(input: {
    expectedVersionToken: string
    signal?: AbortSignal
  }): Promise<{ state: 'deleted' } | { state: 'mismatch' }>
  getStatus(): SyncProviderStatus
}
