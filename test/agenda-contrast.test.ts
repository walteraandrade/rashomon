import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { atlasCss, colorOf, contrast, declared, rulesFor, rulesOf, tokensOf } from './css.js'

const css = atlasCss()
const rules = rulesOf(css)
const tokens = tokensOf(css)

describe('agenda ink', () => {
  it('agenda numbers clear 4.5:1 at every share, plain and active', () => {
    const plainColor = declared(rules, '.agenda-pick', 'color')
    assert.ok(plainColor, '.agenda-pick declares the number colour')
    const activeColor = declared(rules, '.agenda-pick.is-active', 'color') ?? plainColor
    const activeBg = declared(rules, '.agenda-pick.is-active', 'background') ?? declared(rules, '.agenda-pick.is-active', 'background-color')
    assert.ok(activeBg, '.agenda-pick.is-active declares its own background')
    const panel = colorOf('var(--panel)', tokens)
    const active = colorOf(activeBg, tokens)
    for (let share = 0; share <= 100; share++) {
      const at = (expr: string) => colorOf(expr.replace(/var\(--share[^)]*\)/g, `${share}%`), tokens)
      const plain = contrast(at(plainColor), panel)
      assert.ok(plain >= 4.5, `plain cell at --share ${share}% reads ${plain.toFixed(2)}:1 on --panel`)
      const onActive = contrast(at(activeColor), active)
      assert.ok(onActive >= 4.5, `active cell at --share ${share}% reads ${onActive.toFixed(2)}:1 on its own background`)
    }
  })

  it('the muted texts of the grid stay at 4.5:1 on --panel, never on --soft', () => {
    const panel = colorOf('var(--panel)', tokens)
    assert.ok(contrast(colorOf('var(--muted)', tokens), panel) >= 4.5)
    for (const selector of ['.agenda-cell.is-empty', '.lean-chip']) assert.equal(declared(rules, selector, 'color'), 'var(--muted)')
    for (const selector of ['.agenda-table tbody th', '.agenda-table thead th:first-child']) assert.notEqual(declared(rules, selector, 'background'), 'var(--soft)')
  })

  it('agenda table keeps its domain column sticky', () => {
    const table = declared(rules, '.agenda-table', 'border-collapse')
    assert.equal(table, 'separate')
    assert.equal(declared(rules, '.agenda-table', 'border-spacing'), '0')
    for (const selector of ['.agenda-table tbody th', '.agenda-table thead th:first-child']) {
      assert.ok(rulesFor(rules, selector).length > 0, `${selector} has a rule`)
      assert.equal(declared(rules, selector, 'position'), 'sticky', `${selector} is sticky`)
      assert.equal(declared(rules, selector, 'left'), '0', `${selector} sticks at left: 0`)
      assert.equal(declared(rules, selector, 'background'), 'var(--panel)', `${selector} is opaque`)
    }
  })

  it('agenda grid scrolls inside its own container, never the page', () => {
    // An absolutely positioned .sr-only inside the table (the empty cells' text) is clipped only by
    // a scroller that is its containing block; without it the page itself scrolls sideways.
    assert.equal(declared(rules, '.agenda-scroll', 'overflow-x'), 'auto')
    assert.equal(declared(rules, '.agenda-scroll', 'position'), 'relative')
  })
})
