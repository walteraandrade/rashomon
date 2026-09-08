import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { loadTestimony, narrowToTestimony, params, testimonyParams } from '../public/js/api.js'
import { scopeKeys } from '../public/js/app.js'
import { signed, testimonyClass, testimonyColor, testimonyFocus, testimonyPosition, toneColor } from '../public/js/format.js'
import { paintStrip, paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../public/js/render.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
import { seed } from './fixture.js'

// The kikori avaliação on the reading page: GET /api/people/:id/testimony painted into the
// side column (overall, per source, per outlet) and explained in the "Como ler" chapter.
// Behaviour goes through the modules; design-5.html is read only for the markup it must hold.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')
const controls = (over: Partial<Parameters<typeof params>[0]> = {}) => params({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all', ...over })
const ids = ['testimonyLabel', 'testimonyList', 'strip']

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

describe('testimony strip: the outlets on the axis under the map', () => {
  it('swarm keeps every x, never overlaps two dots and puts the biggest on the axis', async () => {
    const { swarm } = await import('../public/js/layout.js')
    const items = [
      { id: 'a', x: 100, r: 10 },
      { id: 'b', x: 104, r: 6 },
      { id: 'c', x: 108, r: 6 },
      { id: 'd', x: 300, r: 8 },
      { id: 'e', x: 101, r: 14 },
    ]
    const placed = swarm(items)
    assert.equal(placed.length, items.length)
    for (const p of placed) assert.equal(p.x, items.find((i) => i.id === p.id)?.x, 'x is the score; the swarm may only move y')
    assert.equal(placed.find((p) => p.id === 'e')?.y, 0, 'the biggest dot sits on the axis')
    assert.equal(placed.find((p) => p.id === 'd')?.y, 0, 'a dot with no neighbour sits on the axis')
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j]
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 1.5 - 1e-6, `${a.id} and ${b.id} overlap`)
      }
    assert.deepEqual(swarm(items), placed, 'deterministic')
  })

  it('foldTestimonyDomains merges one outlet across sources, weighted by texts, most texts first', async () => {
    const { foldTestimonyDomains } = await import('../public/js/format.js')
    const folded = foldTestimonyDomains([
      { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
      { domain: 'bbc.com', source: 'gnews', score: 2, n: 5 },
      { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      { domain: 'nil.example', source: 'rss', score: null, n: 0 },
    ])
    assert.deepEqual(folded, [
      { domain: 'bbc.com', sources: ['gnews'], score: 2, n: 5 },
      { domain: 'g1.globo.com', sources: ['gnews', 'rss'], score: -3.25, n: 4 },
    ])
  })

  it('stripLayout puts -10 at the left pad, +10 at the right pad and sizes dots by texts', async () => {
    const { stripLayout, stripRadius } = await import('../public/js/render.js')
    const layout = stripLayout(
      [
        { domain: 'left.example', source: 'gnews', score: -10, n: 3 },
        { domain: 'right.example', source: 'gnews', score: 10, n: 100 },
        { domain: 'mid.example', source: 'gnews', score: 0, n: 10 },
      ],
      860,
    )
    const by = (d: string) => layout.dots.find((x) => x.domain === d)!
    assert.equal(by('left.example').x, 28)
    assert.equal(by('right.example').x, 860 - 28)
    assert.equal(by('mid.example').x, 430)
    assert.ok(by('right.example').r > by('mid.example').r && by('mid.example').r > by('left.example').r)
    assert.equal(stripRadius(3), 3 + 2 * Math.sqrt(3))
    assert.equal(stripRadius(10_000), 22, 'capped')
    assert.equal(stripRadius(10_000, 328), 22 * 0.55, 'a phone-wide strip shrinks the dots, floor 55%')
    assert.equal(stripRadius(3, 2000), 3 + 2 * Math.sqrt(3), 'a wide strip never grows them')
    assert.ok(stripLayout([{ domain: 'a.example', source: 'gnews', score: 0, n: 10 }], 328).dots[0].r < by('mid.example').r, 'same texts, narrower strip, smaller dot')
    assert.equal(layout.height, layout.half * 2)
  })

  it('paintStrip draws one dot per outlet, marks the active one, and hides itself with nothing to draw', () => {
    withFakeDocument(['strip'], (els) => {
      paintStrip({ data: sample, domain: 'bbc.com', onPick: () => {} })
      assert.equal(els.strip.hidden, false)
      const html = els.strip.innerHTML
      const dots = [...html.matchAll(/data-strip-domain="([^"]+)"/g)].map((m) => m[1])
      assert.deepEqual(dots, ['g1.globo.com', 'bbc.com', 'fdusp.bsky.social'])
      assert.match(html, /class="strip-dot is-active" data-strip-domain="bbc\.com" role="button" tabindex="0" aria-pressed="true"/)
      assert.match(html, /<title>g1\.globo\.com · Google News · -3,62 em 13 textos<\/title>/)
      assert.match(html, /class="strip-mean" style="--pos:39\.2%">média da pessoa -2,16/)
      assert.match(html, /<line class="strip-overall"/)
      assert.match(html, /−10 contra<\/span><span>0<\/span><span>\+10 a favor/)
      assert.match(html, /toque de novo para soltar/)
      for (const value of inlineStyles(html)) assert.ok(value.startsWith('--'), `paintStrip emitted style="${value}"`)
      const g1 = Number(html.match(/data-strip-domain="g1\.globo\.com".*?<circle cx="([\d.]+)"/)?.[1])
      const fdusp = Number(html.match(/data-strip-domain="fdusp\.bsky\.social".*?<circle cx="([\d.]+)"/)?.[1])
      assert.ok(g1 < fdusp, 'a more hostile outlet sits further left')
    })
    withFakeDocument(['strip'], (els) => {
      paintStrip({ data: { ...sample, by_domain: [] }, domain: 'all', onPick: () => {} })
      assert.equal(els.strip.hidden, true)
      assert.equal(els.strip.innerHTML, '')
    })
    withFakeDocument(['testimonyLabel', 'testimonyList', 'strip'], (els) => {
      els.strip.hidden = false
      paintTestimonyLoading()
      assert.equal(els.strip.hidden, true, 'a load in flight blanks the strip too')
    })
  })

  it('design-5.html holds the strip under the legend, inside the canvas, and the chapter explains it', () => {
    const html = read('design-5.html')
    const canvas = html.match(/<div class="canvas">([\s\S]*?)<div class="side">/)?.[1] ?? ''
    assert.match(canvas, /<div class="legend" id="legend"><\/div>\s*<figure class="strip" id="strip" aria-label="Veículos na régua da avaliação" hidden><\/figure>/)
    const chapter = html.match(/<section class="chapter" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>A régua embaixo do mapa<\/b>/)
    assert.match(chapter, /a linha vertical é a média da pessoa/)
  })
})
