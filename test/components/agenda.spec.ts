import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const docsCard = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), openedBy: vi.fn(() => false) }))
vi.mock('../../src/ui/docs-card.svelte.js', async (orig) => ({ ...(await orig<object>()), ...docsCard }))

import Agenda from '../../src/ui/Agenda.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { clearScopes } from '../../src/ui/state.js'

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'tarcisio', name: 'Tarcísio' },
]
const data = (over: Record<string, unknown> = {}) => ({
  days: 30,
  persons: people,
  domains: ['g1.globo.com'],
  cells: [{ person_id: 'lula', domain: 'g1.globo.com', docs: 2, share: 0.004 }],
  ...over,
})

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let urls: string[]
let respond: () => Promise<unknown>
let body: unknown

const grid = () => document.getElementById('agendaGrid')!
const picks = () => [...document.querySelectorAll<HTMLElement>('#agendaGrid [data-person]')]
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300)
  flushSync()
}
const start = async (search = '') => {
  setBoot({ ready: true, people, peopleError: null, search })
  instance = mount(Agenda, { target })
  flushSync()
  await settle()
}
const stubFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url))
      return respond()
    }),
  )
const ok = () => Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => body })

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  urls = []
  body = data()
  respond = ok
  docsCard.open.mockClear()
  docsCard.close.mockClear()
  docsCard.openedBy.mockReset()
  docsCard.openedBy.mockReturnValue(false)
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
  target = document.createElement('div')
  document.body.append(target)
  stubFetch()
})

afterEach(() => {
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Agenda (issue #288)', () => {
  it('agenda AC1: requests /agenda with days and source only', async () => {
    await start('?days=7&source=gdelt')
    const url = urls.find((u) => u.includes('/agenda'))!
    expect(url).toMatch(/\/api\/agenda\?/)
    const qs = new URL(url, 'http://localhost').searchParams
    expect(qs.get('days')).toBe('7')
    expect(qs.get('source')).toBe('gdelt')
    for (const k of ['person', 'domain', 'lean', 'kind', 'limit', 'min']) expect(qs.get(k)).toBeNull()
  })

  it('agenda AC2: paints one row per domain and one column per person', async () => {
    body = data({
      domains: ['g1.globo.com', 'g2.example'],
      cells: [
        { person_id: 'lula', domain: 'g1.globo.com', docs: 8, share: 0.8 },
        { person_id: 'tarcisio', domain: 'g1.globo.com', docs: 2, share: 0.2 },
        { person_id: 'lula', domain: 'g2.example', docs: 5, share: 1 },
      ],
    })
    await start()
    expect(grid().hidden).toBe(false)
    expect(grid().textContent).toContain('g1.globo.com')
    expect(grid().textContent).toContain('g2.example')
    expect(grid().textContent).toContain('Tarcísio')
    expect(picks().map((p) => `${p.dataset.person}/${p.dataset.domain}`).sort()).toEqual(['lula/g1.globo.com', 'lula/g2.example', 'tarcisio/g1.globo.com'])
    expect(grid().querySelectorAll('.agenda-cell').length).toBe(4)
    expect(grid().querySelectorAll('.agenda-cell.is-empty').length).toBe(1)
    expect(grid().querySelector('.lean-chip')).not.toBeNull()
    expect(document.getElementById('agendaDays')).not.toBeNull()
    expect(document.getElementById('agendaSource')).not.toBeNull()
    expect(grid().textContent).toContain('80%')
    expect(grid().textContent).toContain('20%')
  })

  it('agenda AC3: empty cell reads sem documentos, no em dash', async () => {
    await start()
    const empty = grid().querySelector('.agenda-cell.is-empty')!
    expect(empty.querySelector('.sr-only')?.textContent).toBe('sem documentos')
    expect(empty.textContent).not.toContain('—')
    expect(grid().textContent).not.toContain('—')
  })

  it('agenda AC4: note names the row as the share axis', async () => {
    await start()
    expect(grid().textContent).toMatch(/\blinha\b/)
    expect(grid().textContent).not.toMatch(/\bcoluna\b/)
  })

  it('agenda AC5: under 1% reads <1%, never 0%', async () => {
    await start()
    expect(picks()[0].textContent!.trim()).toBe('<1%')
    expect(grid().textContent).not.toMatch(/(^|[^\d])0%/)
  })

  it('agenda AC6: pick opens one side with domain and no term', async () => {
    await start('?source=gnews')
    picks()[0].click()
    flushSync()
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.owner).toBe('agenda')
    expect(req.sides).toHaveLength(1)
    expect(req.sides[0].personId).toBe('lula')
    expect(req.sides[0].query.get('domain')).toBe('g1.globo.com')
    expect(req.sides[0].query.get('source')).toBe('gnews')
    expect(req.sides[0].query.get('term') ?? '').toBe('')
  })

  it('agenda AC7: another pick replaces, same pick releases and closes', async () => {
    body = data({
      cells: [
        { person_id: 'lula', domain: 'g1.globo.com', docs: 8, share: 0.8 },
        { person_id: 'tarcisio', domain: 'g1.globo.com', docs: 2, share: 0.2 },
      ],
    })
    await start()
    const [a, b] = picks()
    a.click()
    flushSync()
    b.click()
    flushSync()
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    expect((docsCard.open.mock.calls[1][0] as any).sides[0].personId).toBe('tarcisio')
    docsCard.openedBy.mockReturnValue(true)
    picks()[1].click()
    flushSync()
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    expect(docsCard.close).toHaveBeenCalledTimes(1)
    expect(picks()[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('agenda AC8/AC9: background click and Escape release, only when openedBy agenda', async () => {
    await start()
    picks()[0].click()
    flushSync()
    docsCard.openedBy.mockReturnValue(true)
    grid().click()
    flushSync()
    expect(docsCard.close).toHaveBeenCalledTimes(1)
    expect(picks()[0].getAttribute('aria-pressed')).toBe('false')
    docsCard.close.mockClear()
    picks()[0].click()
    flushSync()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(docsCard.close).toHaveBeenCalledTimes(1)
    docsCard.close.mockClear()
    docsCard.openedBy.mockReturnValue(false)
    picks()[0].click()
    flushSync()
    grid().click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(docsCard.close).not.toHaveBeenCalled()
    expect(picks()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('agenda AC10: same-data repaint keeps the pick, new data clears it', async () => {
    let width = 500
    const observers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    unmount(instance!)
    instance = undefined
    target.innerHTML = ''
    await start()
    Object.defineProperty(document.getElementById('agenda')!, 'clientWidth', { get: () => width, configurable: true })
    Object.defineProperty(grid(), 'clientWidth', { get: () => width, configurable: true })
    picks()[0].click()
    flushSync()
    width = 700
    observers.forEach((cb) => cb())
    flushSync()
    expect(picks()[0].getAttribute('aria-pressed')).toBe('true')
    const days = document.getElementById('agendaDays') as HTMLSelectElement
    days.value = '7'
    days.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
    expect(picks()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('agenda AC11: empty state names the minimum of 5', async () => {
    body = data({ domains: [], cells: [] })
    await start()
    expect(grid().hidden).toBe(false)
    expect(grid().textContent).toMatch(/mínimo de 5 documentos/)
    expect(picks()).toHaveLength(0)
    expect(grid().querySelector('table')).toBeNull()
  })

  it('agenda AC12: loading shows a ghost, not old data, aria-busy toggles', async () => {
    let release!: () => void
    respond = () => new Promise((res) => (release = () => res({ ok: true, status: 200, headers: new Headers(), json: async () => body })))
    await start()
    expect(grid().getAttribute('aria-busy')).toBe('true')
    expect(grid().querySelector('[class*="agenda-ghost"]')).not.toBeNull()
    expect(grid().textContent).not.toContain('g1.globo.com')
    release()
    await settle()
    expect(grid().getAttribute('aria-busy')).toBe('false')
    expect(grid().querySelector('[class*="agenda-ghost"]')).toBeNull()
    expect(grid().textContent).toContain('g1.globo.com')
  })

  it('agenda AC13: fetch failure shows an error note with retry that refetches', async () => {
    respond = () => Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
    await start()
    const retry = document.getElementById('agendaErrorRetry')!
    expect(retry).not.toBeNull()
    expect(grid().querySelector('[class*="agenda-ghost"]')).toBeNull()
    const before = urls.length
    respond = ok
    retry.click()
    flushSync()
    await settle()
    expect(urls.length).toBeGreaterThan(before)
    expect(document.getElementById('agendaErrorRetry')).toBeNull()
    expect(grid().textContent).toContain('g1.globo.com')
  })

  it('agenda AC14: people error shows unavailable note and makes no request', async () => {
    setBoot({ ready: true, people: [], peopleError: new Error('boom'), search: '' })
    instance = mount(Agenda, { target })
    flushSync()
    await settle()
    expect(grid().textContent).toContain('Falha de rede ou base indisponível')
    expect(document.getElementById('agendaRetry')).not.toBeNull()
    expect(urls).toEqual([])
  })

  it('agenda AC14: people pending shows ghost and makes no request', async () => {
    instance = mount(Agenda, { target })
    flushSync()
    await settle()
    expect(grid().querySelector('[class*="agenda-ghost"]')).not.toBeNull()
    expect(urls).toEqual([])
  })

  it('agenda AC15: seeds days and source, prefixed key wins', async () => {
    await start('?days=60&agenda.days=7&source=gdelt')
    expect((document.getElementById('agendaDays') as HTMLSelectElement).value).toBe('7')
    expect((document.getElementById('agendaSource') as HTMLSelectElement).value).toBe('gdelt')
  })

  it('agenda AC15: an invalid seed falls back to the defaults', async () => {
    await start('?days=9&source=nope')
    expect((document.getElementById('agendaDays') as HTMLSelectElement).value).toBe('30')
    expect(new URL(urls[0], 'http://localhost').searchParams.get('days')).toBe('30')
  })
})
