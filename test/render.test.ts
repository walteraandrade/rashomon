import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  STRIP_MAX_HEIGHT,
  STRIP_MIN_R,
  drawMap,
  inspect,
  paintCandidates,
  paintColumns,
  paintCompareDetail,
  paintDocs,
  paintDocsHead,
  paintRuler,
  paintSelection,
  paintStrip,
  paintTestimony,
  paintTestimonyError,
  paintTestimonyLoading,
  rulerTerms,
  stripLayout,
  stripRadius,
  testimonyLine,
  wordMarkup,
} from '../src/ui/render.js'
import type { Compare, CompareTerm } from '../src/ui/format.js'
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
const side = (count: number, pmi: number) => ({ count, pmi, tone: null })

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4 }
const graph = { person: { id: 'p1', name: 'Alguém' }, stats: { about: 40 }, nodes: [term], links: [] }

const paint = (selected: string | null) =>
  withFakeDocument(['inspector'], (els) => {
    inspect({ graph, nodes: [term], links: [], selected, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {} })
    return els.inspector.innerHTML
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
      assert.doesNotMatch(els.viewport.innerHTML, /class="word-button"[^>]*data-person-docs/, 'a word is never the person')
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
      assert.equal(els.testimonyList.textContent, 'Carregando…')
      assert.equal(els.testimonyLabel.textContent, '')
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
      els.strip.hidden = false
      paintTestimonyLoading()
      assert.equal(els.strip.hidden, true, 'a load in flight blanks the strip too')
    })
  })
})

describe('wordMarkup / paintColumns / paintSelection / testimonyLine: words coloured against the person mean', () => {
  const person = { method: 'kikori:q8', score: -2.4, n: 500 }
  const placed = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', pmi: 1, rank: 0, x: 0, y: 0, w: 60, h: 30, size: 20, lineHeight: 24, lines: ['x'], count: 9, score: 9, ...over })

  it('wordMarkup carries the --mask colour and the testimony in its title only when it has one', () => {
    const masked = String(wordMarkup(placed({ testimony: { score: -4.9, n: 12 } }), 'count', person.score))
    assert.match(masked, /style="--size:20px;--mask:rgb\(255,107,125\)"/)
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
      assert.match(els.columns.innerHTML, /data-col="word:a" style="--mask:rgb\(126,231,135\)">/, '+2.5 over the person: full green')
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
      for (const word of ['alckmin', 'rachadinha', '#bolsa']) assert.ok(html.includes(`>${word}</text>`), `${word} must be written on the ruler`)
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
  it('rulerTerms drops it and counts it as hidden', () => {
    const terms: CompareTerm[] = [
      { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
      { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
    ]
    const { items, hiddenCount } = rulerTerms(terms, 'count')
    assert.equal(items.length, 1)
    assert.equal(items[0].term, 'reforma')
    assert.equal(hiddenCount, 1)
  })

  it('paintRuler produces no dot for the name term and reports the same hiddenCount', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const terms: CompareTerm[] = [
        { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
        { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
      ]
      const data = compareData(terms)
      const { hiddenCount } = paintRuler({ data, personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.equal(hiddenCount, 1)
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-term="lula"/)
      assert.match(els.compareRuler.innerHTML, /data-term="reforma"/)
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
