import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHandlers } from '../public/js/app.js'

// Selecting a term used to be one way: once a word was picked, the only path back to the clean
// map was the clear button in the toolbar. Two gestures now let the selection go — clicking the
// selected term again, and clicking empty space inside the map or the list.

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

describe('selection is a toggle, and empty space releases it', () => {
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
    h.background({ closest: (s: string) => (s === '[data-node], [data-col]' ? {} : null) } as unknown as Element)
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

// The second figure used to write a page-wide filter: clicking an outlet down there narrowed
// the atlas, the header and the documents above it. The outlet is now a reading inside its own
// figure, so no querystring the page builds may carry one.

describe('the outlet in focus is local to the second figure', () => {
  it('no route the page builds carries a domain', async () => {
    const { params, sourcesParams, testimonyParams } = await import('../public/js/api.js')
    const opts = { days: '30', sort: 'count', limit: '18', source: 'all' }
    for (const [name, q] of [
      ['graph', params(opts)],
      ['sources', sourcesParams(opts)],
      ['testimony', testimonyParams(opts)],
    ] as const)
      assert.equal(q.has('domain'), false, `${name} must answer for the whole recorte`)
  })

  // The three outlet behaviours (a click on a row or dot keeps the focus, a click on empty
  // space releases it, a new person drops it) moved into TestimonyFigure.svelte with the state
  // they act on; they are asserted in test/testimony-svelte-acceptance.test.ts.
  it('no control other than the person touches the outlet, and the page never sends one', () => {
    for (const [id, expected] of [
      ['person', ['updateHeader', 'load']],
      ['days', ['loadCandidates', 'updateHeader', 'load']],
      ['sort', ['updateHeader', 'load']],
    ] as const) {
      const calls: string[] = []
      createHandlers({
        loadCandidates: () => calls.push('loadCandidates'),
        updateHeader: () => calls.push('updateHeader'),
        load: () => calls.push('load'),
      }).control(id)()
      assert.deepEqual(calls, expected, `control(${id})`)
    }
  })
})

// The second figure used to spend 1300px: a ruler that repeated the strip above it, four
// full-width rows to say four per-source numbers, and two separate outlet lists — one with the
// document counts, one with the means. It is one list now, in columns.

describe('the second figure carries one outlet list, merged', () => {
  it('mergeOutlets keeps every outlet, attaches a mean only where one exists, and orders by documents', async () => {
    const { mergeOutlets } = await import('../public/js/format.js')
    const merged = mergeOutlets(
      [
        { domain: 'small.example', source: 'rss', docs: 2, tone: null },
        { domain: 'g1.globo.com', source: 'gnews', docs: 13, tone: null },
        { domain: 'g1.globo.com', source: 'rss', docs: 5, tone: null },
      ],
      [
        { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
        { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      ],
    )
    assert.deepEqual(merged, [
      { domain: 'g1.globo.com', sources: ['gnews', 'rss'], docs: 18, score: -3.25, n: 4 },
      { domain: 'small.example', sources: ['rss'], docs: 2, score: null, n: 0 },
    ])
  })

  it('mergeOutlets survives a missing testimony payload', async () => {
    const { mergeOutlets } = await import('../public/js/format.js')
    const merged = mergeOutlets([{ domain: 'g1.globo.com', source: 'gnews', docs: 4, tone: null }], [])
    assert.deepEqual(merged, [{ domain: 'g1.globo.com', sources: ['gnews'], docs: 4, score: null, n: 0 }])
  })

  // The figure's own shape (one column, one ruler, one outlet list, summary before list) is
  // rendered by TestimonyFigure.svelte and asserted against its output in
  // test/testimony-svelte-acceptance.test.ts. design-5.html only holds the mount point.
  it('design-5.html hands the figure to one mount point and keeps no containers of its own', () => {
    const html = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'design-5.html'), 'utf8')
    assert.match(html, /<div id="testimonyFigure"><\/div>/)
    assert.doesNotMatch(html, /figure-lists|id="outletList"|id="testimonyList"/)
  })
})
