import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RULER_MAX_HEIGHT, RULER_SIZE_MIN, rulerLayout, swarm, swarmBy } from '../src/ui/layout.js'
import { paintRuler, rulerTerms } from '../src/ui/render.js'
import { withFiguresDom } from './fake-mount-dom.js'
import type { Compare, CompareTerm } from '../src/ui/format.js'

// Issue #99: the ruler draws the word itself where it used to draw an anonymous dot. The
// criteria here are the reading ones -- a word is legible, no word covers another, nothing
// disappears in silence, the ends still mean "zero on the other side" -- not the wiring, which
// issue #91's own suites already pin.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const atlasCss = () => readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

// The injected text measurer, the same contract layout.js documents: a real canvas in the
// browser, a deterministic stand-in here. 0.6em per character is close enough to Instrument
// Sans that a word's box is the right order of magnitude.
const metrics = (text: string, size: number) => text.length * size * 0.6

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Jair Bolsonaro' }

const compareData = (terms: CompareTerm[]): Compare => ({ days: 365, a: { person: lula, about: 900 }, b: { person: bolsonaro, about: 700 }, terms })

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

// ---------- AC1: the figure is made of words ----------

describe('AC1: the ruler draws the term as text, never as a dot', () => {
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
})

// ---------- AC2: no word covers another, at either width ----------

describe('AC2: the words never overlap and never leave the frame', () => {
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

// ---------- AC3: legibility floor ----------

describe('AC3: no word is drawn below the size floor the site sets', () => {
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

// ---------- AC4: an end still means zero on the other side ----------

describe('AC4: a word both people have never touches an end', () => {
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

// ---------- AC5: nothing disappears in silence ----------

describe('AC5: a word that does not fit is listed, counted and still clickable', () => {
  // Enough words at one balance to exhaust the height cap whatever the packer does.
  const crowded = (): CompareTerm[] => Array.from({ length: 120 }, (_, i) => ({ term: `exclusivadolula${i}`, kind: 'word', a: side(50, 1), b: null }))

  it('rulerLayout returns the words it could not place instead of dropping them', () => {
    const { items } = rulerTerms(crowded(), 'count')
    const { words, overflow } = rulerLayout(metrics, items, 860)
    assert.ok(overflow.length > 0, 'this recorte cannot fit; the packer must say so')
    assert.equal(words.length + overflow.length, items.length, 'every word is either drawn or listed, never lost')
  })

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
})

// ---------- AC6: one packer, two shapes ----------

describe('AC6: the ruler reuses the beeswarm skeleton instead of adding a second packer', () => {
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

  it('rulerLayout is deterministic: the same recorte packs to the same picture', () => {
    const { items } = rulerTerms(corpus(), 'count')
    const once = rulerLayout(metrics, items, 860)
    const twice = rulerLayout(metrics, items, 860)
    assert.deepEqual(once.words, twice.words)
    assert.deepEqual(once.overflow, twice.overflow)
    assert.equal(once.height, twice.height)
  })
})

// ---------- AC7: the stylesheet drives the words ----------

describe('AC7: atlas.css styles words, not dots, and the page keeps its no-<style> rule', () => {
  it('carries the ruler word rules and no longer carries the dot rules', () => {
    const css = atlasCss()
    assert.match(css, /\.ruler-text \{/)
    // Neither the cursor nor the pick repaints the word: the box behind it carries both, in the
    // word's own side colour, at two strengths. A selected word painted --accent threw away the
    // side it leans to, which is the only thing this figure draws.
    assert.match(css, /\.ruler-text \{[^}]*fill:\s*var\(--wc\)/)
    assert.match(css, /\.ruler-word\.is-selected \.ruler-hit \{[^}]*var\(--wc-soft\)/)
    // No outline on a mark, anywhere: this site draws no borders, so hover and pick are a wash
    // the word sits on, at two strengths, never a box drawn around it.
    for (const rule of css.match(/\.(?:ruler-hit|ruler-glow|word-hit|word-glow|center-hit|dot-halo)[^{]*\{[^}]*\}/g) ?? []) assert.doesNotMatch(rule, /stroke/, rule)
    // Core plus penumbra: one uniformly blurred rectangle is fog, and fog has no edge to read.
    assert.match(css, /\.word-glow, \.ruler-glow \{[^}]*blur\((\d+)px\)/)
    assert.match(css, /\.word-hit, \.ruler-hit \{[^}]*blur\((\d+)px\)/)
    assert.doesNotMatch(css, /\.ruler-word:hover \.ruler-text/, 'the cursor must not repaint the word')
    assert.doesNotMatch(css, /\.ruler-word\.is-selected \{[^}]*--wc:\s*var\(--accent\)/, 'nor must the pick')
    assert.match(css, /\.ruler-overflow \{/)
    assert.doesNotMatch(css, /\.ruler-dot/, 'nothing draws a ruler dot any more')
  })

  it('the side colour still travels as the --cmp custom property, the one inline style allowed', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [{ term: 'urgentes', kind: 'word', a: side(20, 1.1), b: null }]
      paintRuler({ data: compareData(terms), personA: lula, personB: bolsonaro, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.match(els.compareRuler.innerHTML, /style="--size:\d+px;--cmp:rgb\(\d+,\d+,\d+\)"/)
    })
  })
})
