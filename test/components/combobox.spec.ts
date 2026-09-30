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
  instance = mount(Combobox, { target: host, props: { select, id: 'lensesA' } }) as any
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
    expect(list().hidden || list().querySelectorAll('[role="option"]').length === 0).toBe(true)
    expect(input().value).toBe('Tudo')
  })
})
