import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachCombobox, filterItems, itemsOf, listMarkup, revealTop, type ComboItem } from '../src/ui/combobox.js'

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
const fakeInput = () => Object.assign(new Node(), { value: '', hidden: true, selected: 0, select() { this.selected++ } })
const fakeList = () => Object.assign(new Node(), { id: 'list', hidden: true, innerHTML: '' })

const lensOptions = [
  { value: 'all', text: 'Tudo' },
  { value: 'domain:folha.uol.com.br', text: 'folha.uol.com.br', group: 'Veículo' },
  { value: 'domain:g1.globo.com', text: 'g1.globo.com', group: 'Veículo' },
  { value: 'lean:left', text: 'Esquerda', group: 'Viés' },
  { value: 'lean:right', text: 'Direita', group: 'Viés' },
  { value: 'source:bluesky', text: 'Bluesky', group: 'Fonte' },
]

const mounted = (value = 'all') => {
  const select = fakeSelect(lensOptions, value)
  const input = fakeInput()
  const list = fakeList()
  const combo = attachCombobox({ select, input, list })
  return { select, input, list, combo }
}

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

describe('attachCombobox', () => {
  it('hides the select, shows the input with the current label, and never fires change on attach', () => {
    const { select, input } = mounted('lean:right')
    assert.equal(select.hidden, true)
    assert.equal(input.hidden, false)
    assert.equal(input.value, 'Direita')
    assert.equal(select.changes, 0)
  })

  it('focus opens the full list with the current value active and selects the input text', () => {
    const { input, list } = mounted('lean:left')
    input.fire('focus')
    assert.equal(list.hidden, false)
    assert.equal(input.attributes['aria-expanded'], 'true')
    assert.equal(optionValues(list.innerHTML).length, lensOptions.length)
    assert.match(list.innerHTML, /is-active"[^>]*data-value="lean:left"/)
    assert.equal(input.attributes['aria-activedescendant'], 'list-3')
    assert.equal(input.selected, 1)
  })

  it('typing filters the list to matching labels and drops the groups that emptied', () => {
    const { input, list } = mounted()
    input.fire('focus')
    input.value = 'folha'
    input.fire('input')
    assert.deepEqual(optionValues(list.innerHTML), ['domain:folha.uol.com.br'])
    assert.deepEqual(groupHeads(list.innerHTML), ['Veículo'])
  })

  it('Enter on the active row writes the select value, dispatches change once, closes and shows the new label', () => {
    const { select, input, list } = mounted()
    input.fire('focus')
    input.value = 'g1'
    input.fire('input')
    input.fire('keydown', { key: 'Enter' })
    assert.equal(select.value, 'domain:g1.globo.com')
    assert.equal(select.changes, 1)
    assert.equal(list.hidden, true)
    assert.equal(input.value, 'g1.globo.com')
    assert.equal(input.attributes['aria-expanded'], 'false')
  })

  it('ArrowDown/ArrowUp walk the visible rows, wrapping at both ends', () => {
    const { input, list } = mounted('all')
    input.fire('focus')
    input.fire('keydown', { key: 'ArrowUp' })
    assert.match(list.innerHTML, /is-active"[^>]*data-value="source:bluesky"/, 'up from the first row wraps to the last')
    input.fire('keydown', { key: 'ArrowDown' })
    assert.match(list.innerHTML, /is-active"[^>]*data-value="all"/)
    input.fire('keydown', { key: 'ArrowDown' })
    assert.match(list.innerHTML, /is-active"[^>]*data-value="domain:folha.uol.com.br"/)
  })

  it('the active row scrolls the list alone, never the page', () => {
    const select = fakeSelect(lensOptions, 'all')
    const input = fakeInput()
    const row = { offsetTop: 100, offsetHeight: 20, scrollIntoView: () => assert.fail('scrollIntoView scrolls the page too') }
    const list = Object.assign(fakeList(), { scrollTop: 0, clientHeight: 40, querySelector: () => row })
    attachCombobox({ select, input, list })
    input.fire('focus')
    assert.equal(list.scrollTop, 80)
  })

  it('Escape and blur close without picking and restore the current label', () => {
    for (const how of ['keydown', 'blur'] as const) {
      const { select, input, list } = mounted('lean:right')
      input.fire('focus')
      input.value = 'fol'
      input.fire('input')
      if (how === 'keydown') input.fire('keydown', { key: 'Escape' })
      else input.fire('blur')
      assert.equal(list.hidden, true, how)
      assert.equal(select.value, 'lean:right', how)
      assert.equal(select.changes, 0, how)
      assert.equal(input.value, 'Direita', how)
    }
  })

  it('a mousedown on a row picks it; picking the current value closes without a change event', () => {
    const { select, input, list } = mounted('all')
    input.fire('focus')
    const row = (value: string) => ({ target: { closest: () => ({ dataset: { value } }) } })
    list.fire('mousedown', row('source:bluesky'))
    assert.equal(select.value, 'source:bluesky')
    assert.equal(select.changes, 1)
    input.fire('focus')
    list.fire('mousedown', row('source:bluesky'))
    assert.equal(select.changes, 1, 'the same value again is not a change')
    assert.equal(list.hidden, true)
  })

  it('sync() re-reads the select after a silent programmatic value change, and a refilled optgroup shows its new labels', () => {
    const { select, input, combo } = mounted('all')
    select.value = 'lean:left'
    assert.equal(input.value, 'Tudo', 'nothing fired, so nothing moved yet')
    combo.sync()
    assert.equal(input.value, 'Esquerda')
    select.options.push({ value: 'domain:novo.com.br', textContent: 'novo.com.br', parentElement: group('Veículo') })
    input.fire('focus')
    assert.ok(optionValues((combo as any).items().map((i: ComboItem) => `data-value="${i.value}"`).join(' ')).includes('domain:novo.com.br'))
  })

  it('the select\'s own change event (a seed applied upstream) also updates the label', () => {
    const { select, input } = mounted('all')
    select.value = 'source:bluesky'
    select.fire('change')
    assert.equal(input.value, 'Bluesky')
  })
})
