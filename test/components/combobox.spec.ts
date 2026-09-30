import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Combobox from '../../src/ui/Combobox.svelte'

let host: HTMLElement
let select: HTMLSelectElement
let instance: ReturnType<typeof mount> & { sync?: () => void }
let changes: number

beforeEach(() => {
  host = document.createElement('div')
  select = document.createElement('select')
  select.innerHTML = `
    <option value="all">Tudo</option>
    <optgroup label="Lado"><option value="lean:esquerda">Esquerda</option><option value="lean:direita">Direita</option></optgroup>
    <optgroup label="Veículo"><option value="domain:a">Estadão</option><option value="domain:b">Folha</option><option value="domain:c">Correio Braziliense</option></optgroup>`
  changes = 0
  select.addEventListener('change', () => changes++)
  document.body.append(select, host)
  instance = mount(Combobox, { target: host, props: { select, inputId: 'lensesAInput', listId: 'lensesAList', label: 'Lente A', listLabel: 'Opções da lente A' } }) as any
  flushSync()
})

afterEach(() => {
  unmount(instance)
  select.remove()
  host.remove()
})

const input = () => host.querySelector('.combo-input') as HTMLInputElement
const list = () => host.querySelector('.combo-list') as HTMLElement
const options = () => [...list().querySelectorAll('[role="option"]')].map((o) => o.textContent)
const type = (value: string) => {
  input().dispatchEvent(new Event('focus'))
  input().value = value
  input().dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('Combobox', () => {
  it('carries the ids and labels figure 6 uses', () => {
    expect(input().id).toBe('lensesAInput')
    expect(input().getAttribute('aria-label')).toBe('Lente A')
    expect(input().getAttribute('aria-controls')).toBe('lensesAList')
    expect(input().hasAttribute('aria-activedescendant')).toBe(false)
    expect(list().id).toBe('lensesAList')
    expect(list().getAttribute('aria-label')).toBe('Opções da lente A')
  })

  it('renders a text input and a listbox', () => {
    expect(input()).not.toBeNull()
    expect(list().getAttribute('role')).toBe('listbox')
    expect(input().value).toBe('Tudo')
  })

  it('filters accent-insensitively', () => {
    type('estadao')
    expect(options()).toEqual(['Estadão'])
    type('BRAZIL')
    expect(options()).toEqual(['Correio Braziliense'])
    type('zzz')
    expect(options()).toEqual([])
    type('')
    expect(options()).toHaveLength(6)
  })

  it('pick writes select value and dispatches change once', () => {
    type('folha')
    const option = list().querySelector('[data-value="domain:b"]')!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    flushSync()
    expect(select.value).toBe('domain:b')
    expect(changes).toBe(1)
    expect(input().value).toBe('Folha')
  })

  it('sync follows a silent value write', () => {
    select.value = 'lean:direita'
    expect(input().value).toBe('Tudo')
    instance.sync!()
    flushSync()
    expect(input().value).toBe('Direita')
    expect(changes).toBe(0)
  })

  it('groups by optgroup', () => {
    type('')
    const groups = [...list().querySelectorAll('.combo-group')].map((g) => g.textContent)
    expect(groups).toEqual(['Lado', 'Veículo'])
  })

  it('reads the groups again at every open', () => {
    const extra = document.createElement('option')
    extra.value = 'domain:d'
    extra.textContent = 'Nexo'
    select.querySelector('optgroup[label="Veículo"]')!.appendChild(extra)
    type('nexo')
    expect(options()).toEqual(['Nexo'])
  })

  it('escape closes', () => {
    type('')
    expect(list().hidden).toBe(false)
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
    expect(list().hidden).toBe(true)
    expect(input().value).toBe('Tudo')
  })
})

const key = (k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  input().dispatchEvent(e)
  flushSync()
  return e
}
const activeText = () => list().querySelector('.is-active')?.textContent

describe('Combobox keyboard, blur and pick', () => {
  it('focus opens the full list with the current value active', () => {
    select.value = 'domain:b'
    instance.sync!()
    input().dispatchEvent(new Event('focus'))
    flushSync()
    expect(list().hidden).toBe(false)
    expect(activeText()).toBe('Folha')
  })

  it('ArrowDown/ArrowUp wrap at both ends', () => {
    type('')
    expect(activeText()).toBe('Tudo')
    key('ArrowUp')
    expect(activeText()).toBe('Correio Braziliense')
    key('ArrowDown')
    expect(activeText()).toBe('Tudo')
    expect(input().getAttribute('aria-activedescendant')).toBe('lensesAList-0')
  })

  it('Enter picks the active row, dispatches change once and closes', () => {
    type('folha')
    const e = key('Enter')
    expect(e.defaultPrevented).toBe(true)
    expect(select.value).toBe('domain:b')
    expect(changes).toBe(1)
    expect(list().hidden).toBe(true)
    expect(input().value).toBe('Folha')
  })

  it('blur closes without picking and restores the label', () => {
    type('fol')
    input().dispatchEvent(new Event('blur'))
    flushSync()
    expect(list().hidden).toBe(true)
    expect(input().value).toBe('Tudo')
    expect(changes).toBe(0)
  })

  it('picking the current value closes without a change event', () => {
    type('')
    list().querySelector('[data-value="all"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    flushSync()
    expect(changes).toBe(0)
    expect(list().hidden).toBe(true)
  })

  it('Escape on an open list does not reach document', () => {
    type('')
    let reached = 0
    const spy = () => reached++
    document.addEventListener('keydown', spy)
    key('Escape')
    document.removeEventListener('keydown', spy)
    expect(reached).toBe(0)
  })

})
