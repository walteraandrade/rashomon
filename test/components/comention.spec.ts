import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
// @ts-ignore -- the component is what issue #289 adds
import Comention from '../../src/ui/Comention.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { close, isOpen, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { clearScopes } from '../../src/ui/state.js'

type Pending = { url: string; resolve: (body: unknown) => void }

const lula = { id: 'lula', name: 'Lula' }
const tarcisio = { id: 'tarcisio', name: 'Tarcísio' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const three = [bolsonaro, lula, tarcisio]
const inverted = [
  { id: 'dino', name: 'Aline' },
  { id: 'bolsonaro', name: 'Zeca' },
]
const payload = (persons: { id: string; name: string }[], pairs: { a: string; b: string; count: number }[]) => ({ days: 21, persons, pairs })

let target: HTMLElement
let cardTarget: HTMLElement
let instances: ReturnType<typeof mount>[]
let fetches: string[]
let pending: Pending[]
let hold: boolean
let body: unknown
let observers: { cb: () => void }[]

const respond = (b: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => b })

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  fetches = []
  pending = []
  hold = false
  observers = []
  instances = []
  ;(globalThis as any).ResizeObserver = class {
    constructor(cb: () => void) {
      observers.push({ cb })
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetches.push(url)
      if (url.includes('/docs')) return Promise.resolve(respond({ docs: [], total: 0 }))
      if (hold) return new Promise((resolve) => pending.push({ url, resolve: (b) => resolve(respond(b)) }))
      return Promise.resolve(respond(body))
    }),
  )
  target = document.createElement('div')
  cardTarget = document.createElement('div')
  document.body.append(target, cardTarget)
  instances.push(mount(DocsCard, { target: cardTarget }))
})

afterEach(() => {
  close()
  instances.forEach((i) => unmount(i))
  target.remove()
  cardTarget.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
})

const settle = async () => {
  await vi.advanceTimersByTimeAsync(300)
  flushSync()
}

const start = async (b: unknown, people = three, search = '', peopleError: unknown = null) => {
  body = b
  setBoot({ people, peopleError, search, ready: true })
  instances.push(mount(Comention, { target }))
  flushSync()
  await settle()
}

const matrix = () => target.querySelector('#comentionMatrix') as HTMLElement
const about = () => target.querySelector('#comentionAbout')!.textContent
const cell = (a: string, b: string) => matrix().querySelector(`.comention-cell[data-a="${a}"][data-b="${b}"]`) as HTMLElement | null
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const docsUrls = () => fetches.filter((u) => u.includes('/docs'))
const comentionUrls = () => fetches.filter((u) => u.includes('/api/comention'))
const pick = async (a: string, b: string) => {
  click(cell(a, b)!)
  await settle()
}
const select = (id: string) => target.querySelector(`#${id}`) as HTMLSelectElement
const change = async (id: string, value: string) => {
  const el = select(id)
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

const filled = payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }])

describe('Comention', () => {
  it('forwards days, source, lean and min (AC1)', async () => {
    await start(filled)
    await change('comentionDays', '7')
    await change('comentionSource', 'gdelt')
    await change('comentionLean', 'left')
    await change('comentionMin', '5')
    const qs = new URL(comentionUrls().at(-1)!, 'http://localhost').searchParams
    expect(qs.get('days')).toBe('7')
    expect(qs.get('source')).toBe('gdelt')
    expect(qs.get('lean')).toBe('left')
    expect(qs.get('min')).toBe('5')
  })

  it('AC24: the period select offers exactly 7 and 21 with 21 selected, and the first /comention carries days=21', async () => {
    await start(filled)
    expect([...select('comentionDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('comentionDays').options].map((o) => o.textContent)).toEqual(['últimos 7 dias', 'últimos 21 dias'])
    expect(select('comentionDays').value).toBe('21')
    expect(new URL(comentionUrls()[0], 'http://localhost').searchParams.get('days')).toBe('21')
  })

  it('AC25: a shared link with days=30 or days=60 opens on 21, and days=7 still selects 7', async () => {
    for (const days of ['30', '60']) {
      await start(filled, three, `?days=${days}`)
      expect(select('comentionDays').value).toBe('21')
      expect(new URL(comentionUrls().at(-1)!, 'http://localhost').searchParams.get('days')).toBe('21')
      unmount(instances.pop()!)
      target.innerHTML = ''
      clearScopes()
    }
    await start(filled, three, '?days=7')
    expect(select('comentionDays').value).toBe('7')
  })

  it('opens one side with with=<b>, smaller id first (AC2)', async () => {
    await start(filled)
    await pick('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    expect(openedBy('comention')).toBe(true)
    expect(docsUrls()).toHaveLength(1)
    expect(docsUrls()[0]).toMatch(/\/api\/people\/lula\/docs\?/)
    expect(new URL(docsUrls()[0], 'http://localhost').searchParams.get('with')).toBe('tarcisio')
  })

  it('second click, background click and Escape release and close (AC3)', async () => {
    await start(filled)
    await pick('lula', 'tarcisio')
    await pick('lula', 'tarcisio')
    expect(isOpen()).toBe(false)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')

    await pick('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    click(matrix().querySelector('.comention-rowhead')!)
    await settle()
    expect(isOpen()).toBe(false)

    await pick('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isOpen()).toBe(false)
  })

  it('a click on the subtitle or a select outside the matrix keeps the pick and the card', async () => {
    await start(filled)
    await pick('lula', 'tarcisio')
    click(target.querySelector('.figure-sub')!)
    click(select('comentionDays'))
    click(target.querySelector('.figure-sub a')!)
    await settle()
    expect(isOpen()).toBe(true)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('release never closes a card another figure opened (AC3)', async () => {
    await start(filled)
    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams('term=a') }] })
    await settle()
    click(matrix().querySelector('.comention-rowhead')!)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
  })

  it('blank cell is not a button and clicking it opens no card (AC4)', async () => {
    await start(filled)
    const empty = matrix().querySelector('.comention-cell.is-empty')
    expect(empty).not.toBeNull()
    expect(empty!.tagName).not.toBe('BUTTON')
    click(empty!)
    await settle()
    expect(isOpen()).toBe(false)
    expect(docsUrls()).toHaveLength(0)
    expect(matrix().querySelectorAll('.comention-cell[data-a]')).toHaveLength(1)
  })

  it('empty response paints no data-a and the empty sentence (AC5)', async () => {
    await start(payload([], []))
    expect(matrix().querySelector('[data-a]')).toBeNull()
    expect(about()).toContain('Ninguém apareceu junto o suficiente nesta janela.')
  })

  it('grid cell and list item open the identical docs request (AC6)', async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]))
    const fromCell = matrix().querySelector('.comention-cell[data-a]') as HTMLElement
    expect(fromCell).not.toBeNull()
    click(fromCell)
    await settle()
    click(matrix().querySelector('.comention-listitem[data-a]')!)
    await settle()
    close()
    flushSync()
    click(matrix().querySelector('.comention-listitem[data-a]')!)
    await settle()
    const urls = docsUrls()
    expect(urls).toHaveLength(1)
    expect(new Set(urls).size).toBe(1)
    expect(urls[0]).toMatch(/\/api\/people\/bolsonaro\/docs\?/)
    expect(new URL(urls[0], 'http://localhost').searchParams.get('with')).toBe('dino')
  })

  it('a pick reads as selected in both the grid cell and the list item, whatever the id order', async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]))
    click(matrix().querySelector('.comention-cell[data-a]')!)
    await settle()
    for (const el of [matrix().querySelector('.comention-cell[data-a]')!, matrix().querySelector('.comention-listitem[data-a="bolsonaro"]')!]) {
      expect(el.getAttribute('aria-pressed')).toBe('true')
      expect(el.classList.contains('is-selected')).toBe(true)
    }
  })

  it('peopleError skips the fetch and writes the failure note (AC7)', async () => {
    await start(filled, three, '', new Error('down'))
    expect(comentionUrls()).toHaveLength(0)
    expect(matrix().hidden).toBe(true)
    expect(about()).toBe('Falha de rede ou base indisponível.')
  })

  it('seeds apply only when among the options (AC8)', async () => {
    await start(filled, three, '?days=7&source=gdelt&comention.lean=left&comention.min=5')
    expect(select('comentionDays').value).toBe('7')
    expect(select('comentionSource').value).toBe('gdelt')
    expect(select('comentionLean').value).toBe('left')
    expect(select('comentionMin').value).toBe('5')
    unmount(instances.pop()!)
    target.innerHTML = ''
    clearScopes()
    await start(filled, three, '?days=999&source=nope&comention.lean=zzz&comention.min=999')
    expect(select('comentionDays').value).toBe('21')
    expect(select('comentionLean').value).toBe('all')
    expect(select('comentionMin').value).toBe('3')
    unmount(instances.pop()!)
    target.innerHTML = ''
    clearScopes()
    await start(filled, three, '?lean=left&min=5')
    expect(select('comentionLean').value).toBe('all')
    expect(select('comentionMin').value).toBe('3')
    expect([...select('comentionSource').options].some((o) => o.value === select('comentionSource').value)).toBe(true)
    expect(select('comentionSource').value).not.toBe('nope')
  })

  it('paints the 27x27 ghost while /api/people is still pending', async () => {
    setBoot({ people: [], peopleError: null, search: '', ready: false })
    instances.push(mount(Comention, { target }))
    flushSync()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).toBe('true')
    expect(matrix().querySelectorAll('.comention-grid .comention-row')).toHaveLength(27)
    expect(comentionUrls()).toHaveLength(0)
  })

  it('a failed fetch shows the note and an empty about line', async () => {
    vi.mocked(fetch).mockImplementation((url: any) => {
      fetches.push(String(url))
      return Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as Response)
    })
    await start(filled)
    expect(matrix().hidden).toBe(false)
    expect(matrix().querySelector('.note')!.textContent).toBe('Não foi possível carregar quem aparece junto.')
    expect(about()).toBe('')
  })

  it('an empty pairs list still draws the full matrix', async () => {
    await start(payload(three, []))
    expect(matrix().querySelectorAll('.comention-grid .comention-row:not(.comention-headrow)')).toHaveLength(3)
    expect(matrix().querySelector('[data-a]')).toBeNull()
    expect(about()).toContain('Ninguém apareceu junto o suficiente nesta janela.')
  })

  it('a pick made during a pending fetch is dropped when new data arrives', async () => {
    await start(filled)
    hold = true
    const sel = select('comentionMin')
    sel.value = '5'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    flushSync()
    click(cell('lula', 'tarcisio')!)
    await settle()
    expect(isOpen()).toBe(true)
    pending.at(-1)!.resolve(payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }]))
    await settle()
    expect(isOpen()).toBe(false)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('a pick is dropped when the next load fails', async () => {
    await start(filled)
    await pick('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    vi.mocked(fetch).mockImplementation((url: any) => {
      fetches.push(String(url))
      return Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as Response)
    })
    await change('comentionMin', '5')
    expect(isOpen()).toBe(false)
    expect(cell('lula', 'tarcisio')).toBeNull()
  })

  it('ghost on first load, dim on reload, aria-busy toggles (AC9)', async () => {
    hold = true
    body = filled
    setBoot({ people: three, peopleError: null, search: '', ready: true })
    instances.push(mount(Comention, { target }))
    flushSync()
    await vi.advanceTimersByTimeAsync(0)
    flushSync()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).toBe('true')
    expect(matrix().querySelectorAll('.comention-grid .comention-row')).toHaveLength(27)
    expect(matrix().querySelectorAll('.comention-list .comention-listitem.ghost')).toHaveLength(6)
    expect(matrix().querySelector('.sr-only')!.textContent).toBe('Lendo quem aparece junto.')
    pending[0].resolve(filled)
    await settle()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).not.toBe('true')
    expect(cell('lula', 'tarcisio')).not.toBeNull()

    const sel = select('comentionDays')
    sel.value = '7'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    flushSync()
    expect(cell('lula', 'tarcisio')).not.toBeNull()
    expect(matrix().querySelector('.ghost')).toBeNull()
    expect(target.querySelector('.is-loading')).not.toBeNull()
    pending.at(-1)!.resolve(filled)
    await settle()
    expect(target.querySelector('.is-loading')).toBeNull()
    expect(matrix().getAttribute('aria-busy')).not.toBe('true')
  })

  it('a resize repaints without a fetch and keeps the selected pair; new data clears it (AC10)', async () => {
    await start(filled)
    await pick('lula', 'tarcisio')
    const before = fetches.length
    Object.defineProperty(matrix(), 'clientWidth', { value: 520, configurable: true })
    observers.forEach((o) => o.cb())
    flushSync()
    expect(fetches.length).toBe(before)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('true')
    body = payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }])
    await change('comentionMin', '5')
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')
  })
})
