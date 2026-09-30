import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterItems, itemsOf, listMarkup, revealTop, type ComboItem } from '../src/ui/combobox.js'

// src/ui/combobox.ts: the searchable face figure 6's two lens selects wear. The <select> stays
// the value store, so every assertion here reads the select's own value and change event.

type Listener = (e?: any) => void
class Node {
  hidden = false
  attributes: Record<string, string> = {}
  listeners: Record<string, Listener[]> = {}
  addEventListener(type: string, fn: Listener) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  fire(type: string, e: any = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...e })
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
}

const group = (label: string) => ({ label })
const fakeSelect = (options: { value: string; text: string; group?: string }[], value = options[0].value) => {
  const select = new Node() as Node & { value: string; options: any[]; changes: number; dispatchEvent: (e: Event) => boolean }
  select.value = value
  select.changes = 0
  select.options = options.map((o) => ({ value: o.value, textContent: o.text, parentElement: o.group ? group(o.group) : {} }))
  select.dispatchEvent = () => {
    select.changes++
    select.fire('change')
    return true
  }
  return select
}
const lensOptions = [
  { value: 'all', text: 'Tudo' },
  { value: 'domain:folha.uol.com.br', text: 'folha.uol.com.br', group: 'Veículo' },
  { value: 'domain:g1.globo.com', text: 'g1.globo.com', group: 'Veículo' },
  { value: 'lean:left', text: 'Esquerda', group: 'Viés' },
  { value: 'lean:right', text: 'Direita', group: 'Viés' },
  { value: 'source:bluesky', text: 'Bluesky', group: 'Fonte' },
]

const optionValues = (markup: string) => [...markup.matchAll(/data-value="([^"]*)"/g)].map((m) => m[1])
const groupHeads = (markup: string) => [...markup.matchAll(/class="combo-group eyebrow" role="presentation">([^<]*)</g)].map((m) => m[1])

describe('itemsOf / filterItems (pure)', () => {
  it('reads each option with its optgroup label, ungrouped ones with an empty group', () => {
    const items = itemsOf(fakeSelect(lensOptions))
    assert.deepEqual(items[0], { value: 'all', label: 'Tudo', group: '' })
    assert.deepEqual(items[1], { value: 'domain:folha.uol.com.br', label: 'folha.uol.com.br', group: 'Veículo' })
  })

  it('filters by label, case- and accent-insensitive, and an empty query keeps everything', () => {
    const items = itemsOf(fakeSelect(lensOptions))
    assert.deepEqual(filterItems(items, 'VIES').map((i) => i.value), [])
    assert.deepEqual(filterItems(items, 'esq').map((i) => i.value), ['lean:left'])
    assert.deepEqual(filterItems(items, 'GLOBO').map((i) => i.value), ['domain:g1.globo.com'])
    assert.equal(filterItems(items, '').length, items.length)
    assert.equal(filterItems(items, '  ').length, items.length)
  })
})

describe('listMarkup (pure)', () => {
  const items: ComboItem[] = itemsOf(fakeSelect(lensOptions))

  it('writes one group head per run of grouped items, none for the ungrouped first option', () => {
    const markup = String(listMarkup('list', items, 0, 'all'))
    assert.deepEqual(groupHeads(markup), ['Veículo', 'Viés', 'Fonte'])
    assert.deepEqual(optionValues(markup), items.map((i) => i.value))
  })

  it('marks the active row and the select\'s current value, with ids the input can point at', () => {
    const markup = String(listMarkup('list', items, 2, 'lean:left'))
    assert.match(markup, /id="list-2"[^>]*data-value="domain:g1.globo.com"/)
    assert.match(markup, /class="combo-option is-active"[^>]*id="list-2"/)
    assert.match(markup, /data-value="lean:left" aria-selected="true"/)
    assert.equal((markup.match(/aria-selected="true"/g) ?? []).length, 1)
  })

  it('escapes a label and says so when nothing matches', () => {
    assert.match(String(listMarkup('list', [{ value: 'x', label: '<b>', group: '' }], 0, '')), /&lt;b&gt;/)
    assert.match(String(listMarkup('list', [], -1, '')), /combo-empty/)
  })
})

describe('revealTop (pure)', () => {
  const box = { scrollTop: 100, clientHeight: 200 }
  it('keeps the scroll when the row is already inside the box', () => {
    assert.equal(revealTop({ offsetTop: 150, offsetHeight: 20 }, box), 100)
  })
  it('scrolls up to a row above the box and down just enough for a row below it', () => {
    assert.equal(revealTop({ offsetTop: 40, offsetHeight: 20 }, box), 40)
    assert.equal(revealTop({ offsetTop: 330, offsetHeight: 20 }, box), 150)
  })
})
