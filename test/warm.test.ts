import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { params, sourcesParams, testimonyParams } from '../src/ui/api.js'
import { summary, warm, warmPaths, WARM_DAYS } from '../src/warm.js'

// src/warm.ts: the paths the page asks for by itself, requested once so the CDN holds them.
// Never hits the network: fetch is injected.

describe('warmPaths', () => {
  it('is /api/people plus graph, sources and testimony per person and window, in the page\'s own querystring order', () => {
    const paths = warmPaths([{ id: 'lula' }, { id: 'tarcísio' }])
    assert.equal(paths.length, 1 + 2 * WARM_DAYS.length * 3)
    assert.equal(paths[0], '/api/people')
    const opts = { days: '7', sort: 'pmi', limit: '18', source: 'all' }
    assert.equal(paths[1], '/api/people/lula/graph?' + params(opts))
    assert.equal(paths[2], '/api/people/lula/sources?' + sourcesParams(opts))
    assert.equal(paths[3], '/api/people/lula/testimony?' + testimonyParams(opts))
    assert.ok(paths.some((p) => p.startsWith('/api/people/tarc%C3%ADsio/graph?days=30&')))
    assert.ok(paths.every((p) => !p.includes('days=365')), 'the year stays cold on purpose')
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
    const fetchFn = ((url: string) => (seen.push(url), stub(200, 'MISS')(url))) as unknown as typeof fetch
    const results = await warm('https://example.test', ['/a', '/b', '/c'], 2, fetchFn)
    assert.deepEqual(seen.sort(), ['https://example.test/a', 'https://example.test/b', 'https://example.test/c'])
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
      { path: '/a', status: 200, cache: 'HIT', server: null, ms: 10 },
      { path: '/b', status: 200, cache: 'MISS', server: null, ms: 3000 },
      { path: '/c', status: 500, cache: null, server: null, ms: 20 },
    ])
    assert.deepEqual(s, { requests: 3, status: { '200': 2, '500': 1 }, cache: { HIT: 1, MISS: 1, none: 1 }, p50: 20, p95: 3000 })
  })
})
