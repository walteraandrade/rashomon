import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { loadTestimony, narrowToTestimony, params, testimonyParams } from '../public/js/api.js'
import { scopeKeys } from '../public/js/app.js'
import { signed, testimonyClass, testimonyColor, testimonyFocus, testimonyPosition, toneColor } from '../public/js/format.js'
import { paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../public/js/render.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
import { seed } from './fixture.js'

// The kikori avaliação on the reading page: GET /api/people/:id/testimony painted into the
// side column (overall, per source, per outlet) and explained in the "Como ler" chapter.
// Behaviour goes through the modules; design-5.html is read only for the markup it must hold.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')
const controls = (over: Partial<Parameters<typeof params>[0]> = {}) => params({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all', ...over })
const ids = ['testimonyLabel', 'testimonyList']

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
    { domain: 'fdusp.bsky.social', source: 'bluesky', score: 0.76, n: 3 },
  ],
}

describe('testimony UI: the request carries only what the route reads', () => {
  it('testimonyParams keeps days, source and min and drops domain, sort and limit', () => {
    const p = testimonyParams({ days: '7', sort: 'pmi', limit: '24', source: 'gnews', domain: 'g1.globo.com' })
    assert.equal(p.toString(), new URLSearchParams({ days: '7', source: 'gnews', min: '3' }).toString())
    assert.equal(p.has('method'), false, 'the server resolves the default method; the client never guesses a label')
  })

  it('loadTestimony hits GET /api/people/:id/testimony', async () => {
    const previous = globalThis.fetch
    let url = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      url = String(input)
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      await loadTestimony('lula', narrowToTestimony(controls()))
    } finally {
      globalThis.fetch = previous
    }
    assert.equal(url, '/api/people/lula/testimony?days=30&source=all&min=3')
  })

  it('the testimony memo key ignores sort, limit and domain and moves with person, period and source', () => {
    const base = scopeKeys('lula', controls())
    assert.equal(scopeKeys('lula', controls({ sort: 'pmi' })).testimony, base.testimony)
    assert.equal(scopeKeys('lula', controls({ limit: '24' })).testimony, base.testimony)
    assert.equal(scopeKeys('lula', controls({ domain: 'g1.globo.com' })).testimony, base.testimony, 'picking an outlet repaints the panel, it does not refetch it')
    assert.notEqual(scopeKeys('tarcisio', controls()).testimony, base.testimony)
    assert.notEqual(scopeKeys('lula', controls({ days: '7' })).testimony, base.testimony)
    assert.notEqual(scopeKeys('lula', controls({ source: 'gnews' })).testimony, base.testimony)
  })
})

describe('testimony UI: pure helpers', () => {
  it('testimonyClass follows the model cut at ±2.5 and stays null without a score', () => {
    assert.equal(testimonyClass(-2.5), 'negativo')
    assert.equal(testimonyClass(-2.49), 'neutro')
    assert.equal(testimonyClass(2.49), 'neutro')
    assert.equal(testimonyClass(2.5), 'positivo')
    assert.equal(testimonyClass(null), null)
    assert.equal(testimonyClass(undefined), null)
  })

  it('testimonyColor is transparent without a score and saturates at ±5; toneColor keeps its ±3 range', () => {
    assert.equal(testimonyColor(null), 'transparent')
    assert.equal(testimonyColor(-5), testimonyColor(-10), 'below -5 nothing gets redder')
    assert.equal(testimonyColor(5), testimonyColor(10))
    assert.notEqual(testimonyColor(-2), testimonyColor(2))
    assert.equal(toneColor(-3), 'rgb(255,107,125)', 'the tone ramp is unchanged by the refactor')
    assert.equal(toneColor(3), 'rgb(126,231,135)')
    assert.equal(toneColor(0), 'rgb(98,106,140)')
    assert.equal(toneColor(null), 'transparent')
  })

  it('testimonyPosition maps -10..+10 onto 0..100% and signed() shows the sign', () => {
    assert.equal(testimonyPosition(-10), 0)
    assert.equal(testimonyPosition(0), 50)
    assert.equal(testimonyPosition(10), 100)
    assert.equal(testimonyPosition(25), 100, 'clamped')
    assert.equal(signed(1.5), '+1,5')
    assert.equal(signed(-2.16), '-2,16')
    assert.equal(signed(0), '0')
  })
})

describe('testimony UI: the painter', () => {
  it('paints the overall score, one row per source and one per outlet, and echoes the method', () => {
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'all', onPick: () => {} })
      assert.equal(els.testimonyLabel.textContent, '-2,16')
      const html = els.testimonyList.innerHTML
      assert.match(html, /<strong[^>]*>-2,16<\/strong>/)
      assert.match(html, /neutro · média de 784 textos avaliados/)
      assert.match(html, /<span class="d">Bluesky<\/span><span class="s"><\/span><span class="n">621<\/span>/, 'sources are labelled in pt-BR')
      assert.match(html, /<span class="d">GKG<\/span>/)
      assert.match(html, /data-testimony-domain="g1\.globo\.com"[^>]*><span class="d">g1\.globo\.com<\/span><span class="s">Google News<\/span><span class="n">13<\/span>/)
      const order = [...html.matchAll(/data-testimony-domain="([^"]+)"/g)].map((m) => m[1])
      assert.deepEqual(order, ['g1.globo.com', 'bbc.com', 'fdusp.bsky.social'], 'outlets are ordered by how many texts were scored')
      assert.match(html, /\+0,76/, 'positive scores carry their sign')
      assert.match(html, /kikori \(kikori:q8\)/, 'the method label the server answered under is visible')
      assert.match(html, /não compare pessoas entre si/, 'the known name bias is stated next to the numbers')
      for (const value of inlineStyles(html)) assert.ok(value.startsWith('--'), `paintTestimony emitted style="${value}"`)
    })
  })

  it('marks the active outlet the same way the outlet list does, and says its own score next to the overall one', () => {
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'bbc.com', onPick: () => {} })
      assert.match(els.testimonyList.innerHTML, /class="outlet is-active" data-testimony-domain="bbc\.com" aria-pressed="true"/)
      assert.match(els.testimonyList.innerHTML, /class="outlet " data-testimony-domain="g1\.globo\.com" aria-pressed="false"/)
      assert.match(els.testimonyList.innerHTML, /<p class="focus"><b>bbc\.com<\/b>: <strong[^>]*>-2<\/strong> em 6 textos\. O número acima é o recorte inteiro\.<\/p>/)
      assert.equal(els.testimonyLabel.textContent, '-2,16', 'the summary keeps the whole recorte')
    })
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'tiny.example', onPick: () => {} })
      assert.match(els.testimonyList.innerHTML, /<b>tiny\.example<\/b>: menos de 3 textos avaliados/)
    })
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'all', onPick: () => {} })
      assert.doesNotMatch(els.testimonyList.innerHTML, /class="focus"/)
    })
  })

  it('testimonyFocus folds one outlet across its sources, weighted by texts', () => {
    const rows = [
      { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
      { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      { domain: 'bbc.com', source: 'gnews', score: 2, n: 5 },
    ]
    assert.deepEqual(testimonyFocus(rows, 'g1.globo.com'), { score: -3.25, n: 4 })
    assert.deepEqual(testimonyFocus(rows, 'bbc.com'), { score: 2, n: 5 })
    assert.equal(testimonyFocus(rows, 'all'), null)
    assert.equal(testimonyFocus(rows, 'nobody.example'), null)
  })

  it('says when nothing was scored instead of showing a zero', () => {
    withFakeDocument(ids, (els) => {
      els.testimonyLabel.textContent = 'stale'
      paintTestimony({ data: { method: 'kikori:q8:abc', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }, domain: 'all', onPick: () => {} })
      assert.equal(els.testimonyLabel.textContent, '')
      assert.match(els.testimonyList.innerHTML, /Nenhum texto avaliado neste recorte \(método kikori:q8:abc\)/)
      assert.doesNotMatch(els.testimonyList.innerHTML, /<strong/)
    })
  })

  it('says when outlets fall under the floor, and has loading and error states', () => {
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: { ...sample, by_domain: [] }, domain: 'all', onPick: () => {} })
      assert.match(els.testimonyList.innerHTML, /Nenhum veículo com 3 ou mais textos avaliados/)
      paintTestimonyLoading()
      assert.equal(els.testimonyList.textContent, 'Carregando…')
      assert.equal(els.testimonyLabel.textContent, '')
      paintTestimonyError()
      assert.match(els.testimonyList.innerHTML, /Não foi possível carregar a avaliação/)
    })
  })
})

describe('testimony UI: the route and the painter agree on the shape', () => {
  before(() => seed())

  it('what GET /api/people/:id/testimony returns paints without adaptation', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?' + testimonyParams({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all' }) + '&method=stub')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.overall.n > 0, 'the fixture must have scored rows in the window, or this proves nothing')
    withFakeDocument(ids, (els) => {
      paintTestimony({ data, domain: 'estadao.com.br', onPick: () => {} })
      assert.equal(els.testimonyLabel.textContent, signed(data.overall.score))
      assert.match(els.testimonyList.innerHTML, /data-testimony-domain="estadao\.com\.br" aria-pressed="true"/)
      assert.match(els.testimonyList.innerHTML, /kikori \(stub\)/)
    })
  })
})

describe('testimony UI: the page holds the panel and explains it', () => {
  it('design-5.html has the panel in the side column, between the outlets and the candidates', () => {
    const html = read('design-5.html')
    const side = html.match(/<div class="side">([\s\S]*?)<aside/)?.[1] ?? ''
    assert.match(side, /<details class="outlets testimony" id="testimony" open><summary class="eyebrow">Avaliação <b id="testimonyLabel"><\/b><\/summary><div id="testimonyList">/)
    assert.ok(side.indexOf('id="outlets"') < side.indexOf('id="testimony"'), 'after the outlets')
    assert.ok(side.indexOf('id="testimony"') < side.indexOf('id="candidateQueue"'), 'before the candidates')
  })

  it('the "Como ler" chapter defines the scale, the cut and the name bias', () => {
    const chapter = read('design-5.html').match(/<section class="chapter" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<h3>Avaliação<\/h3>/)
    assert.match(chapter, /nota de −10 a \+10/)
    assert.match(chapter, /Até −2,5 conta como contra; de \+2,5 para cima, a favor/)
    assert.match(chapter, /nunca compare a nota de uma pessoa com a de outra/)
    assert.match(chapter, /Vale para todas as fontes, ao contrário do tom/)
  })

  it('atlas.css styles the panel with nothing under 11px', () => {
    const css = read('atlas.css')
    assert.match(css, /\.testimony \.verdict strong \{[^}]*var\(--tone, var\(--ink\)\)/)
    assert.match(css, /\.testimony \.scale i \{[^}]*left: var\(--pos, 50%\)/)
    const sizes = [...css.matchAll(/\.testimony[^{]*\{[^}]*font(?:-size)?:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    assert.ok(sizes.length >= 3)
    assert.deepEqual(sizes.filter((s) => s < 11), [])
  })
})
