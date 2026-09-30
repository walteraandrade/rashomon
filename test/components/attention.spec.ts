import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Attention from '../../src/ui/Attention.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { close, mountDocsCard, openedBy, open } from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { ATLAS_KINDS, attentionParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'

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
    expect(chart().classList.contains('is-loading')).toBe(true)
    expect(chart().querySelector('.ghost, .ghost-field')).not.toBeNull()
    expect(chart().textContent).not.toMatch(/Carregando/)
    respond('/attention', att([{ day: '2026-08-15', views: 10 }]))
    respond('/timeline', [bucket('2026-08-15', 1)])
    await settle()
    expect(chart().getAttribute('aria-busy')).not.toBe('true')
    expect(chart().classList.contains('is-loading')).toBe(false)
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
