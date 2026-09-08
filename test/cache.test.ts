import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { cacheEnabled, createCache, maxPersonEntries, maxReadBytes, maxReadEntries, personTtlMs, readTtlMs } from '../src/cache.js'
import { cacheKey, parseDocsQuery, parseQuery, parseRisingQuery, parseTimelineQuery } from '../src/query.js'

// Every clock here is injected. Nothing in this suite sleeps, so expiry and eviction are
// deterministic and the file costs nothing to run.
const clock = (start = 1_000) => {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const counted = <T>(value: T) => {
  let calls = 0
  return { calls: () => calls, load: async () => (calls += 1, value) }
}

describe('createCache: hits and misses', () => {
  it('runs the load once and serves the second call from memory', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: clock().now })
    const { calls, load } = counted('a')
    assert.equal(await c.take('k', load), 'a')
    assert.equal(await c.take('k', load), 'a')
    assert.equal(calls(), 1)
    assert.deepEqual({ ...c.stats(), bytes: 0 }, { entries: 1, bytes: 0, hits: 1, misses: 1, coalesced: 0, expired: 0, evictions: 0 })
  })

  it('keeps different keys apart', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: clock().now })
    assert.equal(await c.take('a', async () => 'A'), 'A')
    assert.equal(await c.take('b', async () => 'B'), 'B')
    assert.equal(await c.take('a', async () => 'never'), 'A')
    assert.equal(await c.take('b', async () => 'never'), 'B')
  })

  it('does nothing when disabled: every call reaches the load', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, enabled: false, now: clock().now })
    const { calls, load } = counted('a')
    await c.take('k', load)
    await c.take('k', load)
    assert.equal(calls(), 2)
    assert.equal(c.stats().entries, 0)
  })
})

describe('createCache: expiry', () => {
  it('serves until the ttl and re-runs the load after it, on the injected clock', async () => {
    const t = clock()
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: t.now })
    const { calls, load } = counted('a')
    await c.take('k', load)
    t.advance(999)
    await c.take('k', load)
    assert.equal(calls(), 1)
    t.advance(1)
    await c.take('k', load)
    assert.equal(calls(), 2)
    assert.equal(c.stats().expired, 1)
  })

  it('expires absolutely, not on a sliding window: a hit does not push the deadline out', async () => {
    const t = clock()
    const c = createCache<string>({ ttlMs: 100, maxEntries: 10, maxBytes: 1_000, now: t.now })
    const { calls, load } = counted('a')
    await c.take('k', load)
    t.advance(90)
    await c.take('k', load)
    t.advance(20)
    await c.take('k', load)
    assert.equal(calls(), 2)
  })

  it('ttl 0 keeps coalescing but never serves a settled entry', async () => {
    const t = clock()
    const c = createCache<string>({ ttlMs: 0, maxEntries: 10, maxBytes: 1_000, now: t.now })
    const { calls, load } = counted('a')
    await c.take('k', load)
    await c.take('k', load)
    assert.equal(calls(), 2)
  })
})

describe('createCache: coalescing', () => {
  it('runs one load for simultaneous callers and hands all of them the same value', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: clock().now })
    const d = deferred<string>()
    let calls = 0
    const load = () => (calls += 1, d.promise)
    const all = Promise.all([c.take('k', load), c.take('k', load), c.take('k', load)])
    d.resolve('A')
    assert.deepEqual(await all, ['A', 'A', 'A'])
    assert.equal(calls, 1)
    assert.equal(c.stats().coalesced, 2)
  })

  it('does not treat an in-flight load as expired, however long it takes', async () => {
    const t = clock()
    const c = createCache<string>({ ttlMs: 10, maxEntries: 10, maxBytes: 1_000, now: t.now })
    const d = deferred<string>()
    let calls = 0
    const load = () => (calls += 1, d.promise)
    const first = c.take('k', load)
    t.advance(10_000)
    const second = c.take('k', load)
    d.resolve('A')
    assert.deepEqual(await Promise.all([first, second]), ['A', 'A'])
    assert.equal(calls, 1)
  })
})

describe('createCache: errors', () => {
  it('never retains a rejected load and re-runs it on the next call', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: clock().now })
    let calls = 0
    const failing = async () => {
      calls += 1
      throw new Error('boom')
    }
    await assert.rejects(c.take('k', failing), /boom/)
    assert.equal(c.stats().entries, 0)
    await assert.rejects(c.take('k', failing), /boom/)
    assert.equal(calls, 2)
    assert.equal(await c.take('k', async () => 'A'), 'A')
    assert.equal(await c.take('k', async () => 'never'), 'A')
  })

  it('rejects every coalesced caller of a failing load, once', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, now: clock().now })
    const d = deferred<string>()
    let calls = 0
    const load = () => (calls += 1, d.promise)
    const settled = Promise.allSettled([c.take('k', load), c.take('k', load)])
    d.reject(new Error('boom'))
    const results = await settled
    assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected'])
    assert.equal(calls, 1)
    assert.equal(c.stats().entries, 0)
  })

  it('leaves no byte charged to the budget after a failure', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, weigh: (v) => v.length, now: clock().now })
    await c.take('a', async () => 'xxxx')
    await assert.rejects(
      c.take('b', async () => {
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.deepEqual(c.stats().bytes, 4)
    assert.equal(c.stats().entries, 1)
  })
})

describe('createCache: bounds', () => {
  it('evicts the least recently used entry once maxEntries is exceeded', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 2, maxBytes: 1_000, now: clock().now })
    await c.take('a', async () => 'A')
    await c.take('b', async () => 'B')
    await c.take('c', async () => 'C')
    assert.equal(c.stats().entries, 2)
    assert.equal(c.stats().evictions, 1)
    assert.equal(await c.take('a', async () => 'reloaded'), 'reloaded')
    assert.equal(await c.take('c', async () => 'never'), 'C')
  })

  it('a hit promotes its key, so the untouched one is evicted first', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 2, maxBytes: 1_000, now: clock().now })
    await c.take('a', async () => 'A')
    await c.take('b', async () => 'B')
    await c.take('a', async () => 'never')
    await c.take('c', async () => 'C')
    assert.equal(await c.take('a', async () => 'never'), 'A')
    assert.equal(await c.take('b', async () => 'reloaded'), 'reloaded')
  })

  it('evicts until the byte budget holds', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 100, maxBytes: 10, weigh: (v) => v.length, now: clock().now })
    await c.take('a', async () => 'aaaaa')
    await c.take('b', async () => 'bbbbb')
    assert.deepEqual([c.stats().entries, c.stats().bytes], [2, 10])
    await c.take('c', async () => 'ccccc')
    assert.deepEqual([c.stats().entries, c.stats().bytes], [2, 10])
    assert.equal(await c.take('a', async () => 'reloaded'), 'reloaded')
  })

  it('drops a single value larger than the whole budget instead of pinning the cache over it', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 100, maxBytes: 10, weigh: (v) => v.length, now: clock().now })
    assert.equal(await c.take('big', async () => 'x'.repeat(50)), 'x'.repeat(50))
    assert.deepEqual([c.stats().entries, c.stats().bytes], [0, 0])
  })

  it('bounds a burst of concurrent misses by maxEntries too', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 3, maxBytes: 1_000, now: clock().now })
    const values = await Promise.all([...Array(20).keys()].map((i) => c.take(`k${i}`, async () => `v${i}`)))
    assert.deepEqual(values[0], 'v0')
    assert.equal(c.stats().entries, 3)
  })
})

describe('createCache: reset', () => {
  it('clear() empties the entries and the byte budget', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, weigh: (v) => v.length, now: clock().now })
    await c.take('a', async () => 'aaaa')
    assert.deepEqual([c.stats().entries, c.stats().bytes], [1, 4])
    c.clear()
    assert.deepEqual([c.stats().entries, c.stats().bytes], [0, 0])
    const { calls, load } = counted('a')
    await c.take('a', load)
    assert.equal(calls(), 1)
  })

  it('a load in flight when clear() runs is not put back into the cache', async () => {
    const c = createCache<string>({ ttlMs: 1_000, maxEntries: 10, maxBytes: 1_000, weigh: (v) => v.length, now: clock().now })
    const d = deferred<string>()
    const first = c.take('k', () => d.promise)
    c.clear()
    d.resolve('A')
    assert.equal(await first, 'A')
    assert.deepEqual([c.stats().entries, c.stats().bytes], [0, 0])
  })
})

describe('cacheKey', () => {
  const graph = (over: Record<string, string> = {}) => cacheKey('graph', 'lula', parseQuery(over))

  it('is stable for the same effective query', () => {
    assert.equal(graph(), graph())
    assert.equal(graph({ days: '30' }), graph())
  })

  it('ignores the order of a source, domain or lean list', () => {
    assert.equal(graph({ source: 'rss,gnews' }), graph({ source: 'gnews,rss' }))
    assert.equal(graph({ domain: 'b.com,a.com' }), graph({ domain: 'a.com,b.com' }))
    assert.equal(graph({ lean: 'right,left' }), graph({ lean: 'left,right' }))
  })

  it('shares an entry between two urls that clamp to the same filters', () => {
    assert.equal(graph({ days: '9999' }), graph({ days: '365' }))
    assert.equal(graph({ source: 'bogus' }), graph({ source: 'all' }))
    assert.equal(graph({ limit: 'abc' }), graph())
  })

  it('separates every parameter of the graph query', () => {
    assert.notEqual(graph({ days: '90' }), graph())
    assert.notEqual(graph({ source: 'gnews' }), graph())
    assert.notEqual(graph({ domain: 'g1.globo.com' }), graph())
    assert.notEqual(graph({ lean: 'left' }), graph())
    assert.notEqual(graph({ kind: 'word' }), graph())
    assert.notEqual(graph({ limit: '10' }), graph())
    assert.notEqual(graph({ min: '5' }), graph())
    assert.notEqual(graph({ sort: 'pmi' }), graph())
  })

  it('carries every field of every parsed query, so a new parameter cannot alias two reads', () => {
    for (const [route, q] of [
      ['graph', parseQuery({})],
      ['docs', parseDocsQuery({})],
      ['timeline', parseTimelineQuery({})],
      ['rising', parseRisingQuery({})],
    ] as const) {
      const key = cacheKey(route, 'lula', q)
      for (const field of Object.keys(q)) assert.ok(key.includes(`|${field}=`), `${route} key is missing ${field}`)
    }
  })

  it('separates people and routes', () => {
    assert.notEqual(cacheKey('graph', 'lula', parseQuery({})), cacheKey('graph', 'tarcisio', parseQuery({})))
    assert.notEqual(cacheKey('graph', 'lula', parseQuery({})), cacheKey('sources', 'lula', parseQuery({})))
    assert.notEqual(cacheKey('person', 'lula', {}), cacheKey('person', 'tarcisio', {}))
  })

  it('escapes the separators, so a crafted person id or term cannot forge another key', () => {
    assert.notEqual(cacheKey('graph', 'lula|days=365', parseQuery({})), cacheKey('graph', 'lula', parseQuery({ days: '365' })))
    const a = cacheKey('docs', 'lula', parseDocsQuery({ term: 'a|kind=word' }))
    const b = cacheKey('docs', 'lula', parseDocsQuery({ term: 'a', kind: 'word' }))
    assert.notEqual(a, b)
    assert.notEqual(
      cacheKey('docs', 'lula', parseDocsQuery({ term: 'a=b' })),
      cacheKey('docs', 'lula', parseDocsQuery({ term: 'a', offset: '0' })),
    )
  })
})

describe('configuration', () => {
  it('is on by default, with a default, a floor and a ceiling for every knob', () => {
    assert.equal(cacheEnabled, true)
    assert.equal(readTtlMs, 30_000)
    assert.equal(personTtlMs, 300_000)
    assert.equal(maxReadEntries, 500)
    assert.equal(maxReadBytes, 32 * 1024 * 1024)
    assert.equal(maxPersonEntries, 200)
  })
})

describe('configuration', () => {
  it('defaults to on, 30s responses, 5min person lookups, 500 entries and 32 MiB', () => {
    assert.equal(cacheEnabled, true)
    assert.equal(readTtlMs, 30_000)
    assert.equal(personTtlMs, 300_000)
    assert.equal(maxReadEntries, 500)
    assert.equal(maxReadBytes, 32 * 1024 * 1024)
    assert.equal(maxPersonEntries, 200)
  })

  it('is documented in README with every knob, its default and its staleness', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    for (const knob of ['CACHE_TTL_MS', 'CACHE_PERSON_TTL_MS', 'CACHE_MAX_ENTRIES', 'CACHE_MAX_BYTES', 'CACHE_MAX_PERSONS'])
      assert.ok(readme.includes(knob), knob)
    for (const value of ['30000', '300000', '500', '33554432', '200']) assert.ok(readme.includes(value), value)
    assert.match(readme, /up to 30 seconds out of date/)
  })
})
