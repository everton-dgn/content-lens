import { z } from 'zod'

import {
  modelCapabilitySchema,
  modelPricingSchema,
  modelTaskSchema
} from '@/ai/models/contracts'
import { normalizeEndpointOrigin } from '@/ai/providers/contracts'
import { nonEmptyStringSchema, platformSchema } from '@/core/content/contracts'
import { ruleSchema } from '@/core/rules/contracts/rule'
import { portableJsonValueSchema } from '@/storage/contracts/profile-envelope'

export const SYNC_ENVELOPE_SCHEMA_VERSION = 1
export const MAX_SYNC_ENTITIES_PER_COLLECTION = 10_000
export const MAX_SYNC_TOMBSTONES = 50_000

export const portableProviderDescriptorSchema = z
  .strictObject({
    providerConfigId: nonEmptyStringSchema.max(256),
    displayName: nonEmptyStringSchema.max(256),
    kind: z.enum([
      'openai',
      'anthropic',
      'gemini',
      'ollama',
      'openai-compatible',
      'user-proxy',
      'custom',
      'browser-built-in'
    ]),
    execution: z.enum(['local', 'cloud', 'browser']),
    endpointOrigin: z.url(),
    policyUrl: z.url({ protocol: /^https$/ }).nullable()
  })
  .superRefine((provider, context) => {
    try {
      if (
        normalizeEndpointOrigin(provider.endpointOrigin, provider.execution) !==
        provider.endpointOrigin
      ) {
        throw new TypeError('Provider origin is not canonical')
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Portable provider endpoint origin is invalid',
        path: ['endpointOrigin']
      })
    }
  })

export const portableModelBindingSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  platform: platformSchema.nullable(),
  task: modelTaskSchema,
  providerConfigId: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256),
  active: z.boolean()
})

export const portableModelDescriptorSchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256),
  displayName: nonEmptyStringSchema.max(256),
  declaredVersion: nonEmptyStringSchema.max(128).nullable(),
  executionKind: z.enum(['local', 'browser', 'cloud']),
  catalogSource: z.enum(['provider', 'user', 'built-in']),
  pricing: modelPricingSchema.optional(),
  capabilities: z.array(modelCapabilitySchema).max(32)
})

const portableEntitySchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  value: portableJsonValueSchema
})

const forbiddenPortableFieldNames = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'credential',
  'password',
  'passphrase',
  'secret',
  'token',
  'vault'
])

function normalizedPortableFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function findSensitiveField(input: unknown) {
  if (input === null || typeof input !== 'object') {
    return undefined
  }
  const pending: Array<{ path: PropertyKey[]; value: object }> = [
    { path: [], value: input }
  ]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current.value)) {
      continue
    }
    visited.add(current.value)
    for (const [key, value] of Object.entries(current.value)) {
      const path = [...current.path, key]
      if (forbiddenPortableFieldNames.has(normalizedPortableFieldName(key))) {
        return path
      }
      if (value !== null && typeof value === 'object') {
        pending.push({ path, value })
      }
    }
  }
  return undefined
}

export const syncProfileSchema = z
  .strictObject({
    portableProviders: z
      .array(portableProviderDescriptorSchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    modelCatalog: z
      .array(portableModelDescriptorSchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    modelBindings: z
      .array(portableModelBindingSchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    rules: z.array(ruleSchema).max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    exclusions: z
      .array(portableEntitySchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    identities: z
      .array(portableEntitySchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION),
    platformPreferences: z
      .array(portableEntitySchema)
      .max(MAX_SYNC_ENTITIES_PER_COLLECTION)
  })
  .superRefine((profile, context) => {
    const sensitivePath = findSensitiveField(profile)
    if (sensitivePath) {
      context.addIssue({
        code: 'custom',
        message: 'Sensitive fields are forbidden in sync envelopes',
        path: sensitivePath
      })
    }
    const ids = {
      portableProviders: profile.portableProviders.map(
        ({ providerConfigId }) => providerConfigId
      ),
      modelCatalog: profile.modelCatalog.map(
        ({ modelId, providerConfigId }) => `${providerConfigId}\u0000${modelId}`
      ),
      modelBindings: profile.modelBindings.map(({ id }) => id),
      rules: profile.rules.map(({ id }) => id),
      exclusions: profile.exclusions.map(({ id }) => id),
      identities: profile.identities.map(({ id }) => id),
      platformPreferences: profile.platformPreferences.map(({ id }) => id)
    }
    for (const [collection, collectionIds] of Object.entries(ids)) {
      if (new Set(collectionIds).size !== collectionIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'Sync collection entity IDs must be unique',
          path: [collection]
        })
      }
    }
  })

export const syncEntityTypeSchema = z.enum([
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
])

export const tombstoneSchema = z.strictObject({
  entityType: syncEntityTypeSchema,
  entityId: nonEmptyStringSchema.max(512),
  deletedInGeneration: z.int().nonnegative(),
  baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  deletedAt: z.iso.datetime({ offset: true })
})

export const syncEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_ENVELOPE_SCHEMA_VERSION),
    syncProfileId: nonEmptyStringSchema.max(256),
    generation: z.int().nonnegative(),
    profile: syncProfileSchema,
    tombstones: z.array(tombstoneSchema).max(MAX_SYNC_TOMBSTONES),
    digest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .superRefine((envelope, context) => {
    const tombstoneKeys = envelope.tombstones.map(
      ({ entityId, entityType }) => `${entityType}\u0000${entityId}`
    )
    if (new Set(tombstoneKeys).size !== tombstoneKeys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Sync tombstones must be unique by entity type and ID',
        path: ['tombstones']
      })
    }
    for (const [index, tombstone] of envelope.tombstones.entries()) {
      if (tombstone.deletedInGeneration > envelope.generation) {
        context.addIssue({
          code: 'custom',
          message: 'Tombstone generation cannot be newer than the envelope',
          path: ['tombstones', index, 'deletedInGeneration']
        })
      }
    }
  })

export type PortableProviderDescriptor = z.infer<
  typeof portableProviderDescriptorSchema
>
export type PortableModelBinding = z.infer<typeof portableModelBindingSchema>
export type PortableModelDescriptor = z.infer<
  typeof portableModelDescriptorSchema
>
export type SyncProfile = z.infer<typeof syncProfileSchema>
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>
export type Tombstone = z.infer<typeof tombstoneSchema>
export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>

export const emptySyncProfile = (): SyncProfile => ({
  portableProviders: [],
  modelCatalog: [],
  modelBindings: [],
  rules: [],
  exclusions: [],
  identities: [],
  platformPreferences: []
})
