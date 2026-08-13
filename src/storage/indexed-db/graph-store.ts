import { z } from 'zod'

import {
  graphEdgeSchema,
  graphManifestSchema,
  graphNodeSchema,
  graphRebuildCheckpointSchema,
  MAX_GRAPH_CONTENT_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_OTHER_NODES
} from '@/core/graph/contracts'

export const GRAPH_STORE_NAMES = {
  nodes: 'graphNodes',
  edges: 'graphEdges',
  runtime: 'graphRuntime',
  checkpoints: 'graphCheckpoints'
} as const

export const ACTIVE_GRAPH_RUNTIME_ID = 'active'

export const graphDerivedStateSchema = z
  .strictObject({
    nodes: z
      .array(graphNodeSchema)
      .max(MAX_GRAPH_CONTENT_NODES + MAX_GRAPH_OTHER_NODES),
    edges: z.array(graphEdgeSchema).max(MAX_GRAPH_EDGES),
    manifest: graphManifestSchema,
    checkpoint: graphRebuildCheckpointSchema.nullable()
  })
  .superRefine((state, context) => {
    const contentNodes = state.nodes.filter(
      node => node.kind === 'content'
    ).length
    if (
      contentNodes > MAX_GRAPH_CONTENT_NODES ||
      state.nodes.length - contentNodes > MAX_GRAPH_OTHER_NODES
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Graph node classes exceed their local limits',
        path: ['nodes']
      })
    }
    if (
      state.manifest.nodeCount !== state.nodes.length ||
      state.manifest.edgeCount !== state.edges.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Graph manifest counts do not match the stored generation',
        path: ['manifest']
      })
    }
    const nodeIds = new Set(state.nodes.map(node => node.id))
    if (
      state.edges.some(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Graph edges must reference stored nodes',
        path: ['edges']
      })
    }
    if (
      state.checkpoint &&
      (state.checkpoint.evidenceVersion !== state.manifest.evidenceVersion ||
        state.checkpoint.representationVersionSpace !==
          state.manifest.representationVersionSpace)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Graph checkpoint does not match the active manifest',
        path: ['checkpoint']
      })
    }
  })

export type GraphDerivedState = z.infer<typeof graphDerivedStateSchema>

export type StoredGraphRuntime = GraphDerivedState['manifest'] & {
  id: typeof ACTIVE_GRAPH_RUNTIME_ID
}
