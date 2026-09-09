import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { candidatesQuery, narrowToSources, params, sourcesParams } from '../public/js/api.js'
import { createHandlers, debounce, docsQuery, fromScope, scopeKeys } from '../public/js/app.js'
import { SCOPE_LIMIT, SCOPE_TTL_MS, clearScopes, readScope, writeScope } from '../public/js/state.js'
import { seed } from './fixture.js'
import './close.js'

// Issue #43's acceptance criteria, exercised against the real front-end modules rather than
// against a claim about them. The atlas' request bookkeeping lives in public/js/state.js
// (the memo) and public/js/app.js (the keys, the memo wrapper and the debounce), all of which
// import cleanly under node:test, so "no sources request on a sort change" is a counted fact
// here and not only a screenshot.

const controls = (over: Partial<Parameters<typeof params>[0]> = {}) =>
  params({ days: '30', sort: 'count', limit: '18', source: 'all', ...over })

const term = { id: 'reforma', term: 'reforma', kind: 'word', count: 4, pmi: 1 }

describe('issue #43 AC1: each scope is keyed by the filters its own route actually reads', () => {
  it('sort and limit move the graph key and leave the sources and docs keys alone', () => {
    const base = scopeKeys('lula', controls())
    const sorted = scopeKeys('lula', controls({ sort: 'pmi' }))
    const wider = scopeKeys('lula', controls({ limit: '24' }))
    assert.notEqual(sorted.graph, base.graph, 'a sort change is a different graph')
    assert.notEqual(wider.graph, base.graph, 'a term-limit change is a different graph')
    assert.equal(sorted.sources, base.sources, 'the outlet list does not depend on the term ordering')
    assert.equal(wider.sources, base.sources, 'the outlet list does not depend on how many terms are drawn')
    assert.equal(sorted.docs, base.docs, 'the five general documents do not depend on the term ordering')
    assert.equal(wider.docs, base.docs, 'the five general documents do not depend on how many terms are drawn')
  })

  it('no key carries an outlet: picking one is a reading inside the second figure', () => {
    for (const key of Object.values(scopeKeys('lula', controls()))) assert.doesNotMatch(key, /domain=/, `${key} must not carry an outlet`)
  })

  it('person, period and source move all three keys', () => {
    const base = scopeKeys('lula', controls())
    for (const [name, other] of [
      ['person', scopeKeys('tarcisio', controls())],
      ['days', scopeKeys('lula', controls({ days: '7' }))],
      ['source', scopeKeys('lula', controls({ source: 'gnews' }))],
    ] as const) {
      assert.notEqual(other.graph, base.graph, `${name} must refetch the graph`)
      assert.notEqual(other.sources, base.sources, `${name} must refetch the outlet list`)
      assert.notEqual(other.docs, base.docs, `${name} must refetch the documents`)
    }
  })

  it('the docs key separates the person summary from a selected term', () => {
    const general = scopeKeys('lula', controls()).docs
    const selected = scopeKeys('lula', controls(), term).docs
    assert.notEqual(general, selected, 'a selected term must not read the person summary out of the memo')
  })
})

describe('issue #43 AC2: the memo is bounded, short-lived and never caches a failure', () => {
  it('serves a fresh entry without calling the fetcher again', async () => {
    clearScopes()
    let calls = 0
    const fetcher = async () => {
      calls++
      return { rows: calls }
    }
    assert.deepEqual(await fromScope('sources', 'k', fetcher), { rows: 1 })
    assert.deepEqual(await fromScope('sources', 'k', fetcher), { rows: 1 })
    assert.equal(calls, 1)
  })

  it('a rejection leaves the bucket untouched, so the next attempt is a real attempt', async () => {
    clearScopes()
    let calls = 0
    await assert.rejects(
      fromScope('graph', 'k', async () => {
        calls++
        throw new Error('HTTP 500')
      }),
    )
    assert.equal(readScope('graph', 'k'), null, 'a failed response must never become a hit')
    await assert.rejects(
      fromScope('graph', 'k', async () => {
        calls++
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }),
    )
    assert.equal(calls, 2, 'the retry must reach the network')
    assert.equal(readScope('graph', 'k'), null, 'an abort must never become a hit either')
  })

  it('expires an entry once it is older than the TTL', () => {
    clearScopes()
    writeScope('docs', 'k', { docs: [] }, 1_000)
    assert.ok(readScope('docs', 'k', 1_000 + SCOPE_TTL_MS), 'still fresh at the boundary')
    assert.equal(readScope('docs', 'k', 1_001 + SCOPE_TTL_MS), null, 'stale one millisecond later')
  })

  it('evicts the oldest write once the bucket is full, so a long session cannot grow it', () => {
    clearScopes()
    for (let i = 0; i <= SCOPE_LIMIT; i++) writeScope('graph', `k${i}`, i)
    assert.equal(readScope('graph', 'k0'), null, 'the oldest key is the one that goes')
    assert.deepEqual(readScope('graph', `k${SCOPE_LIMIT}`), { value: SCOPE_LIMIT })
  })

  it('distinguishes a cached null from nothing cached', () => {
    clearScopes()
    writeScope('docs', 'k', null)
    assert.deepEqual(readScope('docs', 'k'), { value: null })
    assert.equal(readScope('docs', 'missing'), null)
  })
})

describe('issue #43 AC3: a representative interaction sequence, counted per scope', () => {
  // Replays the sequence the browser pass runs, driving the real keys and the real memo with
  // a counting fetcher in place of the network.
  const replay = async () => {
    clearScopes()
    const counts: Record<string, number> = { graph: 0, sources: 0, docs: 0 }
    const fetched: { step: string; requests: number }[] = []
    let personId = 'lula'
    let filters = controls()
    let selected: typeof term | null = null

    const loadAll = async () => {
      const keys = scopeKeys(personId, filters, selected)
      await fromScope('sources', keys.sources, async () => ++counts.sources)
      await fromScope('graph', keys.graph, async () => ++counts.graph)
      await fromScope('docs', keys.docs, async () => ++counts.docs)
    }
    const step = async (name: string, fn: () => Promise<void> | void) => {
      const before = counts.graph + counts.sources + counts.docs
      await fn()
      fetched.push({ step: name, requests: counts.graph + counts.sources + counts.docs - before })
    }

    await step('boot', loadAll)
    await step('sort', () => {
      filters = controls({ sort: 'pmi' })
      return loadAll()
    })
    await step('limit', () => {
      filters = controls({ sort: 'pmi', limit: '24' })
      return loadAll()
    })
    // Re-entering the unselected inspector, which is what a view-mode switch does.
    await step('view mode', () => fromScope('docs', scopeKeys(personId, filters, null).docs, async () => ++counts.docs).then(() => {}))
    await step('person', () => {
      personId = 'tarcisio'
      filters = controls({ sort: 'pmi', limit: '24' })
      return loadAll()
    })
    return { fetched, counts }
  }

  it('spends a request only where that scope\'s own filters moved', async () => {
    const { fetched, counts } = await replay()
    assert.deepEqual(fetched, [
      { step: 'boot', requests: 3 },
      { step: 'sort', requests: 1 },
      { step: 'limit', requests: 1 },
      { step: 'view mode', requests: 0 },
      { step: 'person', requests: 3 },
    ])
    assert.equal(counts.sources, 2, 'the outlet list is fetched once per person, not once per control change')
    assert.equal(counts.docs, 2, 'the five general documents survive sort, limit and the view-mode switch')
    assert.equal(counts.graph + counts.sources + counts.docs, 8)
  })
})

describe('issue #43 AC4: the narrowed querystrings still ask the API the same question', () => {
  before(seed)

  it('sourcesParams drops domain, sort and limit, and the route answers identically without them', async () => {
    const wide = sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all' })
    for (const dropped of ['domain', 'sort', 'limit']) assert.equal(wide.has(dropped), false, `${dropped} is ignored by sourcesFor and must not reach the URL`)
    assert.deepEqual(narrowToSources(controls()).toString(), sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all' }).toString())

    const before = await (await app.request('/api/people/lula/sources?' + controls())).json()
    const after = await (await app.request('/api/people/lula/sources?' + narrowToSources(controls()))).json()
    assert.deepEqual(after, before, 'narrowing the URL must not change a single row')
  })

  it('docsQuery drops sort and min, and the route answers identically without them', async () => {
    const q = docsQuery(controls(), null)
    assert.equal(q.has('sort'), false)
    assert.equal(q.has('min'), false)
    assert.equal(q.get('term'), '')
    assert.equal(q.get('kind'), 'all')
    assert.equal(q.get('limit'), '5')
    assert.equal(q.get('days'), '30', 'the rest of the recorte survives')

    const wide = new URLSearchParams(controls())
    wide.set('term', '')
    wide.set('kind', 'all')
    wide.set('limit', '5')
    const before = await (await app.request('/api/people/lula/docs?' + wide)).json()
    const after = await (await app.request('/api/people/lula/docs?' + q)).json()
    assert.deepEqual(after, before)
  })

  it('a selected term still narrows the docs route the way it did before', async () => {
    const q = docsQuery(controls(), term)
    assert.equal(q.get('term'), 'reforma')
    assert.equal(q.get('kind'), 'word')
    const body = (await (await app.request('/api/people/lula/docs?' + q)).json()) as { docs: { text: string }[] }
    assert.ok(body.docs.length, 'the fixture has documents mentioning reforma')
    for (const doc of body.docs) assert.match(doc.text.toLowerCase(), /reforma/)
  })

  it('the candidate queue keeps its own querystring, untouched by this change', () => {
    assert.equal(candidatesQuery({ days: '7' }).toString(), new URLSearchParams({ days: '7', min: '3', limit: '30' }).toString())
  })
})

describe('issue #43 AC5: local-only interactions still reach no network, and the controls coalesce', () => {
  const spied = () => {
    const calls: string[] = []
    const spy = (name: string) => () => {
      calls.push(name)
    }
    return {
      calls,
      handlers: createHandlers({
        paintCurrentSelection: spy('paintCurrentSelection'),
        choose: spy('choose'),
        load: spy('load'),
        loadCandidates: spy('loadCandidates'),
        setMode: spy('setMode'),
        setZoom: spy('setZoom'),
        getZoomLevel: () => 1,
        clearSearch: spy('clearSearch'),
        canClear: () => true,
        updateHeader: spy('updateHeader'),
        setSource: spy('setSource'),
      }),
    }
  }

  it('search, zoom and the view-mode buttons never ask for a reload', () => {
    for (const name of ['search', 'zoomIn', 'zoomOut', 'zoomReset', 'modeMap', 'modeColumns'] as const) {
      const { calls, handlers } = spied()
      handlers[name]()
      assert.ok(!calls.includes('load'), `${name} must stay a local repaint`)
      assert.ok(!calls.includes('loadCandidates'), `${name} must not refetch the queue either`)
    }
  })

  it('the person, period, sort, limit and source controls still ask for a reload', () => {
    for (const id of ['person', 'days', 'sort', 'limit']) {
      const { calls, handlers } = spied()
      handlers.control(id)()
      assert.ok(calls.includes('load'), `${id} must still reload`)
    }
    const { calls, handlers } = spied()
    handlers.source('gnews')()
    assert.deepEqual(calls, ['setSource', 'load', 'updateHeader'])
  })

  it('debounce collapses a burst into one trailing call', async () => {
    let calls = 0
    const run = debounce(() => calls++, 10)
    run()
    run()
    run()
    assert.equal(calls, 0, 'nothing fires on the leading edge')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 1, 'a burst of control changes costs one load, not three')
    run()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 2, 'a later change still loads')
  })
})
