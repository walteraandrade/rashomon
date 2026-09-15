import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { html } from '../src/ui/format.js'
import { axis, frame, overflowList } from '../src/ui/marks.js'

// src/ui/marks.ts: the pure SVG builders issue #170 pulls out of render.ts (frame, axis,
// overflowList). Never touched from render.test.ts's own painter assertions, which pin the
// byte-identical output of the figures that call these -- this file exercises the builders
// directly, the way the issue's own test plan asks for.

describe('issue #170: marks.ts pure SVG builders', () => {
  describe('frame', () => {
    it('AC: a live frame (ghost omitted) carries role/aria-label when given, and omits them when not', () => {
      const withLabel = String(frame({ cls: 'ruler-svg', width: 100, height: 40, viewBox: '0 0 100 40', role: 'group', ariaLabel: 'Palavras na régua' }, html``))
      assert.match(withLabel, /<svg[^>]*class="ruler-svg"/)
      assert.match(withLabel, /viewBox="0 0 100 40"/)
      assert.match(withLabel, /width="100"/)
      assert.match(withLabel, /height="40"/)
      assert.match(withLabel, /role="group"/)
      assert.match(withLabel, /aria-label="Palavras na régua"/)
      assert.doesNotMatch(withLabel, /aria-hidden/)
      assert.doesNotMatch(withLabel, /ghost-field/)

      const withoutLabel = String(frame({ cls: 'ruler-svg', width: 100, height: 40, viewBox: '0 0 100 40' }, html``))
      assert.doesNotMatch(withoutLabel, /role=/)
      assert.doesNotMatch(withoutLabel, /aria-label=/)
    })

    it('AC: ghost:true wraps the svg in the aria-hidden ghost-field, never role or aria-label', () => {
      const ghost = String(frame({ cls: 'ruler-svg', width: 100, height: 40, viewBox: '0 0 100 40', ghost: true, role: 'group', ariaLabel: 'ignored while loading' }, html``))
      assert.match(ghost, /aria-hidden="true"/)
      assert.match(ghost, /ghost-field/)
      assert.doesNotMatch(ghost, /role=/)
      assert.doesNotMatch(ghost, /aria-label=/)
    })

    it('carries its children through untouched', () => {
      const out = String(frame({ cls: 'ruler-svg', width: 10, height: 10, viewBox: '0 0 10 10' }, html`<circle r="1"/>`))
      assert.match(out, /<circle r="1"\/>/)
    })
  })

  describe('axis', () => {
    it('AC: renders exactly one tick per entry in ticks, at the class name cls passes in, plus one axis line', () => {
      const out = String(axis({ x0: 0, x1: 100, y: 20, ticks: [{ x: 0 }, { x: 50 }, { x: 100 }], cls: 'ruler' }))
      assert.equal((out.match(/class="ruler-axis"/g) || []).length, 1, 'exactly one axis line')
      assert.equal((out.match(/class="ruler-tick"/g) || []).length, 3, 'one tick per entry in ticks')
    })

    it('a different cls prefix produces differently-named classes, since atlas.css selects on them', () => {
      const out = String(axis({ x0: 0, x1: 100, y: 20, ticks: [{ x: 0 }], cls: 'strip' }))
      assert.match(out, /class="strip-axis"/)
      assert.match(out, /class="strip-tick"/)
      assert.doesNotMatch(out, /ruler-axis|ruler-tick/)
    })

    it('an empty ticks array still draws the axis line alone', () => {
      const out = String(axis({ x0: 0, x1: 100, y: 20, ticks: [], cls: 'week' }))
      assert.equal((out.match(/class="week-axis"/g) || []).length, 1)
      assert.equal((out.match(/class="week-tick"/g) || []).length, 0)
    })
  })

  it('AC1: overflowList exists and is a function (its exact shape is pinned by render.test.ts through the callers, paintRuler/paintWeek, whose overflow markup must stay byte-identical)', () => {
    assert.equal(typeof overflowList, 'function')
  })
})
