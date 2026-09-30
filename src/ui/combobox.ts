// A searchable face over an existing <select>, which stays the value store: a pick writes its
// value and dispatches its own `change`. Groups are its <optgroup>s, re-read at every open, so
// a refill (Lenses.svelte's outlet fill) needs no notice here.

import { html, normalize } from './format.js'

export type ComboItem = { value: string; label: string; group: string }

type OptionLike = { value: string; textContent?: string | null; parentElement?: { label?: string } | null }
type SelectLike = {
  value: string
  hidden: boolean
  options: ArrayLike<OptionLike>
  addEventListener: (type: string, fn: (e?: any) => void) => void
  dispatchEvent?: (e: Event) => boolean
}
type Row = { offsetTop: number; offsetHeight: number }

// An <option> inside an <optgroup> has that group's label as its parent's `.label`; one straight
// under the <select> has the select as its parent, whose `.label` is undefined -> ungrouped.
export const itemsOf = (select: SelectLike): ComboItem[] =>
  Array.from(select.options, (o) => ({ value: o.value, label: o.textContent ?? '', group: o.parentElement?.label ?? '' }))

export const filterItems = (items: ComboItem[], query: string): ComboItem[] => {
  const q = normalize(query)
  return q ? items.filter((i) => normalize(i.label).includes(q)) : items
}

export const listMarkup = (listId: string, items: ComboItem[], active: number, current: string) => {
  if (!items.length) return html`<span class="combo-empty">Nada com esse nome</span>`
  let lastGroup: string | null = null
  return html`${items.map((item, i) => {
    const head = item.group && item.group !== lastGroup ? html`<span class="combo-group eyebrow" role="presentation">${item.group}</span>` : null
    lastGroup = item.group
    return html`${head}<span class="combo-option ${i === active ? 'is-active' : ''}" role="option" id="${listId}-${i}" data-value="${item.value}" aria-selected="${String(item.value === current)}">${item.label}</span>`
  })}`
}

// The scrollTop that brings `row` into view inside `box`, touching nothing else: scrollIntoView
// would also scroll the page whenever the list hangs past the viewport edge.
export const revealTop = (row: Row, box: { scrollTop: number; clientHeight: number }) =>
  row.offsetTop < box.scrollTop
    ? row.offsetTop
    : row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight
      ? row.offsetTop + row.offsetHeight - box.clientHeight
      : box.scrollTop
