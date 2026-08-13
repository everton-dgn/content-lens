import { z } from 'zod'

import {
  type ModelDescriptor,
  modelDescriptorSchema
} from '@/ai/models/contracts'
import {
  type ConsentReceipt,
  consentKeySchema,
  consentReceiptSchema,
  PROVIDER_KIND_VALUES,
  type ProviderDescriptor
} from '@/ai/providers/contracts'
import type { ProviderTemplate } from '@/ai/providers/templates'
import type { PlatformActivationResult } from '@/application/adapter-activation/browser-content-scripts'
import type { ProviderRemovalImpact } from '@/application/settings/provider-impact'
import type {
  SaveSettingsResult,
  SettingsLoadResult
} from '@/application/settings/service'
import { nonEmptyStringSchema } from '@/core/content/contracts'
import type { OperationResponse } from '@/core/operations/journal'
import { contentLensSettingsSchema } from '@/core/settings'
import type { SyncRunResult } from '@/sync/cas-service'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import {
  MAX_SYNC_INTERVAL_MINUTES,
  MIN_SYNC_INTERVAL_MINUTES,
  type SyncConnection
} from '@/sync/connection'
import { syncEntityTypeSchema } from '@/sync/contracts'

const requestEnvelope = {
  namespace: z.literal('contentlens.runtime.v1'),
  version: z.literal(1),
  requestId: nonEmptyStringSchema
}

export const settingsSnapshotMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('settings.snapshot')
})

export const providerCreateMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.create'),
  templateId: z.enum(PROVIDER_KIND_VALUES),
  displayName: nonEmptyStringSchema.max(256),
  endpointOrigin: z.string().max(2_048).optional()
})

export const providerCredentialMessageSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...requestEnvelope,
    type: z.literal('provider.credential'),
    providerConfigId: nonEmptyStringSchema.max(256),
    mode: z.literal('session-only'),
    value: nonEmptyStringSchema.max(16_384)
  }),
  z.strictObject({
    ...requestEnvelope,
    type: z.literal('provider.credential'),
    providerConfigId: nonEmptyStringSchema.max(256),
    mode: z.literal('passphrase-wrapped'),
    value: nonEmptyStringSchema.max(16_384),
    passphrase: nonEmptyStringSchema.max(1_024)
  }),
  z.strictObject({
    ...requestEnvelope,
    type: z.literal('provider.credential'),
    providerConfigId: nonEmptyStringSchema.max(256),
    mode: z.literal('external-vault'),
    externalReference: nonEmptyStringSchema.max(256)
  })
])

export const providerDisconnectMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.disconnect'),
  providerConfigId: nonEmptyStringSchema.max(256)
})

export const providerUpdateMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.update'),
  providerConfigId: nonEmptyStringSchema.max(256),
  displayName: nonEmptyStringSchema.max(256),
  endpointOrigin: z.string().max(2_048)
})

export const providerRemovalPreviewMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.remove.preview'),
  providerConfigId: nonEmptyStringSchema.max(256)
})

export const providerRemoveMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.remove'),
  providerConfigId: nonEmptyStringSchema.max(256)
})

export const providerTestMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.test'),
  providerConfigId: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256),
  quotaAcknowledged: z.literal(true)
})

export const providerCatalogRefreshMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.catalog.refresh'),
  providerConfigId: nonEmptyStringSchema.max(256)
})

export const providerConsentMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('provider.consent'),
  receipt: consentReceiptSchema
})

export const modelRegisterMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('model.register'),
  model: modelDescriptorSchema
})

export const settingsSaveMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('settings.save'),
  operationId: nonEmptyStringSchema.max(256),
  expectedRevision: z.int().nonnegative(),
  at: z.iso.datetime({ offset: true }),
  settings: contentLensSettingsSchema,
  reviewedConsentKeys: z.array(consentKeySchema).max(256)
})

export const syncConnectMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.connect'),
  providerConfigId: nonEmptyStringSchema.max(256),
  endpointPath: z.string().max(1_024),
  remoteObjectId: nonEmptyStringSchema.max(256),
  scheduleMinutes: z
    .int()
    .min(MIN_SYNC_INTERVAL_MINUTES)
    .max(MAX_SYNC_INTERVAL_MINUTES)
    .nullable(),
  retention: nonEmptyStringSchema.max(512),
  revocation: nonEmptyStringSchema.max(512),
  consentedAt: z.iso.datetime({ offset: true })
})

export const syncDisconnectMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.disconnect'),
  at: z.iso.datetime({ offset: true })
})

export const syncNowMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.now'),
  at: z.iso.datetime({ offset: true })
})

export const syncScheduleMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.schedule'),
  scheduleMinutes: z
    .int()
    .min(MIN_SYNC_INTERVAL_MINUTES)
    .max(MAX_SYNC_INTERVAL_MINUTES)
    .nullable()
})

const syncConflictResolutionSchema = z.strictObject({
  entityType: syncEntityTypeSchema,
  entityId: nonEmptyStringSchema.max(512),
  choice: z.enum(['local', 'remote', 'custom']),
  customValue: z.unknown().optional()
})

export const syncResolveMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.resolve'),
  at: z.iso.datetime({ offset: true }),
  resolutions: z.array(syncConflictResolutionSchema).max(10_000)
})

export const syncRecoveryRestoreMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.recovery.restore'),
  snapshotId: nonEmptyStringSchema.max(512),
  operationId: nonEmptyStringSchema.max(256),
  at: z.iso.datetime({ offset: true })
})

export const syncRemoteDeleteMessageSchema = z.strictObject({
  ...requestEnvelope,
  type: z.literal('sync.remote.delete'),
  confirmedRemoteObjectId: nonEmptyStringSchema.max(256),
  at: z.iso.datetime({ offset: true })
})

export const settingsRequestMessageSchema = z.union([
  settingsSnapshotMessageSchema,
  providerCreateMessageSchema,
  providerCredentialMessageSchema,
  providerUpdateMessageSchema,
  providerDisconnectMessageSchema,
  providerRemovalPreviewMessageSchema,
  providerRemoveMessageSchema,
  providerCatalogRefreshMessageSchema,
  providerTestMessageSchema,
  providerConsentMessageSchema,
  modelRegisterMessageSchema,
  settingsSaveMessageSchema,
  syncConnectMessageSchema,
  syncDisconnectMessageSchema,
  syncNowMessageSchema,
  syncScheduleMessageSchema,
  syncResolveMessageSchema,
  syncRecoveryRestoreMessageSchema,
  syncRemoteDeleteMessageSchema
])

export type SettingsRequestMessage = z.infer<
  typeof settingsRequestMessageSchema
>

export type SettingsCredentialMetadata = {
  reference: string
  mode: 'session-only' | 'passphrase-wrapped' | 'external-vault'
  binding: {
    providerConfigId: string
    endpointOrigin: string
  }
  externalReference?: string
  proxyCredentialMode?: 'none' | 'session-only' | 'passphrase-wrapped'
  locked: boolean
}

export type SettingsRuntimeSnapshot = {
  state: 'ready'
  settings: Extract<SettingsLoadResult, { state: 'ready' }>
  providers: {
    providers: ProviderDescriptor[]
    models: ModelDescriptor[]
    credentials: SettingsCredentialMetadata[]
    consents: ConsentReceipt[]
  }
  templates: ProviderTemplate[]
  sync: SyncConnection
  syncConflict: SyncConflictView | null
  syncRecoveries: SyncRecoveryView[]
}

export type SyncConflictView = {
  id: string
  createdAt: string
  conflicts: Array<{
    entityType: string
    entityId: string
    reason: string
    local: unknown
    remote: unknown
  }>
  resolutions: SyncConflictResolution[]
}

export type SyncRecoveryView = {
  id: string
  operationId: string
  createdAt: string
  revision: number
  diff: {
    added: number
    changed: number
    removed: number
    unchanged: number
  } | null
}

export type SettingsRuntimeResponse =
  | { kind: 'snapshot'; value: SettingsRuntimeSnapshot }
  | { kind: 'provider'; value: ProviderDescriptor }
  | { kind: 'provider-removal-preview'; value: ProviderRemovalImpact }
  | { kind: 'provider-catalog'; value: ModelDescriptor[] }
  | {
      kind: 'provider-removed'
      value: { provider: ProviderDescriptor; removedModels: ModelDescriptor[] }
    }
  | { kind: 'model'; value: ModelDescriptor }
  | { kind: 'consent'; value: ConsentReceipt }
  | {
      kind: 'connection-test'
      value: {
        provider: ProviderDescriptor
        result: NonNullable<ProviderDescriptor['lastConnectionTest']> & {
          providerStatus: ProviderDescriptor['status']
        }
      }
    }
  | {
      kind: 'settings-save'
      value: OperationResponse<SaveSettingsResult>
      activation: PlatformActivationResult[]
    }
  | {
      kind: 'sync-connect'
      value:
        | { state: 'connected'; connection: SyncConnection }
        | { state: 'disconnected'; connection: SyncConnection }
        | {
            state: 'degraded' | 'conflict'
            code: string
            connection: SyncConnection
          }
    }
  | { kind: 'sync-disconnected'; value: SyncConnection }
  | { kind: 'sync-schedule'; value: SyncConnection }
  | {
      kind: 'sync-run'
      value: SyncRunResult | { state: 'disconnected' }
    }
  | {
      kind: 'sync-resolution'
      value: Awaited<
        ReturnType<
          import('@/sync/service').UserOwnedSyncService['resolveConflict']
        >
      >
    }
  | {
      kind: 'sync-recovery-restored'
      value:
        | { state: 'restored'; revision: number; automaticPush: false }
        | { state: 'invalid' | 'snapshot-unavailable' | 'unavailable' }
    }
  | {
      kind: 'sync-remote-deleted'
      value: Awaited<
        ReturnType<
          import('@/sync/service').UserOwnedSyncService['deleteRemote']
        >
      >
    }
  | {
      kind: 'unavailable'
      code: 'profile-not-found' | 'provider-state-unreadable'
    }
