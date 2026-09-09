import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { loadTestimony, narrowToTestimony, params, testimonyParams } from '../public/js/api.js'
import { scopeKeys } from '../public/js/app.js'
import { signed, testimonyClass, testimonyColor, testimonyFocus, testimonyPosition, toneColor } from '../public/js/format.js'
import { paintColumns, paintStrip, paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../public/js/render.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
import { seed } from './fixture.js'
import './close.js'

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
    assert.equal(toneColor(0), 'rgb(139,144,156)')
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
  it('design-5.html gives the avaliação its own figure: title with the score, the strip, then the lists', () => {
    const html = read('design-5.html')
    const figure = html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''
    assert.ok(figure, 'the second figure must exist')
    assert.match(figure, /<h2 id="testimonyTitle">Avaliação por veículo <b id="testimonyLabel"><\/b><\/h2>/)
    assert.match(figure, /<figure class="strip" id="strip"[^>]*hidden><\/figure>/)
    assert.match(figure, /<div class="testimony-lists" id="testimonyList">/)
    assert.ok(figure.indexOf('id="strip"') < figure.indexOf('id="testimonyList"'), 'the chart comes before its lists')
    assert.ok(figure.indexOf('id="testimonyList"') < figure.indexOf('id="outlets"'), 'the outlet list closes the figure')
    assert.ok(html.indexOf('id="workspace"') < html.indexOf('id="testimony"'), 'after the atlas figure')
  })

  it('the "Como ler" page defines the scale, the cut and the name bias', () => {
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<h3>Gráfico 2 · Avaliação por veículo<\/h3>/)
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
    assert.equal(stripRadius(3), 4 + 2.8 * Math.sqrt(3))
    assert.equal(stripRadius(10_000), 30, 'capped')
    assert.equal(stripRadius(10_000, 328), 30 * 0.55, 'a phone-wide strip shrinks the dots, floor 55%')
    assert.equal(stripRadius(3, 2000), 4 + 2.8 * Math.sqrt(3), 'a wide strip never grows them')
    assert.ok(stripLayout([{ domain: 'a.example', source: 'gnews', score: 0, n: 10 }], 328).dots[0].r < by('mid.example').r, 'same texts, narrower strip, smaller dot')
    assert.equal(layout.height, layout.half * 2)
  })

  it('caps the strip at STRIP_MAX_HEIGHT by shrinking every dot together, never by dropping one', async () => {
    const { STRIP_MAX_HEIGHT, STRIP_MIN_R, stripLayout } = await import('../public/js/render.js')
    // 150 outlets inside a quarter of the axis, like Lula's, each with plenty of texts.
    const crowded = Array.from({ length: 150 }, (_, i) => ({ domain: `o${i}.example`, source: 'gnews', score: -5 + (i % 50) * 0.1, n: 5 + (i % 40) * 3 }))
    const full = stripLayout(crowded.slice(0, 5), 957)
    assert.equal(full.scale, 1, 'a handful of outlets never shrinks')
    const capped = stripLayout(crowded, 957)
    assert.equal(capped.dots.length, 150)
    assert.ok(capped.height <= STRIP_MAX_HEIGHT, `height ${capped.height}`)
    assert.ok(capped.scale < 1 && capped.scale > 0)
    const ratio = capped.dots.find((d) => d.domain === 'o0.example')!.r / full.dots.find((d) => d.domain === 'o0.example')!.r
    for (const d of capped.dots) {
      const base = Math.min(30, 4 + 2.8 * Math.sqrt(d.n))
      assert.ok(Math.abs(d.r / base - ratio) < 1e-9, 'every dot shrinks by the same factor, so sizes stay comparable within the strip')
      assert.ok(d.r >= STRIP_MIN_R - 1e-9, 'never under the minimum radius')
    }
    for (let i = 0; i < capped.dots.length; i++)
      for (let j = i + 1; j < capped.dots.length; j++) {
        const a = capped.dots[i], b = capped.dots[j]
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 1.5 - 1e-6, 'still no overlap')
      }
    // Past the minimum radius the height is allowed to grow again rather than dots vanish.
    // 150 outlets stacked on a tenth of the axis already pins every dot at STRIP_MIN_R and
    // pushes the height to 1144px, well past the cap. swarm is cubic in the number of dots
    // sharing an x, so a larger crowd only buys a slower test: 1200 of them cost 169s.
    const absurd = Array.from({ length: 150 }, (_, i) => ({ domain: `z${i}.example`, source: 'gnews', score: -2 + (i % 10) * 0.01, n: 3 }))
    const grown = stripLayout(absurd, 957)
    assert.equal(grown.dots.length, 150)
    assert.ok(grown.height > STRIP_MAX_HEIGHT)
    assert.ok(grown.dots.every((d) => Math.abs(d.r - STRIP_MIN_R) < 1e-9))
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

  it('design-5.html makes the strip the chart of the second figure, and the como-ler page explains it', () => {
    const html = read('design-5.html')
    const figure = html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''
    assert.match(figure, /<\/header>\s*<figure class="strip" id="strip" aria-label="Veículos na régua da avaliação" hidden><\/figure>/)
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>A régua<\/b>/)
    assert.match(chapter, /a linha vertical é a média da pessoa/)
  })
})

describe('testimony mask: words coloured against the person mean', () => {
  const person = { method: 'kikori:q8', score: -2.4, n: 500 }
  const placed = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', pmi: 1, rank: 0, x: 0, y: 0, w: 60, h: 30, size: 20, lineHeight: 24, lines: ['x'], count: 9, score: 9, ...over })

  it('termMask centres on the person, is null under MASK_MIN texts or without a person mean', async () => {
    const { MASK_MIN, maskColor, termMask, toneColor } = await import('../public/js/format.js')
    assert.equal(MASK_MIN, 3)
    assert.equal(termMask({ testimony: { score: -2.4, n: 10 } }, -2.4), maskColor(0), 'on the mean: the neutral middle')
    assert.equal(termMask({ testimony: { score: -3.9, n: 10 } }, -2.4), maskColor(-1.5), 'MASK_SPAN below the person: full red')
    assert.equal(termMask({ testimony: { score: -3.9, n: 10 } }, -2.4), termMask({ testimony: { score: -9, n: 10 } }, -2.4), 'clamped past the span')
    assert.equal(termMask({ testimony: { score: -4.9, n: 10 } }, -2.4), toneColor(-3), 'the red end is the same red as tone')
    assert.equal(termMask({ testimony: { score: 3, n: 2 } }, -2.4), null, 'two texts is noise')
    assert.equal(termMask({ testimony: null }, -2.4), null)
    assert.equal(termMask({ testimony: { score: 3, n: 9 } }, null), null)
    assert.equal(termMask({ testimony: { score: -2.4, n: 10 } }, -2.4), termMask({ testimony: { score: 1, n: 10 } }, 1), 'same distance, same colour, whoever the person is')
  })

  it('wordMarkup carries the --mask colour and the testimony in its title only when it has one', async () => {
    const { wordMarkup } = await import('../public/js/render.js')
    const masked = wordMarkup(placed({ testimony: { score: -4.9, n: 12 } }), 'count', person.score)
    assert.match(masked, /style="--size:20px;--mask:rgb\(255,107,125\)"/)
    assert.match(masked, /· avaliação -4,9 em 12 textos<\/title>/)
    for (const value of inlineStyles(masked)) assert.ok(value.startsWith('--'))
    const bare = wordMarkup(placed({}), 'count', person.score)
    assert.doesNotMatch(bare, /--mask/)
    assert.doesNotMatch(bare, /avaliação/)
    assert.doesNotMatch(wordMarkup(placed({ testimony: { score: -4.9, n: 2 } }), 'count', person.score), /--mask/, 'under the floor: title yes, colour no')
  })

  it('paintColumns colours cards the same way and spells the score out', () => {
    withFakeDocument(['columns'], (els) => {
      const nodes = [
        { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, testimony: { score: 0.1, n: 20 } },
        { id: 'word:b', term: 'b', kind: 'word', count: 5, pmi: 1, testimony: null },
      ]
      paintColumns({ nodes, links: [], selected: null, search: '', sort: 'count', mode: 'columns', onChoose: () => {}, personTestimony: person })
      assert.match(els.columns.innerHTML, /data-col="word:a" style="--mask:rgb\(126,231,135\)">/, '+2.5 over the person: full green')
      assert.match(els.columns.innerHTML, /· avaliação \+0,1<\/span>/)
      assert.match(els.columns.innerHTML, /data-col="word:b"><span>/, 'no testimony, no style attribute')
    })
  })

  it('testimonyLine reads the two numbers out for the selected term', async () => {
    const { testimonyLine } = await import('../public/js/render.js')
    const n = { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, testimony: { score: -3.1, n: 12 } }
    assert.match(testimonyLine(n, person), /<strong class="score-highlight">-3,1<\/strong> de avaliação em 12 textos, contra -2,4 da pessoa no recorte\. mais hostis que a média da pessoa\./)
    assert.match(testimonyLine({ ...n, testimony: { score: -2.2, n: 12 } }, person), /na média da pessoa/)
    assert.match(testimonyLine({ ...n, testimony: { score: 5, n: 2 } }, person), /poucos textos para comparar/)
    assert.equal(testimonyLine({ ...n, testimony: null }, person), '')
    assert.equal(testimonyLine(n, undefined), '')
    assert.equal(testimonyLine(n, { ...person, score: null }), '')
  })

  it('the mask is a paint toggle: createHandlers.mask flips it and nothing refetches', async () => {
    const { createHandlers } = await import('../public/js/app.js')
    let flips = 0
    let loads = 0
    const h = createHandlers({ toggleMask: () => flips++, load: () => loads++ })
    h.mask()
    h.mask()
    assert.equal(flips, 2)
    assert.equal(loads, 0)
  })

  it('the graph query asks for testimony and the sources/docs queries do not echo it', async () => {
    const { docsQuery } = await import('../public/js/app.js')
    const p = controls()
    assert.equal(p.get('testimony'), '1')
    assert.equal(narrowToTestimony(p).has('testimony'), false)
    assert.equal(testimonyParams({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all' }).has('testimony'), false)
    const { narrowToSources } = await import('../public/js/api.js')
    assert.equal(narrowToSources(p).has('testimony'), false)
    assert.equal(docsQuery(p, null).has('testimony'), false)
  })

  it('the workspace carries an id so a reload can dim it in place instead of blanking the map', () => {
    assert.match(read('design-5.html'), /<section class="figure workspace" id="workspace"/)
    assert.match(read('atlas.css'), /\.workspace\.is-loading \.viewport[^{]*\{[^}]*opacity/)
  })

  it('design-5.html has the toggle next to the view switch, pressed by default, and the como-ler page explains the centring', () => {
    const html = read('design-5.html')
    assert.match(html, /<button id="modeColumns" aria-pressed="false">Lista<\/button><\/div><button id="mask" class="quiet-button toggle" aria-pressed="true">Colorir por avaliação<\/button>/)
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>Colorir por avaliação<\/b>/)
    assert.match(chapter, /com a média da pessoa no recorte, e não com o zero/)
    assert.match(chapter, /menos de 3 textos avaliados/)
  })
})
