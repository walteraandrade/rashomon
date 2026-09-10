import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { narrowToSources, params, sourcesParams } from '../src/ui/api.js'
import { createHandlers, docsQuery, mount, scopeKeys } from '../src/ui/figures/atlas.js'
import { SOURCE_SEGMENTS, sourceLabels } from '../src/ui/format.js'
import { clearScopes, fromScope } from '../src/ui/state.js'
import { persons, seed } from './fixture.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'

// src/ui/figures/atlas.ts, figure 1: its handler table (createHandlers), its request keys
// (scopeKeys, docsQuery) and its mount(). The painters it calls are in test/render.test.ts, the
// memo in test/state.test.ts and the page markup in test/leitura-ui-acceptance.test.ts.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')

const controls = (over: Partial<Parameters<typeof params>[0]> = {}) => params({ days: '30', sort: 'count', limit: '18', source: 'all', ...over })

const term = { id: 'reforma', term: 'reforma', kind: 'word', count: 4, pmi: 1 }

// Records which injected action each handler calls, so a criterion can assert both what was
// called and what was deliberately not.
const spies = () => {
  const calls: string[] = []
  const spy = (name: string) => () => {
    calls.push(name)
  }
  const actions = {
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
  }
  return { calls, handlers: createHandlers(actions) }
}

describe('createHandlers: local repaints never reload, control changes do (issues #28, #43)', () => {
  it('search highlighting does not rebuild the inspector or wipe loaded documents', () => {
    const { calls, handlers } = spies()
    handlers.search()
    assert.deepEqual(calls, ['paintCurrentSelection'], 'typing in the search box may only repaint the selection: rebuilding the inspector re-renders #docs and wipes the documents already loaded')
  })

  it('search, zoom and the view-mode buttons never ask for a reload', () => {
    for (const name of ['search', 'zoomIn', 'zoomOut', 'zoomReset', 'modeMap', 'modeColumns'] as const) {
      const { calls, handlers } = spies()
      handlers[name]()
      assert.ok(!calls.includes('load'), `${name} must stay a local repaint`)
      assert.ok(!calls.includes('loadCandidates'), `${name} must not refetch the queue either`)
    }
  })

  it('clearing the selection resets the search box and deselects, without reloading the graph', () => {
    const { calls, handlers } = spies()
    handlers.clear()
    assert.deepEqual(calls, ['clearSearch', 'choose'])
  })

  it('Escape clears the same way, and any other key does nothing at all', () => {
    const escape = spies()
    escape.handlers.keydown({ key: 'Escape' })
    assert.deepEqual(escape.calls, ['clearSearch', 'choose'])
    const other = spies()
    other.handlers.keydown({ key: 'a' })
    assert.deepEqual(other.calls, [])
  })

  it('closing the dialog goes through the handler table, and Escape closes it before it clears anything', () => {
    const calls: string[] = []
    const actions = { closeDocs: () => calls.push('closeDocs'), clearSearch: () => calls.push('clearSearch'), choose: () => calls.push('choose') }
    createHandlers(actions).docsClose()
    assert.deepEqual(calls, ['closeDocs'])
    calls.length = 0
    createHandlers({ ...actions, docsOpen: () => true }).keydown({ key: 'Escape' })
    assert.deepEqual(calls, ['closeDocs'], 'the selection behind the modal survives')
    calls.length = 0
    createHandlers({ ...actions, docsOpen: () => false }).keydown({ key: 'Escape' })
    assert.deepEqual(calls, ['clearSearch', 'choose'])
  })

  it('the person, period, sort and limit controls reload; only the period refetches candidates, and none names an outlet (issue #92 AC6)', () => {
    const person = spies()
    person.handlers.control('person')()
    assert.deepEqual(person.calls, ['updateHeader', 'load'], 'the outlet in focus belongs to figure 2 now; resetOutlet is gone from the action interface')
    const days = spies()
    days.handlers.control('days')()
    assert.deepEqual(days.calls, ['loadCandidates', 'updateHeader', 'load'])
    const sort = spies()
    sort.handlers.control('sort')()
    assert.deepEqual(sort.calls, ['updateHeader', 'load'])
    const limit = spies()
    limit.handlers.control('limit')()
    assert.ok(limit.calls.includes('load'))
    const src = readFileSync(join(root, 'src', 'ui', 'figures', 'atlas.ts'), 'utf8')
    const signature = src.match(/export const createHandlers = \(\{([\s\S]*?)\}\) => \(\{/)?.[1] ?? ''
    assert.doesNotMatch(signature, /\bresetOutlet\b/, "createHandlers' action parameter list must not declare resetOutlet any more")
  })

  it('every source segment goes through the same handler: set the source, then reload the recorte', () => {
    for (const source of Object.keys(sourceLabels)) {
      const { calls, handlers } = spies()
      handlers.source(source)()
      assert.deepEqual(calls, ['setSource', 'load', 'updateHeader'], `${source} must reuse the shared segment handler`)
    }
    for (const [value] of SOURCE_SEGMENTS) {
      const { calls, handlers } = spies()
      handlers.source(value)()
      assert.deepEqual(calls, ['setSource', 'load', 'updateHeader'], `${value} must inherit the shared handler, not bespoke wiring`)
    }
  })

  it('the mask is a paint toggle: createHandlers.mask flips it and nothing refetches', () => {
    let flips = 0
    let loads = 0
    const h = createHandlers({ toggleMask: () => flips++, load: () => loads++ })
    h.mask()
    h.mask()
    assert.equal(flips, 2)
    assert.equal(loads, 0)
  })
})

// Selecting a term used to be one way: once a word was picked, the only path back to the clean
// map was the clear button in the toolbar. Two gestures now let the selection go — clicking the
// selected term again, and clicking empty space inside the map or the list.
describe('createHandlers: selection is a toggle, and empty space releases it', () => {
  const handlersOver = (selection: { id: string | null }) => {
    const chosen: (string | null)[] = []
    const h = createHandlers({
      getSelected: () => selection.id,
      choose: (id) => {
        selection.id = id
        chosen.push(id)
      },
    })
    return { h, chosen }
  }

  it('picking an unselected term selects it', () => {
    const { h, chosen } = handlersOver({ id: null })
    h.pick('t1')
    assert.deepEqual(chosen, ['t1'])
  })

  it('picking the selected term again clears the selection', () => {
    const { h, chosen } = handlersOver({ id: 't1' })
    h.pick('t1')
    assert.deepEqual(chosen, [null])
  })

  it('picking a different term moves the selection instead of clearing it', () => {
    const { h, chosen } = handlersOver({ id: 't1' })
    h.pick('t2')
    assert.deepEqual(chosen, ['t2'])
  })

  it('a click on a selectable target leaves the selection alone', () => {
    const { h, chosen } = handlersOver({ id: 't1' })
    h.background({ closest: (s: string) => (s === '[data-node], [data-col], [data-person-docs]' ? {} : null) } as unknown as Element)
    assert.deepEqual(chosen, [])
  })

  // The person's own entry to her documents sits inside the viewport, so the click that opens
  // her card bubbles into this handler. Were it empty space, the card would close on the way up.
  it("the person's own entry point is not empty space", () => {
    const { h, chosen } = handlersOver({ id: 't1' })
    const target = { closest: (s: string) => (s.includes('[data-person-docs]') ? {} : null) } as unknown as Element
    h.background(target)
    assert.deepEqual(chosen, [])
  })

  it('a click on empty space clears the selection', () => {
    const { h, chosen } = handlersOver({ id: 't1' })
    h.background({ closest: () => null } as unknown as Element)
    assert.deepEqual(chosen, [null])
  })

  it('a click on empty space with nothing selected does not repaint', () => {
    const { h, chosen } = handlersOver({ id: null })
    h.background({ closest: () => null } as unknown as Element)
    assert.deepEqual(chosen, [])
  })
})

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

describe('mount: colour by avaliação is the default', () => {
  // Issue #92 moved the mask flag out of state.js into figures/atlas.js's own mount()
  // closure (no exported getMask any more), so "on by default" is now read off the control
  // mount() itself renders, the same way a reader would see it.
  it('the mask starts on, read off the control mount() renders', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const people = persons.map(({ id, name }) => ({ id, name }))
      routeFetch(calls, { '/graph': { person: people[0], nodes: [], links: [], stats: { about: 0, testimony: { method: 'kikori', score: null, n: 0 } } } })
      mount(els.workspace, { people, initial: {} })
      await flush()
      assert.equal(els.mask.getAttribute('aria-pressed'), 'true')
    })
  })

  it('design-5.html has the toggle next to the view switch, pressed by default', () => {
    assert.match(read('design-5.html'), /<button id="modeColumns" aria-pressed="false">Lista<\/button><\/div><button id="mask" class="quiet-button toggle" aria-pressed="true">Colorir por avaliação<\/button>/)
  })

  it("figures/atlas.ts's resize handling never reads or writes #strip, #testimonyList or #outletList (issue #92 AC13)", () => {
    const src = readFileSync(join(root, 'src', 'ui', 'figures', 'atlas.ts'), 'utf8')
    for (const id of ['strip', 'testimonyList', 'outletList']) assert.doesNotMatch(src, new RegExp(`\\$\\('${id}'\\)`), `figure 1 must not touch #${id}`)
  })
})
