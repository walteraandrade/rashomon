import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import Week from '../../src/ui/Week.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { close, isOpen, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { clearScopes } from '../../src/ui/state.js'

type Bucket = { start: string; about: number; terms: { term: string; kind: string; count: number }[] }
const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]
const bucketAt = (i: number, over: Partial<Bucket> = {}): Bucket => ({ start: `2026-09-0${i + 2}T03:00:00.000Z`, about: i + 1, terms: [], ...over })
// Day 1 (qui. 3) carries the picked word; day 3 is a short day (fewer terms than the limit of 8);
// day 6 has no terms at all.
const week = (first: Bucket['terms'] = [{ term: 'reforma', kind: 'word', count: 4 }]) => ({
  days: 7,
  tz: 'America/Sao_Paulo',
  buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i, { terms: i === 6 ? [] : i === 1 ? first : [] })),
})
const rich = () => ({
  days: 7,
  tz: 'America/Sao_Paulo',
  buckets: [
    bucketAt(0, { terms: [{ term: 'flavio', kind: 'word', count: 4 }, { term: 'bola', kind: 'word', count: 2 }, { term: 'água', kind: 'word', count: 2 }] }),
    bucketAt(1, { terms: [{ term: 'reforma', kind: 'word', count: 1 }, { term: 'reforma', kind: 'hashtag', count: 1 }, { term: 'água', kind: 'word', count: 1 }] }),
    bucketAt(2, { terms: [{ term: 'flavio', kind: 'word', count: 2 }, { term: 'bola', kind: 'word', count: 1 }] }),
    bucketAt(3, { terms: [{ term: 'unico', kind: 'word', count: 3 }] }),
    bucketAt(4, { terms: [{ term: 'flavio', kind: 'word', count: 6 }] }),
    bucketAt(5, { about: 0 }),
    bucketAt(6, { about: 0 }),
  ],
})

let target: HTMLElement
let cardTarget: HTMLElement
let instances: ReturnType<typeof mount>[]
let calls: string[]
let hold: boolean
let pending: (() => void)[]
let weekBody: () => unknown
let failWeek: boolean
let observers: { target: Element | null; cb: () => void }[]

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const word = (term = 'reforma', kind = 'word') => all('#weekChart [data-term]').find((e) => e.getAttribute('data-term') === term && e.getAttribute('data-kind') === kind)!
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const weekCalls = () => calls.filter((u) => u.includes('/week'))
const docsCalls = () => calls.filter((u) => u.includes('/docs'))
const qs = (u: string) => new URL(u, 'http://localhost').searchParams
// happy-dom never matches ':checked' on an <option>, and Svelte's bind:value reads the choice
// through exactly that selector, so a bare `el.value = x` binds undefined (the request loses its
// limit and the select falls back to its first option, 5). The shim answers what a browser would.
const select = (id: string, value: string) => {
  const el = $(id) as HTMLSelectElement
  const query = el.querySelector.bind(el)
  el.querySelector = ((sel: string) => (sel === ':checked' ? el.options[el.selectedIndex] : query(sel))) as typeof el.querySelector
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

const boot = (over: Record<string, unknown> = {}) => setBoot({ people, peopleError: null, ready: true, search: '', ...over })

const mountWeek = async (ms = 0) => {
  cardTarget = document.createElement('div')
  document.body.append(cardTarget)
  instances.push(mount(DocsCard, { target: cardTarget }))
  instances.push(mount(Week, { target }))
  flushSync()
  await settle(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  hold = false
  pending = []
  failWeek = false
  weekBody = () => week()
  observers = []
  instances = []
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
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url)
      const respond = () => {
        if (url.includes('/week') && failWeek) return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) }
        const body = url.includes('/week') ? weekBody() : { docs: [], total: 0 }
        return { ok: true, status: 200, headers: new Headers(), json: async () => body }
      }
      return new Promise((resolve) => (hold ? pending.push(() => resolve(respond())) : resolve(respond())))
    }),
  )
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close()
  for (const i of instances) unmount(i)
  target.remove()
  cardTarget?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Week.svelte (#329): a word by day table', () => {
  it('asks /week with days=7, the first person and default limit/source', async () => {
    boot()
    await mountWeek()
    expect(weekCalls()).toHaveLength(1)
    expect(weekCalls()[0]).toMatch(/\/api\/people\/lula\/week\?/)
    const q = qs(weekCalls()[0])
    expect(q.get('days')).toBe('7')
    expect(q.get('limit')).toBe('8')
    expect(q.get('source')).toBe(($('#weekSource') as HTMLSelectElement).value)
  })

  it('a matching seed drives the selects and the request', async () => {
    boot({ search: '?person=bolsonaro&source=bluesky&limit=5' })
    await mountWeek()
    expect(($('#weekPerson') as HTMLSelectElement).value).toBe('bolsonaro')
    expect(($('#weekSource') as HTMLSelectElement).value).toBe('bluesky')
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('5')
    const q = qs(weekCalls()[0])
    expect(weekCalls()[0]).toMatch(/\/people\/bolsonaro\/week/)
    expect(q.get('source')).toBe('bluesky')
    expect(q.get('limit')).toBe('5')
    expect(q.get('days')).toBe('7')
  })

  it('a seed matching no option leaves the defaults', async () => {
    boot({ search: '?person=nobody&source=zzz&limit=99' })
    await mountWeek()
    expect(weekCalls()[0]).toMatch(/\/people\/lula\/week/)
    const q = qs(weekCalls()[0])
    expect(q.get('limit')).toBe('8')
    expect(q.get('source')).not.toBe('zzz')
    expect(q.get('days')).toBe('7')
  })

  it('seeds through the prefix: bare person, week.source and week.limit win; bare days is ignored and days=7 is sent', async () => {
    boot({ search: '?person=bolsonaro&days=60&week.source=gdelt&week.limit=5' })
    await mountWeek()
    expect(($('#weekPerson') as HTMLSelectElement).value).toBe('bolsonaro')
    expect(($('#weekSource') as HTMLSelectElement).value).toBe('gdelt')
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('5')
    expect(weekCalls()[0]).toMatch(/\/people\/bolsonaro\/week/)
    const q = qs(weekCalls()[0])
    expect(q.get('source')).toBe('gdelt')
    expect(q.get('limit')).toBe('5')
    expect(q.get('days')).toBe('7')
  })

  it("a later setBoot never re-seeds: the user's own choice survives", async () => {
    boot({ search: '?person=bolsonaro' })
    await mountWeek()
    select('#weekLimit', '5')
    await settle(200)
    const before = weekCalls().length
    boot({ search: '?person=lula&week.limit=8&week.source=gdelt' })
    await settle(200)
    expect(($('#weekPerson') as HTMLSelectElement).value).toBe('bolsonaro')
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('5')
    expect(($('#weekSource') as HTMLSelectElement).value).toBe('all')
    expect(weekCalls()).toHaveLength(before)
  })

  // The select keeps 12. A spec that reads the last request after picking 12 a second time sees
  // 5 instead: a repeated recorte is answered from the 20 s scope memo with no request, so the
  // last call is still the previous pick.
  it('the limit select keeps 12: a seed of 12 and a fresh pick of 12 both reach the select and the request', async () => {
    boot({ search: '?week.limit=12' })
    await mountWeek()
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('12')
    expect(qs(weekCalls()[0]).get('limit')).toBe('12')
    expect([...($('#weekLimit') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['5', '8', '12'])
    select('#weekLimit', '8')
    await settle(200)
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('8')
    expect(weekCalls().map((u) => qs(u).get('limit'))).toEqual(['12', '8'])
  })

  it('a fresh pick of 12 from the default asks for 12 and the select reads 12 back', async () => {
    boot()
    await mountWeek()
    select('#weekLimit', '12')
    await settle(200)
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('12')
    expect(qs(weekCalls()[1]).get('limit')).toBe('12')
    select('#weekLimit', '5')
    await settle(200)
    select('#weekLimit', '12')
    await settle(200)
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('12')
    expect(weekCalls().map((u) => qs(u).get('limit'))).toEqual(['8', '12', '5'])
    expect($('#week .figure-key').textContent).toMatch(/fora das 12 mais citadas/)
  })

  it('AC1: renders one row per word ordered by weekly total, then term, then kind', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    const heads = all('#weekChart tbody th.week-term').map((e) => e.textContent)
    expect(heads).toEqual(['flavio', 'água', 'bola', 'unico', '#reforma', 'reforma'])
    expect(all('#weekChart tbody tr')).toHaveLength(6)
    expect($('#weekChart table.week-table caption').textContent).toBe('Palavras por dia da semana')
    expect(all('#weekChart tbody th.week-term')[0].getAttribute('title')).toMatch(/Palavra · 12 documentos na semana/)
  })

  it('AC2: heads each day with its label and about, oldest left, a zero day included', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    const heads = all('#weekChart thead th[scope="col"].week-day-head')
    expect(heads).toHaveLength(7)
    expect(all('#weekChart thead th[scope="col"]')).toHaveLength(8)
    expect(heads.map((h) => h.getAttribute('data-day'))).toEqual(['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'])
    expect(heads.map((h) => h.querySelector('.stat dd')!.textContent)).toEqual(['1', '2', '3', '4', '5', '0', '0'])
    expect(heads[1].querySelector('.stat dt')!.textContent).toMatch(/qui\.? 3/)
    expect($('#weekChart').hidden).toBe(false)
  })

  it('AC3: a filled cell is a button with its hooks, the count as text and a level on the week ramp', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    const cell = word('flavio')
    expect(cell.tagName).toBe('BUTTON')
    expect(cell.getAttribute('type')).toBe('button')
    expect(cell.className).toContain('week-cell')
    expect(cell.getAttribute('data-day')).toBe('2026-09-02')
    expect(cell.getAttribute('data-kind')).toBe('word')
    expect(cell.getAttribute('aria-pressed')).toBe('false')
    expect(cell.textContent).toBe('4')
    expect(cell.getAttribute('aria-label')).toMatch(/^flavio, [^:,]+ 2: 4 documentos$/)
    const levels = Object.fromEntries(all('#weekChart button.week-cell').map((b) => [`${b.getAttribute('data-term')}@${b.getAttribute('data-day')}`, b.getAttribute('data-lv')]))
    expect(levels['flavio@2026-09-06']).toBe('5')
    expect(levels['flavio@2026-09-02']).toBe('4')
    expect(levels['flavio@2026-09-04']).toBe('2')
    expect(levels['bola@2026-09-04']).toBe('1')
  })

  it('AC3: one document is spoken in the singular', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    const one = all('#weekChart button.week-cell').find((b) => b.getAttribute('data-term') === 'unico')!
    expect(one.getAttribute('aria-label')).toMatch(/: 3 documentos$/)
    const single = all('#weekChart button.week-cell').find((b) => b.getAttribute('data-term') === 'bola' && b.getAttribute('data-day') === '2026-09-04')!
    expect(single.getAttribute('aria-label')).toMatch(/: 1 documento$/)
  })

  it('AC4: an absent cell is a dashed gap, not a button, not a zero, with no data-term', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    const gaps = all('#weekChart .week-cell.is-gap')
    expect(gaps).toHaveLength(6 * 7 - all('#weekChart button.week-cell').length)
    for (const g of gaps) {
      expect(g.tagName).toBe('SPAN')
      expect(g.getAttribute('data-gap')).toBe('1')
      expect(g.hasAttribute('data-term')).toBe(false)
      expect(g.textContent).toBe('')
      expect(g.getAttribute('role')).toBe('img')
      expect(g.getAttribute('aria-label')).not.toMatch(/\b0\b|documento/)
      expect(g.getAttribute('title')).toBe(g.getAttribute('aria-label'))
    }
    const day = (iso: string) => gaps.filter((g) => g.getAttribute('data-day') === iso)
    expect(day('2026-09-08')).toHaveLength(6)
    expect(day('2026-09-08')[0].getAttribute('aria-label')).toMatch(/não apareceu neste dia$/)
  })

  it('AC4: in a full day an absence reads as outside the top N, in a short day as not appearing', async () => {
    weekBody = () => ({
      days: 7,
      tz: 'America/Sao_Paulo',
      buckets: Array.from({ length: 7 }, (_, i) =>
        bucketAt(i, { terms: i === 0 ? [{ term: 'a', kind: 'word', count: 3 }] : Array.from({ length: 5 }, (_, k) => ({ term: `w${k}`, kind: 'word', count: 5 - k })) }),
      ),
    })
    boot({ search: '?week.limit=5' })
    await mountWeek()
    const gap = (term: string, iso: string) => all('#weekChart .week-cell.is-gap').find((g) => g.getAttribute('aria-label')!.startsWith(term + ',') && g.getAttribute('data-day') === iso)!
    expect(gap('a', '2026-09-03').getAttribute('aria-label')).toMatch(/fora das 5 mais citadas do dia$/)
    expect(gap('w0', '2026-09-02').getAttribute('aria-label')).toMatch(/não apareceu neste dia$/)
  })

  it('AC4: a gap label uses the limit the shown data was loaded with, not the select that is still reloading', async () => {
    const day = (i: number) => ['a', 'b', 'c', 'd', i % 2 ? 'e' : 'f'].map((term, k) => ({ term, kind: 'word', count: 9 - k }))
    weekBody = () => ({ days: 7, tz: 'America/Sao_Paulo', buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i, { terms: day(i) })) })
    boot({ search: '?week.limit=5' })
    await mountWeek()
    const labels = () => all('#weekChart .week-cell.is-gap').map((g) => g.getAttribute('aria-label')!)
    expect(labels()).toHaveLength(7)
    for (const l of labels()) expect(l).toMatch(/: fora das 5 mais citadas do dia$/)
    hold = true
    select('#weekLimit', '12')
    await settle(200)
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('12')
    for (const l of labels()) expect(l, 'the select says 12 but the data on screen was loaded with 5').toMatch(/: fora das 5 mais citadas do dia$/)
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect(qs(weekCalls()[1]).get('limit')).toBe('12')
    for (const l of labels()) expect(l, 'with 12 asked and 5 terms back the day was not cut').toMatch(/: não apareceu neste dia$/)
  })

  it('AC4: a day with fewer terms than 12 says the word did not appear, naming no limit', async () => {
    const terms = (n: number) => Array.from({ length: n }, (_, k) => ({ term: `w${k}`, kind: 'word', count: 20 - k }))
    weekBody = () => ({ days: 7, tz: 'America/Sao_Paulo', buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i, { terms: terms(i === 0 ? 11 : 12) })) })
    boot({ search: '?week.limit=12' })
    await mountWeek()
    expect(($('#weekLimit') as HTMLSelectElement).value).toBe('12')
    expect(qs(weekCalls()[0]).get('limit')).toBe('12')
    const gaps = all('#weekChart .week-cell.is-gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].getAttribute('data-day')).toBe('2026-09-02')
    expect(gaps[0].getAttribute('aria-label')).toMatch(/^w11, [^:,]+ 2: não apareceu neste dia$/)
  })

  it('AC4: a day that carries exactly the limit and lacks a word says outside the top N, with that limit', async () => {
    const terms = (names: string[]) => names.map((term, k) => ({ term, kind: 'word', count: 9 - k }))
    weekBody = () => ({
      days: 7,
      tz: 'America/Sao_Paulo',
      buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i, { terms: terms(i === 3 ? ['a', 'b', 'x', 'y', 'z'] : ['a', 'b', 'c', 'd', 'e']) })),
    })
    boot({ search: '?week.limit=5' })
    await mountWeek()
    const gaps = all('#weekChart .week-cell.is-gap')
    expect(gaps).toHaveLength(21)
    for (const g of gaps) expect(g.getAttribute('aria-label')).toMatch(/: fora das 5 mais citadas do dia$/)
    expect(gaps.filter((g) => g.getAttribute('data-day') === '2026-09-05')).toHaveLength(3)
  })

  it('AC8: changing person or source releases the pick, closes its card and reloads', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    expect(openedBy('week')).toBe(true)
    select('#weekPerson', 'bolsonaro')
    await settle(200)
    expect(openedBy('week')).toBe(false)
    expect(weekCalls()).toHaveLength(2)
    expect(weekCalls()[1]).toMatch(/\/people\/bolsonaro\/week/)
    click(word())
    await settle()
    expect(openedBy('week')).toBe(true)
    select('#weekSource', 'bluesky')
    await settle(200)
    expect(openedBy('week')).toBe(false)
    expect(weekCalls()).toHaveLength(3)
    expect(qs(weekCalls()[2]).get('source')).toBe('bluesky')
  })

  it("AC6: a cell click opens the week card for the person, term, kind, day and source; the kicker names the day", async () => {
    boot({ search: '?source=gdelt' })
    await mountWeek()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(word().className).toContain('is-selected')
    expect(isOpen()).toBe(true)
    expect(openedBy('week')).toBe(true)
    expect(docsCalls()).toHaveLength(1)
    const q = qs(docsCalls()[0])
    expect(docsCalls()[0]).toMatch(/\/api\/people\/lula\/docs/)
    expect(q.get('day')).toBe('2026-09-03')
    expect(q.get('days')).toBe('7')
    expect(q.get('term')).toBe('reforma')
    expect(q.get('kind')).toBe('word')
    expect(q.get('source')).toBe('gdelt')
    expect($('#docsKicker').textContent).toMatch(/palavra/i)
    expect($('#docsKicker').textContent).toMatch(/qui\.? 3/)
  })

  it('AC7: the same cell again releases the pick and closes the card', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('false')
    expect(isOpen()).toBe(false)
  })

  it('AC7: Escape and a click on empty space release the pick and its card', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    escape()
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('false')
    expect(isOpen()).toBe(false)
    click(word())
    await settle()
    expect(isOpen()).toBe(true)
    click($('#weekChart'))
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('false')
    expect(isOpen()).toBe(false)
  })

  it('AC7: a gap cell and a row name count as empty space: they open nothing and release the figure\'s own pick', async () => {
    boot()
    await mountWeek()
    click($('#weekChart .week-cell.is-gap'))
    await settle()
    expect(isOpen()).toBe(false)
    expect(docsCalls()).toHaveLength(0)
    click(word())
    await settle()
    expect(openedBy('week')).toBe(true)
    click($('#weekChart .week-cell.is-gap'))
    await settle()
    expect(isOpen()).toBe(false)
    expect(word().getAttribute('aria-pressed')).toBe('false')
    click(word())
    await settle()
    click($('#weekChart th.week-term'))
    await settle()
    expect(isOpen()).toBe(false)
  })

  it("AC7: Escape and a gap click leave a card another figure opened over the week's", async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    void open({ owner: 'atlas', kicker: 'Documentos', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    escape()
    click($('#weekChart .week-cell.is-gap'))
    await settle()
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
  })

  it('AC8: a control change closes the week card and refetches', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    expect(isOpen()).toBe(true)
    select('#weekLimit', '5')
    expect(isOpen()).toBe(false)
    await settle(200)
    expect(weekCalls()).toHaveLength(2)
    expect(qs(weekCalls()[1]).get('limit')).toBe('5')
  })

  it("AC8: a control change leaves another figure's card open", async () => {
    boot()
    await mountWeek()
    void open({ owner: 'atlas', kicker: 'Documentos', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    expect(openedBy('atlas')).toBe(true)
    select('#weekLimit', '12')
    await settle(200)
    expect(openedBy('atlas')).toBe(true)
    expect(weekCalls()).toHaveLength(2)
  })

  it('AC8: new data without the picked {day, term, kind} drops the pick and its card', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    weekBody = () => week([{ term: 'reforma', kind: 'word', count: 9 }])
    select('#weekLimit', '12')
    await settle(200)
    expect(openedBy('week')).toBe(false)
    expect(word().getAttribute('aria-pressed')).toBe('false')
  })

  it('AC8: a resize repaint carries the same data and never drops the pick or refetches', async () => {
    boot()
    await mountWeek()
    expect(observers.filter((o) => o.target === $('#weekChart'))).toHaveLength(1)
    expect(observers.filter((o) => o.target !== null)).toHaveLength(1)
    click(word())
    await settle()
    const fetches = calls.length
    observers.find((o) => o.target === $('#weekChart'))!.cb()
    await settle()
    expect(calls.length).toBe(fetches)
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(isOpen()).toBe(true)
  })

  it('a click on .figure-sub keeps the card and the pick (chart-scoped release)', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    click($('#week .figure-sub'))
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(openedBy('week')).toBe(true)
  })

  it('a pick made while a control change is still fetching is dropped, with its card, when new data lands', async () => {
    boot()
    await mountWeek()
    hold = true
    weekBody = () => week([{ term: 'reforma', kind: 'word', count: 9 }])
    select('#weekLimit', '12')
    await settle(200)
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(openedBy('week')).toBe(true)
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('false')
    expect(openedBy('week')).toBe(false)
  })

  it('a pick made while a control change is still fetching is dropped, with its card, when that fetch fails', async () => {
    boot()
    await mountWeek()
    hold = true
    select('#weekLimit', '12')
    await settle(200)
    click(word())
    await settle()
    expect(openedBy('week')).toBe(true)
    failWeek = true
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect(openedBy('week')).toBe(false)
    expect(isOpen()).toBe(false)
  })

  it('a failed fetch leaves a card another figure opened alone', async () => {
    boot()
    await mountWeek()
    open({ owner: 'atlas', kicker: 'k', title: 't', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams() }] })
    failWeek = true
    select('#weekLimit', '12')
    await settle(200)
    expect(openedBy('atlas')).toBe(true)
  })

  it('AC10: a week without terms draws no table and says so, the seven about numbers stay out of it', async () => {
    weekBody = () => ({ days: 7, tz: 'America/Sao_Paulo', buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i)) })
    boot()
    await mountWeek()
    expect($('#weekChart table.week-table')).toBeNull()
    expect($('#weekChart .week-ghost')).toBeNull()
    expect(all('#weekChart [data-term]')).toHaveLength(0)
    expect($('#weekNote').textContent).toBe('Não há palavras suficientes nesta semana.')
  })

  it('AC10: a failed fetch replaces the ghost with the note and a later resize paints nothing stale', async () => {
    failWeek = true
    boot()
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Não foi possível carregar a semana.')
    expect($('#weekChart .ghost-field')).toBeNull()
    observers.find((o) => o.target === $('#weekChart'))?.cb()
    await settle()
    expect(all('#weekChart [data-term]')).toHaveLength(0)
    expect($('#weekChart table')).toBeNull()
    expect($('#weekNote').textContent).toBe('Não foi possível carregar a semana.')
  })

  it('AC10: peopleError shows the outage note and fetches nothing', async () => {
    boot({ people: [], peopleError: new Error('boom') })
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Falha de rede ou base indisponível.')
    expect(calls).toHaveLength(0)
  })

  it('AC10: an empty people list shows the registry note and fetches nothing', async () => {
    boot({ people: [] })
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Nenhuma pessoa cadastrada.')
    expect(calls).toHaveLength(0)
  })

  it('AC9: before bootData.ready the ghost rows show and nothing is fetched; after ready it loads', async () => {
    await mountWeek()
    expect($('#weekChart .week-ghost')).not.toBeNull()
    expect(all('#weekChart .week-ghost-row')).toHaveLength(6)
    expect(all('#weekChart .week-ghost-row')[0].querySelectorAll('.week-cell.ghost')).toHaveLength(7)
    expect($('#weekChart .week-ghost').getAttribute('aria-hidden')).toBe('true')
    expect($('#weekChart').getAttribute('aria-busy')).toBe('true')
    expect($('#weekChart .sr-only').textContent).toBe('Lendo a semana.')
    expect($('#weekNote').textContent).toBe('')
    expect(calls).toHaveLength(0)
    boot()
    await settle()
    expect(weekCalls()).toHaveLength(1)
    expect($('#weekChart .week-ghost')).toBeNull()
    expect(all('#weekChart thead th.week-day-head')).toHaveLength(7)
  })

  it('AC9: the first load ghosts the chart, a reload with data on screen only dims the figure', async () => {
    boot()
    hold = true
    await mountWeek()
    expect($('#weekChart .week-ghost')).not.toBeNull()
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect($('#week').classList.contains('is-loading')).toBe(false)
    hold = true
    select('#weekLimit', '5')
    await settle(200)
    expect($('#week').classList.contains('is-loading')).toBe(true)
    expect($('#weekChart .week-ghost')).toBeNull()
    expect(all('#weekChart thead th.week-day-head')).toHaveLength(7)
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect($('#week').classList.contains('is-loading')).toBe(false)
  })

  it('draws no svg, no inline style and no Carregando', async () => {
    weekBody = rich
    boot()
    await mountWeek()
    expect($('#weekChart svg')).toBeNull()
    expect($('#weekChart [style]')).toBeNull()
    expect($('#weekChart').textContent).not.toMatch(/Carregando/)
  })

  it('AC12: the mounted section keeps the hooks of the prerendered section and a four-row key', async () => {
    boot()
    await mountWeek()
    const section = $('#week')
    expect(section.tagName).toBe('SECTION')
    expect(section.className).toMatch(/\bfigure\b/)
    expect(section.className).toMatch(/\bweek\b/)
    expect(section.getAttribute('aria-labelledby')).toBe('weekTitle')
    expect($('#weekTitle').textContent).toBe('A semana')
    expect([...section.querySelectorAll('.figure-key dt')].map((e) => e.textContent)).toEqual(['Palavra', 'Célula', 'Vazia', 'Clique'])
    expect(section.querySelector('.figure-key .week-gap-swatch')).not.toBeNull()
    expect(section.querySelectorAll('.figure-key dd')[2].textContent).toBe('fora das 8 mais citadas do dia; não é zero')
    expect(section.querySelectorAll('.sentence-line .pick')).toHaveLength(3)
    for (const id of ['weekPerson', 'weekSource', 'weekLimit']) expect(section.querySelector(`.sentence-line #${id}`)).not.toBeNull()
    expect(section.querySelector('#weekDays')).toBeNull()
    expect($('#weekChart').className).toContain('week-chart')
    expect($('#weekChart').getAttribute('aria-label')).toBeTruthy()
    expect($('#weekNote').className).toBe('note')
  })

  it('the key follows the limit of the data on screen, not the select it is still reloading', async () => {
    boot()
    await mountWeek()
    hold = true
    select('#weekLimit', '5')
    await settle(200)
    expect($('#week .figure-key').textContent).toMatch(/fora das 8 mais citadas/)
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect($('#week .figure-key').textContent).toMatch(/fora das 5 mais citadas/)
  })
})
