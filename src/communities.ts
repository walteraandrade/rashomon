// Pure graph metrics (Louvain, betweenness, Jaccard neighbours): no SQL, no DB import. Callers: aggregate.ts, graph.ts.
import { UndirectedGraph as UndirectedGraphImport } from 'graphology'
import louvainImport from 'graphology-communities-louvain'
import betweennessCentralityImport from 'graphology-metrics/centrality/betweenness.js'

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
type BetweennessFn = (graph: GraphInstance, options?: { getEdgeWeight?: string | null }) => Record<string, number>
const betweennessCentrality = betweennessCentralityImport as unknown as BetweennessFn

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

// Raw, unnormalised; graph.ts normalises against its own response's max.
export const betweenness = (edges: readonly CommunityEdge[]): Map<string, number> => {
  const g = new GraphCtor()
  for (const { a, b, count } of edges) {
    g.mergeNode(a)
    g.mergeNode(b)
    if (a !== b) g.mergeEdge(a, b, { weight: count })
  }
  if (g.order === 0) return new Map()
  const raw = betweennessCentrality(g, { getEdgeWeight: null })
  return new Map(Object.entries(raw))
}

export type OutletPair = { domain: string; neighbor: string; similarity: number }

// Jaccard over each domain's term-id set; zero-similarity pairs are dropped, not stored as zero.
// A domain with no surviving pair gets no entry -- the caller adds its own self-loop.
// `edges` holds every non-zero pair once, undirected; topK caps only `pairs`, never the graph Louvain sees.
export const neighbors = (sets: ReadonlyMap<string, ReadonlySet<string>>, topK: number): { pairs: OutletPair[]; edges: CommunityEdge[] } => {
  const domains = [...sets.keys()]
  const byDomain = new Map<string, OutletPair[]>(domains.map((d) => [d, []]))
  const edges: CommunityEdge[] = []
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i]
      const b = domains[j]
      const setA = sets.get(a)!
      const setB = sets.get(b)!
      let intersection = 0
      for (const id of setA) if (setB.has(id)) intersection++
      const union = setA.size + setB.size - intersection
      const similarity = union === 0 ? 0 : intersection / union
      if (similarity <= 0) continue
      edges.push({ a, b, count: similarity })
      byDomain.get(a)!.push({ domain: a, neighbor: b, similarity })
      byDomain.get(b)!.push({ domain: b, neighbor: a, similarity })
    }
  }
  const byName = (x: OutletPair, y: OutletPair) => (x.neighbor < y.neighbor ? -1 : x.neighbor > y.neighbor ? 1 : 0)
  const pairs = domains.flatMap((d) =>
    byDomain
      .get(d)!
      .sort((x, y) => y.similarity - x.similarity || byName(x, y))
      .slice(0, topK),
  )
  return { pairs, edges }
}
