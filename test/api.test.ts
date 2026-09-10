import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { candidatesQuery, compareParams, endpoint, json, loadCompare, loadDocs, loadGraph, loadPeople, loadSources, loadTestimony, narrowToSources, narrowToTestimony, params, sourcesParams, testimonyParams } from '../src/ui/api.js'

// src/ui/api.ts: URL building and fetching for the documented routes. No DOM.

// Never hits the network (CLAUDE.md's hard constraint): every test stubs global.fetch and
// restores it afterward, so this suite never depends on a running server or DATA_DIR.
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const stubFetch = (ok: boolean, body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response
  }) as typeof fetch
  return calls
}

describe('endpoint', () => {
  it('URL-encodes the person id', () => {
    assert.equal(endpoint('tarcísio'), '/api/people/tarc%C3%ADsio')
  })
})

describe('params', () => {
  it('builds the querystring the graph/sources/docs routes expect', () => {
    const p = params({ days: '30', sort: 'pmi', limit: '18', source: 'all' })
    assert.equal(p.get('days'), '30')
    assert.equal(p.get('sort'), 'pmi')
    assert.equal(p.get('limit'), '18')
    assert.equal(p.get('min'), '2')
    // Not 'all': the atlas names the three kinds it wants (see ATLAS_KINDS in api.js).
    assert.equal(p.get('kind'), 'word,hashtag,phrase')
    assert.equal(p.get('source'), 'all')
    // No outlet: picking one is a reading inside the second figure, so it never reaches a route.
    assert.equal(p.has('domain'), false)
  })

  it('lets an explicit kind/min override the defaults', () => {
    const p = params({ days: '7', sort: 'count', limit: '12', source: 'gdelt', kind: 'hashtag', min: '5' })
    assert.equal(p.get('kind'), 'hashtag')
    assert.equal(p.get('min'), '5')
  })
})

describe('json', () => {
  it('returns the parsed body on a 200', async () => {
    stubFetch(true, { ok: true })
    assert.deepEqual(await json('/api/people'), { ok: true })
  })

  it('throws with the HTTP status on a non-ok response, never returning a fake payload', async () => {
    stubFetch(false, { error: 'nope' })
    await assert.rejects(() => json('/api/people'), /HTTP 500/)
  })
})

describe('loadPeople / loadGraph / loadSources / loadDocs / loadTestimony / loadCompare', () => {
  it('call the exact routes CLAUDE.md documents as the stable API contract', async () => {
    const calls = stubFetch(true, [])
    await loadPeople(undefined)
    assert.equal(calls[0].url, '/api/people')

    await loadGraph('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[1].url, '/api/people/lula/graph?days=30')

    await loadSources('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[2].url, '/api/people/lula/sources?days=30')

    await loadDocs('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[3].url, '/api/people/lula/docs?days=30')

    await loadTestimony('lula', narrowToTestimony(params({ days: '30', sort: 'count', limit: '18', source: 'all' })))
    assert.equal(calls[4].url, '/api/people/lula/testimony?days=30&source=all&min=3')

    const qp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    await loadCompare(qp)
    assert.equal(calls[5].url, '/api/compare?' + qp.toString())
  })
})

describe('the narrowed querystrings: each route is asked only what it reads', () => {
  const opts = { days: '30', sort: 'count', limit: '18', source: 'all' }

  it('sourcesParams drops domain, sort and limit, and narrowToSources agrees with it', () => {
    const wide = sourcesParams(opts)
    for (const dropped of ['domain', 'sort', 'limit']) assert.equal(wide.has(dropped), false, `${dropped} is ignored by sourcesFor and must not reach the URL`)
    assert.deepEqual(narrowToSources(params(opts)).toString(), wide.toString())
  })

  it('testimonyParams keeps days, source and min and drops domain, sort and limit', () => {
    const p = testimonyParams({ days: '7', sort: 'pmi', limit: '24', source: 'gnews' })
    assert.equal(p.toString(), new URLSearchParams({ days: '7', source: 'gnews', min: '3' }).toString())
    assert.equal(p.has('method'), false, 'the server resolves the default method; the client never guesses a label')
  })

  it('the graph query asks for testimony and the sources/testimony queries do not echo it', () => {
    const p = params(opts)
    assert.equal(p.get('testimony'), '1')
    assert.equal(narrowToTestimony(p).has('testimony'), false)
    assert.equal(testimonyParams(opts).has('testimony'), false)
    assert.equal(narrowToSources(p).has('testimony'), false)
  })

  // The second figure used to write a page-wide filter: clicking an outlet down there narrowed
  // the atlas, the header and the documents above it. The outlet is now a reading inside its own
  // figure, so no querystring the page builds may carry one.
  it('no route the page builds carries a domain', () => {
    for (const [name, q] of [
      ['graph', params(opts)],
      ['sources', sourcesParams(opts)],
      ['testimony', testimonyParams(opts)],
    ] as const)
      assert.equal(q.has('domain'), false, `${name} must answer for the whole recorte`)
  })

  it('the candidate queue keeps its own querystring: the period select, min=3 and limit=30', () => {
    assert.equal(candidatesQuery({ days: '7' }).toString(), new URLSearchParams({ days: '7', min: '3', limit: '30' }).toString())
  })

  it('compareParams always sends kind=word,hashtag,phrase and never domain or lean', () => {
    const qp = compareParams({ a: 'tarcisio', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    assert.equal(qp.get('kind'), 'word,hashtag,phrase')
    assert.equal(qp.has('domain'), false)
    assert.equal(qp.has('lean'), false)
  })
})
