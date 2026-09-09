import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { createHandlers } from '../public/js/app.js'
import { paintSelection } from '../public/js/render.js'
import { getMask } from '../public/js/state.js'
import { withFakeDocument } from './fake-dom.js'

// The figures redesign: the reading page is a sequence of graphs, each in its own card with
// a title, a subtitle and its own controls, no side column. The mask is on by default, the
// outlet filter has a chip under the sentence, and the explanations left for their own page.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')

describe('figures UI: the page is a sequence of graphs', () => {
  it('design-5.html carries two figures, each with a numbered eyebrow, a title and a subtitle, and no side column', () => {
    const html = read('design-5.html')
    const figures = [...html.matchAll(/<section class="figure[^"]*" id="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(figures, ['workspace'], 'the second figure is a Svelte mount point')
    assert.match(html, /<div id="testimonyFigure"><\/div>/)
    assert.match(html, /<span class="eyebrow">Gráfico 1<\/span><h2 id="atlasTitle">Atlas de palavras<\/h2>/)
    // Gráfico 2's own eyebrow, title and subtitle come from TestimonyFigure.svelte; they are
    // asserted against its rendered output in test/testimony-svelte-acceptance.test.ts.
    assert.equal(html.match(/<p class="figure-sub">/g)?.length, 1)
    assert.doesNotMatch(html, /class="side"/)
    // The atlas keeps its toolbar and its detail column inside its own figure.
    const atlas = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    for (const id of ['search', 'modeMap', 'mask', 'zoomIn', 'clear', 'viewport', 'legend', 'inspector']) assert.match(atlas, new RegExp(`id="${id}"`), `${id} belongs to the atlas figure`)
  })

  it('there is no page-wide outlet filter: no chip under the sentence, and the sentence keeps its five controls', () => {
    const html = read('design-5.html')
    assert.doesNotMatch(html, /id="domainClear"/)
    assert.doesNotMatch(html, /id="domainChip"/)
    assert.equal(html.match(/<span class="pick">/g)?.length, 5)
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

  it('GET /como-ler.html answers with the reading page', async () => {
    const res = await app.request('/como-ler.html')
    assert.equal(res.status, 200)
    assert.match(await res.text(), /Como ler o rashomon/)
  })
})

describe('figures UI: colour by avaliação is the default', () => {
  it('state.js starts with the mask on', () => {
    assert.equal(getMask(), true)
  })

  it('paintSelection masks only when the person has a mean to compare against', () => {
    const args = { nodes: [], links: [], selected: null, search: '', layout: null, mode: 'map', sort: 'count', onChoose: () => {}, mask: true }
    withFakeDocument(['viewport', 'columns', 'searchNote', 'edges'], (els) => {
      paintSelection({ ...args, personTestimony: { method: 'kikori', score: -2.1, n: 40 } })
      assert.equal(els.columns.classes['is-masked'], true)
      paintSelection({ ...args, personTestimony: { method: 'kikori', score: null, n: 0 } })
      assert.equal(els.columns.classes['is-masked'], false, 'no mean: the words keep their ink instead of all going grey')
      paintSelection({ ...args, personTestimony: undefined })
      assert.equal(els.columns.classes['is-masked'], false)
    })
  })
})

describe('figures UI: the neutral middle of the mask fades', () => {
  it('maskColor is translucent on the mean and opaque at the ends; the chip ramps stay opaque', async () => {
    const { maskColor, SCALE_MID, testimonyColor, toneColor } = await import('../public/js/format.js')
    assert.equal(maskColor(0), 'rgba(139,144,156,0.50)')
    assert.equal(maskColor(-0.75), 'rgba(197,126,141,0.75)', 'halfway: colour and alpha both halfway')
    assert.equal(maskColor(-1.5), 'rgb(255,107,125)')
    assert.equal(maskColor(9), 'rgb(126,231,135)')
    assert.equal(SCALE_MID, '#8b909c')
    assert.equal(testimonyColor(0), 'rgb(139,144,156)', 'a chip with dark text needs a solid background')
    assert.equal(toneColor(0), testimonyColor(0))
  })
})
