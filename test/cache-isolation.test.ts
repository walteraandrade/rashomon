import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// The adversarial half of issue #42: a cache that hands one person's graph to another is the
// worst failure this feature can ship. This file enumerates every (person x filter x route)
// combination, computes the truth straight from the functions the routes call, and then checks
// two things that together leave a key bug nowhere to hide: two reads may share a cache entry
// only if they are the same read, and every response equals its own truth under sequential,
// interleaved, concurrent and evicting traffic.
// CACHE_MAX_ENTRIES is read at import time in src/cache.ts, hence the dynamic imports.
process.env.PERF = '1'
process.env.PERF_LOG = '0'
process.env.CACHE_MAX_ENTRIES = '200'

const { reads, resetCaches } = await import('../src/cache.js')
const { docsFor, graphFor, sourcesFor, timelineFor } = await import('../src/graph.js')
const { cacheKey, parseDocsQuery, parseQuery, parseTimelineQuery } = await import('../src/query.js')
const { app } = await import('../src/server.js')
const { persons, seed } = await import('./fixture.js')

type Person = (typeof persons)[number]
type Query = Record<string, string>

// timelineFor derives its bucket edges from now(), so two calls milliseconds apart differ in
// bucket_start and only in bucket_start. Comparing the counts is what carries the meaning here:
// whose docs, in which window, in which order. Every other route is compared byte for byte.
const identity = (body: unknown) => body
const counts = (body: unknown) => (body as { count: number }[]).map((r) => r.count)

const ROUTES = [
  { path: 'graph', parse: parseQuery, run: graphFor, stable: identity },
  { path: 'sources', parse: parseQuery, run: sourcesFor, stable: identity },
  { path: 'docs', parse: parseDocsQuery, run: docsFor, stable: identity },
  { path: 'timeline', parse: parseTimelineQuery, run: timelineFor, stable: counts },
] as const

// Every entry differs from the first in exactly one parameter, so a key that forgets any single
// parameter makes two rows with different answers collide. The ones that differ only in a
// parameter a given parser drops (bucket, offset, term for graph/sources) are expected to
// collapse onto one entry for that route, which is the other half of the check.
const BASE: Query = { days: '365' }
const FILTERS: Query[] = [
  BASE,
  { ...BASE, days: '30' },
  { ...BASE, days: '1000' },
  { ...BASE, source: 'rss' },
  { ...BASE, domain: 'g1.globo.com' },
  { ...BASE, lean: 'left' },
  { ...BASE, kind: 'word' },
  { ...BASE, limit: '1' },
  { ...BASE, min: '1' },
  { ...BASE, sort: 'pmi' },
  { ...BASE, offset: '1' },
  { ...BASE, bucket: 'day' },
  { ...BASE, term: 'reforma' },
  // sort and kind only change the fixture's graph once min=1 lets the long tail and the single
  // hashtag through, so they get their own pair rather than a lone variant of BASE.
  { ...BASE, min: '1', sort: 'pmi' },
  { ...BASE, min: '1', kind: 'word' },
]

type Case = { url: string; label: string; key: string; stable: (b: unknown) => unknown; truth: () => Promise<string> }

const cases: Case[] = persons.flatMap((person: Person) =>
  FILTERS.flatMap((q) =>
    ROUTES.map((route) => ({
      url: `/api/people/${person.id}/${route.path}?${new URLSearchParams(q)}`,
      label: `${person.id} ${route.path} ${new URLSearchParams(q)}`,
      key: cacheKey(route.path, person.id, route.parse(q)),
      stable: route.stable,
      truth: async () => JSON.stringify(route.stable(JSON.parse(JSON.stringify(await (route.run as (p: Person, q: object) => Promise<unknown>)(person, route.parse(q)))))),
    })),
  ),
)

const body = async (url: string) => {
  const res = await app.request(url)
  assert.equal(res.status, 200, url)
  return res.text()
}

const answer = async (c: Case) => JSON.stringify(c.stable(JSON.parse(await body(c.url))))

const truth = new Map<string, string>()
const keys = new Set(cases.map((c) => c.key))

describe('AC3 adversarial: nothing leaks across people, filters or routes', () => {
  before(async () => {
    await seed()
    for (const c of cases) truth.set(c.label, await c.truth())
    resetCaches()
  })

  it('covers every person, filter set and route', () => {
    assert.equal(cases.length, persons.length * FILTERS.length * ROUTES.length)
    assert.equal(new Set(cases.map((c) => c.url)).size, cases.length)
  })

  it('two reads share a cache entry only when they are the same read', () => {
    const byKey = new Map<string, Set<string>>()
    for (const c of cases) byKey.set(c.key, (byKey.get(c.key) ?? new Set()).add(truth.get(c.label)!))
    for (const [key, answers] of byKey) assert.equal(answers.size, 1, `key ${key} is shared by ${answers.size} different answers`)
    // The converse, so the key cannot pass the check above by being unique per request: the
    // filter sets that differ only in a parameter a parser drops must collapse onto one entry.
    assert.ok(keys.size < cases.length, 'graph and sources ignore bucket/offset and must share those entries')
  })

  it('creates exactly one cache entry per distinct key on the first pass, and only hits on the second', async () => {
    resetCaches()
    const start = reads.stats()
    for (const c of cases) assert.equal(await answer(c), truth.get(c.label), c.label)
    const first = reads.stats()
    assert.equal(first.misses - start.misses, keys.size)
    for (const c of cases) assert.equal(await answer(c), truth.get(c.label), c.label)
    const second = reads.stats()
    assert.equal(second.misses - first.misses, 0)
    assert.equal(second.hits - first.hits, cases.length)
  })

  it('answers every combination correctly, interleaved and reversed', async () => {
    resetCaches()
    // Reversed, then by a stride that walks people and routes out of phase, so a collision
    // cannot hide behind a convenient ordering.
    for (const order of [[...cases].reverse(), cases.map((_, i) => cases[(i * 7) % cases.length])])
      for (const c of order) assert.equal(await answer(c), truth.get(c.label), c.label)
  })

  it('answers every combination correctly when they are all in flight at once', async () => {
    resetCaches()
    const results = await Promise.all(cases.map(async (c) => [c.label, await answer(c)] as const))
    for (const [label, got] of results) assert.equal(got, truth.get(label), label)
  })

  it('answers every combination correctly when each one is requested concurrently with itself', async () => {
    resetCaches()
    for (const c of cases) {
      const copies = await Promise.all([answer(c), answer(c), answer(c)])
      for (const got of copies) assert.equal(got, truth.get(c.label), c.label)
    }
  })

  it('still answers correctly after eviction has thrown every entry away', async () => {
    resetCaches()
    for (const c of cases) await answer(c)
    const before = reads.stats().evictions
    for (let days = 1; days <= 260; days++) await body(`/api/people/lula/graph?days=${days}&min=1`)
    assert.ok(reads.stats().evictions > before, 'the run must actually have evicted')
    assert.ok(reads.stats().entries <= 200)
    for (const c of cases) assert.equal(await answer(c), truth.get(c.label), `after eviction: ${c.label}`)
  })

  it('never serves one person the body of another, even for the identical filter', async () => {
    resetCaches()
    for (const q of FILTERS) {
      const seen = await Promise.all(
        persons.map(async (p: Person) => JSON.parse(await body(`/api/people/${p.id}/graph?${new URLSearchParams(q)}`)) as { person: { id: string } }),
      )
      assert.deepEqual(seen.map((b) => b.person.id), persons.map((p: Person) => p.id))
    }
  })

  it('never serves one route the body of another for the same person and filter', async () => {
    resetCaches()
    for (const person of persons) {
      const graph = JSON.parse(await body(`/api/people/${person.id}/graph?days=365`)) as Record<string, unknown>
      const sources = JSON.parse(await body(`/api/people/${person.id}/sources?days=365`)) as unknown
      const docs = JSON.parse(await body(`/api/people/${person.id}/docs?days=365`)) as Record<string, unknown>
      const timeline = JSON.parse(await body(`/api/people/${person.id}/timeline?days=365`)) as unknown
      assert.deepEqual(Object.keys(graph).sort(), ['links', 'nodes', 'outlets', 'person', 'signature', 'stats'])
      assert.ok(Array.isArray(sources))
      assert.ok(Array.isArray(timeline))
      assert.ok(!Array.isArray(docs) && 'docs' in docs && 'total' in docs)
    }
  })
})
