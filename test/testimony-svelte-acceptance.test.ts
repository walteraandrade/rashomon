import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { render } from 'svelte/server'
import { app } from '../src/server.js'
import { testimonyParams } from '../public/js/api.js'
import { signed } from '../public/js/format.js'
import { seed } from './fixture.js'
import './close.js'
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

  it('every inline style it emits is a --var override, never a hardcoded declaration', () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows })
    for (const [, value] of html.matchAll(/style="([^"]*)"/g))
      assert.ok(value.trimStart().startsWith('--'), `the figure emitted style="${value}"`)
    assert.match(html, /style="--tone:/, 'tone is the one genuinely dynamic value and stays a --var override')
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

  it("says the focused outlet's own score next to the recorte's, and marks its row and dot", () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows, initialOutlet: 'bbc.com' })
    assert.match(html, /<p class="focus"><b>bbc\.com<\/b>/)
    assert.match(html, /em 6 textos\./)
    assert.match(html, /O número acima é o recorte inteiro\./)
    assert.match(html, /class="outlet is-active"/)
    assert.match(html, /class="strip-dot is-active"/)
  })

  it('an outlet with too few scored texts says so instead of inventing a mean', () => {
    const html = paint({ status: 'ready', testimony: sample, outletRows, initialOutlet: 'tiny.example' })
    assert.match(html, /<b>tiny\.example<\/b>/)
    assert.match(html, /menos de 3 textos avaliados, sem média própria/)
  })
})

describe('testimony figure (svelte): the route and the component agree on the shape', () => {
  before(() => seed())

  it('what GET /api/people/:id/testimony returns renders without adaptation', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?' + testimonyParams({ days: '30', sort: 'count', limit: '18', source: 'all' }) + '&method=stub')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.overall.n > 0, 'the fixture must have scored rows in the window, or this proves nothing')
    const html = paint({ status: 'ready', testimony: data, initialOutlet: 'estadao.com.br' })
    assert.match(html, new RegExp(signed(data.overall.score).replace('+', '\\+')))
    assert.match(html, /<p class="focus"><b>estadao\.com\.br<\/b>/)
  })
})
