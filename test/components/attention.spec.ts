import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Attention from '../../src/ui/Attention.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { close, mountDocsCard, openedBy, open } from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { ATLAS_KINDS, attentionParams } from '../../src/ui/api.js'
import { SOURCE_SEGMENTS } from '../../src/ui/format.js'
import { clearScopes } from '../../src/ui/state.js'
import { card } from '../../src/ui/docs-card.svelte.js'

type Call = { url: string; path: string; qs: URLSearchParams; signal?: AbortSignal; resolve: (b: unknown) => void; fail: () => void }

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]
const bucket = (day: string, count: number) => ({ bucket_start: `${day}T00:00:00.000Z`, count })
const att = (series: { day: string; views: number }[]) => ({ days: 30, series })

let calls: Call[]
let targets: HTMLElement[]
let instances: ReturnType<typeof mount>[]
let observers: { cb: () => void; target: unknown }[]
let widths: Record<string, number>
let auto: Record<string, unknown> | null

const $ = (id: string) => document.getElementById(id) as HTMLElement
const chart = () => $('attentionChart')
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const respond = (path: string, body: unknown, filter: (c: Call) => boolean = () => true) => {
  for (const c of calls.filter((c) => c.path.endsWith(path) && filter(c))) c.resolve(body)
}
const named = (path: string) => calls.filter((c) => c.path.endsWith(path))

const boot = (patch: Record<string, unknown> = {}) => {
  setBoot({ ready: true, people, peopleError: null, search: '', ...patch })
  flushSync()
}

const render = (withCard = false) => {
  const t = document.createElement('div')
  document.body.append(t)
  targets.push(t)
  instances.push(mount(Attention, { target: t }))
  if (withCard) {
    const c = document.createElement('div')
    document.body.append(c)
    targets.push(c)
    instances.push(mount(DocsCard, { target: c }))
    mountDocsCard()
  }
  flushSync()
}

const startAll = async (opts: { search?: string; withCard?: boolean } = {}) => {
  render(opts.withCard)
  boot({ search: opts.search ?? '' })
  await settle()
}

const day = (d: string) => [...chart().querySelectorAll('[data-day]')].filter((e) => (e as HTMLElement).dataset.day === d) as HTMLElement[]

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  targets = []
  instances = []
  observers = []
  widths = { attentionChart: 620, attention: 900 }
  auto = null
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widths[this.id] ?? 300
    },
  })
  ;(globalThis as any).ResizeObserver = class {
    cb: () => void
    constructor(cb: () => void) {
      this.cb = cb
    }
    observe(target: unknown) {
      observers.push({ cb: this.cb, target })
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const u = new URL(url, 'http://localhost')
        const done = (b: unknown) => resolve({ ok: true, status: 200, headers: new Headers(), json: async () => b })
        const entry: Call = { url, path: u.pathname, qs: u.searchParams, signal: init?.signal, resolve: done, fail: () => resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) }) }
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        calls.push(entry)
        if (auto) for (const [p, body] of Object.entries(auto)) if (u.pathname.endsWith(p)) done(body)
      }),
    ),
  )
})

afterEach(() => {
  close()
  for (const i of instances) unmount(i)
  for (const t of targets) t.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const both = (views = 100, count = 4, d = '2026-08-15') => ({ '/attention': att([{ day: d, views }]), '/timeline': [bucket(d, count)] })

describe('Attention (issue #295)', () => {
  it('AC3: requests wait for bootData.ready, and the chart shows its own ghost meanwhile', async () => {
    render()
    await settle(500)
    expect(calls).toHaveLength(0)
    expect(chart().hidden).toBe(false)
    expect(chart().innerHTML).not.toMatch(/Carregando/)
    auto = both()
    boot()
    await settle(500)
    expect(named('/attention')).toHaveLength(1)
    expect(named('/timeline')).toHaveLength(1)
    expect(named('/attention')[0].path).toContain('/lula/')
  })

  it('AC3: prefixed seeds beat bare seeds for person and source', async () => {
    auto = both()
    await startAll({ search: '?person=lula&attention.person=bolsonaro&source=rss&attention.source=gdelt' })
    expect(($('attentionPerson') as HTMLSelectElement).value).toBe('bolsonaro')
    expect(($('attentionSource') as HTMLSelectElement).value).toBe('gdelt')
    expect(named('/timeline')[0].path).toContain('/bolsonaro/')
    expect(named('/timeline')[0].qs.get('source')).toBe('gdelt')
  })

  it('AC3: bare person and source seeds are honoured', async () => {
    auto = both()
    await startAll({ search: '?person=bolsonaro&source=gdelt' })
    expect(($('attentionPerson') as HTMLSelectElement).value).toBe('bolsonaro')
    expect(named('/attention')[0].path).toContain('/bolsonaro/')
  })

  it('AC4: sends attention and timeline params', async () => {
    auto = both()
    await startAll({ search: '?source=gdelt' })
    expect([...named('/attention')[0].qs.entries()].sort()).toEqual([...attentionParams({}).entries()].sort())
    expect(named('/attention')[0].qs.get('days')).toBe('30')
    const qs = named('/timeline')[0].qs
    expect(Object.fromEntries(qs.entries())).toEqual({ term: '', kind: ATLAS_KINDS, days: '30', bucket: 'day', source: 'gdelt' })
  })

  it('AC5: source change refetches only timeline and both rows end painted', async () => {
    auto = both(12345, 4)
    await startAll()
    expect(chart().innerHTML).toMatch(/12\.345/)
    const sel = $('attentionSource') as HTMLSelectElement
    sel.value = 'gdelt'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(500)
    expect(named('/attention')).toHaveLength(1)
    expect(named('/timeline')).toHaveLength(2)
    expect(chart().innerHTML).toMatch(/12\.345/)
    expect(chart().innerHTML).toMatch(/data-row="mentions"|data-row=mentions/)
    expect(chart().querySelector('[data-row="mentions"]')).not.toBeNull()
    expect(chart().querySelector('[data-row="views"]')).not.toBeNull()
  })

  it('AC6: pads missing days with zero views and keys mentions by UTC date', async () => {
    auto = {
      '/attention': att([{ day: '2026-08-16', views: 500 }]),
      '/timeline': [{ bucket_start: '2026-08-14T00:00:00.000Z', count: 40 }, bucket('2026-08-15', 2), bucket('2026-08-16', 2)],
    }
    await startAll()
    expect(day('2026-08-14').length).toBeGreaterThan(0)
    expect(day('2026-08-15').length).toBeGreaterThan(0)
    expect($('attentionNote').textContent).toMatch(/a imprensa veio 2 dias antes/)
    expect(chart().textContent).not.toMatch(/sem dado de pageviews/)
  })

  it('AC6: a bucket late on a UTC day stays on that UTC day, never the BRT one', async () => {
    auto = { '/attention': att([]), '/timeline': [{ bucket_start: '2026-08-15T01:00:00.000Z', count: 3 }] }
    await startAll()
    expect(day('2026-08-15').length).toBeGreaterThan(0)
    expect(day('2026-08-14')).toHaveLength(0)
  })

  it('AC7: empty attention shows sem dado', async () => {
    auto = { '/attention': att([]), '/timeline': [bucket('2026-08-15', 6), bucket('2026-08-16', 2)] }
    await startAll()
    const text = chart().textContent + ' ' + $('attentionNote').textContent
    expect(text).toMatch(/sem dado de pageviews para esta pessoa/)
    expect(text).not.toMatch(/dias antes|mesmo dia|os dois picos/)
    expect(chart().querySelector('[data-row="mentions"]')).not.toBeNull()
  })

  it('AC7: one row error keeps the other painted', async () => {
    render()
    boot()
    await settle()
    respond('/timeline', [bucket('2026-08-15', 4)])
    named('/attention')[0].fail()
    await settle()
    expect(chart().textContent).toMatch(/Não foi possível carregar os pageviews\./)
    expect(chart().textContent).not.toMatch(/sem dado de pageviews/)
    expect(chart().querySelector('[data-row="mentions"]')).not.toBeNull()
  })

  it('AC7: a timeline error leaves the views row painted', async () => {
    render()
    boot()
    await settle()
    respond('/attention', att([{ day: '2026-08-15', views: 777 }]))
    named('/timeline')[0].fail()
    await settle()
    expect(chart().textContent).toMatch(/Não foi possível carregar as menções/)
    expect(chart().textContent).toMatch(/777/)
  })

  it('AC7: ignores stale and aborted responses', async () => {
    render()
    boot()
    await settle()
    const [oldAtt] = named('/attention')
    const [oldTl] = named('/timeline')
    const sel = $('attentionPerson') as HTMLSelectElement
    sel.value = 'bolsonaro'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(500)
    oldAtt.resolve(att([{ day: '2026-08-15', views: 12345 }]))
    oldTl.resolve([bucket('2026-08-15', 9)])
    await settle()
    expect(chart().textContent).not.toMatch(/12\.345/)
    respond('/attention', att([{ day: '2026-08-20', views: 999 }]), (c) => c.path.includes('/bolsonaro/'))
    respond('/timeline', [bucket('2026-08-20', 7)], (c) => c.path.includes('/bolsonaro/'))
    await settle()
    expect(chart().textContent).toMatch(/999/)
    expect(chart().textContent).not.toMatch(/12\.345/)
  })

  it('AC8: ghost and aria-busy while loading, cleared afterwards', async () => {
    render()
    boot()
    await settle()
    expect(chart().hidden).toBe(false)
    expect(chart().getAttribute('aria-busy')).toBe('true')
    expect($('attention').classList.contains('is-loading')).toBe(false)
    expect(chart().classList.contains('is-loading')).toBe(false)
    expect(chart().querySelector('.ghost, .ghost-field')).not.toBeNull()
    expect(chart().textContent).not.toMatch(/Carregando/)
    respond('/attention', att([{ day: '2026-08-15', views: 10 }]))
    respond('/timeline', [bucket('2026-08-15', 1)])
    await settle()
    expect(chart().getAttribute('aria-busy')).not.toBe('true')
    expect($('attention').classList.contains('is-loading')).toBe(false)
  })

  it('AC8: the views row ghosts on its own while /attention is pending', async () => {
    render()
    boot()
    await settle()
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    expect(chart().querySelector('[data-row="mentions"]')).not.toBeNull()
    expect(chart().innerHTML).toMatch(/ghost/)
    expect(chart().textContent).not.toMatch(/sem dado de pageviews/)
  })

  it('AC8: views-only ghost does not dim the section and a mentions day stays clickable', async () => {
    render(true)
    boot()
    await settle()
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    expect($('attention').classList.contains('is-loading')).toBe(false)
    expect(chart().classList.contains('is-loading')).toBe(false)
    expect(chart().getAttribute('aria-busy')).toBe('true')
    day('2026-08-15')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(openedBy('attention')).toBe(true)
  })

  it('AC8: a reload over data on screen dims the section', async () => {
    auto = both()
    await startAll()
    auto = null
    const sel = $('attentionSource') as HTMLSelectElement
    sel.value = 'gdelt'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect($('attention').classList.contains('is-loading')).toBe(true)
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 2)], (c) => c.qs.get('source') === 'gdelt')
    await settle()
    expect($('attention').classList.contains('is-loading')).toBe(false)
  })

  it('AC11: width tracks the chart when /attention errored', async () => {
    render()
    boot()
    await settle()
    named('/attention').forEach((c) => c.fail())
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    const before = calls.length
    expect(chart().querySelector('[data-row="views"]')?.textContent).toMatch(/Não foi possível/)
    widths.attentionChart = 400
    for (const o of observers.filter((o) => o.target === chart())) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect((chart().querySelector('[data-row="mentions"] svg.attention-svg') as SVGElement).getAttribute('width')).toBe('400')
  })

  it('AC9: a pick made while a source reload is held is dropped when the new data paints', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    auto = { '/docs': { docs: [], total: 0 } }
    const sel = $('attentionSource') as HTMLSelectElement
    sel.value = 'gdelt'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(500)
    day('2026-08-15')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    await settle()
    expect(openedBy('attention')).toBe(true)
    expect(chart().querySelector('.is-selected')).not.toBeNull()
    respond('/timeline', [bucket('2026-08-15', 2)], (c) => c.qs.get('source') === 'gdelt')
    await settle()
    expect(openedBy('attention')).toBe(false)
    expect(chart().querySelector('.is-selected')).toBeNull()
  })

  it('AC9: a pick is dropped when its row then errors, leaving a card another figure owns alone', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    auto = null
    const sel = $('attentionSource') as HTMLSelectElement
    sel.value = 'gdelt'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(500)
    open({ owner: 'compare', kicker: 'k', title: 't', sides: [] })
    flushSync()
    named('/timeline').filter((c) => c.qs.get('source') === 'gdelt').forEach((c) => c.fail())
    await settle()
    expect(openedBy('compare')).toBe(true)
  })

  const days30 = Array.from({ length: 30 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
  const heights = (row: string) => [...chart().querySelectorAll(`[data-row="${row}"] .attention-bar`)].map((e) => e.getAttribute('height'))
  const scenario = async (count: number, views: number) => {
    clearScopes()
    setBoot({ ready: false, people: [], peopleError: null, search: '' })
    auto = {
      '/attention': att(days30.slice(0, 5).map((d, i) => ({ day: d, views: i === 2 ? views : 2 }))),
      '/timeline': days30.slice(0, 5).map((d, i) => bucket(d, i === 2 ? count : 3)),
    }
    await startAll()
    const out = { mentions: heights('mentions'), views: heights('views') }
    for (const i of instances.splice(0)) unmount(i)
    for (const t of targets.splice(0)) t.remove()
    return out
  }

  it('AC4: each row is sized off its own maximum, never distorted by the other row scale', async () => {
    const a = await scenario(5, 200)
    const b = await scenario(5, 5_000_000)
    expect(a.mentions.length).toBeGreaterThan(0)
    expect(a.mentions).toEqual(b.mentions)
    const c = await scenario(900_000, 200)
    expect(a.views).toEqual(c.views)
  })

  it('30 mentions marks stay in the tab order, the views row drops out of tab order and the accessibility tree', async () => {
    auto = { '/attention': att(days30.map((d) => ({ day: d, views: 9000 }))), '/timeline': days30.map((d) => bucket(d, 40)) }
    await startAll()
    const html = chart().innerHTML
    expect(chart().querySelectorAll('[data-day]')).toHaveLength(60)
    expect(chart().querySelectorAll('[data-row="mentions"] [data-day][tabindex="0"]')).toHaveLength(30)
    expect(chart().querySelectorAll('[data-row="views"] [data-day][tabindex="-1"][aria-hidden="true"]')).toHaveLength(30)
    expect(chart().querySelectorAll('[data-row="views"] [tabindex="0"]')).toHaveLength(0)
    expect(html).not.toMatch(/aria-label="2026-08/)
  })

  it('the mentions mark accessible name is the pt-BR day label plus both values', async () => {
    auto = both(9000, 40, '2026-08-01')
    await startAll()
    const label = chart().querySelector('[data-row="mentions"] [data-day]')!.getAttribute('aria-label')!
    expect(label).toMatch(/^.*, 40 documentos, 9\.000 visualizações$/)
    expect(label).not.toMatch(/2026-08-01/)
  })

  it('the ghost and the data paint share the row/axis shape, and an /attention error clears the ghost', async () => {
    render()
    boot()
    await settle()
    const shape = () => ['mentions', 'views'].map((r) => [chart().querySelector(`[data-row="${r}"]`) !== null, chart().querySelector(`[data-row="${r}"] .attention-axis`) !== null])
    expect(shape()).toEqual([[true, true], [true, true]])
    respond('/attention', att([{ day: '2026-08-15', views: 9000 }]))
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    expect(shape()).toEqual([[true, true], [true, true]])
    expect(chart().querySelector('.ghost-field')).toBeNull()
  })

  it('the lag sentence: peak order sets the wording, no peak leaves a note only', async () => {
    const run = async (mDay: string, vDay: string, vViews = 9000) => {
      clearScopes()
      setBoot({ ready: false, people: [], peopleError: null, search: '' })
      const ds = days30.slice(0, 7)
      auto = { '/attention': att(ds.map((d) => ({ day: d, views: vViews === 0 ? 0 : d === vDay ? vViews : 1 }))), '/timeline': ds.map((d) => bucket(d, d === mDay ? 40 : 1)) }
      await startAll()
      const text = $('attentionNote').textContent
      for (const i of instances.splice(0)) unmount(i)
      for (const t of targets.splice(0)) t.remove()
      return text
    }
    expect(await run('2026-08-03', '2026-08-06')).toMatch(/a imprensa veio 3 dias antes/)
    expect(await run('2026-08-03', '2026-08-04')).toMatch(/a imprensa veio 1 dia antes$/)
    expect(await run('2026-08-06', '2026-08-03')).toMatch(/o público buscou 3 dias antes/)
    expect(await run('2026-08-03', '2026-08-03')).toMatch(/os dois picos caíram no mesmo dia/)
    expect(await run('2026-08-03', '2026-08-03', 0)).not.toMatch(/dias antes|mesmo dia/)
  })

  const changeTo = (id: string, value: string) => {
    const sel = $(id) as HTMLSelectElement
    sel.value = value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    return sel
  }
  const clickDay = (d: string, row = 'mentions') => {
    chart().querySelector(`[data-row="${row}"] [data-day="${d}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
  }
  const oldPerson = (c: Call) => c.path.includes('/lula/')
  const newPerson = (c: Call) => c.path.includes('/bolsonaro/')

  it('AC7: a stale old-person /attention success inside the debounce paints nothing', async () => {
    render()
    boot()
    await settle()
    changeTo('attentionPerson', 'bolsonaro')
    respond('/timeline', [bucket('2026-08-15', 9)], oldPerson)
    respond('/attention', att([{ day: '2026-08-15', views: 12345 }]), oldPerson)
    await settle(10)
    expect(chart().innerHTML).not.toMatch(/12\.345/)
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 7)], newPerson)
    await settle()
    expect(chart().innerHTML).not.toMatch(/12\.345/)
  })

  it('AC7: a stale old-person /timeline success inside the debounce paints nothing', async () => {
    render()
    boot()
    await settle()
    changeTo('attentionPerson', 'bolsonaro')
    respond('/timeline', [bucket('2026-08-15', 4321)], oldPerson)
    await settle(10)
    expect(chart().innerHTML).not.toMatch(/4\.321/)
  })

  it('AC7: a stale old-person /timeline failure inside the debounce paints no error copy', async () => {
    render()
    boot()
    await settle()
    changeTo('attentionPerson', 'bolsonaro')
    named('/timeline').filter(oldPerson).forEach((c) => c.fail())
    await settle(10)
    expect(chart().textContent).not.toMatch(/Não foi possível carregar as menções/)
  })

  it('AC7: a stale old-person /attention failure inside the debounce paints no error copy', async () => {
    render()
    boot()
    await settle()
    respond('/timeline', [bucket('2026-08-15', 4)], oldPerson)
    await settle()
    changeTo('attentionPerson', 'bolsonaro')
    named('/attention').filter(oldPerson).forEach((c) => c.fail())
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 7)], newPerson)
    await settle()
    expect(chart().textContent).not.toMatch(/Não foi possível carregar os pageviews/)
  })

  it('AC7: a person change never paints the old views against the new mentions', async () => {
    auto = both(12345, 4)
    await startAll()
    expect(chart().innerHTML).toMatch(/12\.345/)
    auto = null
    changeTo('attentionPerson', 'bolsonaro')
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 7)], newPerson)
    await settle()
    expect(chart().innerHTML).not.toMatch(/12\.345/)
  })

  it('AC3: a later setBoot never re-seeds or refetches and keeps the selected person', async () => {
    auto = both()
    await startAll()
    const sel = changeTo('attentionPerson', 'bolsonaro')
    await settle(500)
    const before = calls.length
    setBoot({ ready: true, search: '' })
    flushSync()
    await settle(500)
    expect(calls.length).toBe(before)
    expect(sel.value).toBe('bolsonaro')
  })

  it('AC3: an unknown seeded person or source falls back to the first person and the default source', async () => {
    auto = both()
    await startAll({ search: '?person=nobody&source=nope' })
    expect(($('attentionPerson') as HTMLSelectElement).value).toBe('lula')
    expect(($('attentionSource') as HTMLSelectElement).value).toBe(SOURCE_SEGMENTS[0][0])
    expect(named('/timeline')[0].path).toContain('/lula/')
    expect(named('/timeline')[0].qs.get('source')).toBe(SOURCE_SEGMENTS[0][0])
  })

  it('AC8: the views-only ghost carries its own sr-only note', async () => {
    render()
    boot()
    await settle()
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    expect(chart().querySelector('.sr-only')?.textContent).toBe('Lendo os pageviews.')
  })

  it('AC6: the views row carries one mark per mentions day, padding the missing ones', async () => {
    auto = { '/attention': att([{ day: '2026-08-16', views: 500 }]), '/timeline': [bucket('2026-08-14', 40), bucket('2026-08-15', 2), bucket('2026-08-16', 2)] }
    await startAll()
    expect(chart().querySelectorAll('[data-row="views"] [data-day]')).toHaveLength(3)
  })

  it('AC9: aria-pressed and is-selected follow the pick and its release', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    const mark = () => chart().querySelector('[data-row="mentions"] [data-day]')!
    expect(mark().getAttribute('aria-pressed')).toBe('false')
    expect(mark().classList.contains('is-selected')).toBe(false)
    clickDay('2026-08-15')
    await settle()
    expect(mark().getAttribute('aria-pressed')).toBe('true')
    expect(mark().classList.contains('is-selected')).toBe(true)
    chart().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(mark().getAttribute('aria-pressed')).toBe('false')
    expect(mark().classList.contains('is-selected')).toBe(false)
  })

  it('AC9: Enter and Space pick a day', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    const key = (k: string) => {
      chart().querySelector('[data-row="mentions"] [data-day]')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      flushSync()
    }
    key(' ')
    await settle()
    expect(openedBy('attention')).toBe(true)
    key('Enter')
    await settle()
    expect(openedBy('attention')).toBe(false)
    key('Enter')
    await settle()
    expect(openedBy('attention')).toBe(true)
    key('a')
    await settle()
    expect(openedBy('attention')).toBe(true)
  })

  it('AC9: the card kicker names the day and its side names the person', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    changeTo('attentionPerson', 'bolsonaro')
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 4)], newPerson)
    respond('/attention', att([{ day: '2026-08-15', views: 100 }]), newPerson)
    await settle()
    clickDay('2026-08-15')
    await settle()
    expect(document.getElementById('docsKicker')!.textContent).toMatch(/^Documentos de .*15/)
    expect(card.sides[0].personName).toBe('Bolsonaro')
    expect(card.sides[0].personId).toBe('bolsonaro')
  })

  it('AC9: a person or source change closes the open card at once', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    clickDay('2026-08-15')
    await settle()
    expect(openedBy('attention')).toBe(true)
    auto = null
    changeTo('attentionSource', 'gdelt')
    expect(openedBy('attention')).toBe(false)
    expect(chart().querySelector('.is-selected')).toBeNull()
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await settle(500)
    clickDay('2026-08-15')
    await settle()
    expect(openedBy('attention')).toBe(true)
    changeTo('attentionPerson', 'bolsonaro')
    expect(openedBy('attention')).toBe(false)
  })

  it('AC7: a mentions error, then a source change and a success, clears the error row', async () => {
    render()
    boot()
    await settle()
    respond('/attention', att([{ day: '2026-08-15', views: 7 }]))
    named('/timeline')[0].fail()
    await settle()
    expect(chart().textContent).toMatch(/Não foi possível carregar as menções/)
    changeTo('attentionSource', 'gdelt')
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 3)], (c) => c.qs.get('source') === 'gdelt')
    await settle()
    expect(chart().textContent).not.toMatch(/Não foi possível carregar as menções/)
    expect(chart().querySelector('[data-row="mentions"] [data-day]')).not.toBeNull()
  })

  it('AC7: no mentions in the window says so in the row head, and each row head states its own peak', async () => {
    auto = { '/attention': att([]), '/timeline': [] }
    await startAll()
    expect(chart().querySelector('[data-row="mentions"] .attention-row-head')!.textContent).toMatch(/sem dado de menções para esta pessoa nesta janela/)
    clearScopes()
    for (const i of instances.splice(0)) unmount(i)
    for (const t of targets.splice(0)) t.remove()
    setBoot({ ready: false, people: [], peopleError: null, search: '' })
    auto = { '/attention': att([{ day: '2026-08-15', views: 12345 }]), '/timeline': [bucket('2026-08-15', 4)] }
    await startAll()
    expect(chart().querySelector('[data-row="mentions"] .attention-row-head')!.textContent).toMatch(/pico: 4 documentos em/)
    expect(chart().querySelector('[data-row="views"] .attention-row-head')!.textContent).toMatch(/pico: 12\.345 visualizações em/)
  })

  it('AC7: a views mark title reads the day, its mentions count and its own views', async () => {
    auto = both(12345, 4)
    await startAll()
    const title = chart().querySelector('[data-row="views"] [data-day] title')!.textContent!
    expect(title).toMatch(/, 4 documentos, 12\.345 visualizações$/)
  })

  it('AC8: the first ghost draws both rows with ghost bars, ticks, axis and its sr-only note', async () => {
    render()
    boot()
    await settle()
    expect(chart().querySelectorAll('[data-row] svg .ghost')).toHaveLength(12)
    expect(chart().querySelectorAll('[data-row] .attention-tick')).toHaveLength(12)
    expect(chart().querySelector('.sr-only')?.textContent).toBe('Lendo a atenção.')
  })

  it('AC5: data rows carry a labelled group svg and one tick per mark', async () => {
    auto = both(100, 4)
    await startAll()
    const views = chart().querySelector('[data-row="views"] svg')!
    expect(views.getAttribute('role')).toBe('group')
    expect(views.getAttribute('aria-label')).toBe('Pageviews (Wikipédia)')
    expect(chart().querySelectorAll('[data-row="mentions"] .attention-tick')).toHaveLength(1)
  })

  it('AC7: a person change ghosts both rows at once, dropping the old mentions and the old views error', async () => {
    render()
    boot()
    await settle()
    named('/attention').forEach((c) => c.fail())
    respond('/timeline', [bucket('2026-08-15', 4)])
    await settle()
    expect(chart().textContent).toMatch(/Não foi possível carregar os pageviews/)
    changeTo('attentionPerson', 'bolsonaro')
    expect(chart().querySelector('[data-row="mentions"] [data-day]')).toBeNull()
    expect(chart().textContent).not.toMatch(/Não foi possível carregar os pageviews/)
    expect(chart().querySelector('.ghost-field')).not.toBeNull()
    await settle(500)
    respond('/timeline', [bucket('2026-08-15', 7)], newPerson)
    await settle()
    expect(chart().textContent).not.toMatch(/Não foi possível carregar os pageviews/)
    expect(chart().querySelector('[data-row="views"] .ghost')).not.toBeNull()
  })

  it('AC9: a pick is dropped, and its card closed, when the held mentions reload then fails', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    auto = { '/docs': { docs: [], total: 0 } }
    changeTo('attentionSource', 'gdelt')
    await settle(500)
    clickDay('2026-08-15')
    await settle()
    expect(openedBy('attention')).toBe(true)
    named('/timeline').filter((c) => c.qs.get('source') === 'gdelt').forEach((c) => c.fail())
    await settle()
    expect(openedBy('attention')).toBe(false)
  })

  it('AC8: a memo hit does not ghost', async () => {
    auto = both(12345, 4)
    await startAll()
    const sel = $('attentionPerson') as HTMLSelectElement
    sel.value = 'bolsonaro'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    sel.value = 'lula'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(500)
    expect(chart().innerHTML).toMatch(/12\.345/)
    expect(chart().getAttribute('aria-busy')).not.toBe('true')
  })

  it('AC9: day click opens the docs card with owner attention, term empty, that day and days 30', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ search: '?source=gdelt', withCard: true })
    day('2026-08-15')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    await settle()
    const d = named('/docs')[0]
    expect(d).toBeTruthy()
    expect(d.qs.get('day')).toBe('2026-08-15')
    expect(d.qs.get('term')).toBe('')
    expect(d.qs.get('days')).toBe('30')
    expect(d.qs.get('kind')).toBe(ATLAS_KINDS)
    expect(d.qs.get('source')).toBe('gdelt')
    expect(d.path).toContain('/lula/')
    expect(openedBy('attention')).toBe(true)
  })

  it('AC9: a zero-mentions day still opens', async () => {
    auto = { ...both(100, 0), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    day('2026-08-15')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    await settle()
    expect(openedBy('attention')).toBe(true)
  })

  it('AC9: second click, background click and Escape release it', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    const click = () => {
      day('2026-08-15')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      flushSync()
    }
    click()
    await settle()
    expect(openedBy('attention')).toBe(true)
    click()
    await settle()
    expect(openedBy('attention')).toBe(false)
    click()
    await settle()
    expect(openedBy('attention')).toBe(true)
    chart().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(openedBy('attention')).toBe(false)
    click()
    await settle()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(openedBy('attention')).toBe(false)
  })

  it('AC9: Escape is handled once, not twice', async () => {
    auto = { ...both(), '/docs': { docs: [], total: 0 } }
    await startAll({ withCard: true })
    const spy = vi.spyOn(document, 'addEventListener')
    unmount(instances.shift()!)
    spy.mockRestore()
    const t = document.createElement('div')
    document.body.append(t)
    targets.push(t)
    const adds: string[] = []
    const orig = document.addEventListener.bind(document)
    const s2 = vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, ...rest: any[]) => {
      adds.push(type)
      return (orig as any)(type, ...rest)
    }) as any)
    instances.push(mount(Attention, { target: t }))
    flushSync()
    await settle()
    s2.mockRestore()
    expect(adds.filter((a) => a === 'keydown').length).toBeLessThanOrEqual(1)
  })

  it('AC9: Escape does not close a card another figure owns', async () => {
    auto = both()
    await startAll({ withCard: true })
    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams('term=a') }] })
    flushSync()
    expect(openedBy('atlas')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(openedBy('atlas')).toBe(true)
  })

  it('AC10: peopleError shows the unavailable note, issues no fetch and keeps the chart hidden', async () => {
    render()
    boot({ people: [], peopleError: new Error('down') })
    await settle(500)
    expect(calls).toHaveLength(0)
    expect($('attentionNote').textContent).toBe('Falha de rede ou base indisponível.')
    expect(chart().hidden).toBe(true)
  })

  it('AC10: ready with no people says nobody is registered, no fetch, chart hidden', async () => {
    render()
    boot({ people: [] })
    await settle(500)
    expect(calls).toHaveLength(0)
    expect($('attentionNote').textContent).toBe('Nenhuma pessoa cadastrada.')
    expect(chart().hidden).toBe(true)
  })

  it('AC11: measures #attentionChart, not the section', async () => {
    auto = both()
    await startAll()
    const svg = chart().querySelector('svg.attention-svg') as SVGElement
    expect(svg.getAttribute('width')).toBe('620')
  })

  it('AC11: a width change repaints without a new request', async () => {
    auto = both()
    await startAll()
    const before = calls.length
    widths.attentionChart = 400
    for (const o of observers.filter((o) => o.target === chart())) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect((chart().querySelector('svg.attention-svg') as SVGElement).getAttribute('width')).toBe('400')
  })

  it('AC2: keeps the page ids, two pick spans, the como-ler link and the accessible chart label', async () => {
    render()
    const section = $('attention')
    expect(section.getAttribute('aria-labelledby')).toBe('attentionTitle')
    expect(section.classList.contains('figure')).toBe(true)
    expect(section.classList.contains('attention')).toBe(true)
    expect(section.querySelector('.eyebrow')!.textContent).toBe('Gráfico 7')
    expect($('attentionTitle').textContent).toBe('Atenção e menções')
    expect(section.querySelectorAll('.pick')).toHaveLength(2)
    expect(section.querySelector('a[href="/como-ler#atencao"]')).not.toBeNull()
    expect(section.querySelectorAll('.figure-key > *').length).toBeGreaterThan(0)
    expect($('attentionNote').classList.contains('note')).toBe(true)
    expect(chart().getAttribute('aria-label')).toBe('Pageviews da Wikipédia e menções por dia')
    expect(chart().tagName).toBe('FIGURE')
    expect(chart().classList.contains('attention-chart')).toBe(true)
  })

  it('AC12: the component source has no {@html}, no <style>, no inline style= except style:--var, and no graphology', () => {
    const src = readFileSync('src/ui/Attention.svelte', 'utf8')
    expect(src).not.toMatch(/\{@html/)
    expect(src).not.toMatch(/<style[\s>]/)
    expect(src).not.toMatch(/\sstyle=/)
    expect(src).not.toMatch(/graphology/)
    for (const m of src.matchAll(/\sstyle:([^=\s>]+)/g)) expect(m[1]).toMatch(/^--/)
  })
})
