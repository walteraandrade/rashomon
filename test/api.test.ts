import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ATLAS_KINDS, attentionParams, bridgeParams, candidatesQuery, compareParams, docsParams, endpoint, json, lensesParams, loadAttention, loadCompare, loadDocs, loadGraph, loadPeople, loadPersistence, loadSources, loadTestimony, loadTimeline, loadWeek, narrowToSources, narrowToTestimony, params, persistenceParams, sourcesParams, sparklineParams, testimonyParams, weekParams } from '../src/ui/api.js'

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

const stubFetchWithHeaders = (headers: Record<string, string>) => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, headers: new Headers(headers), json: async () => ({}) }) as Response) as typeof fetch
}

describe('json marks one api:<route> measure per completed call', () => {
  it('names the measure after the route and keeps the cache and server-timing headers in its detail', async () => {
    performance.clearMeasures()
    stubFetchWithHeaders({ 'x-vercel-cache': 'HIT', 'server-timing': 'db;dur=3.1;desc="2 sql", app;dur=4' })
    await json('/api/people/lula/graph?days=30')
    const [entry] = performance.getEntriesByName('api:graph', 'measure') as PerformanceMeasure[]
    assert.ok(entry, 'a completed call leaves an api:graph measure')
    assert.ok(entry.duration >= 0)
    assert.deepEqual(entry.detail, { url: '/api/people/lula/graph?days=30', status: 200, cache: 'HIT', server: 'db;dur=3.1;desc="2 sql", app;dur=4' })
  })

  it('records null for headers a stub or a plain server does not send', async () => {
    performance.clearMeasures()
    stubFetch(true, [])
    await json('/api/compare?a=lula&b=bolsonaro')
    const [entry] = performance.getEntriesByName('api:compare', 'measure') as PerformanceMeasure[]
    assert.equal(entry.detail.cache, null)
    assert.equal(entry.detail.server, null)
  })

  it('records a failed call with its status and no body, since a slow 500 is a wait worth seeing', async () => {
    performance.clearMeasures()
    stubFetch(false, {})
    await assert.rejects(json('/api/people/lula/docs?term=x'))
    const [entry] = performance.getEntriesByName('api:docs', 'measure') as PerformanceMeasure[]
    assert.equal(entry.detail.status, 500)
    assert.equal(entry.detail.cache, null)
  })

  it('records a network failure with a null status', async () => {
    performance.clearMeasures()
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    await assert.rejects(json('/api/people/lula/sources?days=30'))
    const [entry] = performance.getEntriesByName('api:sources', 'measure') as PerformanceMeasure[]
    assert.equal(entry.detail.status, null)
  })

  it('leaves no measure when the call is aborted', async () => {
    performance.clearMeasures()
    const controller = new AbortController()
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: (init?.signal as AbortSignal).reason?.name ?? 'AbortError' })
    }) as typeof fetch
    await assert.rejects(json('/api/compare?a=lula&b=bolsonaro', controller.signal))
    assert.deepEqual(performance.getEntriesByName('api:compare', 'measure'), [])
  })
})

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
    // Not 'all': the atlas names the four kinds it wants (see ATLAS_KINDS in api.js).
    assert.equal(p.get('kind'), 'word,hashtag,phrase,org')
    assert.equal(p.get('source'), 'all')
    // No outlet: picking one is a reading inside the second figure, so it never reaches a route.
    assert.equal(p.has('domain'), false)
  })

  it('params maps reach to count on the wire (issue #210)', () => {
    const base = { days: '30', limit: '18', source: 'all' }
    assert.equal(params({ ...base, sort: 'reach' }).get('sort'), 'count')
    assert.equal(params({ ...base, sort: 'pmi' }).get('sort'), 'pmi')
    assert.equal(params({ ...base, sort: 'count' }).get('sort'), 'count')
    assert.equal(params({ ...base, sort: 'reach' }).toString(), params({ ...base, sort: 'count' }).toString())
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

  it('the graph query asks for testimony and communities, and the sources/testimony queries echo neither (issue #217 AC12)', () => {
    const p = params(opts)
    assert.equal(p.get('testimony'), '1')
    assert.equal(p.get('communities'), '1')
    assert.equal(narrowToTestimony(p).has('testimony'), false)
    assert.equal(testimonyParams(opts).has('testimony'), false)
    assert.equal(narrowToSources(p).has('testimony'), false)
    assert.equal(narrowToTestimony(p).has('communities'), false)
    assert.equal(narrowToSources(p).has('communities'), false)
  })

  it('params() sends communities=1 unconditionally, for every source/sort combination (issue #217 AC12)', () => {
    for (const source of ['all', 'gnews', 'bluesky']) {
      for (const sort of ['count', 'pmi']) {
        const qp = params({ ...opts, source, sort })
        assert.equal(qp.get('communities'), '1', `communities=1 must travel with source=${source} sort=${sort}`)
        assert.equal(qp.get('testimony'), '1', 'testimony=1 must still be there too')
      }
    }
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

  it('the ruler requests never carry bridges; bridgeParams adds the ids to the same recorte', () => {
    const compareQp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    assert.equal(compareQp.has('bridges'), false)
    const lensesQp = lensesParams({ a: 'all', b: 'lean:right', days: '30', limit: '40' })
    assert.equal(lensesQp.has('bridges'), false)
    const withIds = bridgeParams(compareQp, ['word:stf', 'word:pix'])
    assert.equal(withIds.get('ids'), 'word:stf,word:pix')
    assert.equal(withIds.get('a'), 'lula')
    assert.equal(compareQp.has('ids'), false)
  })
})


describe('weekParams / loadWeek stay fixed at days=7', () => {
  it('weekParams sends days=7, the full kind set, plus the chosen source and limit', () => {
    const qp = weekParams({ source: 'gdelt', limit: '5' })
    assert.equal(qp.toString(), new URLSearchParams({ days: '7', source: 'gdelt', kind: 'word,hashtag,phrase', limit: '5' }).toString())
  })

  it('loadWeek calls GET /api/people/:id/week', async () => {
    const calls = stubFetch(true, {})
    await loadWeek('lula', weekParams({ source: 'all', limit: '8' }))
    assert.equal(calls[0].url, '/api/people/lula/week?' + weekParams({ source: 'all', limit: '8' }).toString())
  })
})

// Issue #216 (figure 7, attention vs mentions): attentionParams always sends days=30, the
// route's only window, never exposed as a control -- same fixed-window precedent as
// weekParams' days=7 above.
describe('attentionParams / loadAttention stay fixed at days=30 (issue #216)', () => {
  it('attentionParams always sends days=30 regardless of any other input (AC5)', () => {
    assert.equal(attentionParams({}).get('days'), '30')
    // Passing an unrelated/extra field must not change the fixed window either.
    assert.equal(attentionParams({ source: 'gdelt' } as any).get('days'), '30')
  })

  it('loadAttention calls GET /api/people/:id/attention', async () => {
    const calls = stubFetch(true, { days: 30, series: [] })
    await loadAttention('lula', attentionParams({}))
    assert.equal(calls[0].url, '/api/people/lula/attention?' + attentionParams({}).toString())
  })
})

describe('docsParams accepts an optional day, appended only when non-empty', () => {
  it('day is absent from the querystring by default and when explicitly empty', () => {
    assert.equal(docsParams({ days: '7', source: 'all' }).has('day'), false)
    assert.equal(docsParams({ days: '7', source: 'all', day: '' }).has('day'), false)
  })

  it('a non-empty day is set on the querystring, every other field untouched', () => {
    const q = docsParams({ days: '7', source: 'gdelt', term: 'reforma', kind: 'word', day: '2026-09-08' })
    assert.equal(q.get('day'), '2026-09-08')
    assert.equal(q.get('term'), 'reforma')
    assert.equal(q.get('kind'), 'word')
    assert.equal(q.get('days'), '7')
  })
})

describe('sparklineParams / loadTimeline, the inspector sparkline', () => {
  it('sparklineParams asks for 7 rolling days, bucketed by day, for one term/kind, on the atlas source', () => {
    const qp = sparklineParams('reforma', 'word', 'bluesky')
    assert.equal(qp.toString(), new URLSearchParams({ term: 'reforma', kind: 'word', days: '7', bucket: 'day', source: 'bluesky' }).toString())
    assert.equal(sparklineParams('reforma', 'word').get('source'), 'all', 'no source given reads as every source, like the atlas default')
  })

  it('loadTimeline calls GET /api/people/:id/timeline', async () => {
    const calls = stubFetch(true, [])
    await loadTimeline('lula', sparklineParams('reforma', 'word'))
    assert.equal(calls[0].url, '/api/people/lula/timeline?' + sparklineParams('reforma', 'word').toString())
  })
})

// AC12: ATLAS_KINDS becomes 'word,hashtag,phrase,org' — the atlas page's own kind= request
// grows to the full four-kind set, additive over the pre-#209 three.
describe('ATLAS_KINDS gains org (issue #209 AC12)', () => {
  it("ATLAS_KINDS equals 'word,hashtag,phrase,org'", () => {
    assert.equal(ATLAS_KINDS, 'word,hashtag,phrase,org')
  })
})

// Issue #215 (figure 10): docsParams gains an optional week, persistenceParams/loadPersistence
// build and fetch GET /api/people/:id/persistence.
describe('docsParams accepts an optional week, appended only when set (issue #215)', () => {
  it('week unset or empty leaves the query string byte-identical to what every other caller already sends', () => {
    const before = docsParams({ days: '7', source: 'gdelt', term: 'reforma', kind: 'word' }).toString()
    assert.equal(docsParams({ days: '7', source: 'gdelt', term: 'reforma', kind: 'word', week: '' }).toString(), before)
    assert.equal(docsParams({ days: '7', source: 'gdelt', term: 'reforma', kind: 'word', week: undefined }).toString(), before)
    assert.equal(docsParams({ days: '7', source: 'all' }).has('week'), false)
  })

  it('a set week travels as week=<Monday> beside days, term and kind', () => {
    const q = docsParams({ days: '90', source: 'all', term: 'anistia', kind: 'word', week: '2026-09-14' })
    assert.equal(q.get('week'), '2026-09-14')
    assert.equal(q.get('days'), '90')
    assert.equal(q.get('term'), 'anistia')
    assert.equal(q.get('kind'), 'word')
    assert.equal(q.has('day'), false)
  })
})

describe('persistenceParams / loadPersistence (issue #215)', () => {
  it('persistenceParams sends weeks and limit and nothing else', () => {
    const q = persistenceParams({ weeks: '26', limit: '20' })
    assert.equal(q.get('weeks'), '26')
    assert.equal(q.get('limit'), '20')
    assert.deepEqual([...q.keys()].sort(), ['limit', 'weeks'])
  })

  it('loadPersistence calls GET /api/people/:id/persistence', async () => {
    const calls = stubFetch(true, { terms: [] })
    await loadPersistence('lula', persistenceParams({ weeks: '12', limit: '40' }))
    assert.equal(calls[0].url, '/api/people/lula/persistence?' + persistenceParams({ weeks: '12', limit: '40' }).toString())
  })
})
