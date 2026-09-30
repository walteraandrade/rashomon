import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STRIP_MAX_HEIGHT, STRIP_PAD, stripRadius, termStripLayout, MATRIX_CELL_MAX, MATRIX_CELL_MIN, RULER_MAX_HEIGHT, RULER_SIZE_MIN, SIZE_CEILING, SIZE_FLOOR, WEEK_MAX_HEIGHT, WEEK_SIZE_MIN, attentionLayout, centerLabel, matrixLayout, pack, packPass, peakDay, persistenceLayout, routeGraph, routesFrom, rulerLayout, rulerModel, sizeRange, swarm, swarmBy, weekLayout, wrapLines } from '../src/ui/layout.js'
import { rulerTerms } from '../src/ui/render.js'
import type { CompareTerm } from '../src/ui/format.js'
import { balanceColor } from '../src/ui/format.js'

// src/ui/layout.ts: pure geometry. rulerTerms (render.ts) is imported only to build the items
// rulerLayout packs, the same way the browser hands them over.

// Deterministic stand-in for the browser canvas adapter (public/js/render.js's
// createCanvasMeasure): width scales linearly with character count and font size, so wrapping
// and packing behave predictably without a real <canvas>.
const measure = (text: string, size: number) => text.length * size * 0.6

describe('wrapLines', () => {
  it('keeps text on one line when it fits maxWidth', () => {
    assert.deepEqual(wrapLines(measure, 'oi', 20, 500), ['oi'])
  })

  it('wraps at a space/underscore/hyphen when the break falls past 30% of the line', () => {
    const lines = wrapLines(measure, 'palavra composta longa', 20, 90)
    assert.ok(lines.length > 1)
    assert.ok(lines.every((line) => measure(line, 20) <= 90 + 20 * 0.6), 'every line should respect maxWidth within one character')
  })

  it('never drops characters: rejoining every line reproduces every char in order (spaces collapse at hard breaks)', () => {
    const text = 'umtermobemgrandeesemespacoparaforcarquebranomeiodapalavra'
    const lines = wrapLines(measure, text, 14, 60)
    assert.equal(lines.join(''), text)
  })
})

describe('centerLabel', () => {
  it('returns a box at least 240 wide and tall enough for every line', () => {
    const c = centerLabel(measure, 'Fulano de Tal')
    assert.ok(c.w >= 240)
    assert.equal(c.h, c.lines.length * c.lineHeight + 88)
    assert.equal(c.x, 0)
    assert.equal(c.y, 0)
  })

  it('wraps a long name into more than one line', () => {
    const c = centerLabel(measure, 'Um Nome Excepcionalmente Longo Para Forcar Quebra De Linha')
    assert.ok(c.lines.length > 1)
  })
})

const term = (id: string, count: number, pmi = 1) => ({ id, term: id, kind: 'word', count, pmi })

describe('sizeRange', () => {
  it('never passes the ceiling, however few terms there are', () => {
    for (const count of [1, 3, 8, 10]) assert.ok(sizeRange(count).maxSize <= SIZE_CEILING, `${count} terms exceeded the ceiling`)
  })

  it('shrinks both the ceiling and the floor as the term count grows', () => {
    const few = sizeRange(12)
    const many = sizeRange(24)
    assert.ok(many.maxSize < few.maxSize, 'a fuller atlas must lower its largest type')
    assert.ok(many.minSize < few.minSize, 'a fuller atlas must lower its smallest type')
    assert.ok(many.minSize >= SIZE_FLOOR, 'no term goes under the floor')
  })

  it('keeps the largest term larger than the smallest at every count', () => {
    for (const count of [1, 12, 18, 24, 60]) {
      const { minSize, maxSize } = sizeRange(count)
      assert.ok(maxSize > minSize, `${count} terms collapsed the ramp`)
    }
  })
})

describe('packing at the atlas term limits', () => {
  // The three options the sentence in atlas.html offers, with realistically long terms.
  const words = ['investigacao', 'impeachment', 'revelacoes', 'mensagens', 'relatorio', 'inquerito', 'indicios', 'relatorios', 'anotem', 'acusa', 'fake', 'laranja podre', 'fake news', 'processo', 'ministro', 'decisao', 'tribunal', 'censura', 'impedido votar', 'declara impedido', 'acabar elegendo', 'bandido confiar', 'liminar', 'audiencia']

  for (const limit of [12, 18, 24]) {
    it(`leaves at most one term of ${limit} in the overflow list`, () => {
      const terms = words.slice(0, limit).map((w, i) => ({ id: w, term: w, kind: 'word', count: 100 - i * 3, pmi: 1 }))
      const center = centerLabel(measure, 'Alexandre de Moraes')
      const result = pack(measure, terms, center, 'count')
      assert.ok(result.overflow.length <= 1, `${result.overflow.length} terms overflowed: ${result.overflow.map((o) => o.term).join(', ')}`)
      assert.ok(result.placed.every((p) => p.size <= SIZE_CEILING), 'a placed term passed the ceiling')
    })
  }
})

describe('packPass / pack', () => {
  it('accounts for every term exactly once, split between placed and overflow', () => {
    // 40 long equal-score terms in a fixed-size circle: guaranteed to overflow even at the
    // ramp's floor, since the candidate grid and center box cannot fit unlimited boxes.
    const terms = Array.from({ length: 40 }, (_, i) => term(`termo bem comprido numero ${i}`, 10))
    const center = centerLabel(measure, 'Pessoa Central')
    const result = pack(measure, terms, center, 'count')
    const seen = new Set([...result.placed.map((p) => p.id), ...result.overflow.map((p) => p.id)])
    assert.equal(seen.size, terms.length, 'every term must appear exactly once, in placed or overflow')
    assert.ok(result.overflow.length > 0, 'this term count must overflow the fixed packing circle')
  })

  it('places every term when there are few of them', () => {
    const terms = [term('a', 10), term('b', 5), term('c', 1)]
    const center = centerLabel(measure, 'Pessoa Central')
    const result = packPass(measure, terms, center, 'count')
    assert.equal(result.placed.length, 3)
    assert.equal(result.overflow.length, 0)
  })

  it('sort=pmi orders placement rank by pmi * ln(1 + count), not by count', () => {
    // 'low-count-high-pmi' has less count but far higher pmi*ln(1+count) than 'high-count-low-pmi'
    const terms = [term('high-count-low-pmi', 100, 0.01), term('low-count-high-pmi', 2, 50)]
    const center = centerLabel(measure, 'Pessoa Central')
    const bySort = packPass(measure, terms, center, 'pmi')
    const byHighPmi = bySort.placed.find((p) => p.id === 'low-count-high-pmi')!
    const byLowPmi = bySort.placed.find((p) => p.id === 'high-count-low-pmi')!
    assert.ok(byHighPmi.score > byLowPmi.score)
  })
})

describe('routeGraph / routesFrom', () => {
  it('routes from the selected term to every other placed term as an SVG path starting with M', () => {
    const terms = [term('a', 10), term('b', 8), term('c', 6)]
    const center = centerLabel(measure, 'Pessoa Central')
    const layout = packPass(measure, terms, center, 'count')
    assert.equal(layout.overflow.length, 0)
    const routes = routesFrom(layout, 'a')
    assert.ok(routes.has('b'))
    assert.ok(routes.has('c'))
    assert.ok(!routes.has('a'), 'a term never routes to itself')
    for (const path of routes.values()) assert.match(path, /^M/)
  })

  it('caches the routing graph on layout.routing across calls', () => {
    const terms = [term('a', 10), term('b', 8)]
    const center = centerLabel(measure, 'Pessoa Central')
    // routesFrom stashes its routing graph on the layout object itself, a field layout.js
    // declares optional; reading it here is the test's own bookkeeping.
    const layout = packPass(measure, terms, center, 'count')
    assert.equal(layout.routing, undefined)
    routesFrom(layout, 'a')
    const cached = layout.routing
    assert.ok(cached)
    routesFrom(layout, 'b')
    assert.equal(layout.routing, cached, 'second call must reuse the same routing graph, not rebuild it')
  })

  it('routeGraph is independent of routesFrom: it can be called directly to build the same graph', () => {
    const terms = [term('a', 10)]
    const center = centerLabel(measure, 'Pessoa Central')
    const layout = packPass(measure, terms, center, 'count')
    const graph = routeGraph(layout)
    assert.ok(graph.points.length > 0)
    assert.ok(graph.ports.has('a'))
  })
})

// Issue #99: the ruler draws the word itself where it used to draw an anonymous dot. The
// criteria here are the reading ones -- no word covers another, nothing disappears in silence,
// the ends still mean "zero on the other side".

// 0.6em per character is close enough to IBM Plex Mono that a word's box is the right order
// of magnitude.
const metrics = (text: string, size: number) => text.length * size * 0.6

const side = (count: number, pmi: number) => ({ count, pmi, tone: null })

// A term list shaped like the real Lula x Bolsonaro year: a heavy pile at each end (words only
// one side has) plus a spread of shared words, which is the distribution that makes text hard
// to place and dots easy.
const corpus = (): CompareTerm[] => {
  const terms: CompareTerm[] = []
  for (let i = 0; i < 22; i++) terms.push({ term: `esquerda${i}`, kind: 'word', a: side(20 + i, 1.4), b: null })
  for (let i = 0; i < 18; i++) terms.push({ term: `direita${i}`, kind: 'word', a: null, b: side(15 + i, 1.2) })
  for (let i = 0; i < 24; i++) terms.push({ term: `partilhada${i}`, kind: 'word', a: side(10 + i * 3, 1.1), b: side(60 - i * 2, 0.9) })
  return terms
}

const overlapping = (words: { term: string; x: number; y: number; w: number; h: number }[]) => {
  const bad: string[] = []
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i]
      const b = words[j]
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1e-6) bad.push(`${a.term}/${b.term}`)
    }
  return bad
}

describe('the words never overlap and never leave the frame', () => {
  for (const width of [1280, 860, 375]) {
    it(`packs a real-shaped recorte at ${width}px with zero overlaps and zero words outside the frame`, () => {
      const { items } = rulerTerms(corpus(), 'count')
      const { words } = rulerLayout(metrics, items, width)
      assert.ok(words.length > 0)
      assert.deepEqual(overlapping(words), [], 'two words may never share pixels')
      for (const w of words) {
        assert.ok(w.x - w.w / 2 >= -1e-6, `${w.term} starts before the left edge`)
        assert.ok(w.x + w.w / 2 <= width + 1e-6, `${w.term} runs past the right edge`)
      }
    })
  }

  it('holds for the PMI measure too, which moves every word', () => {
    const { items } = rulerTerms(corpus(), 'pmi')
    for (const width of [1280, 375]) assert.deepEqual(overlapping(rulerLayout(metrics, items, width).words), [])
  })

  it('never grows taller than the cap, and reports exactly the height it uses', () => {
    const { items } = rulerTerms(corpus(), 'count')
    const { words, height, half } = rulerLayout(metrics, items, 860)
    assert.ok(height <= RULER_MAX_HEIGHT + 12, `${height} must stay near the ${RULER_MAX_HEIGHT} cap`)
    const reach = words.reduce((m, w) => Math.max(m, Math.abs(w.y) + w.h / 2), 0)
    assert.ok(half >= reach, 'the reported half-height must contain every word it drew')
  })
})

describe('no word is drawn below the size floor the site sets', () => {
  it('every word is at least RULER_SIZE_MIN px, at any width', () => {
    const { items } = rulerTerms(corpus(), 'count')
    assert.equal(RULER_SIZE_MIN, 11, 'atlas.css sets 11px as the smallest type on the site')
    for (const width of [1280, 860, 375]) for (const w of rulerLayout(metrics, items, width).words) assert.ok(w.size >= RULER_SIZE_MIN, `${w.term} at ${w.size}px is under the floor`)
  })

  it('the biggest word is the one with the most documents on both sides combined', () => {
    const terms: CompareTerm[] = [
      { term: 'pouca', kind: 'word', a: side(3, 1), b: side(1, 1) },
      { term: 'muita', kind: 'word', a: side(200, 1), b: side(150, 1) },
    ]
    const { items } = rulerTerms(terms, 'count')
    const { words } = rulerLayout(metrics, items, 860)
    const by = Object.fromEntries(words.map((w) => [w.term, w.size]))
    assert.ok(by.muita > by.pouca, 'the type size is the combined document count, not the measure')
  })

  it('the type size does not move when the measure does', () => {
    const { items: byCount } = rulerTerms(corpus(), 'count')
    const { items: byPmi } = rulerTerms(corpus(), 'pmi')
    const sizes = (items: typeof byCount) => {
      const layout = rulerLayout(metrics, items, 860)
      return Object.fromEntries([...layout.words, ...layout.overflow].map((w) => [w.term, w.size]))
    }
    assert.deepEqual(sizes(byCount), sizes(byPmi), 'combined is measure-independent, so the type size must be too')
  })
})

describe('a word both people have never touches an end', () => {
  it('alckmin (192 documents with Lula, 14 with Bolsonaro) is drawn inside the ruler', () => {
    const terms: CompareTerm[] = [
      { term: 'alckmin', kind: 'word', a: side(192, 0.87), b: side(14, -1.58) },
      { term: 'rachadinha', kind: 'word', a: null, b: side(30, 2.1) },
      { term: 'urgentes', kind: 'word', a: side(20, 1.1), b: null },
    ]
    for (const measure of ['count', 'pmi']) {
      const { items } = rulerTerms(terms, measure)
      const alckmin = items.find((t) => t.term === 'alckmin')!
      assert.ok(Math.abs(alckmin.balance) < 1, `balance ${alckmin.balance} must not pin to an end when both sides have documents`)
      const { words, x } = rulerLayout(metrics, items, 860)
      const drawn = words.find((w) => w.term === 'alckmin')!
      assert.ok(drawn.x > x(-1) && drawn.x < x(1), `alckmin sits at ${drawn.x}, which is on an end of [${x(-1)}, ${x(1)}]`)
    }
  })

  it('a word only one side has does sit on that side end', () => {
    const terms: CompareTerm[] = [{ term: 'rachadinha', kind: 'word', a: null, b: side(30, 2.1) }]
    const { items } = rulerTerms(terms, 'count')
    assert.equal(items[0].balance, 1)
  })
})

describe('a word that does not fit is listed rather than dropped', () => {
  // Enough words at one balance to exhaust the height cap whatever the packer does.
  const crowded = (): CompareTerm[] => Array.from({ length: 120 }, (_, i) => ({ term: `exclusivadolula${i}`, kind: 'word', a: side(50, 1), b: null }))

  it('rulerLayout returns the words it could not place instead of dropping them', () => {
    const { items } = rulerTerms(crowded(), 'count')
    const { words, overflow } = rulerLayout(metrics, items, 860)
    assert.ok(overflow.length > 0, 'this recorte cannot fit; the packer must say so')
    assert.equal(words.length + overflow.length, items.length, 'every word is either drawn or listed, never lost')
  })
})

describe('RulerItem.bridge is optional and never affects layout (issue #219 AC6)', () => {
  it('rulerLayout output is unchanged when items carry no bridge field', () => {
    const wordGeometry = (words: { term: string; x: number; y: number; size: number; w: number; h: number }[]) =>
      words.map(({ term, x, y, size, w, h }) => ({ term, x, y, size, w, h }))
    const overflowGeometry = (words: { term: string; size: number }[]) => words.map(({ term, size }) => ({ term, size }))
    const { items } = rulerTerms(corpus(), 'count')
    const withoutBridge = rulerLayout(metrics, items, 860)
    const withBridge = rulerLayout(metrics, items.map((it) => ({ ...it, bridge: 1 }) as typeof it), 860)
    assert.deepEqual(wordGeometry(withBridge.words), wordGeometry(withoutBridge.words))
    assert.deepEqual(overflowGeometry(withBridge.overflow), overflowGeometry(withoutBridge.overflow))
    assert.equal(withBridge.height, withoutBridge.height)
    assert.equal(withBridge.half, withoutBridge.half)
  })
})

describe('swarm / swarmBy / rulerLayout: one beeswarm skeleton, two shapes (issue #99 AC6)', () => {
  it('swarm is swarmBy with circle clearance and still keeps every x, never overlapping', () => {
    const items = [
      { id: 'a', x: 10, r: 9 },
      { id: 'b', x: 14, r: 7 },
      { id: 'c', x: 18, r: 5 },
      { id: 'd', x: 12, r: 4 },
    ]
    const placed = swarm(items)
    assert.equal(placed.length, items.length, 'the circle swarm never drops a dot')
    for (const p of placed) assert.equal(p.x, items.find((i) => i.id === p.id)?.x)
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) assert.ok(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) >= placed[i].r + placed[j].r - 1e-6, 'two dots may not overlap')
    assert.deepEqual(swarm(items), placed, 'deterministic')
  })

  it('swarmBy sends an item nowhere to go to overflow rather than off the figure', () => {
    const items = [
      { term: 'um', x: 0, w: 40, h: 20 },
      { term: 'dois', x: 0, w: 40, h: 20 },
      { term: 'tres', x: 0, w: 40, h: 20 },
    ]
    const { placed, overflow } = swarmBy(items, {
      size: (d) => d.w,
      reach: (p, item) => (Math.abs(p.x - item.x) < (p.w + item.w) / 2 ? (p.h + item.h) / 2 : null),
      fits: (item, y) => Math.abs(y) + item.h / 2 <= 25,
    })
    assert.equal(placed.length, 1, 'only one 20px box fits inside a 50px band')
    assert.equal(overflow.length, 2)
    assert.equal(placed.length + overflow.length, items.length)
  })

  it('swarm keeps every x, never overlaps two dots and puts the biggest on the axis', () => {
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

  it('rulerLayout is deterministic: the same recorte packs to the same picture', () => {
    const { items } = rulerTerms(corpus(), 'count')
    const once = rulerLayout(metrics, items, 860)
    const twice = rulerLayout(metrics, items, 860)
    assert.deepEqual(once.words, twice.words)
    assert.deepEqual(once.overflow, twice.overflow)
    assert.equal(once.height, twice.height)
  })
})

describe('weekLayout (issue #147): one column per day, built on swarmBy, same overflow contract as rulerLayout', () => {
  const term = (t: string, count: number, kind = 'word') => ({ term: t, kind, count })

  it('returns one column per day, in the order given', () => {
    const days = [[term('reforma', 4)], [], [term('eleicao', 2), term('pauta', 5)]]
    const columns = weekLayout(measure, days)
    assert.equal(columns.length, 3)
    assert.equal(columns[1].words.length, 0, 'an empty day is an empty column, not dropped')
  })

  it('every word in a day is either placed or listed as overflow, never lost', () => {
    const day = Array.from({ length: 40 }, (_, i) => term(`palavradodiaaaaaaaaaaaaaaaaaa${i}`, 40 - i))
    const [column] = weekLayout(measure, [day])
    assert.ok(column.overflow.length > 0, 'this many words cannot fit one column')
    assert.equal(column.words.length + column.overflow.length, day.length)
    for (const w of column.words) assert.ok(w.size >= WEEK_SIZE_MIN, `${w.term} at ${w.size}px is under the floor`)
    assert.ok(column.height <= WEEK_MAX_HEIGHT + 20, 'the column trades overflow for height, not an unbounded column')
  })

  it('two placed words in the same day never overlap vertically', () => {
    const day = [term('reforma', 10), term('pauta', 8), term('eleicao', 6), term('governo', 4)]
    const [column] = weekLayout(measure, [day])
    for (let i = 0; i < column.words.length; i++)
      for (let j = i + 1; j < column.words.length; j++) {
        const a = column.words[i]
        const b = column.words[j]
        assert.ok(Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - 1e-6, `${a.term} and ${b.term} overlap vertically`)
      }
  })

  it('the loudest word of the day sizes larger than the quietest', () => {
    const [column] = weekLayout(measure, [[term('grande', 20), term('pequena', 1)]])
    const big = column.words.find((w) => w.term === 'grande')!
    const small = column.words.find((w) => w.term === 'pequena')!
    assert.ok(big.size > small.size)
  })

  it('sizes on one ramp for the whole week: a loud word on a loud day outsizes the loudest word of a quiet day (#148 review, 5)', () => {
    const [quiet, loud] = weekLayout(measure, [[term('crise', 3), term('pauta', 1)], [term('lei', 300), term('governo', 100)]])
    const quietTop = quiet.words.find((w) => w.term === 'crise')!
    const loudTop = loud.words.find((w) => w.term === 'lei')!
    assert.ok(loudTop.size > quietTop.size, `${loudTop.size}px should beat ${quietTop.size}px`)
    assert.ok(loudTop.size >= 28, 'the loudest word of the week reaches the ruler ceiling, not a 24px cap')
  })

  it('is deterministic: the same day packs to the same picture', () => {
    const day = [term('reforma', 10), term('pauta', 8), term('eleicao', 6)]
    const once = weekLayout(measure, [day])[0]
    const twice = weekLayout(measure, [day])[0]
    assert.deepEqual(once.words, twice.words)
    assert.deepEqual(once.overflow, twice.overflow)
    assert.equal(once.height, twice.height)
  })

  it('the loudest word sets a week-wide ceiling so the largest count is never the one the column hides (validator round 2, 2)', () => {
    const day = [term('presidente', 96), term('candidato', 14), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 120)
    const presidente = column.words.find((w) => w.term === 'presidente')
    assert.ok(presidente, 'presidente leads the day and must be drawn in the column, not listed under it')
    assert.ok(presidente.w <= 120 - 6 + 1e-6, `presidente at ${presidente.w}px overflows the 120px column`)
    assert.equal(column.overflow.length, 0)
    const byCount = [...column.words].sort((a, b) => b.count - a.count)
    for (let i = 1; i < byCount.length; i++) {
      assert.ok(byCount[i - 1].size > byCount[i].size, `${byCount[i - 1].term}@${byCount[i - 1].size} must be larger than ${byCount[i].term}@${byCount[i].size}`)
    }
    assert.ok(presidente.size < 30, 'a 120px column cannot hold presidente at 30px, so the ceiling drops')
    assert.equal(column.words.find((w) => w.term === 'crise')!.size, WEEK_SIZE_MIN, 'the floor never moves')
  })

  it('the ceiling only drops when the column forces it: the same day reaches 30px at 342px', () => {
    const day = [term('presidente', 96), term('candidato', 14), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 342)
    assert.equal(column.words.find((w) => w.term === 'presidente')!.size, 30)
  })

  it('the ceiling is shared by the whole week: a quiet day never outsizes the loud one whose word forced it down', () => {
    const [loud, quiet] = weekLayout(measure, [[term('presidente', 96), term('crise', 3)], [term('lei', 60), term('voto', 3)]], 120)
    const presidente = loud.words.find((w) => w.term === 'presidente')!
    const lei = quiet.words.find((w) => w.term === 'lei')!
    assert.ok(presidente.size > lei.size, `presidente:96@${presidente.size} must beat lei:60@${lei.size}`)
  })

  it('eight short words at mixed counts all place in a 159px column, none pushed out by the height cap (validator round 1, 2)', () => {
    const day = [term('governo', 67), term('reforma', 40), term('pauta', 31), term('eleicao', 20), term('crise', 12), term('lei', 8), term('voto', 5), term('urna', 3)]
    const [column] = weekLayout(measure, [day], 159)
    assert.equal(column.overflow.length, 0, `${column.overflow.map((w) => w.term).join(', ')} did not fit`)
    assert.equal(column.words.length, 8)
    assert.ok(column.height <= WEEK_MAX_HEIGHT + 20)
  })

  it('a word wider than a narrow column even at the floor size is listed under the column, never drawn across the next day (#148 review, 1)', () => {
    const day = [term('pronunciamento', 96), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 84)
    assert.ok(!column.words.some((w) => w.term === 'pronunciamento'), 'one word cannot break, does not fit 84px at 12px and must not be placed')
    assert.ok(column.overflow.some((w) => w.term === 'pronunciamento'), 'it is still reachable in the overflow list')
    for (const w of column.words) assert.ok(w.w <= 84 - 6 + 1e-6)
  })

  it('a phrase wraps at its spaces, never inside a word, and is placed as one box as tall as its lines', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 145)
    const stf = column.words.find((w) => w.term === 'supremo tribunal federal')
    assert.ok(stf, 'the phrase fits once wrapped and is drawn, not listed')
    assert.deepEqual(stf!.lines, ['supremo', 'tribunal', 'federal'])
    assert.equal(stf!.h, Math.round(stf!.size * 1.24) * 3)
    assert.ok(stf!.w <= 145 - 6 + 1e-6, 'the box is as wide as its longest line')
    assert.ok(stf!.size > WEEK_SIZE_MIN, 'the loudest word wraps at a size well above the floor instead of pulling the ceiling down')
    assert.equal(column.overflow.length, 0)
  })

  it('a long one-word term below the loudest phrase is listed, not placed, since the ceiling is the loudest words\' and lowering it for every unwrappable word would flatten the week (#166 review, 1)', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('presidente', 90), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 145)
    const stf = column.words.find((w) => w.term === 'supremo tribunal federal')!
    assert.ok(stf.size > 20, `the wrapped phrase keeps the ceiling up, at ${stf.size}px`)
    assert.ok(column.overflow.some((w) => w.term === 'presidente'), 'presidente does not fit at the size its count earns and is listed with its count')
    assert.ok(!column.words.some((w) => w.term === 'presidente'))
  })

  it('twelve mixed phrases and words, the widest limit the sentence offers, all place at 145px and 159px: the height cap counts lines (#166 review, 2)', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('ministro da fazenda', 80, 'phrase'), term('primeiro turno', 70, 'phrase'), term('reforma tributaria', 60, 'phrase'), term('presidente', 50), term('governo', 45), term('congresso', 40), term('camara dos deputados', 35, 'phrase'), term('senado', 30), term('eleicao', 20), term('lei', 10), term('voto', 5)]
    for (const width of [145, 159]) {
      const [column] = weekLayout(measure, [day], width)
      assert.equal(column.overflow.length, 0, `${column.overflow.map((w) => w.term).join(', ')} did not fit at ${width}px`)
      assert.equal(column.words.length, 12)
      assert.ok(column.height > WEEK_MAX_HEIGHT, 'the column grows past the one-line cap instead of dropping the quietest words')
    }
  })

  it('a hyphenated word breaks after its hyphen, the break wrapLines already prefers (#166 review, nit)', () => {
    const [column] = weekLayout(measure, [[term('vice-presidente', 96), term('crise', 3)]], 145)
    const vice = column.words.find((w) => w.term === 'vice-presidente')!
    assert.deepEqual(vice.lines, ['vice-', 'presidente'])
    assert.ok(vice.size > WEEK_SIZE_MIN + 2, `the ceiling stays up at ${vice.size}px instead of the one-line floor`)
  })

  it('a one-word line keeps every single word on one line: no wrap means lines is [text]', () => {
    const [column] = weekLayout(measure, [[term('crise', 3)]], 145)
    assert.deepEqual(column.words[0].lines, ['crise'])
    assert.equal(column.words[0].h, Math.round(column.words[0].size * 1.24))
  })
})

// Issue #216 (figure 7): peakDay is the pure helper both the mentions and the views series
// share -- each series arrives as one { day, value } pair per calendar day, already reduced to
// the one number that series scores by (mentions' own count, or a day's pageviews).
describe('peakDay (issue #216)', () => {
  it('a single maximum returns that day (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 3 },
      { day: '2026-09-02', value: 9 },
      { day: '2026-09-03', value: 1 },
    ]
    assert.equal(peakDay(series), '2026-09-02')
  })

  it('a tie between two or more days sharing the maximum returns the earliest, oldest one (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 5 },
      { day: '2026-09-02', value: 9 },
      { day: '2026-09-03', value: 9 },
    ]
    assert.equal(peakDay(series), '2026-09-02')
  })

  it('a tie fed in reversed order still returns the oldest day, never the one the loop met first (AC2)', () => {
    const series = [
      { day: '2026-09-03', value: 9 },
      { day: '2026-09-02', value: 5 },
      { day: '2026-09-01', value: 9 },
    ]
    assert.equal(peakDay(series), '2026-09-01')
  })

  it('an all-zero series has no peak, returns null (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 0 },
      { day: '2026-09-02', value: 0 },
      { day: '2026-09-03', value: 0 },
    ]
    assert.equal(peakDay(series), null)
  })
})

// Issue #216 (figure 7): 30 columns at 640px (or fewer, wider ones on mobile at 343px) must
// never let one day's mark box reach into its neighbour's, at realistic values (views
// 4 210-51 000, mentions 12-120).
describe('attentionLayout (issue #216), no adjacent overlap on a 30-day grid', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
  const mentions = (n: number) => days(n).map((day, i) => ({ day, count: 12 + ((i * 37) % 108) }))
  const views = (n: number) => days(n).map((day, i) => ({ day, views: 4210 + ((i * 4013) % 46790) }))

  const assertNoOverlap = (marks: { x: number; barW: number }[], label: string) => {
    const sorted = [...marks].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      const prevRight = prev.x + prev.barW / 2
      const curLeft = cur.x - cur.barW / 2
      assert.ok(curLeft >= prevRight, `${label}: day ${i} overlaps day ${i - 1} (prev right ${prevRight}, cur left ${curLeft})`)
    }
  }

  it('30 days, 5-digit views, width 640: no two adjacent marks overlap in either row', () => {
    const layout = attentionLayout(measure, mentions(30), views(30), 640)
    assertNoOverlap(layout.mentions, 'mentions')
    assertNoOverlap(layout.views, 'views')
  })

  it('30 days, 5-digit views, width 343 (mobile): no two adjacent marks overlap in either row', () => {
    const layout = attentionLayout(measure, mentions(30), views(30), 343)
    assertNoOverlap(layout.mentions, 'mentions')
    assertNoOverlap(layout.views, 'views')
  })

  it("each row's largest day renders at that row's own ceiling size (AC4)", () => {
    const mentionSeries = [
      { day: '2026-08-01', count: 3 },
      { day: '2026-08-02', count: 3 },
      { day: '2026-08-03', count: 40 },
    ]
    const viewSeries = [
      { day: '2026-08-01', views: 50000 },
      { day: '2026-08-02', views: 1000 },
      { day: '2026-08-03', views: 1000 },
    ]
    const layout = attentionLayout(measure, mentionSeries, viewSeries, 640)
    const mentionSizes = layout.mentions.map((m) => m.size)
    const viewSizes = layout.views.map((v) => v.size)
    assert.equal(mentionSizes[2], Math.max(...mentionSizes), "mentions' own peak day (index 2) must render at its own row's ceiling")
    assert.equal(viewSizes[0], Math.max(...viewSizes), "views' own peak day (index 0) must render at its own row's ceiling")
  })
})

describe('matrixLayout (figure 9, issue #207)', () => {
  it('keys a pair by its own a/b, independent of the row/column order the persons array gives, pinning the positional-key bug hit while building', () => {
    // persons is name-ordered ("Ana" < "Bia" < "Rita"), which here differs from the id order the
    // pair travels in (a=lula, b=tarcisio, alphabetically 'lula' < 'tarcisio' regardless of name).
    const persons = [
      { id: 'tarcisio', name: 'Ana' },
      { id: 'lula', name: 'Bia' },
      { id: 'bolsonaro', name: 'Rita' },
    ]
    const { cellSize, cells } = matrixLayout(persons, [{ a: 'lula', b: 'tarcisio', count: 4 }], 900)
    assert.equal(cells.length, (persons.length * (persons.length - 1)) / 2, 'one cell per upper-triangle slot, a<b in row/column order')
    const filled = cells.filter((c) => c.count !== null)
    assert.equal(filled.length, 1, 'exactly one non-null cell')
    assert.deepEqual(filled[0], { a: 'tarcisio', b: 'lula', count: 4, ink: 1 })
    for (const c of cells) if (c.a !== 'tarcisio' || c.b !== 'lula') assert.equal(c.count, null, `${c.a}/${c.b} must be null`)
    assert.ok(cellSize >= MATRIX_CELL_MIN && cellSize <= MATRIX_CELL_MAX)
  })

  it('clamps cellSize to MATRIX_CELL_MIN/MAX regardless of how narrow or wide the container is', () => {
    const persons = Array.from({ length: 27 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
    const narrow = matrixLayout(persons, [], 10)
    assert.equal(narrow.cellSize, MATRIX_CELL_MIN)
    const wide = matrixLayout(persons, [], 4000)
    assert.equal(wide.cellSize, MATRIX_CELL_MAX)
  })
})

// Issue #215 (figure 10): persistenceLayout is a fixed table grid, not a beeswarm: one row per
// term, one cell per week in series order, and a level per cell on ONE ramp for the whole
// figure, keyed to the largest count shown. It takes the GET /persistence payload and returns
// { rows: [{ term, kind, cells: [{ week, count, level }] }] }; a null count has level 0 and a
// positive count never does.
describe('persistenceLayout (figure 10, issue #215)', () => {
  const weeks = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${String(3 + 7 * i).padStart(2, '0')}`)
  const row = (term: string, counts: (number | null)[], kind = 'word') => ({
    term,
    kind,
    series: counts.map((count, i) => ({ week: weeks(counts.length)[i], count })),
    streak: 0,
    half_life: null,
  })
  const payload = (terms: ReturnType<typeof row>[]) => ({ weeks: terms[0]?.series.length ?? 0, since: '2026-09-09', first_week: '2026-08-03', horizon: 60, terms })
  const cellsOf = (l: ReturnType<typeof persistenceLayout>) => (l as unknown as { rows: { term: string; kind: string; cells: { week: string; count: number | null; level: number }[] }[] }).rows

  it('one row per term and one cell per week, in series order, so every row has the same number of columns', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [null, 2, 3, 4]), row('golpe', [5, null, null, 1])]) as never))
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.term), ['anistia', 'golpe'])
    for (const r of rows) assert.deepEqual(r.cells.map((c) => c.week), weeks(4))
  })

  it('a null count is level 0 and every positive count is above it, however small next to the largest', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [null, 1, 500, 2])]) as never))
    const [none, one, big, two] = rows[0].cells
    assert.equal(none.level, 0)
    assert.ok(one.level > 0, 'a count of 1 next to 500 is still visibly filled')
    assert.ok(two.level > 0)
    assert.ok(big.level >= two.level && two.level >= one.level, 'level never falls as the count grows')
  })

  it('one ramp for the whole figure: the same count has the same level in every row, and the largest count anywhere has the top level', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [3, 3, null, 10]), row('golpe', [40, 3, 10, null])]) as never))
    const all = rows.flatMap((r) => r.cells)
    const levelOf = (count: number) => new Set(all.filter((c) => c.count === count).map((c) => c.level))
    for (const count of [3, 10, 40]) assert.equal(levelOf(count).size, 1, `count ${count} has one level across rows`)
    const top = Math.max(...all.map((c) => c.level))
    assert.equal([...levelOf(40)][0], top)
    assert.ok([...levelOf(3)][0] < top)
  })

  it('a grid of one count everywhere never paints an empty cell', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [2, 2, 2, 2])]) as never))
    assert.ok(rows[0].cells.every((c) => c.level > 0))
  })

  it('no terms lays out no rows', () => {
    assert.deepEqual(cellsOf(persistenceLayout({ weeks: 12, since: '2026-09-09', first_week: null, horizon: 60, terms: [] } as never)), [])
  })
})

describe('rulerModel maps a ruler layout to what Ruler.svelte draws', () => {
  const measure = (text: string, size: number) => text.length * size * 0.6
  const items = [
    { term: 'reforma', kind: 'word', balance: -1, combined: 20 },
    { term: 'stf', kind: 'hashtag', balance: 0.5, combined: 8, bridge: 0.9 },
    { term: 'pix', kind: 'word', balance: 0, combined: 4, bridge: 0.1 },
  ]

  it('carries the frame, the axis ends and five ticks at -1, -0.5, 0, 0.5, 1', () => {
    const layout = rulerLayout(measure, items, 600)
    const model = rulerModel(layout)
    assert.equal(model.width, 600)
    assert.equal(model.height, layout.height)
    assert.equal(model.half, layout.half)
    assert.equal(model.x0, 28)
    assert.equal(model.x1, 572)
    assert.deepEqual(model.ticks, [-1, -0.5, 0, 0.5, 1].map(layout.x))
  })

  it('gives each word its label, title, side colour and bridge flag', () => {
    const model = rulerModel(rulerLayout(measure, items, 600))
    const stf = model.words.find((w) => w.term === 'stf')!
    assert.equal(stf.aria, '#stf, 8 documentos')
    assert.equal(stf.title, '#stf · Hashtag · 8 documentos')
    assert.equal(stf.cmp, balanceColor(0.5))
    assert.equal(stf.bridge, true)
    assert.equal(model.words.find((w) => w.term === 'pix')!.bridge, false)
    assert.equal(model.words.find((w) => w.term === 'reforma')!.cmp, balanceColor(-1))
  })

  it('lists spilled words with text and side colour only', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ term: `palavralonga${i}`, kind: 'word', balance: 0, combined: 30 }))
    const model = rulerModel(rulerLayout(measure, many, 600))
    assert.ok(model.overflow.length > 0)
    assert.deepEqual(Object.keys(model.overflow[0]).sort(), ['cmp', 'kind', 'term', 'text'])
    assert.equal(model.overflow[0].cmp, balanceColor(0))
  })
})

describe('#149 AC2/AC3/AC4: termStripLayout, words on the kikori axis (moved from render.ts by #297)', () => {
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
    const innerStart = STRIP_PAD
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
})
