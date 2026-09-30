import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { narrowToSources, params, sourcesParams } from '../src/ui/api.js'
import { docsQuery, layoutKey, scopeKeys } from '../src/ui/atlas-model.js'
import { clearScopes, fromScope } from '../src/ui/state.js'
import { persons, seed } from './fixture.js'
import './close.js'

// #297: the pure helpers figure 1 keeps after it becomes src/ui/Atlas.svelte. They live in
// src/ui/atlas-model.ts so node:test can import them without a .svelte or a document.

const controls = (over: Partial<Parameters<typeof params>[0]> = {}) => params({ days: '30', sort: 'count', limit: '18', source: 'all', ...over })

const term = { id: 'reforma', term: 'reforma', kind: 'word', count: 4, pmi: 1 }

describe('scopeKeys: each scope is keyed by the filters its own route actually reads (issue #43 AC1)', () => {
  it('sort and limit move the graph key and leave the sources, docs and testimony keys alone', () => {
    const base = scopeKeys('lula', controls())
    const sorted = scopeKeys('lula', controls({ sort: 'pmi' }))
    const wider = scopeKeys('lula', controls({ limit: '24' }))
    assert.notEqual(sorted.graph, base.graph, 'a sort change is a different graph')
    assert.notEqual(wider.graph, base.graph, 'a term-limit change is a different graph')
    for (const scope of ['sources', 'docs', 'testimony'] as const) {
      assert.equal(sorted[scope], base[scope], `${scope} does not depend on the term ordering`)
      assert.equal(wider[scope], base[scope], `${scope} does not depend on how many terms are drawn`)
    }
  })

  it('no key carries an outlet: picking one is a reading inside the second figure', () => {
    for (const key of Object.values(scopeKeys('lula', controls()))) assert.doesNotMatch(key, /domain=/, `${key} must not carry an outlet`)
  })

  it('person, period and source move every key', () => {
    const base = scopeKeys('lula', controls())
    for (const [name, other] of [
      ['person', scopeKeys('tarcisio', controls())],
      ['days', scopeKeys('lula', controls({ days: '7' }))],
      ['source', scopeKeys('lula', controls({ source: 'gnews' }))],
    ] as const) {
      for (const scope of ['graph', 'sources', 'docs', 'testimony'] as const) assert.notEqual(other[scope], base[scope], `${name} must refetch ${scope}`)
    }
  })

  it('the docs key separates the person summary from a selected term', () => {
    const general = scopeKeys('lula', controls()).docs
    const selected = scopeKeys('lula', controls(), term).docs
    assert.notEqual(general, selected, 'a selected term must not read the person summary out of the memo')
  })
})

describe('a representative interaction sequence, counted per scope (issue #43 AC3)', () => {
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

  it("spends a request only where that scope's own filters moved", async () => {
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

describe('docsQuery: the narrowed querystring still asks the API the same question (issue #43 AC4)', () => {
  before(seed)

  it('sourcesParams drops domain, sort and limit, and the route answers identically without them', async () => {
    const wide = sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all' })
    assert.deepEqual(narrowToSources(controls()).toString(), wide.toString())
    const before = await (await app.request('/api/people/lula/sources?' + controls())).json()
    const after = await (await app.request('/api/people/lula/sources?' + narrowToSources(controls()))).json()
    assert.deepEqual(after, before, 'narrowing the URL must not change a single row')
  })

  it('drops sort and min, and the route answers identically without them', async () => {
    const q = docsQuery(controls(), null)
    assert.equal(q.has('sort'), false)
    assert.equal(q.has('min'), false)
    assert.equal(q.has('testimony'), false)
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
})

describe('layoutKey (issue #210)', () => {
  it('layoutKey changes with reach', () => {
    const a = [{ id: 'word:x', term: 'x', kind: 'word', count: 4, pmi: 1, reach: 10 }]
    const b = [{ ...a[0], reach: 11 }]
    const c = [{ ...a[0], reach: null }]
    assert.notEqual(layoutKey(persons[0], a, 'reach', '18'), layoutKey(persons[0], b, 'reach', '18'))
    assert.notEqual(layoutKey(persons[0], a, 'reach', '18'), layoutKey(persons[0], c, 'reach', '18'))
    assert.equal(layoutKey(persons[0], a, 'reach', '18'), layoutKey(persons[0], [...a], 'reach', '18'))
  })

  it('#297 AC7: sort and limit move the key, no person yields the empty key', () => {
    const a = [{ id: 'word:x', term: 'x', kind: 'word', count: 4, pmi: 1 }]
    assert.notEqual(layoutKey(persons[0], a, 'count', '18'), layoutKey(persons[0], a, 'pmi', '18'))
    assert.notEqual(layoutKey(persons[0], a, 'count', '18'), layoutKey(persons[0], a, 'count', '24'))
    assert.equal(layoutKey(undefined, a, 'count', '18'), '[]')
  })
})
