import { z } from 'zod'

import {
  contentSimilarityRelationSchema,
  MAX_SIMILARITY_BYTES,
  MAX_SIMILARITY_ITEMS,
  relationSuppressionSchema,
  similarityBatchActionSchema,
  similarityClusterSchema,
  similarityRebuildCheckpointSchema,
  similarityRuntimeStateSchema,
  similarityVectorRecordSchema
} from '@/core/similarity/contracts'

export const SIMILARITY_STORE_NAMES = {
  vectors: 'similarityVectors',
  relations: 'similarityRelations',
  suppressions: 'similaritySuppressions',
  clusters: 'similarityClusters',
  batchActions: 'similarityBatchActions',
  runtime: 'similarityRuntime',
  checkpoints: 'similarityCheckpoints'
} as const

export const ACTIVE_SIMILARITY_RUNTIME_ID = 'active'

export const similarityDerivedStateSchema = z
  .strictObject({
    vectors: z.array(similarityVectorRecordSchema).max(MAX_SIMILARITY_ITEMS),
    relations: z
      .array(contentSimilarityRelationSchema)
      .max(MAX_SIMILARITY_ITEMS),
    suppressions: z.array(relationSuppressionSchema).max(MAX_SIMILARITY_ITEMS),
    clusters: z.array(similarityClusterSchema).max(MAX_SIMILARITY_ITEMS),
    batchActions: z
      .array(similarityBatchActionSchema)
      .max(MAX_SIMILARITY_ITEMS),
    runtime: similarityRuntimeStateSchema,
    checkpoint: similarityRebuildCheckpointSchema.nullable()
  })
  .superRefine((state, context) => {
    const byteLength = state.vectors.reduce(
      (total, vector) => total + vector.byteLength,
      0
    )
    if (byteLength > MAX_SIMILARITY_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Similarity vectors exceed the local byte budget',
        path: ['vectors']
      })
    }
    if (
      state.runtime.itemCount !== state.vectors.length ||
      state.runtime.byteLength !== byteLength
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Similarity runtime counts do not match the stored vectors',
        path: ['runtime']
      })
    }
    if (
      state.checkpoint &&
      state.runtime.activeVersionSpace !==
        state.checkpoint.representationVersionSpace
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Similarity checkpoint uses another representation space',
        path: ['checkpoint']
      })
    }
  })

export type SimilarityDerivedState = z.infer<
  typeof similarityDerivedStateSchema
>

export type StoredSimilarityRuntime = SimilarityDerivedState['runtime'] & {
  id: typeof ACTIVE_SIMILARITY_RUNTIME_ID
}
