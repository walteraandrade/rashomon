// Pure Louvain partitioning: no SQL, no DB import. src/aggregate.ts is the only caller.
import { UndirectedGraph as UndirectedGraphImport } from 'graphology'
import louvainImport from 'graphology-communities-louvain'

export type CommunityEdge = { a: string; b: string; count: number }

// Casting past graphology's own (broken, self-referential under NodeNext + TS7) declarations
// rather than depending on them for the small surface used here.
type GraphInstance = {
  order: number
  mergeNode: (node: string) => void
  mergeEdge: (source: string, target: string, attrs: { weight: number }) => void
}
const GraphCtor = UndirectedGraphImport as unknown as new () => GraphInstance
type LouvainFn = (graph: GraphInstance, options: { getEdgeWeight: string; rng: () => number }) => Record<string, number>
const louvain = louvainImport as unknown as LouvainFn

// mulberry32: deterministic PRNG so the same edges + seed always yield the same partition.
const mulberry32 = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// a === b is how an isolated node enters the graph without a self-loop.
export const communities = (edges: readonly CommunityEdge[], seed: number): Map<string, number> => {
  const g = new GraphCtor()
  for (const { a, b, count } of edges) {
    g.mergeNode(a)
    g.mergeNode(b)
    if (a !== b) g.mergeEdge(a, b, { weight: count })
  }
  if (g.order === 0) return new Map()
  const assignment = louvain(g, { getEdgeWeight: 'weight', rng: mulberry32(seed) })
  return new Map(Object.entries(assignment))
}
