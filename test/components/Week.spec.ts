import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import Week from '../../src/ui/Week.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { close, isOpen, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { weekLayout } from '../../src/ui/layout.js'
import { clearScopes } from '../../src/ui/state.js'

vi.mock('../../src/ui/measure.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/measure.js')>()),
  createCanvasMeasure: () => (text: string, size: number) => text.length * size * 0.6,
}))

type Bucket = { start: string; about: number; terms: { term: string; kind: string; count: number }[] }
const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]
const bucketAt = (i: number, over: Partial<Bucket> = {}): Bucket => ({ start: `2026-09-0${i + 2}T03:00:00.000Z`, about: i + 1, terms: [], ...over })
const week = (first: Bucket['terms'] = [{ term: 'reforma', kind: 'word', count: 4 }]) => ({
  days: 7,
  tz: 'America/Sao_Paulo',
  buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i, { terms: i === 6 ? [] : i === 1 ? first : [] })),
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
let colWidth: number
let chartWidth: number

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const word = (term = 'reforma') => all('#weekChart [data-term]').find((e) => e.getAttribute('data-term') === term)!
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const weekCalls = () => calls.filter((u) => u.includes('/week'))
const docsCalls = () => calls.filter((u) => u.includes('/docs'))
const qs = (u: string) => new URL(u, 'http://localhost').searchParams
const select = (id: string, value: string) => {
  const el = $(id) as HTMLSelectElement
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
  colWidth = 300
  chartWidth = 900
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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('week-day') ? colWidth : this.id === 'weekChart' ? chartWidth : 0
    },
  })
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
  delete (HTMLElement.prototype as any).clientWidth
})

describe('Week.svelte (#291)', () => {
  it('AC3/AC4: asks /week with days=7, the first person and default limit/source', async () => {
    boot()
    await mountWeek()
    expect(weekCalls()).toHaveLength(1)
    expect(weekCalls()[0]).toMatch(/\/api\/people\/lula\/week\?/)
    const q = qs(weekCalls()[0])
    expect(q.get('days')).toBe('7')
    expect(q.get('limit')).toBe('8')
    expect(q.get('source')).toBe(($('#weekSource') as HTMLSelectElement).value)
  })

  it('AC4: a matching seed drives the selects and the request', async () => {
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

  it('AC4: a seed matching no option leaves the defaults', async () => {
    boot({ search: '?person=nobody&source=zzz&limit=99' })
    await mountWeek()
    expect(weekCalls()[0]).toMatch(/\/people\/lula\/week/)
    const q = qs(weekCalls()[0])
    expect(q.get('limit')).toBe('8')
    expect(q.get('source')).not.toBe('zzz')
    expect(q.get('days')).toBe('7')
  })

  it('AC5: paints seven columns oldest left, each with about, and word marks with their hooks', async () => {
    boot()
    await mountWeek()
    const cols = all('#weekChart .week-day')
    expect(cols).toHaveLength(7)
    cols.forEach((c, i) => expect(c.querySelector('.stat dd')!.textContent).toBe(String(i + 1)))
    const mark = word()
    expect(mark.getAttribute('data-day')).toBe('2026-09-03')
    expect(mark.getAttribute('data-kind')).toBe('word')
    expect(mark.getAttribute('aria-pressed')).toBe('false')
    expect(mark.getAttribute('tabindex')).toBe('0')
    expect(mark.getAttribute('role')).toBe('button')
    expect(mark.querySelector('title')!.textContent).toContain('reforma')
    expect($('#weekChart').hidden).toBe(false)
  })

  it('AC6: a pick sets aria-pressed and opens the week card with day, days=7, term, kind and source; the kicker names the day', async () => {
    boot({ search: '?source=gdelt' })
    await mountWeek()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(isOpen()).toBe(true)
    expect(openedBy('week')).toBe(true)
    expect(($('#docsDialog') as HTMLDialogElement).open).toBe(true)
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

  it('AC6: clicking the same word again releases the pick and closes the card', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('false')
    expect(isOpen()).toBe(false)
  })

  it('AC6: Enter and Space on a word pick it', async () => {
    boot()
    await mountWeek()
    key(word(), 'Enter')
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(openedBy('week')).toBe(true)
    key(word(), 'Escape')
    escape()
    await settle()
    expect(openedBy('week')).toBe(false)
    key(word(), ' ')
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(openedBy('week')).toBe(true)
  })

  it('AC7: a control change closes the week card and refetches', async () => {
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

  it("AC7: a control change leaves another figure's card open", async () => {
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

  it('AC8: Escape and a background click release the pick and its card', async () => {
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

  it("AC8: Escape and background click leave a card the atlas opened over the week's", async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    void open({ owner: 'atlas', kicker: 'Documentos', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    escape()
    click($('#weekChart'))
    await settle()
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
  })

  it('AC9: a resize keeps the pick, fetches nothing, and only one ResizeObserver watches #weekChart', async () => {
    boot()
    await mountWeek()
    expect(observers.filter((o) => o.target === $('#weekChart'))).toHaveLength(1)
    expect(observers.filter((o) => o.target !== null)).toHaveLength(1)
    click(word())
    await settle()
    const fetches = calls.length
    const before = $('#weekChart .week-svg').getAttribute('width')
    colWidth = 200
    chartWidth = 700
    observers.find((o) => o.target === $('#weekChart'))!.cb()
    await settle()
    expect(calls.length).toBe(fetches)
    expect(word().getAttribute('aria-pressed')).toBe('true')
    expect(isOpen()).toBe(true)
    expect($('#weekChart .week-svg').getAttribute('width')).toBe('200')
    expect(before).toBe('300')
  })

  it('AC9: a resize with an unchanged chart width repaints nothing', async () => {
    boot()
    await mountWeek()
    const obs = observers.find((o) => o.target === $('#weekChart'))!
    obs.cb()
    await settle()
    colWidth = 150
    obs.cb()
    await settle()
    expect($('#weekChart .week-svg').getAttribute('width')).toBe('300')
  })

  it('AC10: a new dataset clears the pick', async () => {
    boot()
    await mountWeek()
    click(word())
    await settle()
    expect(word().getAttribute('aria-pressed')).toBe('true')
    weekBody = () => week([{ term: 'reforma', kind: 'word', count: 9 }])
    select('#weekLimit', '12')
    await settle(200)
    expect(word().getAttribute('aria-pressed')).toBe('false')
  })

  it('a click on .figure-sub or a select change keeps the card and the pick only until the data changes (chart-scoped release)', async () => {
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

  it('AC11: a week without terms shows the seven about numbers and the note', async () => {
    weekBody = () => ({ days: 7, tz: 'America/Sao_Paulo', buckets: Array.from({ length: 7 }, (_, i) => bucketAt(i)) })
    boot()
    await mountWeek()
    expect(all('#weekChart [data-term]')).toHaveLength(0)
    expect(all('#weekChart .stat dd').map((e) => e.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect($('#weekNote').textContent).toBe('Não há palavras suficientes nesta semana.')
  })

  it('AC12: a failed fetch replaces the ghost with the note and a later resize paints nothing stale', async () => {
    failWeek = true
    boot()
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Não foi possível carregar a semana.')
    expect($('#weekChart .ghost-field')).toBeNull()
    colWidth = 200
    chartWidth = 700
    observers.find((o) => o.target === $('#weekChart'))?.cb()
    await settle()
    expect(all('#weekChart [data-term]')).toHaveLength(0)
    expect($('#weekChart .ghost-field')).toBeNull()
    expect($('#weekNote').textContent).toBe('Não foi possível carregar a semana.')
  })

  it('AC13: peopleError shows the outage note and fetches nothing', async () => {
    boot({ people: [], peopleError: new Error('boom') })
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Falha de rede ou base indisponível.')
    expect(calls).toHaveLength(0)
  })

  it('AC13: an empty people list shows the registry note and fetches nothing', async () => {
    boot({ people: [] })
    await mountWeek()
    expect($('#weekNote').textContent).toBe('Nenhuma pessoa cadastrada.')
    expect(calls).toHaveLength(0)
  })

  it('AC14: before bootData.ready the ghost shows and nothing is fetched; after ready it loads', async () => {
    await mountWeek()
    expect($('#weekChart .ghost-field')).not.toBeNull()
    expect($('#weekChart').getAttribute('aria-busy')).toBe('true')
    expect($('#weekNote').textContent).toBe('')
    expect(calls).toHaveLength(0)
    boot()
    await settle()
    expect(weekCalls()).toHaveLength(1)
    expect($('#weekChart .ghost-field')).toBeNull()
    expect(all('#weekChart .week-day')).toHaveLength(7)
  })

  it('AC15: first load ghosts the chart, a reload with data on screen only dims the figure', async () => {
    boot()
    hold = true
    await mountWeek()
    expect($('#weekChart .ghost-field')).not.toBeNull()
    expect($('#weekChart .sr-only')!.textContent).toBe('Lendo a semana.')
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect($('#week').classList.contains('is-loading')).toBe(false)
    hold = true
    select('#weekLimit', '5')
    await settle(200)
    expect($('#week').classList.contains('is-loading')).toBe(true)
    expect($('#weekChart .ghost-field')).toBeNull()
    expect(all('#weekChart .week-day')).toHaveLength(7)
    hold = false
    pending.splice(0).forEach((f) => f())
    await settle()
    expect($('#week').classList.contains('is-loading')).toBe(false)
  })

  it('a word wider than its column goes to that column\'s .week-overflow list', async () => {
    weekBody = () => week([{ term: 'pronunciamento', kind: 'word', count: 55 }])
    colWidth = 84
    boot()
    await mountWeek()
    const list = $('#weekChart .week-overflow')
    expect(list).not.toBeNull()
    const btn = list.querySelector('button')!
    expect(btn.getAttribute('data-term')).toBe('pronunciamento')
    expect(btn.textContent).toContain('pronunciamento')
    expect(btn.querySelector('b')!.textContent).toBe('55')
    click(btn)
    await settle()
    expect(openedBy('week')).toBe(true)
    expect(qs(docsCalls()[0]).get('day')).toBe('2026-09-03')
  })

  it('one overflowing word is named in the singular; several in the plural, with no "nesta coluna" prose', async () => {
    colWidth = 84
    weekBody = () => week([{ term: 'pronunciamento', kind: 'word', count: 55 }])
    boot()
    await mountWeek()
    expect($('#weekChart .week-overflow .eyebrow').textContent).toBe('Não coube')
    expect($('#weekChart .week-overflow').textContent).not.toMatch(/nesta coluna|clicáveis/)
    weekBody = () => week([{ term: 'pronunciamento', kind: 'word', count: 55 }, { term: 'constitucionalidade', kind: 'word', count: 40 }])
    select('#weekLimit', '12')
    await settle(200)
    expect($('#weekChart .week-overflow .eyebrow').textContent).toBe('Não couberam')
    expect($('#weekChart .week-overflow').textContent).not.toMatch(/nesta coluna|clicáveis/)
  })

  it('a wrapped phrase is one mark with one tspan per line, still one data-term, drawn not listed', async () => {
    colWidth = 145
    weekBody = () => week([{ term: 'supremo tribunal federal', kind: 'phrase', count: 55 }])
    boot()
    await mountWeek()
    const marks = all('#weekChart [data-term="supremo tribunal federal"]')
    expect(marks).toHaveLength(1)
    expect([...marks[0].querySelectorAll('.week-text tspan')].map((t) => t.textContent)).toEqual(['supremo', 'tribunal', 'federal'])
    expect($('#weekChart .week-overflow')).toBeNull()
  })

  it('a bucket with no terms paints only its about number: no svg, no paragraph', async () => {
    weekBody = () => ({ days: 7, tz: 'America/Sao_Paulo', buckets: [bucketAt(0, { about: 4 })] })
    boot()
    await mountWeek()
    const day = $('#weekChart .week-day')
    expect(day.querySelector('dd')!.textContent).toBe('4')
    expect(day.querySelector('.week-svg')).toBeNull()
    expect(day.querySelector('p')).toBeNull()
  })

  it('every style attribute a mark emits is a --var override, never a hardcoded declaration', async () => {
    boot()
    await mountWeek()
    const styles = all('#weekChart [style]').map((e) => e.getAttribute('style')!)
    expect(styles.length).toBeGreaterThan(0)
    for (const value of styles) expect(value.trim().startsWith('--')).toBe(true)
  })

  it('every ghost mark sits inside its svg and the ghost never says Carregando', async () => {
    await mountWeek()
    const svg = $('#weekChart .week-svg')
    const height = Number(svg.getAttribute('height'))
    const rects = [...svg.querySelectorAll('rect.ghost')]
    expect(rects.length).toBeGreaterThanOrEqual(3)
    for (const r of rects) {
      const y = Number(r.getAttribute('y'))
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y + Number(r.getAttribute('height'))).toBeLessThanOrEqual(height)
    }
    expect($('#weekChart').textContent).not.toMatch(/Carregando/)
    expect(all('#weekChart .week-day')).toHaveLength(7)
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

  it('a later setBoot never re-seeds: the user\'s own choice survives', async () => {
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

  it('word marks and hit areas carry no rx: the glow and the hit box are square', async () => {
    boot()
    await mountWeek()
    const shapes = all('#weekChart .week-glow, #weekChart .week-hit')
    expect(shapes.length).toBeGreaterThan(0)
    for (const r of shapes) expect(r.hasAttribute('rx')).toBe(false)
  })

  it('a11y hooks: per-day svg group label, title with kind and count, overflow aria-pressed, Enter and Space preventDefault', async () => {
    boot()
    await mountWeek()
    expect($('#weekChart .week-svg').getAttribute('role')).toBe('group')
    expect($('#weekChart .week-svg').getAttribute('aria-label')).toMatch(/^Palavras de /)
    expect(word().getAttribute('aria-label')).toBe('reforma, 4 documentos neste dia')
    expect(word().querySelector('title')!.textContent).toBe('reforma · Palavra · 4 documentos')
    for (const k of ['Enter', ' ']) {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      word().dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(true)
      flushSync()
      click(word())
      await settle()
    }
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    word().dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
  })

  it('an overflow button carries aria-pressed and follows the pick', async () => {
    colWidth = 84
    weekBody = () => week([{ term: 'pronunciamento', kind: 'word', count: 55 }])
    boot()
    await mountWeek()
    const btn = () => $('#weekChart .week-overflow button')
    expect(btn().getAttribute('aria-pressed')).toBe('false')
    click(btn())
    await settle()
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    expect(btn().className).toContain('is-selected')
  })

  it('places a word at the column centre plus its layout x, and the layout half plus its y', async () => {
    boot()
    await mountWeek()
    const measure = (text: string, size: number) => text.length * size * 0.6
    const layouts = weekLayout(measure as never, week().buckets.map((b) => b.terms), 300)
    const d = layouts[1].words.find((w) => w.term === 'reforma')!
    expect(word().getAttribute('transform')).toBe(`translate(${300 / 2 + d.x},${layouts[1].half + d.y})`)
  })

  it('AC16: the mounted section keeps every hook of the prerendered week section', async () => {
    boot()
    await mountWeek()
    const section = $('#week')
    expect(section.tagName).toBe('SECTION')
    expect(section.className).toMatch(/\bfigure\b/)
    expect(section.className).toMatch(/\bweek\b/)
    expect(section.getAttribute('aria-labelledby')).toBe('weekTitle')
    expect(section.querySelector('.figure-head .eyebrow')!.textContent).toBe('Gráfico 5')
    expect($('#weekTitle').textContent).toBe('A semana')
    expect(section.querySelectorAll('.figure-key dt')).toHaveLength(3)
    expect(section.querySelectorAll('.sentence-line .pick')).toHaveLength(3)
    for (const id of ['weekPerson', 'weekSource', 'weekLimit']) expect(section.querySelector(`.sentence-line #${id}`)).not.toBeNull()
    expect(section.querySelector('#weekDays')).toBeNull()
    expect($('#weekChart').className).toContain('week-chart')
    expect($('#weekChart').getAttribute('aria-label')).toBeTruthy()
    expect($('#weekNote').className).toBe('note')
  })
})
