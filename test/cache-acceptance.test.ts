import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// PERF=1 must be set before src/perf.ts is loaded, and src/perf.ts reads it at import time,
// so every module below is imported dynamically after the assignment. That buys this file the
// x-perf-sql-count header, which is how "a warm request executes no SQL" is asserted directly
// instead of inferred. node:test gives each file its own process, so no other suite sees it.
process.env.PERF = '1'
process.env.PERF_LOG = '0'

const { people, reads, resetCaches } = await import('../src/cache.js')
const { docsFor, graphFor, sourcesFor } = await import('../src/graph.js')
const { cacheKey, parseDocsQuery, parseQuery } = await import('../src/query.js')
const { app } = await import('../src/server.js')
const { persons, seed } = await import('./fixture.js')

type Read = { status: number; sql: number; body: string; type: string | null }

const get = async (url: string): Promise<Read> => {
  const res = await app.request(url)
  return { status: res.status, sql: Number(res.headers.get('x-perf-sql-count') ?? -1), body: await res.text(), type: res.headers.get('content-type') }
}

// clear() drops entries, not counters: the counters are observability and survive a reset on
// purpose, so every assertion on them here is a delta around the call under test.
const delta = async (cache: { stats: () => { misses: number; hits: number; coalesced: number } }, fn: () => Promise<unknown>) => {
  const before = cache.stats()
  await fn()
  const after = cache.stats()
  return { misses: after.misses - before.misses, hits: after.hits - before.hits, coalesced: after.coalesced - before.coalesced }
}

// Cold then warm, from an empty cache, so the two numbers are comparable.
const coldThenWarm = async (url: string) => {
  resetCaches()
  const cold = await get(url)
  const warm = await get(url)
  return { cold, warm }
}

const ROUTES = [
  '/api/people',
  '/api/people/lula/graph?days=30',
  '/api/people/lula/graph?days=365&sort=pmi&limit=60',
  '/api/people/lula/sources?days=30',
  '/api/people/lula/docs?days=30&term=reforma&kind=word',
  '/api/people/lula/timeline?days=30&bucket=week',
  '/api/people/lula/rising?days=7&baseline=30',
  '/api/people/tarcisio/testimony?days=30&method=stub',
  '/api/tone?days=30',
  '/api/candidates?days=7&min=1',
]

describe('AC1: a warm identical request executes no SQL', () => {
  before(seed)

  for (const url of ROUTES)
    it(`${url} runs statements cold and none warm`, async () => {
      const { cold, warm } = await coldThenWarm(url)
      assert.equal(cold.status, 200)
      assert.ok(cold.sql > 0, `expected the cold request to run SQL, got ${cold.sql}`)
      assert.equal(warm.status, 200)
      assert.equal(warm.sql, 0)
    })

  it('the person lookup is cached too, so a warm 404 runs no SQL either', async () => {
    resetCaches()
    const cold = await get('/api/people/nobody/graph')
    const warm = await get('/api/people/nobody/graph')
    assert.deepEqual([cold.status, warm.status], [404, 404])
    assert.equal(JSON.parse(warm.body).error, 'person not found')
    assert.ok(cold.sql > 0)
    assert.equal(warm.sql, 0)
  })

  it('a second route for the same person reuses the cached lookup', async () => {
    resetCaches()
    await get('/api/people/lula/graph?days=30')
    const d = await delta(people, () => get('/api/people/lula/sources?days=45'))
    assert.deepEqual([d.misses, d.hits], [0, 1])
  })
})

describe('AC1: statuses, bodies and headers are identical warm and cold', () => {
  before(seed)

  for (const url of ROUTES)
    it(`${url} answers byte-for-byte the same`, async () => {
      const { cold, warm } = await coldThenWarm(url)
      assert.equal(warm.body, cold.body)
      assert.equal(warm.type, cold.type)
      assert.equal(warm.type, 'application/json')
    })

  it('a cached body is exactly what the underlying function returns', async () => {
    resetCaches()
    const person = persons.find((p) => p.id === 'lula')!
    for (const [url, expected] of [
      ['/api/people/lula/graph?days=30', await graphFor(person, parseQuery({ days: '30' }))],
      ['/api/people/lula/sources?days=30', await sourcesFor(person, parseQuery({ days: '30' }))],
      ['/api/people/lula/docs?days=30', await docsFor(person, parseDocsQuery({ days: '30' }))],
    ] as const) {
      const cold = await get(url)
      const warm = await get(url)
      assert.equal(cold.body, JSON.stringify(expected))
      assert.equal(warm.body, JSON.stringify(expected))
    }
  })
})

describe('AC2: simultaneous identical requests run one underlying operation', () => {
  before(seed)

  it('three concurrent graph requests cost exactly one cold request of SQL', async () => {
    resetCaches()
    const url = '/api/people/lula/graph?days=365&sort=pmi'
    const alone = await get(url)
    resetCaches()
    const coalesced = reads.stats().coalesced + 2
    const together = await Promise.all([get(url), get(url), get(url)])
    assert.equal(
      together.reduce((a, r) => a + r.sql, 0),
      alone.sql,
    )
    for (const r of together) {
      assert.equal(r.status, 200)
      assert.equal(r.body, alone.body)
    }
    assert.equal(reads.stats().coalesced, coalesced)
  })

  it('the person lookup coalesces across concurrent requests for different routes', async () => {
    resetCaches()
    const d = await delta(people, () =>
      Promise.all([get('/api/people/lula/graph'), get('/api/people/lula/sources'), get('/api/people/lula/timeline')]),
    )
    assert.deepEqual([d.misses, d.coalesced], [1, 2])
  })

  it('concurrent requests for different people do not coalesce into one another', async () => {
    resetCaches()
    let bodies: string[] = []
    const d = await delta(people, async () => {
      const results = await Promise.all([get('/api/people/lula/graph?days=365'), get('/api/people/tarcisio/graph?days=365')])
      bodies = results.map((r) => r.body)
    })
    assert.deepEqual(bodies.map((b) => JSON.parse(b).person.id), ['lula', 'tarcisio'])
    assert.deepEqual([d.misses, d.coalesced], [2, 0])
  })
})

describe('AC3: no result leaks between people or between filters', () => {
  before(seed)

  it('two people asked in sequence each get their own graph', async () => {
    resetCaches()
    for (const id of ['lula', 'tarcisio', 'bolsonaro', 'lula', 'tarcisio']) {
      const body = JSON.parse((await get(`/api/people/${id}/graph?days=365`)).body)
      const expected = await graphFor(persons.find((p) => p.id === id)!, parseQuery({ days: '365' }))
      assert.equal(body.person.id, id)
      assert.deepEqual(body, JSON.parse(JSON.stringify(expected)))
    }
  })

  it('two people asked at the same time do not swap bodies', async () => {
    resetCaches()
    const results = await Promise.all(persons.map((p) => get(`/api/people/${p.id}/graph?days=365`)))
    assert.deepEqual(results.map((r) => JSON.parse(r.body).person.id), persons.map((p) => p.id))
  })

  it('every differing filter gets its own entry and its own, correct answer', async () => {
    const variants: Record<string, string>[] = [
      { days: '365' },
      { days: '365', sort: 'pmi' },
      { days: '365', limit: '1' },
      { days: '365', min: '3' },
      { days: '365', kind: 'hashtag' },
      { days: '365', source: 'rss' },
      { days: '365', domain: 'g1.globo.com' },
      { days: '30' },
    ]
    resetCaches()
    const lula = persons.find((p) => p.id === 'lula')!
    const d = await delta(reads, async () => {
      for (const q of variants) {
        const url = `/api/people/lula/graph?${new URLSearchParams(q)}`
        const body = (await get(url)).body
        assert.equal(body, JSON.stringify(await graphFor(lula, parseQuery(q))), url)
      }
    })
    // One miss per variant: no two of them shared an entry, whether or not their bodies coincide.
    assert.deepEqual([d.misses, d.hits], [variants.length, 0])
  })

  it('a docs term is part of the key: two terms never share an entry', async () => {
    resetCaches()
    const reforma = await get('/api/people/lula/docs?days=365&term=reforma&kind=word')
    const bahia = await get('/api/people/lula/docs?days=365&term=bahia&kind=word')
    assert.notEqual(reforma.body, bahia.body)
    assert.equal((await get('/api/people/lula/docs?days=365&term=reforma&kind=word')).body, reforma.body)
    assert.equal((await get('/api/people/lula/docs?days=365&term=bahia&kind=word')).body, bahia.body)
  })

  it('an unknown parameter cannot fork an entry, and a clamped one shares it', async () => {
    resetCaches()
    const cold = await get('/api/people/lula/graph?days=30')
    const withJunk = await get('/api/people/lula/graph?days=30&nocache=1')
    const clamped = await get('/api/people/lula/graph?days=99999&limit=abc')
    assert.equal(withJunk.sql, 0)
    assert.equal(withJunk.body, cold.body)
    assert.ok(clamped.sql > 0, 'days=99999 clamps to 365, a different window')
  })
})

describe('AC2: equivalent list orders share one entry', () => {
  before(seed)

  it('source=rss,gnews and source=gnews,rss are one cache entry', async () => {
    resetCaches()
    const first = await get('/api/people/lula/graph?days=365&source=rss,gnews')
    const second = await get('/api/people/lula/graph?days=365&source=gnews,rss')
    assert.ok(first.sql > 0)
    assert.equal(second.sql, 0)
    assert.equal(second.body, first.body)
  })

  it('domain and lean list orders share an entry too', async () => {
    resetCaches()
    const domains = await get('/api/people/lula/docs?days=365&domain=example.org,g1.globo.com')
    const flipped = await get('/api/people/lula/docs?days=365&domain=g1.globo.com,example.org')
    assert.equal(flipped.sql, 0)
    assert.equal(flipped.body, domains.body)
    const lean = await get('/api/people/bolsonaro/graph?days=365&lean=left,right')
    const leanFlipped = await get('/api/people/bolsonaro/graph?days=365&lean=right,left')
    assert.equal(leanFlipped.sql, 0)
    assert.equal(leanFlipped.body, lean.body)
  })
})

describe('AC4: reset and invalidation', () => {
  before(seed)

  it('resetCaches() makes the next identical request run SQL again', async () => {
    const url = '/api/people/lula/graph?days=30'
    resetCaches()
    const cold = await get(url)
    assert.equal((await get(url)).sql, 0)
    resetCaches()
    const again = await get(url)
    assert.equal(again.sql, cold.sql)
    assert.equal(again.body, cold.body)
  })

  it('an in-process write drops the cache, so a new doc is visible immediately', async () => {
    const { insertDoc } = await import('../src/store.js')
    const url = '/api/people/lula/docs?days=30&limit=200'
    resetCaches()
    const before = JSON.parse((await get(url)).body) as { total: number }
    assert.equal((await get(url)).sql, 0)
    await insertDoc(
      { source: 'rss', uri: 'https://example.org/cache-invalidation', text: 'Lula comenta a reforma em nova entrevista', publishedAt: new Date().toISOString(), domain: 'example.org' },
      persons,
    )
    const after = await get(url)
    assert.ok(after.sql > 0, 'the write must have dropped the entry')
    assert.equal((JSON.parse(after.body) as { total: number }).total, before.total + 1)
  })

  it('holds a bounded number of entries and a bounded number of bytes', async () => {
    resetCaches()
    for (let days = 1; days <= 40; days++) await get(`/api/people/lula/graph?days=${days}`)
    const { entries, bytes } = reads.stats()
    assert.ok(entries > 0 && entries <= 500)
    assert.ok(bytes > 0 && bytes <= 32 * 1024 * 1024)
    assert.equal(reads.stats().entries, entries)
  })

  it('keys the reads by route, person and parsed query, and nothing else', () => {
    assert.equal(cacheKey('graph', 'lula', parseQuery({ days: '30' })), 'graph|lula|days=30|domain=all|kind=all|lean=all|limit=40|min=2|sort=count|source=all')
  })
})
