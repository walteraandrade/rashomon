import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { centerLabel, pack, packPass, routeGraph, routesFrom, wrapLines } from '../public/js/layout.js'

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

describe('packPass / pack', () => {
  it('accounts for every term exactly once, split between placed and overflow', () => {
    // 40 same-length equal-score terms in a fixed-size circle: guaranteed to overflow, since
    // the candidate grid and center box cannot fit unlimited boxes without collision.
    const terms = Array.from({ length: 40 }, (_, i) => term(`t${i}`, 10))
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
