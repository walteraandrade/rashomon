import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { html } from '../src/ui/format.js'
import { axis, frame, overflowList } from '../src/ui/marks.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// src/ui/marks.ts: the pure SVG builders issue #170 pulls out of render.ts (frame, axis,
// overflowList). Never touched from render.test.ts's own painter assertions, which pin the
// byte-identical output of the figures that call these -- this file exercises the builders
// directly, the way the issue's own test plan asks for.

describe('issue #170: marks.ts pure SVG builders', () => {
  it('AC1: marks.ts exports frame, axis and overflowList as functions', () => {
    assert.equal(typeof frame, 'function')
    assert.equal(typeof axis, 'function')
    assert.equal(typeof overflowList, 'function')
  })

  describe('frame', () => {
    it('AC: a frame carries role/aria-label when given, and omits them when not', () => {
      const withLabel = String(frame({ cls: 'ruler-svg', width: 100, height: 40, viewBox: '0 0 100 40', role: 'group', ariaLabel: 'Palavras na régua' }, html``))
      assert.match(withLabel, /<svg[^>]*class="ruler-svg"/)
      assert.match(withLabel, /viewBox="0 0 100 40"/)
      assert.match(withLabel, /width="100"/)
      assert.match(withLabel, /height="40"/)
      assert.match(withLabel, /role="group"/)
      assert.match(withLabel, /aria-label="Palavras na régua"/)

      const withoutLabel = String(frame({ cls: 'ruler-svg', width: 100, height: 40, viewBox: '0 0 100 40' }, html``))
      assert.doesNotMatch(withoutLabel, /role=/)
      assert.doesNotMatch(withoutLabel, /aria-label=/)
    })

    it('carries its children through untouched', () => {
      const out = String(frame({ cls: 'ruler-svg', width: 10, height: 10, viewBox: '0 0 10 10' }, html`<circle r="1"/>`))
      assert.match(out, /<circle r="1"\/>/)
    })
  })

  describe('axis', () => {
    it('AC: renders exactly one tick per entry in ticks, at the class name cls passes in, plus one axis line', () => {
      const out = String(axis({ x0: 0, x1: 100, y: 20, ticks: [0, 50, 100], cls: 'ruler' }))
      assert.equal((out.match(/class="ruler-axis"/g) || []).length, 1, 'exactly one axis line')
      assert.equal((out.match(/class="ruler-tick"/g) || []).length, 3, 'one tick per entry in ticks')
    })

    it('a different cls prefix produces differently-named classes, since atlas.css selects on them', () => {
      const out = String(axis({ x0: 0, x1: 100, y: 20, ticks: [0], cls: 'strip' }))
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

  describe('overflowList', () => {
    const intro = html`<p class="eyebrow">2 não couberam</p>`
    const renderItem = (w: string) => html`<button>${w}</button>`

    it('AC1: no items, no markup at all', () => {
      assert.equal(overflowList({ items: [], cls: 'week', intro, renderItem }), '')
    })

    it('AC1: one wrapper, the intro first, then one rendered item per entry in order', () => {
      const out = String(overflowList({ items: ['lula', 'moraes'], cls: 'week', intro, renderItem }))
      assert.equal((out.match(/<div class="week-overflow">/g) || []).length, 1)
      assert.equal(out, '<div class="week-overflow"><p class="eyebrow">2 não couberam</p><button>lula</button><button>moraes</button></div>')
    })
  })

  it('issue #170 AC9: CLAUDE.md documents marks.ts between layout.ts and render.ts, DOM-free, owning frame/axis/overflow-list', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    const layoutIdx = claude.indexOf('`src/ui/layout.ts`')
    const marksIdx = claude.indexOf('`src/ui/marks.ts`')
    const renderIdx = claude.indexOf('`src/ui/render.ts`')
    assert.ok(layoutIdx >= 0, 'CLAUDE.md must still mention src/ui/layout.ts')
    assert.ok(marksIdx >= 0, 'CLAUDE.md must mention src/ui/marks.ts')
    assert.ok(renderIdx >= 0, 'CLAUDE.md must still mention src/ui/render.ts')
    assert.ok(layoutIdx < marksIdx && marksIdx < renderIdx, 'src/ui/marks.ts must be documented between the layout.ts and render.ts bullets')
    const marksSentence = claude.slice(marksIdx, renderIdx)
    assert.match(marksSentence, /DOM-free/i, "CLAUDE.md's marks.ts bullet must say it is DOM-free")
    assert.match(marksSentence, /\bframe\b/, "CLAUDE.md's marks.ts bullet must name frame")
    assert.match(marksSentence, /\baxis\b/, "CLAUDE.md's marks.ts bullet must name axis")
    assert.match(marksSentence, /overflow/i, "CLAUDE.md's marks.ts bullet must name the overflow list")
  })
})
