// Pure halves of a searchable face over a <select>, which stays the value store; groups are its <optgroup>s, re-read at every open.

import { normalize } from './format.js'

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

// A direct child of the <select> has no parent `.label`, so it is ungrouped.
export const itemsOf = (select: SelectLike): ComboItem[] =>
  Array.from(select.options, (o) => ({ value: o.value, label: o.textContent ?? '', group: o.parentElement?.label ?? '' }))

export const filterItems = (items: ComboItem[], query: string): ComboItem[] => {
  const q = normalize(query)
  return q ? items.filter((i) => normalize(i.label).includes(q)) : items
}

// The scrollTop that brings `row` into view inside `box`; scrollIntoView would also scroll the page.
export const revealTop = (row: Row, box: { scrollTop: number; clientHeight: number }) =>
  row.offsetTop < box.scrollTop
    ? row.offsetTop
    : row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight
      ? row.offsetTop + row.offsetHeight - box.clientHeight
      : box.scrollTop
