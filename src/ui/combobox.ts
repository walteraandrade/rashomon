// A searchable face over an existing <select>, which stays the value store: a pick writes its
// value and dispatches its own `change`. Groups are its <optgroup>s, re-read at every open, so
// a refill (loadOutlets in figures/lenses.ts) needs no notice here.

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
type InputLike = {
  value: string
  hidden: boolean
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, fn: (e?: any) => void) => void
  select?: () => void
}
type ListLike = {
  id: string
  hidden: boolean
  innerHTML: string
  addEventListener: (type: string, fn: (e?: any) => void) => void
  scrollTop?: number
  clientHeight?: number
  querySelector?: (selector: string) => Row | null
}
type Row = { offsetTop: number; offsetHeight: number }

export type Combobox = { sync: () => void; close: () => void; items: () => ComboItem[] }

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

export const attachCombobox = ({ select, input, list }: { select: SelectLike; input: InputLike; list: ListLike }): Combobox => {
  let open = false
  let shown: ComboItem[] = []
  let active = -1

  const labelOf = (value: string) => itemsOf(select).find((i) => i.value === value)?.label ?? ''
  const sync = () => {
    input.value = labelOf(select.value)
  }

  const render = () => {
    list.innerHTML = String(listMarkup(list.id, shown, active, select.value))
    input.setAttribute('aria-activedescendant', active >= 0 ? `${list.id}-${active}` : '')
    const row = list.querySelector?.('.is-active')
    if (row && list.scrollTop !== undefined && list.clientHeight !== undefined) list.scrollTop = revealTop(row, { scrollTop: list.scrollTop, clientHeight: list.clientHeight })
  }

  const show = (query: string) => {
    shown = filterItems(itemsOf(select), query)
    active = query ? (shown.length ? 0 : -1) : Math.max(0, shown.findIndex((i) => i.value === select.value))
    open = true
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    render()
  }

  const close = () => {
    open = false
    active = -1
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-activedescendant', '')
    sync()
  }

  const pick = (value: string) => {
    if (value !== select.value) {
      select.value = value
      select.dispatchEvent?.(new Event('change', { bubbles: true }))
    }
    close()
  }

  const move = (delta: number) => {
    if (!open) return show('')
    if (!shown.length) return
    active = (active + delta + shown.length) % shown.length
    render()
  }

  input.addEventListener('focus', () => {
    show('')
    input.select?.()
  })
  input.addEventListener('click', () => {
    if (!open) show('')
  })
  input.addEventListener('input', () => show(input.value))
  input.addEventListener('blur', () => {
    if (open) close()
  })
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const chosen = shown[active] ?? (shown.length === 1 ? shown[0] : undefined)
      if (chosen) pick(chosen.value)
    } else if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      if (open) close()
    }
  })
  // mousedown, not click: a click lands after the input's blur has already closed the list.
  list.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
    const option = (e.target as Element | null)?.closest?.('[data-value]') as HTMLElement | null
    if (option?.dataset.value !== undefined) pick(option.dataset.value)
  })
  select.addEventListener('change', sync)

  select.hidden = true
  input.hidden = false
  sync()
  return { sync, close, items: () => itemsOf(select) }
}
