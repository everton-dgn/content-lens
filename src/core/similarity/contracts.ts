import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema,
  surfaceSchema
} from '@/core/content/contracts'

export const SIMILARITY_SCHEMA_VERSION = 1
export const MAX_SIMILARITY_ITEMS = 10_000
export const MAX_SIMILARITY_RETENTION_DAYS = 30
export const MAX_SIMILARITY_BYTES = 100 * 1024 * 1024
export const MAX_SIMILARITY_CANDIDATES = 100
export const MAX_EMBEDDING_DIMENSIONS = 8_192

export const similarityRelationTypeSchema = z.enum([
  'exact-duplicate',
  'near-duplicate',
  'semantically-similar',
  'story-update',
  'related-distinct'
])

export const similarityEvidenceCodeSchema = z.enum([
  'stable-platform-id',
  'canonical-url',
  'exact-content-fingerprint',
  'text-vector',
  'visual-vector',
  'structural-overlap',
  'published-time-delta',
  'material-fact-delta',
  'source-link',
  'protected-exception'
])

export const representationManifestSchema = z.strictObject({
  modelProviderId: nonEmptyStringSchema.max(256),
  modelId: nonEmptyStringSchema.max(256),
  modality: z.enum(['text', 'visual', 'multimodal']),
  dimension: z.int().positive().max(MAX_EMBEDDING_DIMENSIONS),
  preprocessingVersion: nonEmptyStringSchema.max(128),
  normalization: z.enum(['l2', 'none']),
  versionSpace: nonEmptyStringSchema.max(512)
})

export const similarityVectorRecordSchema = z
  .strictObject({
    id: nonEmptyStringSchema.max(512),
    contentId: nonEmptyStringSchema.max(512),
    platform: platformSchema,
    surface: surfaceSchema,
    language: nonEmptyStringSchema.max(64).nullable(),
    stableIdentity: z.boolean(),
    exactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    manifest: representationManifestSchema,
    vector: z.array(z.number().finite().min(-1).max(1)),
    observedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    byteLength: z.int().nonnegative().max(MAX_SIMILARITY_BYTES)
  })
  .superRefine((record, context) => {
    if (record.vector.length !== record.manifest.dimension) {
      context.addIssue({
        code: 'custom',
        message: 'Vector dimension does not match its version-space manifest',
        path: ['vector']
      })
    }
  })

export const contentSimilarityRelationSchema = z
  .strictObject({
    relationId: nonEmptyStringSchema.max(512),
    leftContentId: nonEmptyStringSchema.max(512),
    rightContentId: nonEmptyStringSchema.max(512),
    type: similarityRelationTypeSchema,
    score: z.number().finite().min(0).max(1),
    confidence: z.number().finite().min(0).max(1),
    threshold: z.number().finite().min(0).max(1),
    evidenceCodes: z.array(similarityEvidenceCodeSchema).min(1).max(32),
    evidenceVersion: nonEmptyStringSchema.max(128),
    representation: representationManifestSchema.optional(),
    relationPolicyVersion: nonEmptyStringSchema.max(128),
    advisoryOnly: z.boolean(),
    createdAt: isoTimestampSchema,
    validUntil: isoTimestampSchema
  })
  .superRefine((relation, context) => {
    if (relation.leftContentId === relation.rightContentId) {
      context.addIssue({
        code: 'custom',
        message: 'A relation requires two distinct content IDs',
        path: ['rightContentId']
      })
    }
    if (Date.parse(relation.validUntil) <= Date.parse(relation.createdAt)) {
      context.addIssue({
        code: 'custom',
        message: 'A relation must expire after it is created',
        path: ['validUntil']
      })
    }
    const probabilistic = [
      'near-duplicate',
      'semantically-similar',
      'story-update',
      'related-distinct'
    ].includes(relation.type)
    if (probabilistic && !relation.representation) {
      context.addIssue({
        code: 'custom',
        message: 'Probabilistic relations require a representation manifest',
        path: ['representation']
      })
    }
    if (relation.type === 'exact-duplicate' && relation.representation) {
      context.addIssue({
        code: 'custom',
        message: 'Exact duplicate relations cannot depend on embeddings',
        path: ['representation']
      })
    }
    if (relation.confidence < 0.9 && !relation.advisoryOnly) {
      context.addIssue({
        code: 'custom',
        message: 'Low-confidence relations must remain advisory',
        path: ['advisoryOnly']
      })
    }
  })

export const relationSuppressionSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  relationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceVersion: nonEmptyStringSchema.max(128),
  reason: z.enum(['false-grouping', 'distinct-update', 'protected-content']),
  createdAt: isoTimestampSchema
})

export const similarityClusterMemberSchema = z.strictObject({
  contentId: nonEmptyStringSchema.max(512),
  platform: platformSchema,
  stableIdentity: z.boolean(),
  sponsored: z.boolean(),
  sourceEvidence: z.boolean(),
  publishedAt: isoTimestampSchema.nullable(),
  portableOrderId: nonEmptyStringSchema.max(512),
  relationType: similarityRelationTypeSchema,
  protected: z.boolean(),
  update: z.boolean()
})

export const similarityClusterSchema = z
  .strictObject({
    clusterId: nonEmptyStringSchema.max(512),
    representativeContentId: nonEmptyStringSchema.max(512),
    members: z.array(similarityClusterMemberSchema).min(1).max(10_000),
    evidenceVersion: nonEmptyStringSchema.max(128),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema
  })
  .superRefine((cluster, context) => {
    if (!cluster.members.some(member => member.stableIdentity)) {
      context.addIssue({
        code: 'custom',
        message: 'A durable cluster requires a stable content identity',
        path: ['members']
      })
    }
    if (
      !cluster.members.some(
        member => member.contentId === cluster.representativeContentId
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Cluster representative must be a cluster member',
        path: ['representativeContentId']
      })
    }
  })

export const similarityRuntimeStateSchema = z.strictObject({
  schemaVersion: z.literal(SIMILARITY_SCHEMA_VERSION),
  state: z.enum(['disabled', 'exact-only', 'ready', 'rebuilding', 'degraded']),
  activeVersionSpace: nonEmptyStringSchema.max(512).nullable(),
  itemCount: z.int().nonnegative().max(MAX_SIMILARITY_ITEMS),
  byteLength: z.int().nonnegative().max(MAX_SIMILARITY_BYTES),
  lastErrorCode: nonEmptyStringSchema.max(128).nullable(),
  updatedAt: isoTimestampSchema
})

export const similarityBatchActionSchema = z
  .strictObject({
    id: nonEmptyStringSchema.max(512),
    clusterId: nonEmptyStringSchema.max(512),
    action: z.literal('hide'),
    contentIds: z.array(nonEmptyStringSchema.max(512)).min(1).max(10_000),
    preservedContentIds: z
      .array(nonEmptyStringSchema.max(512))
      .min(1)
      .max(10_000),
    policyVersion: nonEmptyStringSchema.max(128),
    acceptedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema
  })
  .superRefine((action, context) => {
    const preserved = new Set(action.preservedContentIds)
    if (action.contentIds.some(contentId => preserved.has(contentId))) {
      context.addIssue({
        code: 'custom',
        message: 'A batch action cannot hide a preserved item',
        path: ['contentIds']
      })
    }
    if (Date.parse(action.expiresAt) <= Date.parse(action.acceptedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'A batch action must expire after acceptance',
        path: ['expiresAt']
      })
    }
  })

export const similarityRebuildCheckpointSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  generation: z.int().nonnegative(),
  evidenceVersion: nonEmptyStringSchema.max(128),
  representationVersionSpace: nonEmptyStringSchema.max(512),
  cursor: z.int().nonnegative().max(MAX_SIMILARITY_ITEMS),
  processedCount: z.int().nonnegative().max(MAX_SIMILARITY_ITEMS),
  state: z.enum(['pending', 'running', 'cancelled', 'completed', 'failed']),
  updatedAt: isoTimestampSchema
})

export type SimilarityRelationType = z.infer<
  typeof similarityRelationTypeSchema
>
export type RepresentationManifest = z.infer<
  typeof representationManifestSchema
>
export type SimilarityVectorRecord = z.infer<
  typeof similarityVectorRecordSchema
>
export type ContentSimilarityRelation = z.infer<
  typeof contentSimilarityRelationSchema
>
export type RelationSuppression = z.infer<typeof relationSuppressionSchema>
export type SimilarityClusterMember = z.infer<
  typeof similarityClusterMemberSchema
>
export type SimilarityCluster = z.infer<typeof similarityClusterSchema>
export type SimilarityRuntimeState = z.infer<
  typeof similarityRuntimeStateSchema
>
export type SimilarityBatchAction = z.infer<typeof similarityBatchActionSchema>
export type SimilarityRebuildCheckpoint = z.infer<
  typeof similarityRebuildCheckpointSchema
>
