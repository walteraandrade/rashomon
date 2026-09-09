import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { render } from 'svelte/server'
import { TestimonyFigure } from '../.svelte-ssr/ssr.js'

// The second figure as a Svelte component. What used to be paintTestimony + paintStrip +
// paintOutlets plus three handlers in app.js is one component that owns the outlet in focus,
// so these assertions replace the app.js handler-table ones in selection-toggle.

const sample = {
  method: 'kikori:q8',
  overall: { score: -2.16, n: 784 },
  by_source: [
    { source: 'bluesky', score: -1.89, n: 621 },
    { source: 'gkg', score: -4.22, n: 39 },
  ],
  by_domain: [
    { domain: 'bbc.com', source: 'gnews', score: -2, n: 6 },
    { domain: 'g1.globo.com', source: 'gnews', score: -3.62, n: 13 },
  ],
}

const outletRows = [
  { domain: 'bbc.com', source: 'gnews', label: 'bbc', docs: 9, tone: null },
  { domain: 'g1.globo.com', source: 'gnews', label: 'g1', docs: 21, tone: null },
]

const paint = (props: Record<string, unknown>) => render(TestimonyFigure, { props }).body

describe('testimony figure (svelte)', () => {
  it('shows the loading state before any data arrives', () => {
    assert.match(paint({ status: 'loading' }), /Carregando…/)
  })

  it('shows the error state when the fetch fails', () => {
    assert.match(paint({ status: 'error' }), /Não foi possível carregar a avaliação/)
  })

  it('paints the verdict, the source chips and the merged outlet grid', () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows })
    assert.match(html, /-2,16/, 'the overall score')
    assert.match(html, /784/, 'the text count')
    assert.match(html, /class="source-chips"/)
    assert.match(html, /class="outlet-grid"/)
    assert.match(html, /g1\.globo\.com/)
    assert.match(html, /21/, 'the outlet doc count comes from /sources')
  })

  it('carries no outlet ranking of its own: the merged grid is the only list', () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows })
    assert.equal(html.match(/class="outlet-grid"/g)?.length, 1)
    assert.doesNotMatch(html, /data-testimony-domain/, 'the second per-outlet list is gone')
  })

  it('shows no focus line while no outlet is picked', () => {
    assert.doesNotMatch(paint({ status: 'ready', testimony: sample, outletRows }), /class="focus"/)
  })

  it('escapes an outlet name without an esc() call anywhere in the component', () => {
    const html = paint({
      status: 'ready',
      testimony: sample,
      outletRows: [{ domain: '<img src=x onerror=1>', source: 'gnews', label: 'x', docs: 3, tone: null }],
    })
    assert.doesNotMatch(html, /<img src=x/)
    assert.match(html, /&lt;img/)
  })

  it('the empty recorte names the method instead of drawing a ruler', () => {
    const html = paint({ status: 'ready', testimony: { ...sample, overall: { score: null, n: 0 } } })
    assert.match(html, /Nenhum texto avaliado neste recorte \(método kikori:q8\)/)
    assert.doesNotMatch(html, /class="strip-svg"/)
  })

  it('the ruler carries one dot per outlet, each releasable by a second click', () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows })
    assert.equal(html.match(/class="strip-dot[^"]*"/g)?.length, 2)
    assert.match(html, /toque de novo para soltar|Toque numa bolinha/)
  })
})
