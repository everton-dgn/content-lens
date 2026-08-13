import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'
import { SYNC_RUNTIME_STATES } from '@/sync/providers/contracts'

export const MIN_SYNC_INTERVAL_MINUTES = 5
export const MAX_SYNC_INTERVAL_MINUTES = 24 * 60

export const syncConnectionSchema = z
  .strictObject({
    id: z.literal('active-sync-connection'),
    configured: z.boolean(),
    enabled: z.boolean(),
    runtimeState: z.enum(SYNC_RUNTIME_STATES),
    providerConfigId: nonEmptyStringSchema.max(256).nullable(),
    endpointPath: z
      .string()
      .max(1_024)
      .regex(/^\/(?!\/)[^?#]*$/)
      .nullable(),
    remoteObjectId: nonEmptyStringSchema.max(256).nullable(),
    scheduleMinutes: z
      .int()
      .min(MIN_SYNC_INTERVAL_MINUTES)
      .max(MAX_SYNC_INTERVAL_MINUTES)
      .nullable(),
    retention: nonEmptyStringSchema.max(512).nullable(),
    revocation: nonEmptyStringSchema.max(512).nullable(),
    encryption: z.literal('none'),
    consentedAt: z.iso.datetime({ offset: true }).nullable(),
    connectedAt: z.iso.datetime({ offset: true }).nullable(),
    disconnectedAt: z.iso.datetime({ offset: true }).nullable(),
    lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
    lastConfirmedAt: z.iso.datetime({ offset: true }).nullable(),
    lastConfirmedDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    lastErrorCode: nonEmptyStringSchema.max(128).nullable()
  })
  .superRefine((connection, context) => {
    if (!connection.configured) {
      return
    }
    for (const field of [
      'providerConfigId',
      'endpointPath',
      'remoteObjectId',
      'retention',
      'revocation',
      'consentedAt'
    ] as const) {
      if (connection[field] === null) {
        context.addIssue({
          code: 'custom',
          message: 'Configured sync connection is incomplete',
          path: [field]
        })
      }
    }
    if (connection.enabled && connection.runtimeState === 'disconnected') {
      context.addIssue({
        code: 'custom',
        message: 'Enabled sync cannot be disconnected',
        path: ['runtimeState']
      })
    }
  })

export type SyncConnection = z.infer<typeof syncConnectionSchema>

export const disconnectedSyncConnection = (): SyncConnection => ({
  id: 'active-sync-connection',
  configured: false,
  enabled: false,
  runtimeState: 'disconnected',
  providerConfigId: null,
  endpointPath: null,
  remoteObjectId: null,
  scheduleMinutes: null,
  retention: null,
  revocation: null,
  encryption: 'none',
  consentedAt: null,
  connectedAt: null,
  disconnectedAt: null,
  lastAttemptAt: null,
  lastConfirmedAt: null,
  lastConfirmedDigest: null,
  lastErrorCode: null
})
