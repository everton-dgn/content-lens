import {
  type GraphEdge,
  type GraphNode,
  MAX_GRAPH_QUERY_DEPTH,
  MAX_GRAPH_QUERY_EDGES,
  MAX_GRAPH_QUERY_FAN_OUT
} from '@/core/graph/contracts'

export type GraphQueryResult = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  depthReached: number
}

export function queryContentGraph(input: {
  startNodeId: string
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  depth?: number
  fanOut?: number
  maximumEdges?: number
}): GraphQueryResult {
  const depth = Math.min(
    Math.max(0, input.depth ?? MAX_GRAPH_QUERY_DEPTH),
    MAX_GRAPH_QUERY_DEPTH
  )
  const fanOut = Math.min(
    Math.max(1, input.fanOut ?? MAX_GRAPH_QUERY_FAN_OUT),
    MAX_GRAPH_QUERY_FAN_OUT
  )
  const maximumEdges = Math.min(
    Math.max(1, input.maximumEdges ?? MAX_GRAPH_QUERY_EDGES),
    MAX_GRAPH_QUERY_EDGES
  )
  const nodes = new Map(input.nodes.map(node => [node.id, node]))
  if (!nodes.has(input.startNodeId)) {
    return { nodes: [], edges: [], truncated: false, depthReached: 0 }
  }
  const adjacency = new Map<string, GraphEdge[]>()
  for (const edge of input.edges) {
    const current = adjacency.get(edge.from) ?? []
    if (current.length < fanOut) {
      current.push(edge)
      adjacency.set(edge.from, current)
    }
  }
  const visitedNodes = new Set([input.startNodeId])
  const visitedEdges: GraphEdge[] = []
  let frontier = [input.startNodeId]
  let depthReached = 0
  let truncated = false
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const outgoing = adjacency.get(nodeId) ?? []
      for (const edge of outgoing) {
        if (visitedEdges.length >= maximumEdges) {
          truncated = true
          break
        }
        visitedEdges.push(edge)
        if (!visitedNodes.has(edge.to) && nodes.has(edge.to)) {
          visitedNodes.add(edge.to)
          next.push(edge.to)
        }
      }
      if (truncated) {
        break
      }
    }
    depthReached = level + 1
    frontier = next
    if (truncated) {
      break
    }
  }
  return {
    nodes: [...visitedNodes]
      .map(id => nodes.get(id))
      .filter((node): node is GraphNode => node !== undefined)
      .map(node => structuredClone(node)),
    edges: visitedEdges.map(edge => structuredClone(edge)),
    truncated,
    depthReached
  }
}
