import { strict as assert } from 'node:assert'
import { after, describe, it } from 'node:test'
import { label, setLabels, spell, STRIP_SPANS, stripSpan } from '../src/ui/format.js'
import { RULER_BRIDGES, rulerLayout, rulerModel } from '../src/ui/layout.js'
import { LABEL_BAND, stripLabels } from '../src/ui/strip-model.js'

const dot = (domain: string, score: number, n: number, x: number, y = 0, r = 6) => ({ domain, score, n, x, y, r })

describe('stripSpan: the strip axis fits the scores it shows', () => {
  it('picks the smallest of 2, 5 and 10 that holds every score with a margin', () => {
    assert.deepEqual([...STRIP_SPANS], [2, 5, 10])
    assert.equal(stripSpan([0.3, -1.2]), 2)
    assert.equal(stripSpan([-3.6, 1]), 5)
    assert.equal(stripSpan([4.9]), 10, 'a score at the very edge of ±5 gets the wider axis')
    assert.equal(stripSpan([12]), 10, 'anything past ±10 is clamped onto the widest axis')
  })

  it('ignores missing scores and falls back to ±2 on an empty list', () => {
    assert.equal(stripSpan([null, undefined, Number.NaN]), 2)
    assert.equal(stripSpan([]), 2)
  })
})

describe('stripLabels: a few dots carry their outlet name', () => {
  it('names both extremes first, then the largest dots, up to the count', () => {
    const dots = [dot('left.example', -4, 3, 100), dot('big.example', 0, 90, 400), dot('mid.example', 0.5, 40, 600), dot('right.example', 4, 2, 800)]
    const names = stripLabels(dots, 40, 900, 3).map((l) => l.domain)
    assert.deepEqual(names, ['left.example', 'right.example', 'big.example'])
  })

  it('never lets two names overlap in one band, and skips a name with no room in either', () => {
    const dots = [dot('aaaaaaaaaaaaaaa.example', -1, 9, 300), dot('bbbbbbbbbbbbbbb.example', 0, 8, 310), dot('ccccccccccccccc.example', 1, 7, 320)]
    const placed = stripLabels(dots, 40, 900)
    assert.equal(placed.length, 2)
    assert.notEqual(placed[0].side, placed[1].side)
  })

  it('keeps clear of a span reserved up top, and the bands sit outside the swarm', () => {
    const placed = stripLabels([dot('folha.uol.com.br', 0, 9, 450, -10)], 40, 900, 6, [400, 500])
    assert.equal(placed[0].side, 'bottom')
    assert.ok(placed[0].y > 80 && placed[0].y <= 80 + LABEL_BAND)
  })
})

describe('labels: the reader spelling of a stored term', () => {
  after(() => setLabels({}))

  it('spells each word of a phrase from the map and leaves unknown words alone', () => {
    setLabels({ tributaria: 'tributária', stf: 'STF' })
    assert.equal(spell('reforma tributaria'), 'reforma tributária')
    assert.equal(label({ kind: 'word', term: 'stf' }), 'STF')
    assert.equal(label({ kind: 'hashtag', term: 'tributaria' }), '#tributaria', 'a hashtag is what was typed, never respelled')
  })
})

describe('rulerModel: the bridge mark', () => {
  it(`marks only the ${RULER_BRIDGES} strongest bridges`, () => {
    const measure = (text: string, size: number) => text.length * size * 0.6
    const items = Array.from({ length: 12 }, (_, i) => ({ term: `w${i}`, kind: 'word', balance: (i - 6) / 6, combined: 10 + i, bridge: 10 + i }))
    const words = rulerModel(rulerLayout(measure, items, 1200)).words
    const marked = words.filter((w) => w.bridge).map((w) => w.term).sort()
    assert.equal(marked.length, RULER_BRIDGES)
    assert.deepEqual(marked, ['w10', 'w11', 'w7', 'w8', 'w9'])
  })
})
