import { describe, expect, it } from 'vitest'

import {
  disconnectedSyncConnection,
  syncConnectionSchema
} from '@/sync/connection'

describe('sync connection contract', () => {
  it('starts disconnected with no remote configuration', () => {
    expect(disconnectedSyncConnection()).toMatchObject({
      configured: false,
      enabled: false,
      runtimeState: 'disconnected',
      providerConfigId: null
    })
  })

  it('enforces a five-minute minimum and a path without query secrets', () => {
    const base = {
      ...disconnectedSyncConnection(),
      configured: true,
      enabled: true,
      runtimeState: 'idle' as const,
      providerConfigId: 'provider:sync',
      endpointPath: '/contentlens/profile.json',
      remoteObjectId: 'profile.json',
      retention: 'User controlled',
      revocation: 'Delete the provider token',
      consentedAt: '2026-07-31T12:00:00.000Z'
    }
    expect(syncConnectionSchema.safeParse(base).success).toBe(true)
    expect(
      syncConnectionSchema.safeParse({ ...base, scheduleMinutes: 4 }).success
    ).toBe(false)
    expect(
      syncConnectionSchema.safeParse({
        ...base,
        endpointPath: '/profile.json?token=secret'
      }).success
    ).toBe(false)
  })
})
