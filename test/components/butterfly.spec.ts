import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Butterfly from '../../src/ui/Butterfly.svelte'
import { butterflyRows } from '../../src/ui/butterfly-model.js'
import type { CompareTerm } from '../../src/ui/format.js'

const real = (count: number) => ({ count, pmi: 1, tone: null })
const terms: CompareTerm[] = [
  { term: 'economia', kind: 'word', a: real(41), b: real(17), bridge: 0.8 },
  { term: 'pix', kind: 'hashtag', a: real(20), b: null },
  { term: 'Alexandre de Moraes', kind: 'phrase', a: null, b: real(30) },
  { term: 'uma expressão muito comprida para caber', kind: 'phrase', a: real(9), b: null },
  { term: 'exatamente vinte e seis ch', kind: 'word', a: null, b: real(8) },
]
const model = butterflyRows(terms, 412, 168, 20, 'count')

let target: HTMLElement
let instance: ReturnType<typeof mount>
let picked: [string, string][]
let selected: { term: string; kind: string } | null

const start = () => {
  instance = mount(Butterfly, {
    target,
    props: { groups: model.groups, scale: model.scale, labelA: 'Lula', labelB: 'Flávio Bolsonaro', selected, onpick: (t: string, k: string) => picked.push([t, k]), ariaLabel: 'Barras' },
  })
  flushSync()
}
const rowOf = (term: string) => [...target.querySelectorAll<HTMLElement>('[data-term]')].find((r) => r.getAttribute('data-term') === term)!

beforeEach(() => {
  picked = []
  selected = null
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  unmount(instance)
  target.remove()
  vi.unstubAllGlobals()
})

describe('Butterfly', () => {
  it('renders one keyboard row per word with hooks and an aria-label', () => {
    start()
    const rows = [...target.querySelectorAll<HTMLElement>('[data-term]')]
    expect(rows).toHaveLength(model.groups.flatMap((g) => g.rows).length)
    for (const r of rows) {
      expect(r.tagName).toBe('DIV')
      expect(r.getAttribute('role')).toBe('button')
      expect(r.getAttribute('tabindex')).toBe('0')
      expect(r.getAttribute('aria-pressed')).toBe('false')
      expect(r.getAttribute('data-kind')).toBeTruthy()
    }
    expect(rowOf('economia').getAttribute('aria-label')).toBe('economia: Lula 41 documentos, Flávio Bolsonaro 17 documentos')
    expect(rowOf('pix').getAttribute('aria-label')).toBe('#pix: Lula 20 documentos, Flávio Bolsonaro nenhum documento')
    expect(rowOf('Alexandre de Moraes').getAttribute('aria-label')).toContain('Lula nenhum documento')
  })

  it('headers the three groups with the label props', () => {
    start()
    expect([...target.querySelectorAll('.butterfly-group-head')].map((e) => e.textContent)).toEqual(['só Lula', 'dos dois', 'só Flávio Bolsonaro'])
  })

  it('sets bar width from share over the shared domain and omits a null side', () => {
    start()
    const bar = (term: string, side: string) => rowOf(term).querySelector<HTMLElement>(`.butterfly-bar[data-side="${side}"]`)
    const width = (el: Element | null) => Number(/--bar:\s*([0-9.]+)/.exec(el?.getAttribute('style') ?? '')?.[1])
    const { domain } = model.scale
    expect(width(bar('economia', 'a'))).toBeCloseTo(((41 / 412) * 100) / domain, 6)
    expect(width(bar('economia', 'b'))).toBeCloseTo(((17 / 168) * 100) / domain, 6)
    expect(bar('pix', 'b')).toBeNull()
    expect(rowOf('pix').querySelectorAll('.butterfly-count')).toHaveLength(1)
    expect(rowOf('pix').querySelector('.butterfly-count')?.textContent).toBe('20')
    expect(rowOf('economia').querySelector('.butterfly-side.is-b .butterfly-count')?.textContent).toBe('17')
  })

  it('draws width 0 when the domain is 0', () => {
    unmount(instance)
    const empty = butterflyRows([{ term: 'x', kind: 'word', a: real(5), b: null }], 0, 0, 20, 'count')
    instance = mount(Butterfly, { target, props: { groups: empty.groups, scale: empty.scale, labelA: 'A', labelB: 'B', selected: null, onpick: () => {}, ariaLabel: 'x' } })
    flushSync()
    expect(target.querySelector('.butterfly-bar')?.getAttribute('style')).toMatch(/--bar:\s*0\b/)
  })

  it('truncates past 26 characters with the full term in title', () => {
    start()
    const long = rowOf('uma expressão muito comprida para caber').querySelector('.butterfly-label')!
    expect(long.querySelector('.butterfly-word')?.textContent).toBe('uma expressão muito compr…')
    expect(long.querySelector('.butterfly-word')!.textContent!.length).toBe(26)
    expect(long.getAttribute('title')).toBe('uma expressão muito comprida para caber')
    const edge = rowOf('exatamente vinte e seis ch').querySelector('.butterfly-label')!
    expect(edge.querySelector('.butterfly-word')?.textContent).toBe('exatamente vinte e seis ch')
    expect(edge.hasAttribute('title')).toBe(false)
    expect(rowOf('pix').querySelector('.butterfly-label')?.hasAttribute('title')).toBe(false)
    expect(rowOf('pix').querySelector('.butterfly-word')?.textContent).toBe('#pix')
  })

  it('renders the tick axes on both sides', () => {
    start()
    const ticks = (side: string) => [...target.querySelectorAll(`.butterfly-axis.is-${side} .butterfly-axis-tick`)].map((e) => e.textContent)
    expect(ticks('a')).toEqual(model.scale.ticks.map((t) => `${t.toLocaleString('pt-BR')}%`))
    expect(ticks('b')).toEqual(ticks('a'))
    expect(target.querySelector('.butterfly-axis.is-a .butterfly-axis-label')?.classList.contains('cmp-a')).toBe(true)
    expect(target.querySelector('.butterfly-axis.is-b .butterfly-axis-label')?.classList.contains('cmp-b')).toBe(true)
  })

  it('marks a bridge row with the amber mark and sr-only text', () => {
    start()
    const bridge = rowOf('economia')
    expect(bridge.getAttribute('data-bridge')).toBe('1')
    const label = bridge.querySelector('.butterfly-label')!
    expect(label.firstElementChild?.classList.contains('butterfly-bridge-mark')).toBe(true)
    expect(label.querySelector('.sr-only')?.textContent).toBe('ponte')
    const plain = rowOf('pix')
    expect(plain.hasAttribute('data-bridge')).toBe(false)
    expect(plain.querySelector('.butterfly-bridge-mark')).toBeNull()
    expect(plain.querySelector('.sr-only')).toBeNull()
  })

  it('picks on click, Enter and Space', () => {
    start()
    rowOf('pix').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (const key of ['Enter', ' ']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      rowOf('pix').dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
    }
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    rowOf('pix').dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(picked).toEqual([['pix', 'hashtag'], ['pix', 'hashtag'], ['pix', 'hashtag']])
  })

  it('shows the picked row pressed and selected', () => {
    selected = { term: 'pix', kind: 'hashtag' }
    start()
    expect(rowOf('pix').getAttribute('aria-pressed')).toBe('true')
    expect(rowOf('pix').classList.contains('is-selected')).toBe(true)
    expect(rowOf('economia').classList.contains('is-selected')).toBe(false)
  })
})
