import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Persistence from '../../src/ui/Persistence.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { close, isOpen, mountDocsCard, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { clearScopes } from '../../src/ui/state.js'
import { kinds, shiftDate, sinceLabel, todayBrt, weekSpanLabel } from '../../src/ui/format.js'

const mondayOf = (date: string) => shiftDate(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
const cur = mondayOf(todayBrt())
const prev = shiftDate(cur, -7)
const HORIZON = 45

const series = (counts: (number | null)[]) => counts.map((count, i) => ({ week: shiftDate(cur, -7 * (counts.length - 1 - i)), count }))
const row = (over: Record<string, unknown> = {}) => ({
  term: 'anistia',
  kind: 'word',
  series: series([null, null, null, null, null, null, 2, 3, 3, 5, 4, 6]),
  streak: 6,
  half_life: 2,
  ...over,
})
const payload = (over: Record<string, unknown> = {}) => ({
  weeks: 12,
  since: '2026-09-09',
  first_week: shiftDate(cur, -70),
  horizon: HORIZON,
  terms: [row()],
  ...over,
})

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]

let target: HTMLElement
let cardTarget: HTMLElement
let instances: ReturnType<typeof mount>[] = []
let urls: string[]
let respond: (url: string) => Promise<unknown>

const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const $ = (id: string) => document.getElementById(id) as any
const persistenceUrls = () => urls.filter((u) => u.includes('/persistence'))
const paramsOf = (url: string) => new URL(url, 'http://localhost').searchParams
const cell = (week: string) => [...document.querySelectorAll<HTMLElement>('#persistenceChart [data-week]')].find((el) => el.dataset.week === week)
const change = (id: string, value: string) => {
  const select = $(id)
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

const start = async (search = '', data: unknown = payload()) => {
  respond = async (url) => ok(url.includes('/docs') ? { docs: [], total: 0 } : data)
  setBoot({ people, peopleError: null, ready: true, search })
  instances.push(mount(Persistence, { target }))
  instances.push(mount(DocsCard, { target: cardTarget }))
  mountDocsCard()
  flushSync()
  await settle(0)
  await settle(200)
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  urls = []
  respond = async () => ok(payload())
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
  target = document.createElement('div')
  cardTarget = document.createElement('div')
  document.body.append(target, cardTarget)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url))
      return respond(String(url))
    }),
  )
  setBoot({ people: [], peopleError: null, ready: false, search: '' })
})

afterEach(() => {
  close()
  instances.forEach((i) => unmount(i))
  instances = []
  target.remove()
  cardTarget.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Persistence request (#290)', () => {
  it('AC3: sends person, weeks and limit only, in memo-key order, seeded', async () => {
    await start('?persistence.person=bolsonaro&persistence.weeks=26&limit=20')
    const [url] = persistenceUrls()
    expect(url).toMatch(/\/api\/people\/bolsonaro\/persistence\?/)
    const qs = paramsOf(url)
    expect([...qs.keys()]).toEqual(['weeks', 'limit'])
    expect(qs.get('weeks')).toBe('26')
    expect(qs.get('limit')).toBe('20')
    for (const key of ['source', 'kind', 'days', 'min']) expect(qs.has(key)).toBe(false)
  })

  it('AC3: with no seed it asks for the first person, 12 weeks and 40 words', async () => {
    await start('')
    const [url] = persistenceUrls()
    expect(url).toMatch(/\/api\/people\/lula\/persistence\?/)
    expect(paramsOf(url).get('weeks')).toBe('12')
    expect(paramsOf(url).get('limit')).toBe('40')
  })

  it('AC8: a seeded weeks or limit outside the options is ignored; an unknown person falls back to the first; a bare weeks never seeds', async () => {
    await start('?persistence.person=ghost&persistence.weeks=5&limit=999')
    const qs = paramsOf(persistenceUrls()[0])
    expect(persistenceUrls()[0]).toMatch(/\/people\/lula\/persistence/)
    expect(qs.get('weeks')).toBe('12')
    expect(qs.get('limit')).toBe('40')
    unmount(instances.shift()!)
    unmount(instances.shift()!)
    clearScopes()
    urls = []
    await start('?weeks=4')
    expect(paramsOf(persistenceUrls()[0]).get('weeks')).toBe('12')
  })

  it('AC8: changing person, weeks or limit refetches', async () => {
    await start('')
    expect(persistenceUrls()).toHaveLength(1)
    change('persistenceWeeks', '4')
    await settle(200)
    expect(paramsOf(persistenceUrls().at(-1)!).get('weeks')).toBe('4')
    change('persistenceLimit', '60')
    await settle(200)
    expect(paramsOf(persistenceUrls().at(-1)!).get('limit')).toBe('60')
    change('persistencePerson', 'bolsonaro')
    await settle(200)
    expect(persistenceUrls().at(-1)).toMatch(/\/people\/bolsonaro\/persistence/)
    expect(persistenceUrls()).toHaveLength(4)
  })

  it('AC12: no fetch happens before boot state is ready', async () => {
    setBoot({ people, ready: false })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(500)
    expect(persistenceUrls()).toHaveLength(0)
    setBoot({ ready: true })
    flushSync()
    await settle(500)
    expect(persistenceUrls()).toHaveLength(1)
  })
})

describe('Persistence table (#290)', () => {
  it('AC4: a row per word, a button per filled week with data-lv and aria-label; gaps are data-gap', async () => {
    await start('')
    expect($('persistenceChart').hidden).toBe(false)
    expect(document.querySelectorAll('#persistenceChart .persistence-table tbody tr')).toHaveLength(1)
    expect(document.querySelector('#persistenceChart caption.sr-only')).not.toBeNull()
    const buttons = document.querySelectorAll<HTMLElement>('#persistenceChart button[data-week]')
    expect(buttons).toHaveLength(6)
    const b = cell(prev)!
    expect(b.dataset.term).toBe('anistia')
    expect(b.dataset.kind).toBe('word')
    expect(b.dataset.lv).toBeTruthy()
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe(`anistia, semana ${weekSpanLabel(prev)}: 4 documentos`)
    expect(document.querySelectorAll('#persistenceChart [data-gap]')).toHaveLength(6)
    expect(document.querySelectorAll('#persistenceChart button[data-gap]')).toHaveLength(0)
  })

  it('AC4: a filled cell older than the horizon is data-expired, not a button', async () => {
    await start('', payload({ terms: [row({ series: series(Array(12).fill(3)) })] }))
    const old = shiftDate(cur, -77)
    expect(cell(old)).toBeUndefined()
    expect(cell(prev)).toBeDefined()
    expect(document.querySelectorAll('#persistenceChart [data-expired]').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('#persistenceChart button[data-expired]')).toHaveLength(0)
  })

  it('AC9: null half-life reads "sem queda"; #persistenceSince shows the series start', async () => {
    await start('', payload({ terms: [row({ half_life: null })] }))
    expect($('persistenceChart').textContent).toContain('sem queda')
    expect($('persistenceSince').textContent).toBe(sinceLabel('2026-09-09'))
  })
})

describe('Persistence docs card (#290)', () => {
  it('AC5: a click opens the card with week, days=horizon, term, kind, source=all, one side, owner persistence; a second click closes', async () => {
    await start('?persistence.person=lula')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    const docs = urls.filter((u) => u.includes('/docs'))
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatch(/\/api\/people\/lula\/docs\?/)
    const qs = paramsOf(docs[0])
    expect(qs.get('week')).toBe(prev)
    expect(qs.get('days')).toBe(String(HORIZON))
    expect(qs.get('term')).toBe('anistia')
    expect(qs.get('kind')).toBe('word')
    expect(qs.get('source')).toBe('all')
    expect(isOpen()).toBe(true)
    expect(openedBy('persistence')).toBe(true)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('true')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(false)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('false')
  })

  it('AC6: the kicker names the kind and the week span; an unknown kind reads "o termo"', async () => {
    await start('', payload({ terms: [row(), row({ term: '#anistia', kind: 'weird' })] }))
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect($('docsKicker').textContent).toBe(`Documentos com ${kinds.word.toLowerCase()} · ${weekSpanLabel(prev)}`)
    expect($('docsTitle')?.textContent ?? 'anistia').toContain('anistia')
    const weird = [...document.querySelectorAll<HTMLElement>('#persistenceChart [data-kind="weird"]')].find((el) => el.dataset.week === prev)!
    weird.click()
    flushSync()
    await settle(0)
    expect($('docsKicker').textContent).toBe(`Documentos com o termo · ${weekSpanLabel(prev)}`)
  })

  it('AC7: a background click releases the selection and closes the card', async () => {
    await start('')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(true)
    $('persistenceChart').querySelector('caption')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(false)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('false')
  })

  it('AC7: Escape releases the selection and closes the card', async () => {
    await start('')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(false)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('false')
  })

  it('a click on the subtitle, its link or a select keeps the pick and the card', async () => {
    await start('')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click(document.querySelector('#persistence .figure-sub')!)
    click(document.querySelector('#persistence .figure-sub a')!)
    click($('persistenceWeeks'))
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(true)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('true')
  })

  it('a pick made during a pending fetch is dropped when new data arrives', async () => {
    await start('')
    let resolve!: (body: unknown) => void
    respond = (url) => (url.includes('/docs') ? Promise.resolve(ok({ docs: [], total: 0 })) : new Promise((r) => (resolve = (b) => r(ok(b)))))
    change('persistenceLimit', '20')
    await settle(200)
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(true)
    resolve(payload())
    await settle(0)
    expect(isOpen()).toBe(false)
    expect(cell(prev)!.getAttribute('aria-pressed')).toBe('false')
  })

  it('a pick is dropped when the next load fails', async () => {
    await start('')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(isOpen()).toBe(true)
    let resolve!: (body: unknown) => void
    respond = (url) => (url.includes('/docs') ? Promise.resolve(ok({ docs: [], total: 0 })) : new Promise((r) => (resolve = r)))
    change('persistenceLimit', '20')
    await settle(200)
    cell(prev)!.click()
    flushSync()
    await settle(0)
    resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
    await settle(0)
    expect(isOpen()).toBe(false)
    expect(cell(prev)).toBeUndefined()
  })

  it('AC7: a control change closes its own card but never one another figure owns', async () => {
    await start('')
    cell(prev)!.click()
    flushSync()
    await settle(0)
    expect(openedBy('persistence')).toBe(true)
    change('persistenceLimit', '20')
    await settle(200)
    expect(isOpen()).toBe(false)
    open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    flushSync()
    await settle(0)
    change('persistenceWeeks', '4')
    await settle(200)
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
  })
})

describe('Persistence notes, ghost and error (#290)', () => {
  const note = () => $('persistenceNote').textContent as string

  it('AC9: null first_week, 1 week and 3 weeks write their note; 4 weeks writes none', async () => {
    await start('', payload({ first_week: null, terms: [] }))
    expect(note()).toMatch(/Ainda sem série: a primeira semana é gravada na próxima atualização\./)
    unmount(instances.shift()!)
    unmount(instances.shift()!)
    clearScopes()
    await start('', payload({ first_week: cur }))
    expect(note()).toMatch(/^1 semana de série; a leitura começa a valer com quatro\./)
    unmount(instances.shift()!)
    unmount(instances.shift()!)
    clearScopes()
    await start('', payload({ first_week: shiftDate(cur, -14) }))
    expect(note()).toMatch(/^3 semanas de série; a leitura começa a valer com quatro\./)
    unmount(instances.shift()!)
    unmount(instances.shift()!)
    clearScopes()
    await start('', payload({ first_week: shiftDate(cur, -21) }))
    expect(note()).toBe('')
  })

  it('AC10: loading with no data shows six ghost rows and the sr-only text, never "Carregando"', async () => {
    respond = () => new Promise(() => {})
    setBoot({ people, ready: true, search: '' })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(0)
    expect(document.querySelectorAll('#persistenceChart .persistence-ghost-row')).toHaveLength(6)
    expect(document.querySelectorAll('#persistenceChart .persistence-ghost-row')[0].querySelectorAll('.persistence-cell.ghost')).toHaveLength(12)
    expect($('persistenceChart').textContent).toContain('Lendo a persistência.')
    expect(document.body.textContent).not.toContain('Carregando')
  })

  it('mounted before boot is ready: ghost rows, aria-busy, no fetch', async () => {
    setBoot({ people: [], peopleError: null, ready: false, search: '' })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(500)
    expect($('persistenceChart').hidden).toBe(false)
    expect($('persistenceChart').getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('#persistenceChart .persistence-ghost-row')).toHaveLength(6)
    expect(persistenceUrls()).toHaveLength(0)
  })

  it('AC10: a reload with data on screen dims and keeps the table', async () => {
    await start('')
    respond = () => new Promise(() => {})
    change('persistenceLimit', '20')
    flushSync()
    await vi.advanceTimersByTimeAsync(0)
    flushSync()
    expect(document.querySelector('#persistence')!.classList.contains('is-loading')).toBe(true)
    expect(document.querySelector('#persistenceChart table')).not.toBeNull()
  })

  it('AC10: a failing fetch shows the error note and hides the chart', async () => {
    setBoot({ people, ready: true, search: '' })
    respond = async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(200)
    expect($('persistenceChart').textContent + note()).toContain('Não foi possível carregar a persistência.')
    expect($('persistenceChart').querySelector('.persistence-ghost-row')).toBeNull()
  })

  it('AC11: peopleError writes the outage note and makes no request', async () => {
    setBoot({ people: [], peopleError: new Error('boom'), ready: true, search: '' })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(500)
    expect(note()).toBe('Falha de rede ou base indisponível.')
    expect($('persistenceChart').hidden).toBe(true)
    expect(persistenceUrls()).toHaveLength(0)
  })

  it('AC11: an empty registry writes its note and makes no request', async () => {
    setBoot({ people: [], peopleError: null, ready: true, search: '' })
    instances.push(mount(Persistence, { target }))
    flushSync()
    await settle(500)
    expect(note()).toBe('Nenhuma pessoa cadastrada.')
    expect($('persistenceChart').hidden).toBe(true)
    expect(persistenceUrls()).toHaveLength(0)
  })
})
