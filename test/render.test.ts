import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STRIP_MAX_HEIGHT,
  STRIP_MIN_R,
  drawMap,
  inspect,
  paintAtlasLoading,
  paintCandidates,
  paintColumns,
  paintCompareDetail,
  paintCompareLoading,
  paintDocs,
  paintDocsHead,
  paintDocsLoading,
  paintLensDetail,
  paintLensRuler,
  paintLensRulerError,
  paintLensesLoading,
  paintOutletsLoading,
  paintRisingLoading,
  paintRisingRuler,
  paintRisingRulerError,
  paintRuler,
  paintSelection,
  paintStrip,
  paintTermStrip,
  paintTestimony,
  paintTestimonyError,
  paintTestimonyLoading,
  RARE_SHOWN,
  hasShares,
  liftBalance,
  liftOfPerson,
  rareRisers,
  paintWeek,
  paintWeekError,
  paintWeekLoading,
  risingRulerItems,
  shareBalance,
  rulerTerms,
  stripLayout,
  stripRadius,
  termStripLayout,
  testimonyLine,
  wordMarkup,
} from '../src/ui/render.js'
import { signed, termMask, type Compare, type CompareTerm, type Lenses, type PlacedTerm, type Rising, type RisingTerm, type Week, type WeekBucket } from '../src/ui/format.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
import { withFiguresDom } from './fake-mount-dom.js'

// src/ui/render.ts: the painters, driven against a fake document and asserted on the markup
// they emit. Nothing here fetches.

// The injected text measurer, the same contract layout.ts documents: a real canvas in the
// browser, a deterministic stand-in here.
const metrics = (text: string, size: number) => text.length * size * 0.6

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

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Jair Bolsonaro' }
const compareData = (terms: CompareTerm[]): Compare => ({ days: 365, a: { person: lula, about: 900 }, b: { person: bolsonaro, about: 700 }, terms })
const lensesData = (terms: CompareTerm[], a = 'all', b = 'lean:right'): Lenses => ({ days: 30, a: { lens: a, about: 900 }, b: { lens: b, about: 700 }, terms })
const side = (count: number, pmi: number) => ({ count, pmi, tone: null })

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4 }
const graph = { person: { id: 'p1', name: 'Alguém' }, stats: { about: 40 }, nodes: [term], links: [] }

const paint = (selected: string | null) =>
  withFakeDocument(['inspector'], (els) => {
    inspect({ graph, nodes: [term], links: [], selected, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {} })
    return els.inspector.innerHTML
  })

describe('the inspector sparkline', () => {
  const paintWithSpark = (sparkline?: Parameters<typeof inspect>[0]['sparkline']) =>
    withFakeDocument(['inspector'], (els) => {
      inspect({ graph, nodes: [term], links: [], selected: term.id, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {}, sparkline })
      return els.inspector.innerHTML
    })

  it('a word in focus with no sparkline handed in paints none', () => {
    assert.doesNotMatch(paintWithSpark(undefined), /sparkline/)
  })

  it('person-in-focus (no selection) never paints a sparkline, even if one is handed in', () => {
    const html = withFakeDocument(['inspector'], (els) => {
      inspect({ graph, nodes: [term], links: [], selected: null, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {}, sparkline: { state: 'ready', counts: [1, 2, 3, 4, 5, 6, 7] } })
      return els.inspector.innerHTML
    })
    assert.doesNotMatch(html, /sparkline/)
  })

  it('"loading" paints a ghost of seven bars, never the word Carregando', () => {
    const html = paintWithSpark({ state: 'loading' })
    assert.match(html, /class="sparkline ghost-field"/)
    assert.equal(html.match(/spark-ghost/g)?.length, 7)
    assert.doesNotMatch(html, /Carregando/)
  })

  it('"ready" paints seven bars sized from the counts, tallest at the loudest day', () => {
    const html = paintWithSpark({ state: 'ready', counts: [0, 1, 2, 10, 3, 0, 1] })
    assert.equal(html.match(/spark-bar/g)?.length, 7)
    const heights = [...html.matchAll(/--h:(\d+)px/g)].map((m) => Number(m[1]))
    assert.equal(heights.length, 7)
    assert.equal(heights[3], Math.max(...heights), 'the loudest day is the tallest bar')
    assert.match(html, /Últimos 7 dias corridos/, 'the caption states this is a rolling window, not the atlas period')
  })

  it('"error" leaves the hole empty rather than inventing bars, and paints no note', () => {
    const html = paintWithSpark({ state: 'error' })
    assert.doesNotMatch(html, /spark-bar/)
    assert.doesNotMatch(html, /spark-ghost/)
    assert.match(html, /<div class="sparkline" aria-hidden="true"><\/div>/)
    assert.doesNotMatch(html, /Não foi possível carregar/)
    assert.doesNotMatch(html, /Últimos 7 dias/)
  })

  it('a failed sparkline never removes the inspector numbers that already painted', () => {
    const html = paintWithSpark({ state: 'error' })
    assert.match(html, /documentos/)
    assert.match(html, /PMI bruto/)
  })
})

describe('the inspector carries no documents button', () => {
  it('neither state emits one, and neither holds a docs container', () => {
    for (const html of [paint(term.id), paint(null)]) {
      assert.doesNotMatch(html, /docs-open|id="docsOpen"|Ler documentos/)
      assert.doesNotMatch(html, /id="docs"/, 'the documents live in the card, not in the inspector')
      assert.doesNotMatch(html, /<details|id="termDocs"|id="showDocs"/)
    }
  })

})

describe("the person's own entry points to her documents", () => {
  const layout = {
    placed: [{ id: term.id, term: 'reforma', kind: 'word', count: 12, pmi: 1.4, x: 0, y: -100, w: 90, h: 30, size: 20, lines: ['reforma'], lineHeight: 22, rank: 0, score: 1.4 }],
    overflow: [],
    center: { lines: ['Alguém'], size: 52, lineHeight: 57, w: 240, h: 145, x: 0, y: 0 },
  }

  it('the centre of the map is a real button, and painting it fetches nothing', () => {
    withFakeDocument(['viewport', 'overflow', 'legend'], (els) => {
      const calls: string[] = []
      drawMap({ layout, personName: 'Alguém', about: 40, mode: 'map', sort: 'pmi', onChoose: () => {}, onShowPerson: () => calls.push('person') })
      assert.match(els.viewport.innerHTML, /<g class="center-label" data-person-docs role="button" tabindex="0"/)
      assert.equal(els.viewport.innerHTML.match(/data-person-docs/g)?.length, 1, 'exactly one centre, and it is the entry point')
      assert.doesNotMatch(els.viewport.innerHTML, /class="atlas-word"[^>]*data-person-docs/, 'a word is never the person')
      assert.equal(calls.length, 0, 'painting opens nothing on its own')
    })
  })

  it('the list has no centre, so it carries the same entry at its head', () => {
    withFakeDocument(['columns'], (els) => {
      const calls: string[] = []
      paintColumns({
        nodes: [term], links: [], selected: null, search: '', sort: 'pmi', mode: 'columns',
        onChoose: () => {}, onShowPerson: () => calls.push('person'), personName: 'Alguém', about: 40,
      })
      assert.match(els.columns.innerHTML, /<div class="column-person" data-person-docs role="button" tabindex="0"/)
      assert.match(els.columns.innerHTML, /<strong>Alguém<\/strong>/)
      assert.equal(els.columns.innerHTML.match(/data-person-docs/g)?.length, 1)
      assert.equal(calls.length, 0, 'painting opens nothing on its own')
    })
  })
})

describe('paintDocsHead / paintDocs: the card that holds the documents', () => {
  it('paintDocsHead writes whatever the figure that asked calls its own reading', () => {
    withFakeDocument(['docsKicker', 'docsTitle'], (els) => {
      paintDocsHead({ kicker: 'Documentos com palavra', title: 'reforma' })
      assert.equal(els.docsKicker.textContent, 'Documentos com palavra')
      assert.equal(els.docsTitle.textContent, 'reforma')
      paintDocsHead({ kicker: 'Documentos de', title: 'g1.globo.com' })
      assert.equal(els.docsKicker.textContent, 'Documentos de')
      assert.equal(els.docsTitle.textContent, 'g1.globo.com')
    })
  })

  // The ruler asks the same word of both people at once, so the card has to answer in two
  // labelled columns; every other figure asks one side and must keep the plain single list.
  it('paintDocs writes one plain list for one side and two labelled columns for two', () => {
    const side = (name: string | null) => ({ label: name, data: { docs: [{ source: 'rss', domain: 'example.org', text: 'um texto', url: 'https://example.org/a' }], total: 3 } })
    withFakeDocument(['docs'], (els) => {
      paintDocs([side(null)])
      assert.doesNotMatch(els.docs.innerHTML, /docs-columns/)
      assert.match(els.docs.innerHTML, /Mostrando 1 de 3 documentos\./)
    })
    withFakeDocument(['docs'], (els) => {
      paintDocs([side('Lula'), side('Bolsonaro')])
      assert.match(els.docs.innerHTML, /<div class="docs-columns">/)
      assert.match(els.docs.innerHTML, /<p class="eyebrow docs-side-name">Lula<\/p>/)
      assert.match(els.docs.innerHTML, /<p class="eyebrow docs-side-name">Bolsonaro<\/p>/)
    })
  })

  it('an empty side says so instead of leaving a blank column', () => {
    withFakeDocument(['docs'], (els) => {
      paintDocs([{ label: 'Lula', data: { docs: [], total: 0 } }, { label: 'Bolsonaro', data: { docs: [], total: 0 } }])
      assert.equal(els.docs.innerHTML.match(/Nenhum documento encontrado\./g)?.length, 2)
    })
  })
})

describe('paintTestimony', () => {
  it('paints the overall score and the per-source means as chips, and leaves the outlet ranking to the merged list', () => {
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'all' })
      assert.equal(els.testimonyLabel.textContent, '-2,16')
      const html = els.testimonyList.innerHTML
      // Label and measurement, so <dt> names it and <dd> carries it; the reading in words drops
      // to its own caption line instead of sharing the number's line.
      assert.match(html, /<dt>Média do recorte<\/dt><dd[^>]*>-2,16<\/dd>/)
      assert.match(html, /<p class="verdict-class">neutro · média de 784 textos avaliados<\/p>/)
      assert.match(html, /<div class="source-chip"><dt>Bluesky<\/dt><dd><span class="n">621<\/span>/, 'sources are labelled in pt-BR')
      assert.match(html, /<dt>GKG<\/dt>/)
      // The outlet ranking lives in paintOutlets now: the strip above is already the ruler, and
      // a second ranking here was the same outlets read twice.
      assert.doesNotMatch(html, /data-testimony-domain/)
      assert.doesNotMatch(html, /class="scale"/, 'the strip above is the only −10..+10 ruler')
      for (const value of inlineStyles(html)) assert.ok(value.startsWith('--'), `paintTestimony emitted style="${value}"`)
    })
  })

  it('says the focused outlet\'s own score next to the overall one', () => {
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'bbc.com' })
      assert.match(els.testimonyList.innerHTML, /<p class="focus"><b>bbc\.com<\/b>: <strong[^>]*>-2<\/strong> em 6 textos\. O número acima é o recorte inteiro\.<\/p>/)
      assert.equal(els.testimonyLabel.textContent, '-2,16', 'the summary keeps the whole recorte')
    })
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'tiny.example' })
      assert.match(els.testimonyList.innerHTML, /<b>tiny\.example<\/b>: menos de 3 textos avaliados/)
    })
    withFakeDocument(ids, (els) => {
      paintTestimony({ data: sample, domain: 'all' })
      assert.doesNotMatch(els.testimonyList.innerHTML, /class="focus"/)
    })
  })

  it('says when nothing was scored instead of showing a zero', () => {
    withFakeDocument(ids, (els) => {
      els.testimonyLabel.textContent = 'stale'
      paintTestimony({ data: { method: 'kikori:q8:abc', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }, domain: 'all' })
      assert.equal(els.testimonyLabel.textContent, '')
      assert.match(els.testimonyList.innerHTML, /Nenhum texto avaliado neste recorte \(método kikori:q8:abc\)/)
      assert.doesNotMatch(els.testimonyList.innerHTML, /<strong/)
    })
  })

  it('has loading and error states', () => {
    withFakeDocument(ids, (els) => {
      paintTestimonyLoading()
      assert.match(els.testimonyList.innerHTML, /ghost-field/)
      assert.match(els.testimonyList.innerHTML, /Lendo a avaliação/)
      assert.equal(els.testimonyLabel.textContent, '')
      assert.equal(els.strip.hidden, false, 'the strip keeps its silhouette while the recorte is in flight')
      assert.match(els.strip.innerHTML, /strip-axis/)
      paintTestimonyError()
      assert.match(els.testimonyList.innerHTML, /Não foi possível carregar a avaliação/)
    })
  })
})

describe('stripLayout / paintStrip: the outlets on the axis', () => {
  it('stripLayout puts -10 at the left pad, +10 at the right pad and sizes dots by texts', () => {
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

  it('caps the strip at STRIP_MAX_HEIGHT by shrinking every dot together, never by dropping one', () => {
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
      assert.match(html, /class="strip-dot is-active" style="--tone:rgb\(\d+,\d+,\d+\)" data-strip-domain="bbc\.com" role="button" tabindex="0" aria-pressed="true"/)
      assert.match(html, /<title>g1\.globo\.com · Google News · -3,62 em 13 textos<\/title>/)
      assert.match(html, /class="strip-mean" style="--pos:39\.2%">média da pessoa -2,16/)
      assert.match(html, /<line class="strip-overall"/)
      assert.match(html, /−10 contra<\/span><span>0<\/span><span>\+10 a favor/)
      assert.match(html, /toque de novo, ou fora das bolinhas, para soltar/)
      assert.match(html, /O atlas acima não muda\./)
      for (const value of inlineStyles(html)) assert.ok(value.startsWith('--'), `paintStrip emitted style="${value}"`)
      const g1 = Number(html.match(/data-strip-domain="g1\.globo\.com".*?<circle class="dot-face" cx="([\d.]+)"/)?.[1])
      const fdusp = Number(html.match(/data-strip-domain="fdusp\.bsky\.social".*?<circle class="dot-face" cx="([\d.]+)"/)?.[1])
      assert.ok(g1 < fdusp, 'a more hostile outlet sits further left')
    })
    withFakeDocument(['strip'], (els) => {
      paintStrip({ data: { ...sample, by_domain: [] }, domain: 'all', onPick: () => {} })
      assert.equal(els.strip.hidden, true)
      assert.equal(els.strip.innerHTML, '')
    })
    withFakeDocument(['testimonyLabel', 'testimonyList', 'strip'], (els) => {
      els.strip.hidden = true
      paintTestimonyLoading()
      assert.equal(els.strip.hidden, false, 'a load in flight keeps the strip visible as a ghost')
      assert.match(els.strip.innerHTML, /ghost-field/)
    })
  })
})

// Issue #149: figure 1's third view is a beeswarm strip keyed by each word's own kikori mean,
// coloured the same way termMask already colours the map and the columns.
describe('#149 AC2/AC3/AC4: termStripLayout / paintTermStrip, words on the kikori axis', () => {
  const personTestimony = { method: 'kikori:q8', score: -1, n: 200 }
  const golpe = { id: 'word:golpe', term: 'golpe', kind: 'word', count: 41, pmi: 2.1, testimony: { score: -3.97, n: 12 } }
  const reforma = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 20, pmi: 1.4, testimony: { score: 0, n: 6 } }
  const agenda = { id: 'word:agenda', term: 'agenda', kind: 'word', count: 15, pmi: 1.1, testimony: { score: 2.5, n: 9 } }
  const rare = { id: 'word:rare', term: 'rara', kind: 'word', count: 3, pmi: 0.5, testimony: { score: 4, n: 2 } } // n < MASK_MIN
  const unscored = { id: 'word:unscored', term: 'silencio', kind: 'word', count: 7, pmi: 0.8, testimony: null } // testimony: null
  const missing = { id: 'word:missing', term: 'ausente', kind: 'word', count: 5, pmi: 0.6 } // testimony: undefined
  const stripNodes = [golpe, reforma, agenda, rare, unscored, missing]

  it('only the nodes termMask accepts are included, and x is monotonic non-decreasing in score', () => {
    const layout = termStripLayout(stripNodes, personTestimony, 860)
    const ids = new Set(layout.dots.map((d: { id: string }) => d.id))
    assert.deepEqual(ids, new Set(['word:golpe', 'word:reforma', 'word:agenda']), 'rare (n<3), unscored (testimony: null) and missing (testimony: undefined) must be excluded')
    const byScore = [...layout.dots].sort((a: { score: number }, b: { score: number }) => a.score - b.score)
    for (let i = 1; i < byScore.length; i++) assert.ok(byScore[i].x >= byScore[i - 1].x, 'x must never decrease as score increases')
  })

  it('excludes every node when the person has no eligible score (stats.testimony absent or its score null/undefined)', () => {
    assert.equal(termStripLayout(stripNodes, { method: 'kikori', score: null, n: 0 }, 860).dots.length, 0, 'a null person score')
    assert.equal(termStripLayout(stripNodes, undefined, 860).dots.length, 0, 'an absent stats.testimony')
  })

  it('the domain widens to at least 2 with exactly one eligible word', () => {
    const layout = termStripLayout([golpe], personTestimony, 860)
    assert.equal(layout.dots.length, 1)
    assert.ok(layout.domainMax - layout.domainMin >= 2, `domain must widen for a single point: got [${layout.domainMin}, ${layout.domainMax}]`)
  })

  it('the domain widens when every eligible word ties the person mean', () => {
    const tied = [
      { id: 'word:a', term: 'a', kind: 'word', count: 5, pmi: 1, testimony: { score: -1, n: 4 } },
      { id: 'word:b', term: 'b', kind: 'word', count: 6, pmi: 1, testimony: { score: -1, n: 5 } },
    ]
    const layout = termStripLayout(tied, personTestimony, 860)
    assert.ok(layout.domainMax - layout.domainMin >= 2, `domain must widen when every word ties the mean: got [${layout.domainMin}, ${layout.domainMax}]`)
  })

  // issue #149 gap: a float personScore (e.g. -3.97) can sit a hair from its floor/ceil edge
  // (-4) without ever equaling it, so an exact-value guard misses it and the dashed mean line
  // draws on the last slice of the axis.
  it('gap: a float person score near its domain edge still gets pushed off the edge', () => {
    const floatPerson = { method: 'kikori:q8', score: -3.97, n: 200 }
    const wide = [
      { id: 'word:a', term: 'a', kind: 'word', count: 20, pmi: 1, testimony: { score: -1, n: 10 } },
      { id: 'word:b', term: 'b', kind: 'word', count: 20, pmi: 1, testimony: { score: 2, n: 10 } },
    ]
    const layout = termStripLayout(wide, floatPerson, 860)
    assert.ok(layout.domainMin < Math.floor(floatPerson.score), `domainMin must widen past the plain floor(-3.97) = -4: got ${layout.domainMin}`)
    const overallX = layout.x(floatPerson.score)
    const innerStart = 28 // STRIP_PAD, mirrored here since it is not exported
    const span = layout.domainMax - layout.domainMin
    const fraction = (overallX - innerStart) / (860 - 2 * innerStart)
    assert.ok(fraction > 0.03, `the mean must sit clear of the left edge, got fraction=${fraction} (domain [${layout.domainMin}, ${layout.domainMax}], span ${span})`)
  })

  // issue #149 gap: termStripLayout only reads the nodes array it is handed; it filters
  // eligibility with termMask but never applies any alias/own-name filtering of its own.
  it('gap: termStripLayout consumes only the nodes array it is handed, never filtering by name', () => {
    const layout = termStripLayout([golpe], personTestimony, 860)
    const ids = new Set(layout.dots.map((d: { id: string }) => d.id))
    assert.deepEqual(ids, new Set(['word:golpe']), 'a node absent from the given array never appears, regardless of what it is named')
    // A node shaped like a tracked person's own name: real alias filtering happens upstream
    // in graphFor, so it never reaches here in production, but termStripLayout itself must
    // apply no such rule — an eligible node it is handed is drawn regardless of its term.
    const ownName = { id: 'word:lula', term: 'lula', kind: 'word', count: 30, pmi: 1, testimony: { score: -0.5, n: 5 } }
    const withOwnName = termStripLayout([golpe, ownName], personTestimony, 860)
    assert.deepEqual(
      new Set(withOwnName.dots.map((d: { id: string }) => d.id)),
      new Set(['word:golpe', 'word:lula']),
      'termStripLayout draws every eligible node handed to it, with no alias/own-name filtering of its own',
    )
    const full = termStripLayout(stripNodes, personTestimony, 860)
    assert.deepEqual(
      new Set(full.dots.map((d: { id: string }) => d.id)),
      new Set(['word:golpe', 'word:reforma', 'word:agenda']),
      'every eligible node handed in appears; termStripLayout applies no filter beyond termMask',
    )
  })

  // issue #149 gap: at count >= 100 with 24 nodes (limit=24, the widest select option), the
  // strip must still fit STRIP_MAX_HEIGHT by shrinking dots together. All 24 sharing one score
  // is the worst case for stacking (a spread-out score, like -5+(i%10) across 10 x-slots, never
  // reaches STRIP_MAX_HEIGHT at all and so never exercises the while loop this pins).
  it('gap: 24 same-score nodes with count >= 100 force the shrink loop and still fit STRIP_MAX_HEIGHT', () => {
    const many = Array.from({ length: 24 }, (_, i) => ({
      id: `word:w${i}`,
      term: `w${i}`,
      kind: 'word',
      count: 100 + i,
      pmi: 1,
      testimony: { score: -1, n: 20 },
    }))
    const unshrunk = stripRadius(100, 860)
    const layout = termStripLayout(many, personTestimony, 860)
    assert.equal(layout.dots.length, 24)
    assert.ok(layout.height <= STRIP_MAX_HEIGHT, `height ${layout.height} must fit STRIP_MAX_HEIGHT (${STRIP_MAX_HEIGHT})`)
    assert.ok(
      (layout.dots[0] as { r: number }).r < unshrunk - 1e-6,
      `the shrink loop must have run: dot radius ${(layout.dots[0] as { r: number }).r} must be smaller than the unshrunk ${unshrunk}`,
    )
  })

  it('paintTermStrip draws one circle per eligible node, each with data-node and an inline --tone equal to termMask, none for an excluded node', () => {
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: stripNodes, personTestimony, onChoose: () => {}, width: 860 })
      const markup = els.atlasStrip.innerHTML
      const drawn = [...markup.matchAll(/data-node="([^"]+)"/g)].map((m) => m[1])
      assert.deepEqual(new Set(drawn), new Set(['word:golpe', 'word:reforma', 'word:agenda']))
      for (const id of ['word:rare', 'word:unscored', 'word:missing']) assert.ok(!drawn.includes(id), `${id} must not be drawn`)
      // issue #149 gap: --tone must equal termMask's own return value, not merely be present.
      const tone = markup.match(/data-node="word:golpe"[^>]*--tone:([^"]+)"/)?.[1]
      assert.equal(tone, termMask(golpe, personTestimony.score), "the emitted --tone must equal termMask(node, personScore)'s return value")
      for (const value of inlineStyles(markup)) assert.ok(value.startsWith('--'), `paintTermStrip emitted style="${value}"`)
    })
  })

  it('the axis-end labels are signed domainMin/domainMax, not a fixed ±10', () => {
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      const layout = termStripLayout(stripNodes, personTestimony, 860)
      paintTermStrip({ nodes: stripNodes, personTestimony, onChoose: () => {}, width: 860 })
      assert.ok(
        els.atlasStrip.innerHTML.includes(`<div class="strip-axis-labels"><span>${signed(layout.domainMin)} contra</span><span>${signed(layout.domainMax)} a favor</span></div>`),
        els.atlasStrip.innerHTML,
      )
    })
  })

  it('the dashed mean line and its "média da pessoa" label only appear when the person has a score', () => {
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: stripNodes, personTestimony, onChoose: () => {}, width: 860 })
      assert.match(els.atlasStrip.innerHTML, /média da pessoa/)
      assert.match(els.atlasStrip.innerHTML, /<line class="strip-overall"/, 'a non-null score must also draw the dashed line, not just the label')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: stripNodes, personTestimony: { method: 'kikori', score: null, n: 0 }, onChoose: () => {}, width: 860 })
      assert.doesNotMatch(els.atlasStrip.innerHTML, /média da pessoa/, 'no person score, no mean line')
      assert.doesNotMatch(els.atlasStrip.innerHTML, /<line class="strip-overall"/, 'no person score, no dashed line either')
    })
  })

  it('an empty recorte and a recorte with zero eligible words each get their own empty message', () => {
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [], personTestimony, onChoose: () => {}, width: 860 })
      assert.match(els.atlasStrip.innerHTML, /Nenhum termo neste recorte\./)
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [unscored], personTestimony, onChoose: () => {}, width: 860 })
      assert.match(els.atlasStrip.innerHTML, /Nenhuma palavra com avaliação suficiente neste recorte\./)
    })
  })

  it('the hidden-count note reports 0 (hidden), 1 (singular) and N excluded words', () => {
    const noteText = (els: Record<string, { innerHTML: string; textContent: string }>) => String(els.stripHiddenNote.innerHTML) + String(els.stripHiddenNote.textContent)
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe, reforma, agenda], personTestimony, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.hidden, true, 'nothing excluded: the note stays hidden')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe, reforma, agenda, rare], personTestimony, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.hidden, false)
      assert.match(noteText(els), /1 palavra deixada de fora/, 'singular at exactly one excluded word')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: stripNodes, personTestimony, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.hidden, false)
      assert.match(noteText(els), /3 palavras deixadas de fora/, 'plural at N excluded words')
    })
  })

  // issue #149 gap: pins the exact wording of both hidden-note variants, singular and plural,
  // for the two reasons a word is excluded — no eligible person mean, and too few scored texts.
  it('gap: hidden-note wording is pinned for both exclusion reasons, singular and plural', () => {
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe], personTestimony: { method: 'kikori', score: null, n: 0 }, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.textContent, '1 palavra deixada de fora: esta pessoa não tem média de avaliação neste recorte.')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe, reforma], personTestimony: { method: 'kikori', score: null, n: 0 }, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.textContent, '2 palavras deixadas de fora: esta pessoa não tem média de avaliação neste recorte.')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe, rare], personTestimony, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.textContent, '1 palavra deixada de fora por ter menos de 3 textos avaliados.')
    })
    withFakeDocument(['atlasStrip', 'stripHiddenNote'], (els) => {
      paintTermStrip({ nodes: [golpe, rare, unscored], personTestimony, onChoose: () => {}, width: 860 })
      assert.equal(els.stripHiddenNote.textContent, '2 palavras deixadas de fora por terem menos de 3 textos avaliados.')
    })
  })
})

describe('wordMarkup / paintColumns / paintSelection / testimonyLine: words coloured against the person mean', () => {
  const person = { method: 'kikori:q8', score: -2.4, n: 500 }
  const placed = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', pmi: 1, rank: 0, x: 0, y: 0, w: 60, h: 30, size: 20, lineHeight: 24, lines: ['x'], count: 9, score: 9, ...over })

  it('wordMarkup carries the --mask colour and the testimony in its title only when it has one', () => {
    const masked = String(wordMarkup(placed({ testimony: { score: -4.9, n: 12 } }), 'count', person.score))
    assert.match(masked, /style="--size:20px;--mask:rgb\(255,122,138\)"/)
    assert.match(masked, /· avaliação -4,9 em 12 textos<\/title>/)
    for (const value of inlineStyles(masked)) assert.ok(value.startsWith('--'))
    const bare = String(wordMarkup(placed({}), 'count', person.score))
    assert.doesNotMatch(bare, /--mask/)
    assert.doesNotMatch(bare, /avaliação/)
    assert.doesNotMatch(String(wordMarkup(placed({ testimony: { score: -4.9, n: 2 } }), 'count', person.score)), /--mask/, 'under the floor: title yes, colour no')
  })

  it('paintColumns colours cards the same way and spells the score out', () => {
    withFakeDocument(['columns'], (els) => {
      const nodes = [
        { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, testimony: { score: 0.1, n: 20 } },
        { id: 'word:b', term: 'b', kind: 'word', count: 5, pmi: 1, testimony: null },
      ]
      paintColumns({ nodes, links: [], selected: null, search: '', sort: 'count', mode: 'columns', onChoose: () => {}, personTestimony: person })
      assert.match(els.columns.innerHTML, /data-col="word:a" style="--mask:rgb\(116,220,134\)">/, '+2.5 over the person: full green')
      assert.match(els.columns.innerHTML, /· avaliação \+0,1<\/span>/)
      assert.match(els.columns.innerHTML, /data-col="word:b"><span>/, 'no testimony, no style attribute')
    })
  })

  it('testimonyLine reads the two numbers out for the selected term', () => {
    const n = { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, testimony: { score: -3.1, n: 12 } }
    assert.match(String(testimonyLine(n, person)), /<strong class="score-highlight">-3,1<\/strong> de avaliação em 12 textos, contra -2,4 da pessoa no recorte\. mais hostis que a média da pessoa\./)
    assert.match(String(testimonyLine({ ...n, testimony: { score: -2.2, n: 12 } }, person)), /na média da pessoa/)
    assert.match(String(testimonyLine({ ...n, testimony: { score: 5, n: 2 } }, person)), /poucos textos para comparar/)
    assert.equal(testimonyLine({ ...n, testimony: null }, person), '')
    assert.equal(testimonyLine(n, undefined), '')
    assert.equal(testimonyLine(n, { ...person, score: null }), '')
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

const corpus = (): CompareTerm[] => {
  const terms: CompareTerm[] = []
  for (let i = 0; i < 22; i++) terms.push({ term: `esquerda${i}`, kind: 'word', a: side(20 + i, 1.4), b: null })
  for (let i = 0; i < 18; i++) terms.push({ term: `direita${i}`, kind: 'word', a: null, b: side(15 + i, 1.2) })
  for (let i = 0; i < 24; i++) terms.push({ term: `partilhada${i}`, kind: 'word', a: side(10 + i * 3, 1.1), b: side(60 - i * 2, 0.9) })
  return terms
}

describe('paintRuler: the word itself is the mark (issue #99)', () => {
  it('paintRuler emits no <circle> and one <text> carrying the term for every drawn word', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [
        { term: 'alckmin', kind: 'word', a: side(192, 0.87), b: side(14, -1.58) },
        { term: 'rachadinha', kind: 'word', a: null, b: side(30, 2.1) },
        { term: 'bolsa', kind: 'hashtag', a: side(40, 1.2), b: null },
      ]
      const { shown, overflowCount } = paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      const html = els.compareRuler.innerHTML
      assert.equal(shown, 3)
      assert.equal(overflowCount, 0)
      assert.doesNotMatch(html, /<circle/, 'no dot survives: the mark is the word')
      assert.equal([...html.matchAll(/<text class="ruler-text"/g)].length, 3)
      for (const word of ['alckmin', 'rachadinha', '#bolsa']) assert.ok(html.includes(`>${word}</tspan>`), `${word} must be written on the ruler`)
    })
  })

  it('every drawn word keeps the data-term/data-kind pair the click handler reads', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [{ term: 'bolsa', kind: 'hashtag', a: side(40, 1.2), b: side(4, 0.2) }]
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.match(els.compareRuler.innerHTML, /data-term="bolsa" data-kind="hashtag"/)
    })
  })

  // Enough words at one balance to exhaust the height cap whatever the packer does.
  const crowded = (): CompareTerm[] => Array.from({ length: 120 }, (_, i) => ({ term: `exclusivadolula${i}`, kind: 'word', a: side(50, 1), b: null }))

  it('paintRuler writes the count and one button per listed word, with the same data attributes', async () => {
    await withFiguresDom(async (els) => {
      const { overflowCount, shown } = paintRuler({ data: compareData(crowded()), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      const html = els.compareRuler.innerHTML
      assert.ok(overflowCount > 0)
      assert.match(html, new RegExp(`${overflowCount} palavras não couberam`))
      assert.equal([...html.matchAll(/<button class="quiet-button[^"]*" data-term=/g)].length, overflowCount)
      assert.equal(shown + overflowCount, 120)
    })
  })

  it('clicking a listed word picks it exactly like clicking a drawn one', async () => {
    await withFiguresDom(async (els) => {
      const picked: string[] = []
      paintRuler({ data: compareData(crowded()), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: (term) => picked.push(term) })
      const buttons = [...els.compareRuler.innerHTML.matchAll(/<button class="quiet-button[^"]*" data-term="([^"]+)"/g)].map((m) => m[1])
      assert.ok(buttons.length > 0)
      // The harness wires every [data-term] the painter emitted; firing the last one is enough
      // to prove the listed words go through the same onPick as the drawn ones.
      const stubs = els.compareRuler.querySelectorAll('[data-term]') as unknown as { dataset: { term: string }; fire: (t: string) => void }[]
      const stub = [...stubs].find((s) => s.dataset.term === buttons[0])!
      stub.fire('click')
      assert.deepEqual(picked, [buttons[0]])
    })
  })

  it('says how many words the recorte actually carries, since each person contributes two lists', async () => {
    await withFiguresDom(async (els) => {
      const terms = corpus()
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.match(els.compareRuler.innerHTML, new RegExp(`${terms.length} palavras neste recorte`))
    })
  })

  it('the side colour still travels as the --cmp custom property, the one inline style allowed', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [{ term: 'urgentes', kind: 'word', a: side(20, 1.1), b: null }]
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.match(els.compareRuler.innerHTML, /style="--size:\d+px;--cmp:rgb\(\d+,\d+,\d+\)"/)
    })
  })
})

describe('rulerTerms: balance is -1/+1 for a one-sided term and 0 for an identical-both-sides term (issue #91 AC5)', () => {
  it('an a-only term is -1, a b-only term is +1, an identical-both-sides term is 0, under count', () => {
    const terms = [
      { term: 'onlyA', kind: 'word', a: { count: 5, pmi: 1, tone: null }, b: null },
      { term: 'onlyB', kind: 'word', a: null, b: { count: 5, pmi: 1, tone: null } },
      { term: 'same', kind: 'word', a: { count: 4, pmi: 2, tone: null }, b: { count: 4, pmi: 2, tone: null } },
    ]
    const { items } = rulerTerms(terms, 'count')
    assert.equal(items.find((t) => t.term === 'onlyA')!.balance, -1)
    assert.equal(items.find((t) => t.term === 'onlyB')!.balance, 1)
    assert.equal(items.find((t) => t.term === 'same')!.balance, 0)
  })

  it('the identical-both-sides term stays 0 under pmi too, regardless of measure', () => {
    const terms = [{ term: 'same', kind: 'word', a: { count: 4, pmi: 2, tone: null }, b: { count: 4, pmi: 2, tone: null } }]
    assert.equal(rulerTerms(terms, 'pmi').items[0].balance, 0)
  })
})

describe('rulerTerms: measure changes position but never the combined document count (issue #91 AC6)', () => {
  it('switching measure moves at least one term\'s balance while combined stays identical for every term', () => {
    const terms = [
      { term: 'mixed', kind: 'word', a: { count: 10, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } },
      { term: 'aonly', kind: 'word', a: { count: 1, pmi: 0.1, tone: null }, b: null },
    ]
    const byCount = rulerTerms(terms, 'count')
    const byPmi = rulerTerms(terms, 'pmi')
    assert.deepEqual(
      byCount.items.map((t) => t.combined),
      byPmi.items.map((t) => t.combined),
      'combined must never depend on measure',
    )
    const balanceCount = byCount.items.find((t) => t.term === 'mixed')!.balance
    const balancePmi = byPmi.items.find((t) => t.term === 'mixed')!.balance
    assert.notEqual(balanceCount, balancePmi, 'balance must move with measure for a term with different count/pmi shapes on each side')
  })
})

describe('regression: an opposite-signed-but-real term on both sides never pins to a literal end, and a null side never wins on the other\'s negative score', () => {
  it('alcolumbre (real docs and a negative PMI on the b side) settles short of -1', () => {
    const terms = [{ term: 'alcolumbre', kind: 'word', a: { count: 233, pmi: 0.61, tone: null }, b: { count: 8, pmi: -2.93, tone: null } }]
    const balance = rulerTerms(terms, 'pmi').items[0].balance
    assert.ok(Math.abs(balance) < 1, `balance must not pin to a literal end when both sides have documents, got ${balance}`)
  })

  it('an a-only term (b truly absent) with a negative PMI is still -1, not +1', () => {
    const terms = [{ term: 'onlyANegative', kind: 'word', a: { count: 5, pmi: -1, tone: null }, b: null }]
    assert.equal(rulerTerms(terms, 'pmi').items[0].balance, -1)
  })
})

describe('rulerTerms / paintRuler: a term where either side is the string "name" is absent from the rendered set (issue #91 AC7)', () => {
  it('rulerTerms drops it and counts it as hidden, for either side', () => {
    const terms: CompareTerm[] = [
      { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
      { term: 'bolsonaro', kind: 'word', a: { count: 4, pmi: 1, tone: null }, b: 'name' },
      { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
    ]
    const { items, hiddenCount } = rulerTerms(terms, 'count')
    assert.deepEqual(items.map((t) => t.term), ['reforma'])
    assert.equal(hiddenCount, 2, 'a name on the b side hides the term just as one on the a side does')
  })

  it('paintRuler produces no dot for the name term and reports the same hiddenCount', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const terms: CompareTerm[] = [
        { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
        { term: 'bolsonaro', kind: 'word', a: { count: 4, pmi: 1, tone: null }, b: 'name' },
        { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
      ]
      const data = compareData(terms)
      const { hiddenCount } = paintRuler({ data, personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.equal(hiddenCount, 2)
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-term="lula"/)
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-term="bolsonaro"/)
      assert.match(els.compareRuler.innerHTML, /data-term="reforma"/)
    })
  })
})

describe('paintLensRuler (figure 6, issue #206): empty-state markup and own-name hidden count', () => {
  it('paints "Nenhuma palavra neste recorte." when terms is empty', () => {
    withFakeDocument(['lensesRuler'], (els) => {
      const { hiddenCount, shown, overflowCount } = paintLensRuler({ data: lensesData([]), endA: 'Tudo', endB: 'Direita', metrics, selected: null, onPick: () => {} })
      assert.match(els.lensesRuler.innerHTML, /Nenhuma palavra neste recorte\./)
      assert.equal(hiddenCount, 0)
      assert.equal(shown, 0)
      assert.equal(overflowCount, 0)
    })
  })

  it('drops a term that is "name" on either side and reports it in hiddenCount, same as paintRuler', () => {
    withFakeDocument(['lensesRuler'], (els) => {
      const terms: CompareTerm[] = [
        { term: 'lula', kind: 'word', a: 'name', b: 'name' },
        { term: 'reforma', kind: 'word', a: { count: 5, pmi: 1, tone: null }, b: { count: 2, pmi: 0.5, tone: null } },
      ]
      const { hiddenCount } = paintLensRuler({ data: lensesData(terms), endA: 'Tudo', endB: 'Direita', metrics, selected: null, onPick: () => {} })
      assert.equal(hiddenCount, 1)
      assert.doesNotMatch(els.lensesRuler.innerHTML, /data-term="lula"/)
      assert.match(els.lensesRuler.innerHTML, /data-term="reforma"/)
    })
  })

  it('positions by pmi always, with no measure parameter to switch it', () => {
    withFakeDocument(['lensesRuler'], (els) => {
      const terms: CompareTerm[] = [{ term: 'reforma', kind: 'word', a: { count: 40, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } }]
      paintLensRuler({ data: lensesData(terms), endA: 'Tudo', endB: 'Direita', metrics, selected: null, onPick: () => {} })
      const byPmi = rulerTerms(terms, 'pmi').items[0].balance
      const byCount = rulerTerms(terms, 'count').items[0].balance
      assert.notEqual(byPmi, byCount, 'fixture assumption: pmi and count order this term differently')
      assert.match(els.lensesRuler.innerHTML, /data-term="reforma"/)
    })
  })
})

describe('paintLensRulerError / paintLensesLoading', () => {
  it('paintLensRulerError paints the failure note', () => {
    withFakeDocument(['lensesRuler'], (els) => {
      paintLensRulerError()
      assert.match(els.lensesRuler.innerHTML, /Não foi possível carregar as lentes/)
    })
  })

  it('paintLensesLoading paints a ghost, never the word Carregando', () => {
    withFakeDocument(['lensesRuler', 'lensesDetail'], (els) => {
      paintLensesLoading()
      assert.match(els.lensesRuler.innerHTML, /ghost-field/)
      assert.doesNotMatch(els.lensesRuler.innerHTML, /Carregando/)
      assert.match(els.lensesDetail.innerHTML, /ghost-field/)
    })
  })
})

describe('paintLensDetail', () => {
  it('shows the empty hint when no term is selected', () => {
    withFakeDocument(['lensesDetail'], (els) => {
      paintLensDetail({ term: null, endA: 'Tudo', endB: 'Direita' })
      assert.match(els.lensesDetail.innerHTML, /Clique numa palavra/)
    })
  })

  it('labels each side by its lens, not by a person, and reads "nenhum documento" for a null side', () => {
    withFakeDocument(['lensesDetail'], (els) => {
      const term: CompareTerm = { term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: null }
      paintLensDetail({ term, endA: 'Folha de S.Paulo', endB: 'Direita' })
      assert.match(els.lensesDetail.innerHTML, /<dt>Folha de S\.Paulo<\/dt>/)
      assert.match(els.lensesDetail.innerHTML, /<dt>Direita<\/dt><dd class="empty-hint">nenhum documento<\/dd>/)
    })
  })

  it('reads a "name" side as the person\'s own name, never as "nenhum documento"', () => {
    withFakeDocument(['lensesDetail'], (els) => {
      const term: CompareTerm = { term: 'lula', kind: 'word', a: 'name', b: 'name' }
      paintLensDetail({ term, endA: 'Folha de S.Paulo', endB: 'Direita' })
      assert.doesNotMatch(els.lensesDetail.innerHTML, /nenhum documento/)
      assert.match(els.lensesDetail.innerHTML, /nome da pessoa/)
    })
  })
})

describe('rulerTerms: the amended balance formula clamps each side at zero before differencing', () => {
  // Spec §3 as amended on issue #91 after this branch's first validation round. The formula
  // originally written there — balance = (scoreOf(b) − scoreOf(a)) / mag, unclamped — sends a
  // term whose two sides carry opposite-signed pmi to exactly ±1, because rawB − rawA
  // telescopes to |rawA| + |rawB| = mag whenever the signs differ. Measured against the real
  // corpus (lula × bolsonaro, days=365, limit=100): 141 of the 232 terms with documents on
  // BOTH sides landed on a literal end, under an axis labelled "Só de <Nome>". A word the
  // other person has 14 documents of is not that person's exclusive word, so the amended rule
  // clamps each side's score at zero before differencing. The cost, stated: a side that
  // actively repels a term (negative pmi) and a side merely indifferent to it now share a
  // position. Both exact numbers stay on the detail line, where the reader can still tell them
  // apart.
  it('a term present on both sides never reaches a literal end, even with opposite-signed pmi', () => {
    const a = { count: 40, pmi: 0.3, tone: null }
    const b = { count: 5, pmi: -2.1, tone: null }
    const terms: CompareTerm[] = [{ term: 'divergente', kind: 'word', a, b }]
    const score = (n: { count: number; pmi: number }) => n.pmi * Math.log1p(n.count)
    const mag = Math.abs(score(a)) + Math.abs(score(b))
    const expected = (Math.max(0, score(b)) - Math.max(0, score(a))) / mag
    const actual = rulerTerms(terms, 'pmi').items[0].balance
    assert.equal(actual, expected, 'each side is clamped at zero before differencing')
    assert.ok(actual > -1 && actual < 1, `a term with documents on both sides must stay off the ends, got ${actual}`)
    assert.ok(actual < 0, 'it still leans toward the side with the positive relationship')
  })

  it('an end is reachable only when one side has no documents at all', () => {
    const onlyA: CompareTerm[] = [{ term: 'exclusiva', kind: 'word', a: { count: 3, pmi: -0.9, tone: null }, b: null }]
    assert.equal(rulerTerms(onlyA, 'pmi').items[0].balance, -1, "a one-sided term pins to that side's end whatever its pmi sign")
    const bothSides: CompareTerm[] = [
      { term: 'compartilhada', kind: 'word', a: { count: 300, pmi: 4, tone: null }, b: { count: 1, pmi: -5, tone: null } },
    ]
    const balance = rulerTerms(bothSides, 'pmi').items[0].balance
    assert.ok(balance > -1, `a term with one document on the other side must not read as exclusive, got ${balance}`)
  })
})

describe('paintRuler / paintCompareDetail never reference #docsDialog (issue #91 AC12)', () => {
  it('a rendered dot carries no data-docs-open-style attribute and no reference to the dialog', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const data = compareData([{ term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }])
      paintRuler({ data, personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-docs-open/)
      assert.doesNotMatch(els.compareRuler.innerHTML, /docsDialog/)
    })
  })

  it('paintCompareDetail never emits a link or button referencing the dialog', () => {
    withFakeDocument(['compareDetail'], (els) => {
      paintCompareDetail({ term: { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }, personA: lula, personB: bolsonaro })
      assert.doesNotMatch(els.compareDetail.innerHTML, /docsDialog/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<a\b/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<button\b/)
    })
  })
})

describe('paintCandidates (issue #32 AC7)', () => {
  it('renders name, docs, sources, trend and the sample docs on click, in pt-BR', () => {
    const markup = withFakeDocument(['candidateLabel', 'candidateList'], (els) => {
      paintCandidates({
        candidates: [
          { name: 'Hugo Motta', count: 5, sources: 1, previous: 0, samples: [{ id: '7', source: 'gnews', text: 'texto de exemplo' }] },
          { name: 'Davi Alcolumbre', count: 4, sources: 2, previous: 9, samples: [] },
        ],
      })
      return { label: els.candidateLabel.textContent, list: els.candidateList.innerHTML }
    })
    assert.equal(markup.label, '2')
    for (const fragment of ['Hugo Motta', '5 docs', '1 fonte', 'novo', '2 fontes', '↓ era 9', 'data-candidate="0"', 'aria-expanded="false"', 'class="samples"', 'texto de exemplo', 'Sem exemplos neste período.'])
      assert.ok(markup.list.includes(fragment), fragment)
  })

  it('says so in pt-BR when no name clears the bar, instead of rendering an empty list', () => {
    const markup = withFakeDocument(['candidateLabel', 'candidateList'], (els) => {
      paintCandidates({ candidates: [] })
      return { label: els.candidateLabel.textContent, list: els.candidateList.innerHTML }
    })
    assert.equal(markup.label, '')
    assert.match(markup.list, /Nenhum nome novo com 3 ou mais documentos neste período\./)
  })
})

describe('loading ghosts hold each figure\'s silhouette, with no invented words', () => {
  it('paintAtlasLoading draws the map ring and ghost bars, not a Carregando hole', () => {
    withFakeDocument(['viewport', 'inspector'], (els) => {
      paintAtlasLoading()
      assert.match(els.viewport.innerHTML, /ghost-field/)
      assert.match(els.viewport.innerHTML, /class="boundary"/)
      assert.match(els.viewport.innerHTML, /<rect class="ghost"/)
      assert.doesNotMatch(els.viewport.innerHTML, /Carregando/)
      assert.match(els.inspector.innerHTML, /ghost-kicker/)
      assert.equal(els.viewport.getAttribute('aria-busy'), 'true')
      for (const value of inlineStyles(els.viewport.innerHTML + els.inspector.innerHTML)) assert.ok(value.startsWith('--'), `atlas ghost emitted style="${value}"`)
    })
  })

  it('paintOutletsLoading, paintCompareLoading and paintDocsLoading keep geometry and stay mute', () => {
    withFakeDocument(['outletList', 'compareRuler', 'compareDetail', 'docs'], (els) => {
      els.compareRuler.hidden = true
      paintOutletsLoading()
      paintCompareLoading()
      paintDocsLoading()
      assert.match(els.outletList.innerHTML, /outlet-grid/)
      assert.match(els.outletList.innerHTML, /Lendo os veículos/)
      assert.equal(els.compareRuler.hidden, false)
      assert.match(els.compareRuler.innerHTML, /ruler-axis/)
      assert.match(els.compareRuler.innerHTML, /Lendo a régua/)
      assert.match(els.compareDetail.innerHTML, /detail-sides/)
      assert.match(els.docs.innerHTML, /Lendo os documentos/)
      assert.equal(els.docs.getAttribute('aria-busy'), 'true')
      assert.doesNotMatch(els.outletList.innerHTML + els.compareRuler.innerHTML + els.docs.innerHTML, /Carregando/)
    })
  })
})

// issue #151: figure 4's own pure pre-layout step, checked directly (per the issue's own test
// plan) against the exports rather than against painted markup.
const risingTerm = (over: Partial<RisingTerm> = {}): RisingTerm => ({
  term: 'x',
  kind: 'word',
  count_recent: 1,
  count_baseline: 1,
  count_recent_raw: 1,
  count_baseline_raw: 1,
  lift: 1,
  ...over,
})

describe('risingRulerItems / shareBalance position by the word\'s share of everything written about the person', () => {
  // 40 word rows this week, 16 before: a word with 5 rows now and 1 (+1 smoothing → 2) before
  // holds 1/8 of the words in both windows.
  const about = { recent: 10, baseline: 5, words_recent: 40, words_baseline: 16 }
  const byShare = (a: typeof about) => (t: RisingTerm) => shareBalance(t, a)

  it('a term whose share is unchanged sits at the centre (balance === 0)', () => {
    const items = risingRulerItems([risingTerm({ term: 'igual', count_recent_raw: 5, count_baseline_raw: 1 })], byShare(about))
    assert.equal(items[0].balance, 0)
  })

  it('a share 8x bigger than before clamps to the rightmost position (balance === 1)', () => {
    const exactlyEight = risingRulerItems([risingTerm({ term: 'oito', count_recent_raw: 40, count_baseline_raw: 1 })], byShare(about))
    assert.equal(exactlyEight[0].balance, 1, 'log2(8)/3 === 1 exactly')
    const wellOver = risingRulerItems([risingTerm({ term: 'muito-mais', count_recent_raw: 40, count_baseline_raw: 0 })], byShare({ ...about, words_baseline: 5000 }))
    assert.equal(wellOver[0].balance, 1, 'anything past the clamp still reads as 1, never more')
  })

  it('a share 8x smaller than before clamps to the leftmost position (balance === -1)', () => {
    const items = risingRulerItems([risingTerm({ term: 'oitavo', count_recent_raw: 1, count_baseline_raw: 15 })], byShare({ ...about, words_recent: 64 }))
    assert.equal(items[0].balance, -1, '1/64 now against 16/16 before, clamped at -1')
  })

  it('a corpus whose docs grew longer does not push a steady word right: shares, not doc counts', () => {
    // Same 10 docs both weeks, but the recent ones carry 6x the words. A word in half the docs
    // either week keeps its share only if the totals scale with it.
    const grown = { recent: 10, baseline: 10, words_recent: 600, words_baseline: 100 }
    const steady = risingRulerItems([risingTerm({ term: 'sempre', count_recent_raw: 30, count_baseline_raw: 4 })], byShare(grown))
    assert.equal(steady[0].balance, 0)
  })

  it('stays finite with no baseline words at all: everything present is new, so it reads +1', () => {
    const items = risingRulerItems([risingTerm({ term: 'novo', count_recent_raw: 3, count_baseline_raw: 0 })], byShare({ recent: 5, baseline: 0, words_recent: 9, words_baseline: 0 }))
    assert.equal(items[0].balance, 1)
    assert.equal(shareBalance({ count_recent_raw: 0, count_baseline_raw: 0 }, { recent: 0, baseline: 0, words_recent: 0, words_baseline: 0 }), 0)
  })

  it('combined is the raw recent+baseline doc count, independent of balance', () => {
    const items = risingRulerItems([risingTerm({ term: 'soma', count_recent_raw: 12, count_baseline_raw: 3 })], byShare(about))
    assert.equal(items[0].combined, 15)
  })

  // The pre-#164 rule, kept for a payload that predates `present`/`about.words_*`.
  it('liftBalance / liftOfPerson: the fallback positions by the person\'s own lift and stays finite at baseline 0', () => {
    const lp = liftOfPerson({ recent: 10, baseline: 5 }, 7, 30)
    assert.equal(liftBalance({ lift: lp }, lp), 0)
    assert.equal(liftBalance({ lift: lp * 8 }, lp), 1)
    assert.equal(liftBalance({ lift: lp / 8 }, lp), -1)
    const zero = liftOfPerson({ recent: 5, baseline: 0 }, 7, 30)
    assert.ok(Number.isFinite(zero) && zero > 0)
  })

  it('hasShares is true only when present and both word totals arrived', () => {
    const base = { days: 7, baseline: 30, terms: [], outlets: [], about: { recent: 1, baseline: 1 } }
    assert.equal(hasShares(base), false)
    assert.equal(hasShares({ ...base, present: [] }), false)
    assert.equal(hasShares({ ...base, about: { recent: 1, baseline: 1, words_recent: 3, words_baseline: 2 } }), false)
    assert.equal(hasShares({ ...base, present: [], about: { recent: 1, baseline: 1, words_recent: 3, words_baseline: 2 } }), true)
  })

  it('rareRisers: terms minus present, only lift > 1, in the order terms came', () => {
    const present = [risingTerm({ term: 'a', lift: 4 }), risingTerm({ term: 'b', lift: 2 })]
    const terms = [risingTerm({ term: 'a', lift: 4 }), risingTerm({ term: 'c', lift: 3 }), risingTerm({ term: 'b', lift: 2 }), risingTerm({ term: 'd', lift: 1.5 }), risingTerm({ term: 'e', lift: 1 }), risingTerm({ term: 'f', lift: 0.5 })]
    assert.deepEqual(rareRisers(terms, present).map((t) => t.term), ['c', 'd'])
    assert.deepEqual(rareRisers(terms, []).map((t) => t.term), ['a', 'c', 'b', 'd'], 'lift 1 and below never counts as rising')
  })
})

describe('paintRisingRuler / paintRisingRulerError / paintRisingLoading', () => {
  const risingData = (present: RisingTerm[], about = { recent: 8, baseline: 3, words_recent: 40, words_baseline: 12 }, terms: RisingTerm[] = present): Rising => ({ days: 7, baseline: 30, terms, present, outlets: [], about })

  it('an empty terms array paints "Nenhuma palavra neste recorte." inside #risingRuler', () => {
    withFakeDocument(['risingRuler'], (els) => {
      const { shown, overflowCount } = paintRisingRuler({ data: risingData([]), metrics, selected: null, onPick: () => {} })
      assert.equal(shown, 0)
      assert.equal(overflowCount, 0)
      assert.match(els.risingRuler.innerHTML, /Nenhuma palavra neste recorte\./)
      assert.equal(els.risingRuler.hidden, false, 'the empty note is shown, not hidden behind the loading flag')
    })
  })

  it('paints one word per term, with the same data-term/data-kind pair the click handler reads', () => {
    withFakeDocument(['risingRuler'], (els) => {
      const terms = [risingTerm({ term: 'diretor', kind: 'word', lift: 40, count_recent_raw: 12, count_baseline_raw: 1 })]
      const { shown } = paintRisingRuler({ data: risingData(terms), metrics, selected: null, onPick: () => {} })
      assert.equal(shown, 1)
      assert.match(els.risingRuler.innerHTML, /data-term="diretor" data-kind="word"/)
      assert.match(els.risingRuler.innerHTML, /antes \(30 dias\)/)
      assert.match(els.risingRuler.innerHTML, /agora \(7 dias\)/)
      assert.match(els.risingRuler.innerHTML, /Fatia menor que antes[\s\S]*mesma fatia[\s\S]*Fatia maior que antes/, 'the axis speaks of shares, not of the person\'s own pace')
    })
  })

  it('the risers off the ruler (terms minus present, lift > 1) are listed after the overflow as clickable buttons, and alone they still paint', () => {
    withFakeDocument(['risingRuler'], (els) => {
      const present = [risingTerm({ term: 'diretor', kind: 'word', count_recent_raw: 12, count_baseline_raw: 1, lift: 2 })]
      const terms = [
        risingTerm({ term: 'sigilo', kind: 'word', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        risingTerm({ term: 'vorcaro', kind: 'hashtag', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        ...present,
        risingTerm({ term: 'caiu', kind: 'word', count_recent_raw: 3, count_baseline_raw: 9, lift: 0.5 }),
      ]
      const { shown } = paintRisingRuler({ data: risingData(present, undefined, terms), metrics, selected: { term: 'sigilo', kind: 'word' }, onPick: () => {} })
      assert.equal(shown, 1, 'only present words take a place on the ruler itself')
      const html = els.risingRuler.innerHTML
      assert.match(html, /ruler-rare/)
      assert.match(html, /Fora da régua, 2 palavras com poucos textos na semana, mas mais que antes/)
      assert.match(html, /<button class="quiet-button is-selected" data-term="sigilo" data-kind="word"/)
      assert.match(html, /data-term="vorcaro" data-kind="hashtag"[^>]*>#vorcaro</)
      assert.doesNotMatch(html, /data-term="caiu"/, 'a word whose lift is 1 or below did not rise and never makes the list')
      assert.equal(html.match(/data-term="diretor"/g)?.length, 1, 'a ruled word is never listed again below')
      assert.ok(html.indexOf('ruler-axis-labels') < html.indexOf('ruler-rare'), 'the list comes after the axis')
      assert.doesNotMatch(html, /Nenhuma palavra neste recorte/)
      paintRisingRuler({ data: risingData([], undefined, terms), metrics, selected: null, onPick: () => {} })
      assert.match(els.risingRuler.innerHTML, /ruler-rare/, 'no present words but risers still paints the list')
    })
  })

  it('shows only the first RARE_SHOWN (12) risers, in lift order, and says how many it left out', () => {
    withFakeDocument(['risingRuler'], (els) => {
      const present = [risingTerm({ term: 'comum', count_recent_raw: 20, lift: 1.2 })]
      const risers = Array.from({ length: 30 }, (_, i) => risingTerm({ term: `rara${i}`, count_recent_raw: 3, count_baseline_raw: 0, lift: 40 - i }))
      paintRisingRuler({ data: risingData(present, undefined, [...risers, ...present]), metrics, selected: null, onPick: () => {} })
      const html = els.risingRuler.innerHTML
      assert.equal(RARE_SHOWN, 12)
      assert.equal(html.match(/data-term="rara\d+"/g)?.length, 12)
      assert.match(html, /Fora da régua, 12 de 30 palavras/)
      assert.match(html, /data-term="rara11"/)
      assert.doesNotMatch(html, /data-term="rara12"/)
      paintRisingRuler({ data: risingData(present, undefined, [...risers.slice(0, 3), ...present]), metrics, selected: null, onPick: () => {} })
      assert.match(els.risingRuler.innerHTML, /Fora da régua, 3 palavras com/, 'no "de N" when nothing was left out')
    })
  })

  // A /rising payload cached before `present`/`about.words_*` existed: the ruler must not paint
  // NaN positions from `undefined` totals, so it falls back to the person-lift rule, with that
  // rule's own axis prose and no list below.
  it('a pre-present payload paints every word by the person-lift rule, finite positions, old axis, no risers list', () => {
    withFakeDocument(['risingRuler'], (els) => {
      const about = { recent: 10, baseline: 5 }
      const lp = liftOfPerson(about, 7, 30)
      const terms = [risingTerm({ term: 'igual', lift: lp }), risingTerm({ term: 'oito', lift: lp * 8 })]
      const stale: Rising = { days: 7, baseline: 30, terms, outlets: [], about }
      const { shown } = paintRisingRuler({ data: stale, metrics, selected: null, onPick: () => {} })
      assert.equal(shown, 2)
      const html = els.risingRuler.innerHTML
      assert.doesNotMatch(html, /NaN/)
      assert.match(html, /Mais devagar que a pessoa[\s\S]*no mesmo ritmo[\s\S]*Mais rápido que a pessoa/)
      assert.doesNotMatch(html, /Fatia/)
      assert.doesNotMatch(html, /ruler-rare/)
    })
  })

  it('paintRisingRulerError paints the "could not load" note', () => {
    withFakeDocument(['risingRuler'], (els) => {
      els.risingRuler.hidden = true
      paintRisingRulerError()
      assert.equal(els.risingRuler.hidden, false)
      assert.match(els.risingRuler.innerHTML, /Não foi possível carregar os termos em alta/)
    })
  })

  it('paintRisingLoading paints a ruler ghost, not the word Carregando, and stays mute on #risingAbout', () => {
    withFakeDocument(['risingRuler', 'risingAbout'], (els) => {
      els.risingAbout.textContent = 'A pessoa: 8 textos nos últimos 7 dias, 3 nos 30 dias antes.'
      paintRisingLoading()
      assert.match(els.risingRuler.innerHTML, /ruler-axis/)
      assert.doesNotMatch(els.risingRuler.innerHTML, /Carregando/)
      assert.equal(els.risingRuler.getAttribute('aria-busy'), 'true')
      assert.equal(els.risingAbout.textContent, '', 'the ghost clears the previous two-number sentence rather than leaving it stale')
    })
  })
})

describe('paintRuler (compare, figure 3) keeps its own exported shape after the shared paintRulerBody extraction', () => {
  it('still returns hiddenCount/shown/overflowCount and paints #compareRuler exactly as before', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const terms: CompareTerm[] = [{ term: 'reforma', kind: 'word', a: side(5, 1), b: null }]
      const result = paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.deepEqual(Object.keys(result).sort(), ['hiddenCount', 'overflowCount', 'shown'].sort())
      assert.match(els.compareRuler.innerHTML, /Só de Lula/)
      assert.match(els.compareRuler.innerHTML, /Só de Jair Bolsonaro/)
      assert.doesNotMatch(els.compareRuler.innerHTML, /antes \(30 dias\)|agora \(7 dias\)/, 'compare keeps its own end labels, not the rising ruler\'s')
    })
  })
})

describe('paintWeek / paintWeekLoading / paintWeekError, figure 5', () => {
  const weekBucket = (over: Partial<WeekBucket> = {}): WeekBucket => ({ start: '2026-09-08T03:00:00.000Z', about: 5, terms: [], ...over })
  const weekData = (buckets: WeekBucket[]): Week => ({ days: 7, tz: 'America/Sao_Paulo', buckets })

  it('paints one .week-day per bucket, oldest first, each with its own weekday label and about number', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      const buckets = Array.from({ length: 7 }, (_, i) => weekBucket({ start: `2026-09-0${i + 2}T03:00:00.000Z`, about: i, terms: i === 6 ? [{ term: 'reforma', kind: 'word', count: 3 }] : [] }))
      paintWeek({ data: weekData(buckets), metrics, selected: null, onPick: () => {} })
      assert.equal(els.weekChart.innerHTML.match(/class="week-day"/g)?.length, 7)
      assert.match(els.weekChart.innerHTML, /class="stat"/)
      assert.match(els.weekChart.innerHTML, /data-term="reforma" data-kind="word" data-day="2026-09-08"/)
      assert.equal(els.weekChart.hidden, false)
    })
  })

  it('an empty week (every terms array empty) keeps the seven about numbers and no marks, plus one note', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      const buckets = Array.from({ length: 7 }, (_, i) => weekBucket({ about: i + 1, terms: [] }))
      paintWeek({ data: weekData(buckets), metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.weekChart.innerHTML, /data-term=/)
      for (let i = 1; i <= 7; i++) assert.match(els.weekChart.innerHTML, new RegExp(`<dd>${i}</dd>`))
      assert.match(els.weekNote.textContent, /Não há palavras suficientes nesta semana\./)
    })
  })

  it('a day with no surviving terms keeps its number and paints nothing under it: no mark, no per-day sentence', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ about: 4, terms: [] })]), metrics, selected: null, onPick: () => {} })
      assert.match(els.weekChart.innerHTML, /<dd>4<\/dd>/)
      assert.doesNotMatch(els.weekChart.innerHTML, /data-term=/)
      assert.doesNotMatch(els.weekChart.innerHTML, /week-svg/)
      assert.doesNotMatch(els.weekChart.innerHTML, /<p/)
    })
  })

  it('an overflow button carries the day count, since size is the only encoding and a listed word has none', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ terms: [{ term: 'pronunciamento', kind: 'word', count: 55 }] })]), metrics, selected: null, onPick: () => {}, width: 84 })
      assert.match(els.weekChart.innerHTML, /<button class="quiet-button[^"]*" data-term="pronunciamento"[^>]*>pronunciamento<b>55<\/b><\/button>/)
    })
  })

  it('the overflow list is named by one eyebrow line, never a sentence taller than the words it lists', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ terms: [{ term: 'pronunciamento', kind: 'word', count: 55 }, { term: 'constitucionalidade', kind: 'word', count: 40 }] })]), metrics, selected: null, onPick: () => {}, width: 84 })
      assert.match(els.weekChart.innerHTML, /<div class="week-overflow"><p class="eyebrow">Não couberam<\/p><button/)
      assert.doesNotMatch(els.weekChart.innerHTML, /nesta coluna|clicáveis/)
    })
  })

  it('one listed word is named in the singular', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ terms: [{ term: 'pronunciamento', kind: 'word', count: 55 }] })]), metrics, selected: null, onPick: () => {}, width: 84 })
      assert.match(els.weekChart.innerHTML, /<div class="week-overflow"><p class="eyebrow">Não coube<\/p><button/)
    })
  })

  it('a wrapped phrase is one tspan per line inside one mark, still one data-term', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ terms: [{ term: 'supremo tribunal federal', kind: 'phrase', count: 55 }] })]), metrics, selected: null, onPick: () => {}, width: 145 })
      const marks = els.weekChart.innerHTML.match(/data-term="supremo tribunal federal"/g) ?? []
      assert.equal(marks.length, 1, 'drawn, not listed')
      assert.match(els.weekChart.innerHTML, /<text class="week-text"[^>]*><tspan x="0" y="[^"]+">supremo<\/tspan><tspan x="0" y="[^"]+">tribunal<\/tspan><tspan x="0" y="[^"]+">federal<\/tspan><\/text>/)
      assert.doesNotMatch(els.weekChart.innerHTML, /week-overflow/)
    })
  })

  it('every style="..." emitted is a --var override, never a hardcoded declaration', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeek({ data: weekData([weekBucket({ terms: [{ term: 'reforma', kind: 'word', count: 3 }] })]), metrics, selected: null, onPick: () => {} })
      for (const value of inlineStyles(els.weekChart.innerHTML)) assert.ok(value.startsWith('--'), `paintWeek emitted style="${value}"`)
    })
  })

  it('paintWeekLoading paints a ghost of seven columns, never the word Carregando', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeekLoading()
      assert.match(els.weekChart.innerHTML, /ghost-field/)
      assert.equal(els.weekChart.innerHTML.match(/class="week-day"/g)?.length, 7)
      assert.doesNotMatch(els.weekChart.innerHTML, /Carregando/)
      assert.equal(els.weekChart.getAttribute('aria-busy'), 'true')
    })
  })

  it('every ghost mark sits inside its svg: y within [0, height], never above the label ghost (validator round 1, 3)', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeekLoading()
      const height = Number(els.weekChart.innerHTML.match(/viewBox="0 0 \d+ (\d+)"/)?.[1])
      assert.ok(height > 0)
      const ys = [...els.weekChart.innerHTML.matchAll(/<rect class="ghost"[^>]*\sy="(-?[\d.]+)"[^>]*height="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
      assert.ok(ys.length >= 3, 'the ghost draws marks')
      for (const [y, h] of ys) assert.ok(y >= 0 && y + h <= height, `ghost rect at y=${y} leaves the 0..${height} svg`)
    })
  })

  it('paintWeekError paints the "could not load" note and clears the loading ghost', () => {
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      paintWeekError()
      assert.match(els.weekChart.innerHTML, /Não foi possível carregar a semana/)
      assert.doesNotMatch(els.weekChart.innerHTML, /ghost-field/)
    })
  })
})

// Issue #170 AC5: paintRuler's exported shape is already pinned by issue #151's block above.
// paintWeek and paintTermStrip need the same guarantee after the marks.ts extraction: still
// exported under their pre-refactor names, still painting the markup issue #147/#149's suites
// in this file pin.
describe('paintWeek and paintTermStrip keep their exported shape after the marks.ts extraction', () => {
  it('render.ts still exports paintWeek, paintWeekLoading, paintWeekError, paintTermStrip and termStripLayout as functions', () => {
    assert.equal(typeof paintWeek, 'function')
    assert.equal(typeof paintWeekLoading, 'function')
    assert.equal(typeof paintWeekError, 'function')
    assert.equal(typeof paintTermStrip, 'function')
    assert.equal(typeof termStripLayout, 'function')
  })
})

// Issue #174.
describe('one class scheme, one rx source, one text shape for the three word marks', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const renderSrc = readFileSync(join(root, 'src', 'ui', 'render.ts'), 'utf8')
  const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')
  const placedSample: PlacedTerm = { id: 'word:x', term: 'x', kind: 'word', pmi: 1, rank: 0, x: 0, y: 0, w: 60, h: 30, size: 20, lineHeight: 24, lines: ['x'], count: 9, score: 9 }

  // The block-body finder for a class selector, tolerant of a rule declared with several
  // comma-separated selectors (".ruler-glow, .week-glow { rx: 8px }" is how the spec's own
  // example groups the shared value).
  const ruleFor = (selector: string) => {
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim())
      if (selectors.includes(selector)) return m[2]
    }
    return ''
  }
  const rxOf = (selector: string) => {
    const body = ruleFor(selector)
    const found = body.match(/rx\s*:\s*([\d.]+)px/)
    return found ? Number(found[1]) : undefined
  }

  it('render.ts carries no literal word-button, word-glow, word-hit or class="word" string', () => {
    for (const literal of ['word-button', 'word-glow', 'word-hit', 'class="word"'])
      assert.ok(!renderSrc.includes(literal), `render.ts must not contain ${JSON.stringify(literal)}`)
  })

  it('the atlas word markup uses atlas-word/atlas-glow/atlas-hit/atlas-text', () => {
    const html = String(wordMarkup(placedSample, 'count', null))
    assert.match(html, /<g class="atlas-word[^"]*"/)
    assert.match(html, /<rect class="atlas-glow"/)
    assert.match(html, /<rect class="atlas-hit"/)
    assert.match(html, /<text class="atlas-text"/)
  })

  it('the map-svg.is-masked mask-and-underline rule still targets the atlas word class', () => {
    assert.match(css, /\.map-svg\.is-masked \.atlas-word/)
  })

  it('no glow or hit rect emitted by any of the three builders carries an rx attribute', async () => {
    const atlasHtml = String(wordMarkup(placedSample, 'count', null))
    assert.doesNotMatch(atlasHtml, /class="(atlas|ruler|week)-(glow|hit)"[^>]*rx=/)
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [{ term: 'alckmin', kind: 'word', a: side(192, 0.87), b: side(14, -1.58) }]
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.compareRuler.innerHTML, /class="(atlas|ruler|week)-(glow|hit)"[^>]*rx=/)
    })
    withFakeDocument(['weekChart', 'weekNote'], (els) => {
      const buckets = [{ start: '2026-09-08T03:00:00.000Z', about: 5, terms: [{ term: 'reforma', kind: 'word', count: 3 }] }]
      paintWeek({ data: { days: 7, tz: 'America/Sao_Paulo', buckets } as Week, metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.weekChart.innerHTML, /class="(atlas|ruler|week)-(glow|hit)"[^>]*rx=/)
    })
  })

  it('atlas.css sets rx on the six rules, at the same values the markup used to carry', () => {
    assert.equal(rxOf('.atlas-glow'), 9)
    assert.equal(rxOf('.atlas-hit'), 6)
    assert.equal(rxOf('.ruler-glow'), 8)
    assert.equal(rxOf('.ruler-hit'), 5)
    assert.equal(rxOf('.week-glow'), 8)
    assert.equal(rxOf('.week-hit'), 5)
  })

  it('the ruler wraps its word text in a single <tspan x="0" y="0">, like the atlas and the week', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [{ term: 'alckmin', kind: 'word', a: side(192, 0.87), b: side(14, -1.58) }]
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.match(els.compareRuler.innerHTML, /<text class="ruler-text"[^>]*><tspan x="0" y="0">alckmin<\/tspan><\/text>/)
    })
  })

  it('marks.ts still exports only frame, axis and overflowList — no wordMark', async () => {
    const marks = await import('../src/ui/marks.js')
    assert.deepEqual(Object.keys(marks).sort(), ['axis', 'frame', 'overflowList'])
  })
})
