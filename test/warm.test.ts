import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { params, sourcesParams, testimonyParams } from '../src/ui/api.js'
import { summary, warm, warmFailed, WARM_HEADERS, warmPaths, WARM_DAYS, type WarmResult } from '../src/warm.js'

// src/warm.ts: the paths the page asks for by itself, requested once so the CDN holds them.
// Never hits the network: fetch is injected.

describe('warmPaths', () => {
  it('warmPaths asks only 7 and 21: every days is one of them and none is a retired window (issue #313)', () => {
    assert.deepEqual([...WARM_DAYS], ['7', '21'])
    const paths = warmPaths([{ id: 'lula' }, { id: 'tarcisio' }, { id: 'bolsonaro' }])
    assert.equal(paths.length, 1 + 3 * 2 * 3)
    const days = new Set(paths.filter((p) => p !== '/api/people').map((p) => new URLSearchParams(p.split('?')[1]).get('days')))
    assert.deepEqual([...days].sort(), ['21', '7'])
    assert.ok(paths.every((p) => !/days=(30|60|365)\b/.test(p)))
  })

  it('is /api/people plus graph, sources and testimony per person and window, in the page\'s own querystring order', () => {
    const paths = warmPaths([{ id: 'lula' }, { id: 'tarcísio' }])
    assert.equal(paths.length, 1 + 2 * WARM_DAYS.length * 3)
    assert.equal(paths[0], '/api/people')
    const opts = { days: '7', sort: 'pmi', limit: '18', source: 'all' }
    assert.equal(paths[1], '/api/people/lula/graph?' + params(opts))
    assert.equal(paths[2], '/api/people/lula/sources?' + sourcesParams(opts))
    assert.equal(paths[3], '/api/people/lula/testimony?' + testimonyParams(opts))
    assert.ok(paths.some((p) => p.startsWith('/api/people/tarc%C3%ADsio/graph?days=21&')))
    assert.ok(paths.every((p) => !/days=(30|60|365)\b/.test(p)), 'a retired window is never warmed')
  })
})

describe('warm', () => {
  const stub = (status: number, cache: string) =>
    (async (url: string | URL | Request) => ({
      status,
      headers: new Headers({ 'x-vercel-cache': cache, 'server-timing': 'db;dur=1;desc="1 sql", total;dur=2' }),
      arrayBuffer: async () => new ArrayBuffer(0),
      url: String(url),
    })) as unknown as typeof fetch

  it('requests every path once against the site and keeps status, cache and server-timing', async () => {
    const seen: string[] = []
    const headers: unknown[] = []
    const fetchFn = ((url: string, init: RequestInit) => (seen.push(url), headers.push(init.headers), stub(200, 'MISS')(url))) as unknown as typeof fetch
    const results = await warm('https://example.test', ['/a', '/b', '/c'], 2, fetchFn)
    assert.deepEqual(seen.sort(), ['https://example.test/a', 'https://example.test/b', 'https://example.test/c'])
    assert.deepEqual(headers, Array(3).fill(WARM_HEADERS))
    assert.equal(results.length, 3)
    assert.deepEqual(results.map((r) => [r.status, r.cache, r.server]), Array(3).fill([200, 'MISS', 'db;dur=1;desc="1 sql", total;dur=2']))
  })

  it('records a thrown fetch as a null status instead of stopping the run', async () => {
    const fetchFn = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    const [r] = await warm('https://example.test', ['/a'], 1, fetchFn)
    assert.deepEqual([r.status, r.cache], [null, null])
  })
})

describe('summary', () => {
  it('counts statuses and cache states and reports p50/p95 of the wall time', () => {
    const s = summary([
      { path: '/a', status: 200, cache: 'HIT', server: null, store: 'hit', ms: 10 },
      { path: '/b', status: 200, cache: 'MISS', server: null, store: 'none', ms: 3000 },
      { path: '/c', status: 500, cache: null, server: null, store: 'miss', ms: 20 },
    ])
    assert.deepEqual(s, { requests: 3, status: { '200': 2, '500': 1 }, cache: { HIT: 1, MISS: 1, none: 1 }, store: { hit: 1, none: 1, miss: 1 }, p50: 20, p95: 3000 })
  })
})

describe('warm and the store', () => {
  const answer = (store: string | null, cache = 'MISS', status = 200) =>
    (async () => ({
      status,
      headers: new Headers({ 'x-vercel-cache': cache, ...(store ? { 'x-warm-store': store } : {}) }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch

  const paths = warmPaths([{ id: 'lula' }])

  it('asks for the store alone, so a miss is a 503 rather than a live statement', () => {
    assert.equal(WARM_HEADERS['x-warm-store-only'], '1')
  })

  it('reads x-warm-store into each result and counts it in the summary', async () => {
    const results = await warm('https://example.test', paths, 2, answer('hit'))
    assert.ok(results.every((r) => r.store === 'hit'))
    assert.deepEqual(summary(results).store, { hit: paths.length })
  })

  it('is not a failure when every path is a hit', async () => {
    assert.equal(warmFailed(await warm('https://example.test', paths, 2, answer('hit'))), false)
  })

  it('is not a failure when no deployment header is present: every result counts as none', async () => {
    const results = await warm('https://example.test', paths, 2, answer(null))
    assert.equal(warmFailed(results), false)
    assert.equal(summary(results).store.none, paths.length)
  })

  const mixed = (cache: string): WarmResult[] => [
    { path: '/a', status: 200, cache: 'MISS', server: null, store: 'hit', ms: 1 },
    { path: '/b', status: 200, cache, server: null, store: 'miss', ms: 1 },
  ]

  it('is a failure when one path missed the store at the origin', () => {
    assert.equal(warmFailed(mixed('MISS')), true)
    assert.equal(warmFailed(mixed('MISS').map((r) => ({ ...r, store: 'stale' }))), true)
  })

  it('is not a failure when the same miss came with a CDN HIT: the CDN is warm', () => {
    assert.equal(warmFailed(mixed('HIT')), false)
  })

  it('is a failure on a null status or a 5xx, whatever the store said', () => {
    assert.equal(warmFailed([{ path: '/a', status: null, cache: null, server: null, store: 'none', ms: 1 }]), true)
    assert.equal(warmFailed([{ path: '/a', status: 503, cache: 'HIT', server: null, store: 'hit', ms: 1 }]), true)
  })
})

// Issue #313 acceptance criteria, quoted by number.
describe('warmPaths over the 7 and 21 day windows (issue #313 acceptance)', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
  const daysOf = (path: string) => new URL(path, 'http://warm.local').searchParams.get('days')

  it('N people yield 1 + N x 2 x 3 paths, every days is 7 or 21 and none carries a retired window (AC22)', () => {
    for (const n of [0, 1, 3, 27]) {
      const paths = warmPaths(people(n))
      assert.equal(paths.length, 1 + n * 2 * 3, `${n} people`)
      for (const path of paths.filter((p) => p !== '/api/people')) assert.ok(['7', '21'].includes(daysOf(path) ?? ''), path)
      assert.ok(paths.every((p) => !/days=(30|60)\b/.test(p)), `${n} people`)
    }
  })

  it('each person is warmed at both windows on graph, sources and testimony (AC22)', () => {
    const paths = warmPaths([{ id: 'lula' }])
    for (const route of ['graph', 'sources', 'testimony'])
      for (const days of ['7', '21']) assert.ok(paths.some((p) => p.startsWith(`/api/people/lula/${route}?`) && daysOf(p) === days), `${route} ${days}`)
  })
})
