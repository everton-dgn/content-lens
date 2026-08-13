import {
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphManifest,
  type GraphNode,
  graphEdgeSchema,
  graphManifestSchema,
  graphNodeSchema,
  MAX_GRAPH_CONTENT_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_OTHER_NODES
} from '@/core/graph/contracts'

const provenanceEdges = new Set([
  'candidate-derived-from',
  'candidate-primary-source'
])

export class LocalContentGraph {
  readonly #nodes = new Map<string, GraphNode>()
  readonly #edges = new Map<string, GraphEdge>()
  readonly #suppressed = new Set<string>()
  #manifest: GraphManifest
  #conflicts = 0

  constructor(input: {
    evidenceVersion: string
    representationVersionSpace: string | null
    at: string
  }) {
    this.#manifest = graphManifestSchema.parse({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      generation: 0,
      state: 'ready',
      evidenceVersion: input.evidenceVersion,
      representationVersionSpace: input.representationVersionSpace,
      nodeCount: 0,
      edgeCount: 0,
      updatedAt: input.at,
      lastErrorCode: null
    })
  }

  upsertNodes(inputs: readonly unknown[], at: string) {
    if (this.#manifest.state !== 'ready') {
      return { state: 'unavailable' as const }
    }
    const parsed = inputs.map(input => graphNodeSchema.safeParse(input))
    if (parsed.some(result => !result.success)) {
      return { state: 'invalid' as const }
    }
    const next = new Map(this.#nodes)
    for (const result of parsed) {
      if (result.success) {
        next.set(result.data.id, result.data)
      }
    }
    const contentCount = [...next.values()].filter(
      node => node.kind === 'content'
    ).length
    if (
      contentCount > MAX_GRAPH_CONTENT_NODES ||
      next.size - contentCount > MAX_GRAPH_OTHER_NODES
    ) {
      return { state: 'limit-exceeded' as const }
    }
    this.#nodes.clear()
    for (const [id, node] of next) {
      this.#nodes.set(id, node)
    }
    this.#updateManifest(at)
    return { state: 'stored' as const, count: parsed.length }
  }

  upsertEdge(input: unknown, at: string) {
    if (this.#manifest.state !== 'ready') {
      return { state: 'unavailable' as const }
    }
    const parsed = graphEdgeSchema.safeParse(input)
    if (!parsed.success) {
      return { state: 'invalid' as const }
    }
    if (
      !this.#nodes.has(parsed.data.from) ||
      !this.#nodes.has(parsed.data.to)
    ) {
      return { state: 'missing-node' as const }
    }
    if (
      !this.#edges.has(parsed.data.id) &&
      this.#edges.size >= MAX_GRAPH_EDGES
    ) {
      return { state: 'limit-exceeded' as const }
    }
    if (
      provenanceEdges.has(parsed.data.type) &&
      this.#hasPath(parsed.data.to, parsed.data.from)
    ) {
      this.#conflicts += 1
      return { state: 'conflict' as const, code: 'provenance-cycle' as const }
    }
    this.#edges.set(parsed.data.id, parsed.data)
    this.#updateManifest(at)
    return { state: 'stored' as const }
  }

  suppressEdge(edgeId: string, generatorVersion: string) {
    const edge = this.#edges.get(edgeId)
    if (!edge || edge.generatorVersion !== generatorVersion) {
      return { state: 'missing' as const }
    }
    this.#suppressed.add(`${edgeId}\u0000${generatorVersion}`)
    return { state: 'suppressed' as const }
  }

  activeNodes() {
    return [...this.#nodes.values()].map(node => structuredClone(node))
  }

  activeEdges(now: string) {
    if (this.#manifest.state !== 'ready') {
      return []
    }
    return [...this.#edges.values()]
      .filter(
        edge =>
          Date.parse(edge.validUntil) > Date.parse(now) &&
          !this.#suppressed.has(`${edge.id}\u0000${edge.generatorVersion}`)
      )
      .map(edge => structuredClone(edge))
  }

  markRebuilding(code: string, at: string) {
    this.#manifest = graphManifestSchema.parse({
      ...this.#manifest,
      state: 'rebuilding',
      updatedAt: at,
      lastErrorCode: code
    })
  }

  replaceGeneration(input: {
    graph: LocalContentGraph
    generation: number
    at: string
  }) {
    if (input.graph.#manifest.state !== 'ready') {
      return { state: 'invalid' as const }
    }
    this.#nodes.clear()
    this.#edges.clear()
    for (const node of input.graph.#nodes.values()) {
      this.#nodes.set(node.id, structuredClone(node))
    }
    for (const edge of input.graph.#edges.values()) {
      this.#edges.set(edge.id, structuredClone(edge))
    }
    this.#suppressed.clear()
    this.#manifest = graphManifestSchema.parse({
      ...input.graph.#manifest,
      generation: input.generation,
      updatedAt: input.at
    })
    return { state: 'replaced' as const }
  }

  disable(at: string) {
    this.#nodes.clear()
    this.#edges.clear()
    this.#suppressed.clear()
    this.#manifest = graphManifestSchema.parse({
      ...this.#manifest,
      state: 'disabled',
      nodeCount: 0,
      edgeCount: 0,
      updatedAt: at,
      lastErrorCode: null
    })
  }

  snapshot() {
    return {
      manifest: structuredClone(this.#manifest),
      conflicts: this.#conflicts,
      suppressions: this.#suppressed.size
    }
  }

  #hasPath(from: string, to: string) {
    const pending = [from]
    const visited = new Set<string>()
    while (pending.length > 0 && visited.size <= MAX_GRAPH_EDGES) {
      const current = pending.shift()
      if (!current || visited.has(current)) {
        continue
      }
      if (current === to) {
        return true
      }
      visited.add(current)
      for (const edge of this.#edges.values()) {
        if (provenanceEdges.has(edge.type) && edge.from === current) {
          pending.push(edge.to)
        }
      }
    }
    return false
  }

  #updateManifest(at: string) {
    this.#manifest = graphManifestSchema.parse({
      ...this.#manifest,
      nodeCount: this.#nodes.size,
      edgeCount: this.#edges.size,
      updatedAt: at,
      lastErrorCode: null
    })
  }
}
