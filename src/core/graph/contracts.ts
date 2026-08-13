import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema
} from '@/core/content/contracts'

export const GRAPH_SCHEMA_VERSION = 1
export const MAX_GRAPH_CONTENT_NODES = 10_000
export const MAX_GRAPH_OTHER_NODES = 5_000
export const MAX_GRAPH_EDGES = 100_000
export const MAX_GRAPH_QUERY_DEPTH = 3
export const MAX_GRAPH_QUERY_FAN_OUT = 100
export const MAX_GRAPH_QUERY_EDGES = 1_000

export const graphNodeKindSchema = z.enum([
  'content',
  'source',
  'topic',
  'archetype'
])

export const graphNodeSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  kind: graphNodeKindSchema,
  namespace: nonEmptyStringSchema.max(128),
  stable: z.boolean(),
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  observedAt: isoTimestampSchema,
  validUntil: isoTimestampSchema
})

export const graphEdgeTypeSchema = z.enum([
  'published-by',
  'about',
  'exact-duplicate',
  'near-duplicate',
  'similar-to',
  'candidate-derived-from',
  'candidate-primary-source'
])

export const graphEdgeSchema = z
  .strictObject({
    id: nonEmptyStringSchema.max(512),
    from: nonEmptyStringSchema.max(512),
    to: nonEmptyStringSchema.max(512),
    type: graphEdgeTypeSchema,
    evidenceKind: z.enum(['observed', 'inferred']),
    evidenceCodes: z.array(nonEmptyStringSchema.max(128)).min(1).max(32),
    confidence: z.number().finite().min(0).max(1),
    generatorVersion: nonEmptyStringSchema.max(128),
    advisoryOnly: z.boolean(),
    createdAt: isoTimestampSchema,
    validUntil: isoTimestampSchema
  })
  .superRefine((edge, context) => {
    if (edge.from === edge.to) {
      context.addIssue({
        code: 'custom',
        message: 'Graph edges cannot reference the same node twice',
        path: ['to']
      })
    }
    if (edge.confidence < 0.9 && !edge.advisoryOnly) {
      context.addIssue({
        code: 'custom',
        message: 'Low-confidence graph edges must remain advisory',
        path: ['advisoryOnly']
      })
    }
    if (
      edge.type === 'candidate-derived-from' &&
      edge.evidenceCodes.every(code => code === 'embedding-similarity')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Derived-from candidates require non-embedding evidence',
        path: ['evidenceCodes']
      })
    }
  })

export const graphManifestSchema = z.strictObject({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  generation: z.int().nonnegative(),
  state: z.enum(['ready', 'rebuilding', 'degraded', 'disabled']),
  evidenceVersion: nonEmptyStringSchema.max(128),
  representationVersionSpace: nonEmptyStringSchema.max(512).nullable(),
  nodeCount: z
    .int()
    .nonnegative()
    .max(MAX_GRAPH_CONTENT_NODES + MAX_GRAPH_OTHER_NODES),
  edgeCount: z.int().nonnegative().max(MAX_GRAPH_EDGES),
  updatedAt: isoTimestampSchema,
  lastErrorCode: nonEmptyStringSchema.max(128).nullable()
})

export const graphRebuildCheckpointSchema = z.strictObject({
  id: nonEmptyStringSchema.max(512),
  generation: z.int().nonnegative(),
  evidenceVersion: nonEmptyStringSchema.max(128),
  representationVersionSpace: nonEmptyStringSchema.max(512).nullable(),
  cursor: z.int().nonnegative(),
  processedCount: z.int().nonnegative().max(MAX_GRAPH_EDGES),
  state: z.enum(['pending', 'running', 'cancelled', 'completed', 'failed']),
  updatedAt: isoTimestampSchema
})

export type GraphNode = z.infer<typeof graphNodeSchema>
export type GraphEdge = z.infer<typeof graphEdgeSchema>
export type GraphManifest = z.infer<typeof graphManifestSchema>
export type GraphRebuildCheckpoint = z.infer<
  typeof graphRebuildCheckpointSchema
>
