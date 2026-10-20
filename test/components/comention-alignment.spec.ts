import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Comention from '../../src/ui/Comention.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { close } from '../../src/ui/docs-card.svelte.js'
import { matrixLayout } from '../../src/ui/layout.js'
import { clearScopes } from '../../src/ui/state.js'

const persons = Array.from({ length: 27 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, name: `Pessoa ${String(i).padStart(2, '0')}` }))
const pairs = persons.flatMap((a, i) => persons.slice(i + 1).map((b, k) => ({ a: a.id, b: b.id, count: 3 + i + k })))
const payload = { days: 21, persons, pairs }

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let observers: { target: Element | null; cb: () => void }[]
let matrixWidth: number

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const px = (el: HTMLElement, name: string) => Number.parseFloat(el.style.getPropertyValue(name))

const mountComention = async () => {
  setBoot({ people: persons, peopleError: null, ready: true, search: '' })
  instance = mount(Comention, { target })
  flushSync()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  observers = []
  matrixWidth = 1247
  setBoot({ people: [], peopleError: null, ready: false, search: '' })
  ;(globalThis as any).ResizeObserver = class {
    entry: { target: Element | null; cb: () => void }
    constructor(cb: () => void) {
      this.entry = { target: null, cb }
      observers.push(this.entry)
    }
    observe(t: Element) {
      this.entry.target = t
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.id === 'comentionMatrix' ? matrixWidth : 0
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/comention') ? payload : { docs: [], total: 0 }
      return { ok: true, status: 200, headers: new Headers(), json: async () => body }
    }),
  )
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close()
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (HTMLElement.prototype as any).clientWidth
})

describe('Comention.svelte column alignment', () => {
  it('drives every row from one track list: pitch is the cell plus both gaps, and it fits the measured width', async () => {
    await mountComention()
    const grid = $('#comentionMatrix .comention-grid')
    const expected = matrixLayout(persons, pairs, 1247)
    expect(grid.style.getPropertyValue('--n')).toBe('27')
    expect(px(grid, '--pitch')).toBe(expected.pitch)
    expect(px(grid, '--cell')).toBe(expected.cellSize)
    expect(px(grid, '--gap')).toBe(expected.gap)
    expect(px(grid, '--rowhead')).toBe(expected.rowhead)
    expect(px(grid, '--pitch')).toBe(px(grid, '--cell') + 2 * px(grid, '--gap'))
    expect(px(grid, '--rowhead') + 27 * px(grid, '--pitch')).toBeLessThanOrEqual(1247)
  })

  it('puts column j header and every cell for person j in the same track j', async () => {
    await mountComention()
    const rows = all('#comentionMatrix .comention-grid .comention-row')
    expect(rows).toHaveLength(persons.length + 1)
    const heads = [...rows[0].children].slice(1) as HTMLElement[]
    expect(heads.map((h) => h.getAttribute('title'))).toEqual(persons.map((p) => p.name))
    for (const row of rows) expect(row.children).toHaveLength(persons.length + 1)
    rows.slice(1).forEach((row, i) => {
      const cells = [...row.children].slice(1) as HTMLElement[]
      cells.forEach((cell, j) => {
        if (j <= i) return expect(cell.classList.contains('is-blank')).toBe(true)
        expect(cell.getAttribute('data-a')).toBe(persons[i].id)
        expect(cell.getAttribute('data-b')).toBe(persons[j].id)
        expect(heads[j].getAttribute('title')).toBe(persons[j].name)
      })
    })
  })

  it('never lets a header or a cell set its own width: only the shared tracks size a column', async () => {
    await mountComention()
    for (const h of all('#comentionMatrix .comention-colhead')) expect(h.getAttribute('style')).toBeNull()
    for (const c of all('#comentionMatrix .comention-cell')) {
      const style = c.getAttribute('style')
      if (style) expect(style.replace(/--w:\s*[\d.]+;?/, '').trim()).toBe('')
    }
  })

  it('a narrower box re-derives the pitch on resize and still fits', async () => {
    await mountComention()
    matrixWidth = 1000
    observers.find((o) => o.target === $('#comentionMatrix'))!.cb()
    await settle()
    const grid = $('#comentionMatrix .comention-grid')
    expect(px(grid, '--pitch')).toBe(matrixLayout(persons, pairs, 1000).pitch)
    expect(px(grid, '--rowhead') + 27 * px(grid, '--pitch')).toBeLessThanOrEqual(1000)
  })
})
