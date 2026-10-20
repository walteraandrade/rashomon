import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Compare from '../../src/ui/Compare.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import * as docsCard from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { compareParams, lensesParams, sourcesParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'
import { SOURCES } from '../../src/query.js'
import type { Compare as CompareData, CompareTerm, Lenses as LensesData } from '../../src/ui/format.js'

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const ciro = { id: 'ciro', name: 'Ciro' }
const people = [lula, bolsonaro]

const side = (count: number, pmi = 1) => ({ count, pmi, tone: null })
const reforma: CompareTerm = { term: 'reforma', kind: 'word', a: side(5, 1.2), b: null }
const payload = (terms: CompareTerm[], a = lula, b = bolsonaro): CompareData => ({ days: 21, a: { person: a, about: 412 }, b: { person: b, about: 168 }, terms })
const lensPayload = (terms: CompareTerm[], a = 'source:bluesky', b = 'source:gnews', about: [number, number] = [412, 168]): LensesData => ({ days: 21, a: { lens: a, about: about[0] }, b: { lens: b, about: about[1] }, terms })
const folha = { domain: 'folha.uol.com.br', docs: 12 }
const g1 = { domain: 'g1.globo.com', docs: 4 }

type Call = { url: string; path: string; route: string; person: string; params: URLSearchParams; signal?: AbortSignal }
type Handler = (call: Call) => unknown
let calls: Call[]
let handlers: Record<string, Handler>
let width: number
let observers: { cb: () => void; target: unknown }[]
let target: HTMLElement
let instances: ReturnType<typeof mount>[]

const $ = (id: string) => document.getElementById(id) as HTMLElement
const select = (id: string) => $(id) as HTMLSelectElement
const rows = () => [...$('compareRuler').querySelectorAll('[data-term]')] as HTMLElement[]
const compareCalls = () => calls.filter((c) => c.path === '/api/compare')
const input = (id: string) => $(id) as HTMLInputElement
const of = (route: string) => calls.filter((c) => c.route === route)
const lensCalls = () => of('lenses')
const outletValues = (id: string) => [...$(id).querySelectorAll('option')].map((o) => o.value)

const echo: Handler = (call) => lensPayload([reforma], call.params.get('a') ?? 'all', call.params.get('b') ?? 'all')

const held = () => {
  let release: (v: unknown) => void = () => {}
  let fail: (e: unknown) => void = () => {}
  const promise = new Promise((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release: (v: unknown) => release(v), fail: (e: unknown) => fail(e) }
}

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}

const change = async (id: string, value: string) => {
  select(id).value = value
  select(id).dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  await settle(220)
}

const click = (el: Element) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}

const keydown = (el: Element, key: string) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  flushSync()
  return e
}

const escape = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
}

const boot = (patch: Partial<{ ready: boolean; people: typeof people; peopleError: unknown; search: string }> = {}) =>
  setBoot({ ready: true, people, peopleError: null, search: '', ...patch })

const start = async () => {
  instances.push(mount(Compare, { target }))
  instances.push(mount(DocsCard, { target }))
  flushSync()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  handlers = {
    '/api/compare': () => payload([reforma]),
    '/api/compare/bridges': () => ({ bridges: {} }),
    lenses: echo,
    sources: () => [folha, g1],
    bridges: () => ({ bridges: {} }),
  }
  width = 600
  observers = []
  instances = []
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  ;(globalThis as any).ResizeObserver = class {
    cb: () => void
    constructor(cb: () => void) {
      this.cb = cb
    }
    observe(el: unknown) {
      observers.push({ cb: this.cb, target: el })
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }) }),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      const u = new URL(url, 'http://localhost')
      const m = /^\/api\/people\/([^/]+)\/(lenses\/bridges|lenses|sources|docs)$/.exec(u.pathname)
      const route = m ? (m[2] === 'lenses/bridges' ? 'bridges' : m[2]) : u.pathname
      const call: Call = { url, path: u.pathname, route, person: m?.[1] ?? '', params: u.searchParams, signal: init?.signal }
      calls.push(call)
      const body = await (handlers[u.pathname] ?? handlers[route] ?? (() => ({ docs: [], total: 0 })))(call)
      return { ok: true, status: 200, headers: new Headers(), json: async () => body }
    }),
  )
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  for (const i of instances) unmount(i)
  instances = []
  target.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Compare (#293)', () => {
  it('AC1: the request URL is exactly what compareParams builds for the controls', async () => {
    boot()
    await start()
    expect(compareCalls()).toHaveLength(1)
    const expected = compareParams({
      a: select('compareA').value,
      b: select('compareB').value,
      days: select('compareDays').value,
      source: select('compareSource').value,
      limit: select('compareLimit').value,
    })
    expect(compareCalls()[0].url).toBe('/api/compare?' + expected.toString())
    expect(compareCalls()[0].params.get('a')).toBe('lula')
    expect(compareCalls()[0].params.get('b')).toBe('bolsonaro')
    expect(compareCalls()[0].params.has('measure')).toBe(false)
  })

  it('AC2: one keyboard row per drawn term with data-term, data-kind, aria-pressed=false and an aria-label; no overflow list', async () => {
    const terms: CompareTerm[] = Array.from({ length: 10 }, (_, i) => ({ term: `palavralongademais${i}`, kind: i % 2 ? 'hashtag' : 'word', a: side(3 + (i % 9)), b: i % 3 ? side(2) : null }))
    handlers['/api/compare'] = () => payload(terms)
    boot()
    await start()
    expect(rows()).toHaveLength(terms.length)
    for (const w of rows()) {
      expect(w.getAttribute('data-term')).toBeTruthy()
      expect(['word', 'hashtag']).toContain(w.getAttribute('data-kind'))
      expect(w.getAttribute('aria-pressed')).toBe('false')
      expect(w.getAttribute('aria-label')).toMatch(/documentos/)
    }
    expect($('compareRuler').querySelector('[class*="overflow"]')).toBeNull()
  })

  it('AC3: a click picks the word and opens the card once with both people, owned by compare', async () => {
    boot()
    await start()
    click(rows()[0])
    await settle()
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('compare')).toBe(true)
    const docsCalls = calls.filter((c) => c.path.endsWith('/docs'))
    expect(docsCalls.map((c) => c.path).sort()).toEqual(['/api/people/bolsonaro/docs', '/api/people/lula/docs'])
    for (const c of docsCalls) expect(c.params.get('term')).toBe('reforma')
  })

  for (const key of ['Enter', ' ']) {
    it(`AC3: pressing ${key === ' ' ? 'Space' : key} on a word picks it and prevents the default`, async () => {
      boot()
      await start()
      const e = keydown(rows()[0], key)
      expect(e.defaultPrevented).toBe(true)
      await settle()
      expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
      expect(docsCard.openedBy('compare')).toBe(true)
    })
  }

  it('AC3: the same word again, the background and Escape each clear the pick and close the card', async () => {
    boot()
    await start()
    const releasers: [string, () => void][] = [
      ['same word', () => click(rows()[0])],
      ['background', () => click($('compareRuler'))],
      ['escape', escape],
    ]
    for (const [name, release] of releasers) {
      click(rows()[0])
      await settle()
      expect(docsCard.openedBy('compare'), `${name}: open`).toBe(true)
      release()
      await settle()
      expect(docsCard.isOpen(), `${name}: card closed`).toBe(false)
      expect(rows()[0].getAttribute('aria-pressed'), `${name}: unpicked`).toBe('false')
      expect($('compareDetail').textContent).toMatch(/Clique numa palavra/)
    }
  })

  it('AC3: a group header, an axis and a bar-side gutter each count as empty space and release the pick', async () => {
    boot()
    await start()
    for (const selector of ['.butterfly-group-head', '.butterfly-axis', '.butterfly-axes', '.butterfly-group']) {
      click(rows()[0])
      await settle()
      expect(docsCard.openedBy('compare'), selector).toBe(true)
      click($('compareRuler').querySelector(selector)!)
      await settle()
      expect(docsCard.isOpen(), selector).toBe(false)
      expect(rows()[0].getAttribute('aria-pressed')).toBe('false')
      expect(rows()[0].classList.contains('is-selected')).toBe(false)
    }
  })

  it('AC3: a picked row is is-selected and the card carries the figure days and source', async () => {
    boot({ search: '?days=7&source=gdelt' })
    await start()
    click(rows()[0])
    await settle()
    expect(rows()[0].classList.contains('is-selected')).toBe(true)
    const docs = calls.filter((c) => c.path.endsWith('/docs'))
    expect(docs).toHaveLength(2)
    for (const c of docs) {
      expect(c.params.get('days')).toBe('7')
      expect(c.params.get('source')).toBe('gdelt')
    }
  })

  it('AC4: a control change leaves a card another figure opened over a compare pick', async () => {
    boot()
    await start()
    click(rows()[0])
    await settle()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '21' }) }] })
    await settle()
    expect(docsCard.openedBy('compare')).toBe(false)
    await change('compareDays', '7')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('AC4: a control change closes the card compare owns', async () => {
    boot()
    await start()
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    await change('compareDays', '7')
    expect(docsCard.isOpen()).toBe(false)
  })

  const measureTerms: CompareTerm[] = Array.from({ length: 25 }, (_, i) => ({ term: `w${i}`, kind: 'word', a: side(30 - i, 1 + i), b: null }))

  it('AC5: changing the measure re-derives the rows and issues no fetch, keeping the pick', async () => {
    handlers['/api/compare'] = () => payload(measureTerms)
    boot()
    await start()
    expect(rows().map((r) => r.getAttribute('data-term'))).toContain('w0')
    click(rows().find((r) => r.getAttribute('data-term') === 'w10')!)
    await settle()
    clearScopes()
    const before = calls.length
    const markup = $('compareRuler').innerHTML
    await change('compareMeasure', 'pmi')
    expect(calls.length).toBe(before)
    expect($('compareRuler').innerHTML).not.toBe(markup)
    expect(rows().map((r) => r.getAttribute('data-term'))).not.toContain('w0')
    expect($('compareDetail').textContent).toMatch(/w10/)
    expect(rows().find((r) => r.getAttribute('data-term') === 'w10')!.getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.openedBy('compare')).toBe(true)
  })

  it('a pick that the new measure no longer draws keeps the detail line but no pressed row', async () => {
    handlers['/api/compare'] = () => payload(measureTerms)
    boot()
    await start()
    click(rows().find((r) => r.getAttribute('data-term') === 'w0')!)
    await settle()
    await change('compareMeasure', 'pmi')
    expect(rows().some((r) => r.getAttribute('aria-pressed') === 'true')).toBe(false)
    expect($('compareDetail').textContent).toMatch(/w0/)
  })

  for (const [id, value] of [
    ['compareA', 'bolsonaro'],
    ['compareB', 'lula'],
    ['compareDays', '7'],
    ['compareSource', 'bluesky'],
    ['compareLimit', '100'],
  ]) {
    it(`AC5: changing #${id} issues exactly one /api/compare fetch and none for other figures`, async () => {
      boot()
      await start()
      const before = calls.length
      await change(id, value)
      const added = calls.slice(before)
      expect(added.filter((c) => c.path === '/api/compare')).toHaveLength(1)
      expect(added.filter((c) => !c.path.startsWith('/api/compare'))).toEqual([])
    })
  }

  it('AC6: limit options are exactly 20/40/60/100 (as figures/compare.ts offered), default 20, and a ?limit= seed selects it', async () => {
    boot()
    await start()
    const options = [...select('compareLimit').options].map((o) => Number(o.value))
    expect(options).toEqual([20, 40, 60, 100])
    expect(select('compareLimit').value).toBe('20')
    for (const i of instances) unmount(i)
    instances = []
    document.body.innerHTML = ''
    target = document.createElement('div')
    document.body.append(target)
    clearScopes()
    calls = []
    boot({ search: '?limit=60' })
    await start()
    expect(select('compareLimit').value).toBe('60')
    expect(compareCalls()[0].params.get('limit')).toBe('60')
  })

  it('AC7: ?person= seeds A only; B is the first other person', async () => {
    boot({ people: [lula, bolsonaro, ciro], search: '?person=bolsonaro' })
    await start()
    expect(select('compareA').value).toBe('bolsonaro')
    expect(select('compareB').value).toBe('lula')
    expect(compareCalls()[0].params.get('a')).toBe('bolsonaro')
    expect(compareCalls()[0].params.get('b')).toBe('lula')
  })

  it('AC7: only compare.b seeds B, a bare b= does not', async () => {
    boot({ people: [lula, bolsonaro, ciro], search: '?b=ciro' })
    await start()
    expect(select('compareB').value).toBe('bolsonaro')
    for (const i of instances) unmount(i)
    instances = []
    document.body.innerHTML = ''
    target = document.createElement('div')
    document.body.append(target)
    clearScopes()
    boot({ people: [lula, bolsonaro, ciro], search: '?compare.b=ciro' })
    await start()
    expect(select('compareB').value).toBe('ciro')
  })

  it('AC7: a single tracked person is both A and B', async () => {
    boot({ people: [lula] })
    await start()
    expect(select('compareA').value).toBe('lula')
    expect(select('compareB').value).toBe('lula')
  })

  it('AC24: the period select offers exactly 7 and 21 with 21 selected, and the first /compare carries days=21', async () => {
    boot()
    await start()
    expect([...select('compareDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('compareDays').options].map((o) => o.textContent)).toEqual(['últimos 7 dias', 'últimos 21 dias'])
    expect(select('compareDays').value).toBe('21')
    expect(compareCalls()[0].params.get('days')).toBe('21')
  })

  it('AC7: days, source, limit and measure seed, and the first fetch sends them', async () => {
    boot({ search: '?days=7&source=gdelt&limit=40&compare.measure=pmi' })
    await start()
    expect(select('compareDays').value).toBe('7')
    expect(select('compareSource').value).toBe('gdelt')
    expect(select('compareLimit').value).toBe('40')
    expect(select('compareMeasure').value).toBe('pmi')
    const first = compareCalls()[0].params
    expect(first.get('days')).toBe('7')
    expect(first.get('source')).toBe('gdelt')
    expect(first.get('limit')).toBe('40')
  })

  it('AC7: a prefixed key overrides the bare one for this figure only', async () => {
    boot({ search: '?days=21&compare.days=7' })
    await start()
    expect(select('compareDays').value).toBe('7')
  })

  it('AC8: #compareStatus is visible iff A and B resolve to the same person', async () => {
    handlers['/api/compare'] = () => payload([], lula, lula)
    boot()
    await start()
    expect($('compareStatus').hidden).toBe(true)
    await change('compareB', 'lula')
    expect($('compareStatus').hidden).toBe(false)
    expect($('compareStatus').textContent).toBe('Os dois lados mostram a mesma pessoa.')
    handlers['/api/compare'] = () => payload([])
    await change('compareB', 'bolsonaro')
    expect($('compareStatus').hidden).toBe(true)
  })

  it('AC9: an empty payload says so', async () => {
    handlers['/api/compare'] = () => payload([])
    boot()
    await start()
    expect($('compareRuler').hidden).toBe(false)
    expect($('compareRuler').textContent).toContain('Nenhuma palavra neste recorte.')
  })

  it('AC9: #compareHiddenNote is hidden with nothing dropped and reports the exact count otherwise', async () => {
    boot()
    await start()
    expect($('compareHiddenNote').hidden).toBe(true)
    expect($('compareHiddenNote').textContent).toBe('')
    handlers['/api/compare'] = () => payload([{ term: 'lula', kind: 'word', a: 'name', b: side(3) }, reforma])
    await change('compareDays', '7')
    expect($('compareHiddenNote').hidden).toBe(false)
    expect($('compareHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome de uma das duas pessoas.')
    expect(rows().map((w) => w.getAttribute('data-term'))).toEqual(['reforma'])
  })

  it('AC9: the detail line names both people, "nenhum documento" for a side without the word', async () => {
    boot()
    await start()
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números dos dois lados.')
    click(rows()[0])
    await settle()
    const detail = $('compareDetail').textContent ?? ''
    expect(detail).toContain('reforma')
    expect(detail).toContain('Lula')
    expect(detail).toContain('Bolsonaro')
    expect(detail).toContain('nenhum documento')
    expect(detail).not.toMatch(/\b0 documentos/)
  })

  it('AC10: bridges load after the ruler paints and mark the bridge row', async () => {
    const terms: CompareTerm[] = [
      { term: 'stf', kind: 'word', a: side(5), b: side(5) },
      { term: 'pix', kind: 'word', a: side(2), b: null },
    ]
    handlers['/api/compare'] = () => payload(terms)
    handlers['/api/compare/bridges'] = () => ({ bridges: { 'word:stf': 1, 'word:pix': 0 } })
    boot()
    await start()
    const ruler = calls.findIndex((c) => c.path === '/api/compare')
    const bridges = calls.findIndex((c) => c.path === '/api/compare/bridges')
    expect(ruler).toBeGreaterThanOrEqual(0)
    expect(bridges).toBeGreaterThan(ruler)
    expect(calls[ruler].params.has('bridges')).toBe(false)
    expect(calls[bridges].params.get('ids')).toBe('word:pix,word:stf')
    expect($('compareRuler').querySelectorAll('[data-bridge="1"]').length).toBe(1)
    expect($('compareRuler').querySelector('[data-bridge="1"]')?.getAttribute('data-term')).toBe('stf')
    const bridged = $('compareRuler').querySelector('[data-bridge="1"]')!
    expect(bridged.querySelector('.butterfly-bridge-mark')).not.toBeNull()
    expect(bridged.querySelector('.sr-only')?.textContent).toBe('ponte')
    expect($('compareRuler').querySelectorAll('.butterfly-bridge-mark')).toHaveLength(1)
    expect(calls.filter((c) => c.path === '/api/compare')).toHaveLength(1)
  })

  it('bridge repaint leaves the pick open', async () => {
    let release: (v: unknown) => void = () => {}
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers['/api/compare/bridges'] = () => new Promise((resolve) => (release = resolve))
    boot()
    await start()
    click(rows()[0])
    await settle()
    expect($('compareRuler').querySelectorAll('[data-bridge]')).toHaveLength(0)
    release({ bridges: { 'word:stf': 1 } })
    await settle()
    expect($('compareRuler').querySelectorAll('[data-bridge="1"]')).toHaveLength(1)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(calls.filter((c) => c.path === '/api/compare')).toHaveLength(1)
  })

  it('AC10: a control change during the bridge load aborts it and its late result is dropped', async () => {
    const terms: CompareTerm[] = [{ term: 'stf', kind: 'word', a: side(5), b: side(5) }]
    let releaseBridges: (v: unknown) => void = () => {}
    let first: Call | undefined
    handlers['/api/compare'] = () => payload(terms)
    handlers['/api/compare/bridges'] = (call) => {
      first ??= call
      return new Promise((resolve) => {
        releaseBridges = resolve
      })
    }
    boot()
    await start()
    expect(first).toBeDefined()
    expect(first!.signal?.aborted).toBe(false)
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(9), b: side(4) }])
    handlers['/api/compare/bridges'] = () => new Promise(() => {})
    await change('compareDays', '7')
    expect(first!.signal?.aborted).toBe(true)
    releaseBridges({ bridges: { 'word:stf': 1 } })
    await settle()
    expect($('compareRuler').querySelectorAll('[data-bridge]')).toHaveLength(0)
  })

  it('a click on the header, the subtitle or a select keeps the pick and the card', async () => {
    boot()
    await start()
    click(rows()[0])
    await settle()
    for (const el of [document.querySelector('#compare .figure-head')!, document.querySelector('#compare .figure-sub')!, select('compareA'), select('compareMeasure'), $('compareDetail')]) {
      click(el)
      await settle()
      expect(docsCard.openedBy('compare')).toBe(true)
      expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('a pick made on dimmed data is dropped when the new data lands', async () => {
    boot()
    await start()
    let release: (v: unknown) => void = () => {}
    handlers['/api/compare'] = () => new Promise((resolve) => (release = resolve))
    select('compareDays').value = '7'
    select('compareDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    expect($('compare').classList.contains('is-loading')).toBe(true)
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    release(payload([{ term: 'reforma', kind: 'word', a: side(9), b: null }]))
    await settle()
    expect($('compare').classList.contains('is-loading')).toBe(false)
    expect(docsCard.isOpen()).toBe(false)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('a pick made on dimmed data is dropped when that reload fails', async () => {
    boot()
    await start()
    let fail: (e: unknown) => void = () => {}
    handlers['/api/compare'] = () => new Promise((_, reject) => (fail = reject))
    select('compareDays').value = '7'
    select('compareDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    fail(new Error('boom'))
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect($('compareRuler').textContent).toMatch(/Não foi possível carregar a comparação/)
  })

  it('a later setBoot never re-seeds nor refetches', async () => {
    boot({ search: '?compare.days=7' })
    await start()
    expect(compareCalls()).toHaveLength(1)
    expect(select('compareDays').value).toBe('7')
    await change('compareDays', '21')
    const before = calls.length
    boot({ search: '?compare.days=7', people: [...people, ciro] })
    flushSync()
    await settle(500)
    expect(select('compareDays').value).toBe('21')
    expect(calls.length).toBe(before)
  })

  it('a control change aborts the bridge load before the new data lands', async () => {
    let first: Call | undefined
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers['/api/compare/bridges'] = (call) => {
      first ??= call
      return new Promise(() => {})
    }
    boot()
    await start()
    handlers['/api/compare'] = () => new Promise(() => {})
    select('compareDays').value = '7'
    select('compareDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(first!.signal?.aborted).toBe(true)
  })

  it('review K1: peopleError hides the ruler and the retry keeps its id', async () => {
    boot({ people: [], peopleError: new Error('down') })
    await start()
    expect($('compareRuler').hidden).toBe(true)
    expect($('compareDetail').querySelector('#compareRetry')).not.toBeNull()
  })
  it('review K2: no people hides the ruler', async () => {
    boot({ people: [] })
    await start()
    expect($('compareRuler').hidden).toBe(true)
  })
  it('review K3: ghost: eight placeholder rows with two ghost bars each, sr-only prose, detail sides', async () => {
    await start()
    expect($('compareRuler').textContent).toContain('Lendo as barras.')
    expect($('compareRuler').querySelector('.ghost-field')?.getAttribute('aria-hidden')).toBe('true')
    const ghostRows = [...$('compareRuler').querySelectorAll('.butterfly-ghost-row')]
    expect(ghostRows).toHaveLength(8)
    for (const r of ghostRows) expect(r.querySelectorAll('.ghost.butterfly-ghost-bar')).toHaveLength(2)
    expect($('compareDetail').querySelector('.detail-sides')).not.toBeNull()
  })
  it('review K3: the ghost also shows on a first load after boot, before the payload lands', async () => {
    let release: (v: unknown) => void = () => {}
    handlers['/api/compare'] = () => new Promise((resolve) => (release = resolve))
    boot()
    await start()
    expect($('compareRuler').querySelectorAll('.butterfly-ghost-row')).toHaveLength(8)
    release(payload([reforma]))
    await settle()
    expect($('compareRuler').querySelectorAll('.butterfly-ghost-row')).toHaveLength(0)
    expect(rows()).toHaveLength(1)
  })
  it('review K5: row label, hooks and the null-side aria-label', async () => {
    boot()
    await start()
    const w = rows()[0]
    expect(w.getAttribute('aria-label')).toBe('reforma: Lula 5 documentos, Bolsonaro nenhum documento')
    expect(w.getAttribute('tabindex')).toBe('0')
    expect(w.getAttribute('role')).toBe('button')
    expect(w.querySelector('.butterfly-label')?.textContent?.trim()).toBe('reforma')
  })
  it('review K6: the axes list every tick of the shared scale on both sides', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(160), b: side(30) }])
    boot()
    await start()
    const ticks = (side: string) => [...$('compareRuler').querySelectorAll(`.butterfly-axis.is-${side} .butterfly-axis-tick`)].map((e) => e.textContent)
    expect(ticks('a')).toEqual(['0%', '20%', '40%'])
    expect(ticks('b')).toEqual(['0%', '20%', '40%'])
  })
  it('review K7: the axis heads name both people in their own side classes, and the group role names the chart', async () => {
    boot()
    await start()
    const heads = [...$('compareRuler').querySelectorAll('.butterfly-axis-label')]
    expect(heads.map((e) => e.textContent)).toEqual(['Lula', 'Bolsonaro'])
    expect(heads.map((e) => e.classList.contains('cmp-a') || e.classList.contains('cmp-b'))).toEqual([true, true])
    expect($('compareRuler').getAttribute('aria-label')).toBe('Barras comparando as duas pessoas')
    expect($('compareRuler').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Barras comparando Lula e Bolsonaro')
  })
  it('the container has the class butterfly and no .ruler-* children', async () => {
    boot()
    await start()
    expect($('compareRuler').classList.contains('butterfly')).toBe(true)
    expect($('compareRuler').classList.contains('ruler')).toBe(false)
    expect($('compareRuler').querySelector('[class*="ruler-"]')).toBeNull()
  })
  it('review K9: the card names the word and both people, on the figure recorte', async () => {
    boot({ search: '?source=gdelt&days=7' })
    await start()
    click(rows()[0])
    await settle()
    expect($('docsTitle').textContent).toBe('reforma')
    expect($('docsKicker').textContent).toBe('Documentos com palavra')
    const docs = calls.filter((c) => c.path.endsWith('/docs'))
    expect(docs).toHaveLength(2)
    for (const c of docs) {
      expect(c.params.get('source')).toBe('gdelt')
      expect(c.params.get('days')).toBe('7')
      expect(c.params.get('kind')).toBe('word')
    }
    expect(document.body.textContent).toContain('Lula')
    expect([...document.querySelectorAll('#docsDialog h3, #docsDialog .docs-column-head, #docsDialog [class*=side]')].map((e) => e.textContent).join('|')).toMatch(/Lula[\s\S]*Bolsonaro/)
  })
  it('review K10: detail prints counts and the bridge line', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(7, 1.5), b: side(3, 0.5) }])
    handlers['/api/compare/bridges'] = () => ({ bridges: { 'word:stf': 1 } })
    boot()
    await start()
    click(rows()[0])
    await settle()
    expect($('compareDetail').textContent).toContain('7 documentos · PMI 1,5')
    expect($('compareDetail').querySelector('.detail-bridge')?.textContent).toBe('ponte: liga os dois vocabulários')
  })
  it('review K11: a recorte revisited from the memo does not ask for bridges again', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers['/api/compare/bridges'] = () => ({ bridges: { 'word:stf': 1 } })
    boot()
    await start()
    await change('compareDays', '7')
    await change('compareDays', '21')
    expect(calls.filter((c) => c.path === '/api/compare/bridges')).toHaveLength(2)
  })

  it('unmounting aborts the in-flight bridge request', async () => {
    let first: Call | undefined
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers['/api/compare/bridges'] = (call) => {
      first ??= call
      return new Promise(() => {})
    }
    boot()
    await start()
    expect(first?.signal?.aborted).toBe(false)
    for (const i of instances) unmount(i)
    instances = []
    flushSync()
    expect(first!.signal?.aborted).toBe(true)
  })

  it('#compareStatus stays hidden while the ghost shows, even when A and B are the same person', async () => {
    let release: (v: unknown) => void = () => {}
    handlers['/api/compare'] = () => new Promise((resolve) => (release = resolve))
    boot({ people: [lula] })
    await start()
    expect($('compareRuler').textContent).toContain('Lendo as barras.')
    expect($('compareStatus').hidden).toBe(true)
    release(payload([reforma], lula, lula))
    await settle()
    expect($('compareStatus').hidden).toBe(false)
  })

  it('a bridge result that lands after the recorte changed is not applied to the old payload', async () => {
    let releaseFirst: (v: unknown) => void = () => {}
    let n = 0
    handlers['/api/compare'] = (call) => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(call.params.get('days') === '7' ? 4 : 5) }])
    handlers['/api/compare/bridges'] = () => {
      n++
      if (n === 1) return new Promise((resolve) => (releaseFirst = resolve))
      return { bridges: {} }
    }
    boot()
    await start()
    await change('compareDays', '7')
    releaseFirst({ bridges: { 'word:stf': 1 } })
    await settle()
    await change('compareDays', '21')
    expect(calls.filter((c) => c.path === '/api/compare/bridges').length).toBeGreaterThanOrEqual(3)
    expect($('compareRuler').querySelectorAll('[data-bridge]')).toHaveLength(0)
  })

  it('AC11: a width change issues no fetch, keeps the pick and the card and leaves the markup unchanged', async () => {
    boot()
    await start()
    click(rows()[0])
    await settle()
    const before = calls.length
    const markup = $('compareRuler').innerHTML
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect($('compareRuler').innerHTML).toBe(markup)
  })

  it('AC11: a resize during loading repaints nothing', async () => {
    let release: (v: unknown) => void = () => {}
    boot()
    await start()
    handlers['/api/compare'] = () => new Promise((resolve) => (release = resolve))
    select('compareDays').value = '7'
    select('compareDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    const ghost = $('compareRuler').innerHTML
    width = 300
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect($('compareRuler').innerHTML).toBe(ghost)
    release(payload([reforma]))
    await settle()
    expect(rows()).toHaveLength(1)
  })

  it('AC12: a failed request writes the error note and detail hint, and a later resize repaints nothing stale', async () => {
    boot()
    await start()
    expect(rows()).toHaveLength(1)
    handlers['/api/compare'] = () => {
      throw new Error('offline')
    }
    await change('compareDays', '7')
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
    expect($('compareRuler').querySelector('img'), 'the outage is words only, no pet').toBeNull()
    expect($('compareDetail').querySelector('img')).toBeNull()
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números dos dois lados.')
    expect(rows()).toHaveLength(0)
    width = 350
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(rows()).toHaveLength(0)
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
  })

  it('AC12: peopleError shows a retry button that reloads the page, and fetches nothing', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    boot({ people: [], peopleError: new Error('down') })
    await start()
    expect(calls).toEqual([])
    expect($('compareDetail').textContent).toContain('Falha de rede ou base indisponível.')
    const retry = $('compareDetail').querySelector('button')!
    expect(retry.textContent).toContain('Tentar novamente')
    click(retry)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('AC12: no people says so and fetches nothing', async () => {
    boot({ people: [] })
    await start()
    expect(calls).toEqual([])
    expect($('compareDetail').textContent).toContain('Nenhuma pessoa cadastrada.')
  })

  it('AC13: before bootData.ready the ghost is in #compareRuler and nothing fetches', async () => {
    await start()
    expect(calls).toEqual([])
    expect($('compareRuler').hidden).toBe(false)
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('compareRuler').querySelectorAll('.ghost').length).toBeGreaterThan(0)
    expect($('compareRuler').textContent).not.toMatch(/Carregando/)
    await settle(500)
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
  })

  it('AC13: once boot settles the component fetches and replaces the ghost', async () => {
    await start()
    boot()
    flushSync()
    await settle(220)
    expect(compareCalls()).toHaveLength(1)
    expect($('compareRuler').querySelector('.ghost-field')).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it('AC15: a bar paints its share over the domain as --bar and no font-size literal', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'stf', kind: 'word', a: side(160), b: side(30) }])
    boot()
    await start()
    const bars = [...$('compareRuler').querySelectorAll('.butterfly-bar')]
    expect(bars).toHaveLength(2)
    const bar = (el: Element) => Number(/--bar:\s*([0-9.]+)/.exec(el.getAttribute('style') ?? '')?.[1])
    expect(bar(bars[0])).toBeCloseTo(((160 / 412) * 100) / 40, 5)
    expect(bar(bars[1])).toBeCloseTo(((30 / 168) * 100) / 40, 5)
    for (const el of $('compareRuler').querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/font-size/)
  })
})

describe('figure 3 states a people outage in words only (ported from pet-acceptance)', () => {
  it('no <img> anywhere in #compare when /api/people failed', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    vi.stubGlobal('fetch', async () => { throw new Error('network down') })
    setBoot({ ready: true, people: [], peopleError: new Error('down'), search: '' })
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(Compare, { target })
    flushSync()
    expect(document.getElementById('compareRetry')).not.toBeNull()
    expect(target.querySelector('img')).toBeNull()
    unmount(instance); target.remove(); vi.unstubAllGlobals()
  })
})

describe('Compare over the 7 and 21 day windows (issue #313 acceptance)', () => {
  for (const days of ['30', '60'])
    it(`AC25: a shared link with days=${days} leaves the select on 21 and requests days=21`, async () => {
      boot({ search: `?days=${days}` })
      await start()
      expect(select('compareDays').value).toBe('21')
      expect(compareCalls()[0].params.get('days')).toBe('21')
    })

  it('AC25: a shared link with days=7 still selects 7', async () => {
    boot({ search: '?days=7' })
    await start()
    expect(select('compareDays').value).toBe('7')
    expect(compareCalls()[0].params.get('days')).toBe('7')
  })
})

// ---------------------------------------------------------------------------------------------
// Lens mode (#326): the former #lenses figure folded into #compare. Ported from lenses.spec.ts.
// ---------------------------------------------------------------------------------------------

const lensSearch = (extra = '') => '?compare.mode=recortes' + (extra ? '&' + extra.replace(/^\?/, '') : '')

const startLens = async (extra = '', patch: Partial<{ people: typeof people; peopleError: unknown }> = {}) => {
  boot({ search: lensSearch(extra), ...patch })
  await start()
  await settle(220)
}

const remount = () => {
  for (const i of instances) unmount(i)
  instances = []
  document.body.innerHTML = ''
  target = document.createElement('div')
  document.body.append(target)
  clearScopes()
  calls = []
}

const fire = (id: string, value: string) => {
  select(id).value = value
  select(id).dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

const barOf = (el: Element) => Number(/--bar:\s*([0-9.]+)/.exec(el.getAttribute('style') ?? '')?.[1])
const atlasCard = () =>
  void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '21' }) }] })

describe('Compare lens mode (#326)', () => {
  it('lens mode: AC2: lenses: request params and defaults', async () => {
    await startLens()
    expect(lensCalls()).toHaveLength(1)
    expect(compareCalls()).toEqual([])
    const c = lensCalls()[0]
    expect(c.path).toBe('/api/people/lula/lenses')
    expect(c.url).toBe('/api/people/lula/lenses?' + lensesParams({ a: 'source:bluesky', b: 'source:gnews', days: '21', limit: '20' }).toString())
    expect(c.params.get('a')).toBe('source:bluesky')
    expect(c.params.get('b')).toBe('source:gnews')
    expect(c.params.get('days')).toBe('21')
    expect(c.params.get('limit')).toBe('20')
    expect(c.params.get('kind')).toBe('word,hashtag,phrase')
    for (const key of ['mode', 'person', 'source', 'measure']) expect(c.params.has(key), key).toBe(false)
    expect(input('compareLensAInput').value).toBe('Bluesky')
    expect(input('compareLensBInput').value).toBe('Google News')
    expect(of('sources')).toHaveLength(1)
    expect(of('sources')[0].path).toBe('/api/people/lula/sources')
    expect(of('sources')[0].url).toBe('/api/people/lula/sources?' + sourcesParams({ days: '21', sort: 'count', limit: '80', source: 'all' }).toString())
    expect(of('docs')).toEqual([])
  })

  it('lens mode: AC2: nothing fetches before bootData.ready, and the ghost stands in the chart and the detail', async () => {
    await start()
    expect(calls).toEqual([])
    expect($('compareRuler').hidden).toBe(false)
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('compareRuler').textContent).toContain('Lendo as barras.')
    expect($('compareDetail').querySelector('.detail-sides')).not.toBeNull()
    expect($('compareStatus').hidden).toBe(true)
    expect($('compareThinNote').hidden).toBe(true)
    await settle(500)
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    boot({ search: lensSearch() })
    flushSync()
    await settle(220)
    expect(lensCalls()).toHaveLength(1)
    expect($('compareRuler').querySelector('.ghost-field')).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it('lens mode: AC3: lenses: seeds from the querystring, a bare a= never seeds lens A', async () => {
    boot({ search: '?person=bolsonaro&lenses.a=all&lenses.b=lean:right&days=7&limit=60' })
    await start()
    await settle(220)
    const c = lensCalls()[0]
    expect(select('compareMode').value).toBe('recortes')
    expect(c.path).toBe('/api/people/bolsonaro/lenses')
    expect(c.params.get('a')).toBe('all')
    expect(c.params.get('b')).toBe('lean:right')
    expect(c.params.get('days')).toBe('7')
    expect(c.params.get('limit')).toBe('60')
    expect(select('comparePerson').value).toBe('bolsonaro')
    expect(select('compareLensB').value).toBe('lean:right')
    expect(select('compareDays').value).toBe('7')
    expect(select('compareLimit').value).toBe('60')
    expect(of('sources')[0].path).toBe('/api/people/bolsonaro/sources')
    expect(of('sources')[0].params.get('days')).toBe('7')

    remount()
    boot({ search: '?a=lean:left&lenses.b=lean:right' })
    await start()
    await settle(220)
    expect(select('compareLensA').value).toBe('source:bluesky')
    expect(lensCalls()[0].params.get('a')).toBe('source:bluesky')
    expect(lensCalls()[0].params.get('b')).toBe('lean:right')

    remount()
    boot({ search: '?a=lean:left&lenses.a=lean:left' })
    await start()
    await settle(220)
    expect(select('compareLensA').value).toBe('lean:left')
    expect(lensCalls()[0].params.get('a')).toBe('lean:left')
  })

  it('lens mode: the legacy lenses.* keys open lens mode with exactly their values', async () => {
    boot({ search: '?lenses.person=bolsonaro&lenses.a=lean:left&lenses.b=source:gdelt&lenses.days=7&lenses.limit=60' })
    await start()
    await settle(220)
    expect(select('compareMode').value).toBe('recortes')
    expect(compareCalls()).toEqual([])
    expect(lensCalls()).toHaveLength(1)
    const c = lensCalls()[0]
    expect(c.path).toBe('/api/people/bolsonaro/lenses')
    expect(c.params.get('a')).toBe('lean:left')
    expect(c.params.get('b')).toBe('source:gdelt')
    expect(c.params.get('days')).toBe('7')
    expect(c.params.get('limit')).toBe('60')
  })

  it('lens mode: AC3: lenses: an unknown lens token or option stays on the default (never all), an unknown limit or days is ignored', async () => {
    await startLens('lenses.a=lean:nope&lenses.b=source:nope&limit=7&days=9')
    expect(select('compareLensA').value).toBe('source:bluesky')
    expect(select('compareLensB').value).toBe('source:gnews')
    expect(lensCalls()[0].params.get('a')).toBe('source:bluesky')
    expect(lensCalls()[0].params.get('b')).toBe('source:gnews')
    expect(lensCalls()[0].params.get('days')).toBe('21')
    expect(lensCalls()[0].params.get('limit')).toBe('20')
  })

  it('lens mode: AC3: a later setBoot never re-seeds nor refetches', async () => {
    await startLens('lenses.days=7')
    expect(lensCalls()).toHaveLength(1)
    await change('compareDays', '21')
    const before = calls.length
    boot({ search: lensSearch('lenses.days=7'), people: [...people, ciro] })
    flushSync()
    await settle(500)
    expect(select('compareDays').value).toBe('21')
    expect(calls.length).toBe(before)
  })

  it('lens mode: AC4: lenses: the Veículo optgroup lists each top domain once and skips rows without a domain', async () => {
    handlers.sources = () => [folha, { domain: 'folha.uol.com.br', docs: 3 }, { domain: null, docs: 2 }, g1]
    await startLens()
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:folha.uol.com.br', 'domain:g1.globo.com'])
    expect(outletValues('compareLensBOutlets')).toEqual(['domain:folha.uol.com.br', 'domain:g1.globo.com'])
  })

  it('lens mode: AC4: lenses: domain seed deferred until optgroup fills', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=lean:left')
    expect(select('compareLensA').value).toBe('source:bluesky')
    expect(select('compareLensB').value).toBe('lean:left')
    expect(input('compareLensAInput').value).toBe('Bluesky')
    expect(lensCalls()).toHaveLength(0)
    gate.release([folha, g1])
    await settle(220)
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
    expect(input('compareLensAInput').value).toBe('folha.uol.com.br')
    expect(lensCalls()).toHaveLength(1)
    expect(lensCalls()[0].params.get('a')).toBe('domain:folha.uol.com.br')
  })

  it('lens mode: AC4: lenses: a domain seed the optgroup never gets stays on the default, never all', async () => {
    handlers.sources = () => [g1]
    await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=domain:nowhere.example')
    expect(select('compareLensA').value).toBe('source:bluesky')
    expect(select('compareLensB').value).toBe('source:gnews')
    expect(lensCalls()[0].params.get('a')).toBe('source:bluesky')
    expect(lensCalls()[0].params.get('b')).toBe('source:gnews')
  })

  for (const [side, id, param] of [
    ['A', 'compareLensA', 'a'],
    ['B', 'compareLensB', 'b'],
  ]) {
    it(`lens mode: AC4: lenses: touched side skips domain seed (${side})`, async () => {
      const gate = held()
      handlers.sources = () => gate.promise
      await startLens(`lenses.${param}=domain:folha.uol.com.br`)
      fire(id, 'source:rss')
      await settle()
      gate.release([folha])
      await settle(220)
      expect(select(id).value).toBe('source:rss')
      expect(lensCalls().pop()!.params.get(param)).toBe('source:rss')
    })
  }

  it('lens mode: AC4: lenses: a non-domain seed applies at once and a reader change survives the pending fill', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    await startLens('lenses.a=lean:left')
    expect(select('compareLensA').value).toBe('lean:left')
    fire('compareLensA', 'source:rss')
    await settle()
    gate.release([folha])
    await settle(220)
    expect(select('compareLensA').value).toBe('source:rss')
    expect(lensCalls().pop()!.params.get('a')).toBe('source:rss')
  })

  it('lens mode: AC4: lenses: a limit change while /sources is in flight keeps the deferred domain seed', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    await startLens('lenses.a=domain:folha.uol.com.br')
    await change('compareLimit', '60')
    gate.release([folha])
    await settle(220)
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
  })

  for (const [name, id, value, applied] of [
    ['a person change marks both sides touched', 'comparePerson', 'bolsonaro', false],
    ['a days change marks neither', 'compareDays', '7', true],
  ] as const) {
    it(`lens mode: ${name}, so the pending domain seeds ${applied ? 'still apply' : 'are skipped'}`, async () => {
      const first = held()
      let n = 0
      handlers.sources = () => (++n === 1 ? first.promise : [folha, g1])
      await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=domain:g1.globo.com')
      await change(id, value)
      first.release([folha, g1])
      await settle(220)
      expect(select('compareLensA').value).toBe(applied ? 'domain:folha.uol.com.br' : 'source:bluesky')
      expect(select('compareLensB').value).toBe(applied ? 'domain:g1.globo.com' : 'source:gnews')
    })
  }

  it('lens mode: AC4: lenses: stale /sources response ignored (another person)', async () => {
    const first = held()
    let n = 0
    handlers.sources = (call) => {
      n++
      if (n === 1) return first.promise
      return call.person === 'bolsonaro' ? [folha] : [g1]
    }
    await startLens()
    await change('comparePerson', 'bolsonaro')
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:folha.uol.com.br'])
    select('compareLensA').value = 'domain:folha.uol.com.br'
    first.release([g1])
    await settle(220)
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:folha.uol.com.br'])
    expect(outletValues('compareLensBOutlets')).toEqual(['domain:folha.uol.com.br'])
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
  })

  it('lens mode: AC4: lenses: stale /sources response ignored (days back to its starting value)', async () => {
    const first = held()
    let n = 0
    handlers.sources = () => {
      n++
      return n === 1 ? first.promise : [{ domain: 'fresh.example', docs: 1 }]
    }
    await startLens()
    await change('compareDays', '7')
    await change('compareDays', '21')
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:fresh.example'])
    first.release([{ domain: 'stale.example', docs: 1 }])
    await settle(220)
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:fresh.example'])
  })

  it('lens mode: AC5: lenses: person and days change keep or drop a domain', async () => {
    await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=lean:left')
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')

    handlers.sources = () => [g1]
    await change('comparePerson', 'bolsonaro')
    expect(select('compareLensA').value).toBe('all')
    expect(input('compareLensAInput').value).toBe('Tudo')
    expect(select('compareLensB').value).toBe('lean:left')
    expect(lensCalls().pop()!.path).toBe('/api/people/bolsonaro/lenses')
    expect(lensCalls().pop()!.params.get('a')).toBe('all')

    handlers.sources = () => [folha, g1]
    await change('comparePerson', 'lula')
    await change('compareLensA', 'domain:folha.uol.com.br')
    handlers.sources = () => [folha]
    await change('comparePerson', 'bolsonaro')
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
    expect(lensCalls().pop()!.params.get('a')).toBe('domain:folha.uol.com.br')

    const sourcesBefore = of('sources').length
    handlers.sources = () => [folha]
    await change('compareDays', '7')
    expect(of('sources').length).toBe(sourcesBefore + 1)
    expect(of('sources').pop()!.params.get('days')).toBe('7')
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')

    handlers.sources = () => [g1]
    await change('compareDays', '21')
    expect(select('compareLensA').value).toBe('all')
    expect($('compareRuler').querySelector('[role="group"]')?.getAttribute('aria-label')).not.toContain('folha.uol.com.br')
  })

  it('lens mode: a person change drops a B domain the new person lacks', async () => {
    await startLens('lenses.b=domain:folha.uol.com.br')
    expect(select('compareLensB').value).toBe('domain:folha.uol.com.br')
    handlers.sources = () => [g1]
    await change('comparePerson', 'bolsonaro')
    expect(select('compareLensB').value).toBe('all')
    expect(input('compareLensBInput').value).toBe('Tudo')
    expect(lensCalls().pop()!.params.get('b')).toBe('all')
  })

  it('lens mode: AC5: lenses: a limit change keeps both sides and does not refetch /sources', async () => {
    await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=lean:left')
    const sources = of('sources').length
    await change('compareLimit', '100')
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
    expect(select('compareLensB').value).toBe('lean:left')
    expect(of('sources')).toHaveLength(sources)
    expect(lensCalls().pop()!.params.get('limit')).toBe('100')
  })

  for (const [id, value, param] of [
    ['compareLensA', 'lean:left', 'a'],
    ['compareLensB', 'source:rss', 'b'],
    ['compareDays', '7', 'days'],
    ['compareLimit', '100', 'limit'],
    ['comparePerson', 'bolsonaro', 'person'],
  ]) {
    it(`lens mode: AC5: lenses: control changes refetch and release (#${id})`, async () => {
      await startLens()
      const before = lensCalls().length
      await change(id, value)
      const added = lensCalls().slice(before)
      expect(added).toHaveLength(1)
      if (param === 'person') expect(added[0].path).toBe('/api/people/bolsonaro/lenses')
      else expect(added[0].params.get(param)).toBe(value)
      expect(of('docs')).toEqual([])
    })
  }

  it('lens mode: AC6: lenses: status notice for identical lenses', async () => {
    await startLens()
    expect($('compareStatus').hidden).toBe(true)
    await change('compareLensB', 'source:bluesky')
    expect($('compareStatus').hidden).toBe(false)
    expect($('compareStatus').textContent).toBe('Os dois lados mostram o mesmo recorte.')
    await change('compareLensA', 'lean:right')
    expect($('compareStatus').hidden).toBe(true)
    await change('compareLensB', 'lean:right')
    expect($('compareStatus').hidden).toBe(false)
    await change('compareLensB', 'all')
    expect($('compareStatus').hidden).toBe(true)
  })

  it('lens mode: AC6: #compareStatus stays hidden while the ghost shows', async () => {
    const gate = held()
    handlers.lenses = () => gate.promise
    await startLens()
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('compareStatus').hidden).toBe(true)
    gate.release(lensPayload([reforma], 'all', 'all'))
    await settle()
    expect($('compareStatus').hidden).toBe(false)
  })

  it('lens mode: AC7: lenses: click opens two-sided docs card', async () => {
    handlers.lenses = () => lensPayload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    await startLens('days=7')
    click(rows()[0])
    await settle()
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('compare')).toBe(true)
    const docs = of('docs')
    expect(docs).toHaveLength(2)
    for (const c of docs) {
      expect(c.path).toBe('/api/people/lula/docs')
      expect(c.params.get('term')).toBe('reforma')
      expect(c.params.get('kind')).toBe('word')
      expect(c.params.get('days')).toBe('7')
      expect(c.params.get('source')).toBe('all')
    }
    const a = docs.find((c) => c.params.get('domain') === 'folha.uol.com.br')
    const b = docs.find((c) => c.params.get('lean') === 'right')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a!.params.has('lean')).toBe(false)
    expect(b!.params.has('domain')).toBe(false)
    expect($('docsTitle').textContent).toBe('reforma')
    expect($('docsKicker').textContent).toBe('Documentos com palavra')
    const text = document.body.textContent ?? ''
    expect(text).toContain('folha.uol.com.br')
    expect(text).toContain('Direita')
    expect(text).toContain('Lula')
  })

  it('lens mode: AC7: lenses: a source lens sends source=, an all lens sends source=all and no domain or lean', async () => {
    handlers.lenses = () => lensPayload([reforma], 'source:rss', 'all')
    await startLens()
    click(rows()[0])
    await settle()
    const docs = of('docs')
    expect(docs).toHaveLength(2)
    expect(docs.map((c) => c.params.get('source')).sort()).toEqual(['all', 'rss'])
    for (const c of docs) {
      expect(c.params.has('domain')).toBe(false)
      expect(c.params.has('lean')).toBe(false)
    }
    expect(document.body.textContent).toContain('Tudo')
  })

  it('lens mode: AC7: lenses: a lean lens on the other side and pressing Enter or Space on a word picks it', async () => {
    handlers.lenses = () => lensPayload([reforma], 'lean:left', 'source:gdelt')
    await startLens()
    for (const key of ['Enter', ' ']) {
      const e = keydown(rows()[0], key)
      expect(e.defaultPrevented).toBe(true)
      await settle()
      expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
      expect(docsCard.openedBy('compare')).toBe(true)
      escape()
      await settle()
      expect(docsCard.isOpen()).toBe(false)
    }
    const docs = of('docs')
    expect(docs.some((c) => c.params.get('lean') === 'left' && c.params.get('source') === 'all')).toBe(true)
    expect(docs.some((c) => c.params.get('source') === 'gdelt')).toBe(true)
  })

  it('lens mode: AC7: the same word again, the background and Escape each clear the pick and close the card', async () => {
    await startLens()
    const releasers: [string, () => void][] = [
      ['same row', () => click(rows()[0])],
      ['background', () => click($('compareRuler'))],
      ['escape', escape],
    ]
    for (const [name, release] of releasers) {
      click(rows()[0])
      await settle()
      expect(docsCard.openedBy('compare'), `${name}: open`).toBe(true)
      release()
      await settle()
      expect(docsCard.isOpen(), `${name}: card closed`).toBe(false)
      expect(rows()[0].getAttribute('aria-pressed'), `${name}: unpicked`).toBe('false')
      expect($('compareDetail').textContent).toMatch(/Clique numa palavra para ver os números das duas lentes\./)
    }
  })

  it('lens mode: AC8: lenses: control change releases own card only', async () => {
    await startLens()
    for (const [id, value] of [
      ['compareLensA', 'lean:left'],
      ['compareLensB', 'lean:center'],
      ['compareDays', '7'],
      ['compareLimit', '60'],
      ['comparePerson', 'bolsonaro'],
    ]) {
      click(rows()[0])
      await settle()
      expect(docsCard.openedBy('compare'), `${id}: open`).toBe(true)
      await change(id, value)
      expect(docsCard.isOpen(), `${id}: closed`).toBe(false)
    }
    click(rows()[0])
    await settle()
    atlasCard()
    await settle()
    expect(docsCard.openedBy('compare')).toBe(false)
    await change('compareLensA', 'source:rss')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  for (const id of ['compareLensA', 'compareLensB']) {
    it(`lens mode: changing #${id} clears the pick, closes the card and aborts the bridges before the new data lands`, async () => {
      let bridgeCall: Call | undefined
      const shared: CompareTerm[] = [{ term: 'stf', kind: 'word', a: side(5), b: side(5) }]
      handlers.lenses = () => lensPayload(shared)
      handlers.bridges = (call) => {
        bridgeCall ??= call
        return new Promise(() => {})
      }
      await startLens()
      click(rows()[0])
      await settle()
      expect(docsCard.openedBy('compare')).toBe(true)
      expect(bridgeCall!.signal?.aborted).toBe(false)
      const gate = held()
      handlers.lenses = () => gate.promise
      fire(id, 'lean:center')
      expect(docsCard.isOpen()).toBe(false)
      expect(bridgeCall!.signal?.aborted).toBe(true)
      expect(rows().some((r) => r.classList.contains('is-selected'))).toBe(false)
      gate.release(lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }], 'source:bluesky', 'lean:center'))
      await settle(220)
      expect(rows().some((r) => r.classList.contains('is-selected'))).toBe(false)
    })
  }

  it('lens mode: a domain or all lens sends source=all whatever the person-mode source was seeded to', async () => {
    await startLens('compare.source=gdelt&lenses.a=domain:folha.uol.com.br&lenses.b=all')
    expect(select('compareSource').value).toBe('gdelt')
    click(rows()[0])
    await settle()
    const [first, second] = of('docs')
    expect(first.params.get('domain')).toBe('folha.uol.com.br')
    expect(first.params.get('source')).toBe('all')
    expect(first.params.has('lean')).toBe(false)
    expect(second.params.get('source')).toBe('all')
    expect(second.params.has('domain')).toBe(false)
    expect(second.params.has('lean')).toBe(false)
  })

  it('lens mode: a days change closes the lenses card at once, before the new data lands', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    handlers.lenses = () => new Promise(() => {})
    fire('compareDays', '7')
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('lens mode: AC8: lenses: resize keeps the pick', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    const before = calls.length
    const markup = $('compareRuler').innerHTML
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    expect($('compareRuler').innerHTML).toBe(markup)
  })

  it('lens mode: AC8: a resize during loading repaints nothing', async () => {
    await startLens()
    const gate = held()
    handlers.lenses = () => gate.promise
    fire('compareDays', '7')
    await settle(220)
    const ghost = $('compareRuler').innerHTML
    width = 300
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect($('compareRuler').innerHTML).toBe(ghost)
    gate.release(lensPayload([reforma]))
    await settle()
    expect(rows()).toHaveLength(1)
  })

  it('lens mode: a second click on the same word after a resize still releases', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    click(rows()[0])
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('lens mode: AC8: a click on the header, the subtitle, a select, a combobox or the detail keeps the pick and the card', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    const els = [document.querySelector('#compare .figure-head')!, document.querySelector('#compare .figure-sub')!, select('compareMode'), select('comparePerson'), select('compareLensA'), $('compareLensAInput'), $('compareDetail')]
    for (const el of els) {
      click(el)
      await settle()
      expect(docsCard.openedBy('compare')).toBe(true)
      expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('lens mode: AC8: lenses: stale pick dropped mid-reload (data lands)', async () => {
    await startLens()
    const gate = held()
    handlers.lenses = () => gate.promise
    fire('compareLensA', 'lean:left')
    await settle(220)
    expect($('compare').classList.contains('is-loading')).toBe(true)
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    gate.release(lensPayload([reforma], 'lean:left', 'source:gnews'))
    await settle()
    expect($('compare').classList.contains('is-loading')).toBe(false)
    expect(docsCard.isOpen()).toBe(false)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('lens mode: AC8: lenses: stale pick dropped mid-reload (reload fails)', async () => {
    await startLens()
    const gate = held()
    handlers.lenses = () => gate.promise
    fire('compareDays', '7')
    await settle(220)
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    gate.fail(new Error('boom'))
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
  })

  it('lens mode: AC8: a card another figure opened over a pick made on dimmed data survives the new data', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    atlasCard()
    await settle()
    await change('compareDays', '7')
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('lens mode: AC9: lenses: bridges applied after paint, aborted on change', async () => {
    const terms: CompareTerm[] = [
      { term: 'stf', kind: 'word', a: side(5), b: side(5) },
      { term: 'pix', kind: 'word', a: side(2), b: null },
    ]
    handlers.lenses = () => lensPayload(terms)
    handlers.bridges = () => ({ bridges: { 'word:stf': 1, 'word:pix': 0 } })
    await startLens()
    const chart = calls.findIndex((c) => c.route === 'lenses')
    const bridges = calls.findIndex((c) => c.route === 'bridges')
    expect(chart).toBeGreaterThanOrEqual(0)
    expect(bridges).toBeGreaterThan(chart)
    expect(calls[bridges].path).toBe('/api/people/lula/lenses/bridges')
    expect(calls[bridges].params.get('ids')).toBe('word:pix,word:stf')
    expect(calls[bridges].params.get('a')).toBe('source:bluesky')
    expect(calls[bridges].params.get('b')).toBe('source:gnews')
    expect(calls[bridges].params.get('days')).toBe('21')
    expect(calls[bridges].params.get('limit')).toBe('20')
    expect(calls[chart].params.has('bridges')).toBe(false)
    expect($('compareRuler').querySelectorAll('[data-bridge="1"]')).toHaveLength(1)
    expect($('compareRuler').querySelector('[data-bridge="1"]')?.getAttribute('data-term')).toBe('stf')
    expect(calls.filter((c) => c.path === '/api/compare/bridges')).toEqual([])
  })

  it('lens mode: AC9: a control change during the bridge load aborts it and its late result is dropped', async () => {
    const late = held()
    let first: Call | undefined
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = (call) => {
      first ??= call
      return late.promise
    }
    await startLens()
    expect(first!.signal?.aborted).toBe(false)
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(9), b: side(4) }])
    handlers.bridges = () => new Promise(() => {})
    await change('compareDays', '7')
    expect(first!.signal?.aborted).toBe(true)
    late.release({ bridges: { 'word:stf': 1 } })
    await settle()
    expect($('compareRuler').querySelectorAll('[data-bridge]')).toHaveLength(0)
  })

  it('lens mode: AC9: a control change aborts the bridge load before the new data lands', async () => {
    let first: Call | undefined
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = (call) => {
      first ??= call
      return new Promise(() => {})
    }
    await startLens()
    handlers.lenses = () => new Promise(() => {})
    fire('compareLimit', '60')
    expect(first!.signal?.aborted).toBe(true)
  })

  it('lens mode: AC9: unmounting aborts the in-flight bridge request', async () => {
    let first: Call | undefined
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = (call) => {
      first ??= call
      return new Promise(() => {})
    }
    await startLens()
    expect(first?.signal?.aborted).toBe(false)
    for (const i of instances) unmount(i)
    instances = []
    flushSync()
    expect(first!.signal?.aborted).toBe(true)
  })

  it('lens mode: AC9: a failed bridge request leaves the chart as painted', async () => {
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = () => {
      throw new Error('nope')
    }
    await startLens()
    expect(rows()).toHaveLength(1)
    expect($('compareRuler').querySelectorAll('[data-bridge]')).toHaveLength(0)
    expect($('compareRuler').textContent).not.toMatch(/Não foi possível/)
  })

  it('lens mode: a memoized payload that already carries bridges never asks for them again', async () => {
    handlers.lenses = (call) => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }], call.params.get('a')!, call.params.get('b')!)
    handlers.bridges = () => ({ bridges: { 'word:stf': 1 } })
    await startLens()
    await change('compareLimit', '60')
    await change('compareLimit', '20')
    expect(of('bridges')).toHaveLength(2)
  })

  it('lens mode: the bridges request carries both lenses', async () => {
    handlers.lenses = (call) => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }], call.params.get('a')!, call.params.get('b')!)
    await startLens('lenses.a=lean:left&lenses.b=source:rss')
    const bridge = of('bridges').pop()!
    expect(bridge.params.get('a')).toBe('lean:left')
    expect(bridge.params.get('b')).toBe('source:rss')
    expect(bridge.params.get('days')).toBe('21')
    expect(bridge.params.get('limit')).toBe('20')
    expect(bridge.params.get('ids')).toBe('word:stf')
  })

  it('lens mode: AC9: lenses: name word and bridge detail copy', async () => {
    handlers.lenses = () => lensPayload([{ term: 'stf', kind: 'word', a: side(7, 1.5), b: side(3, 0.5) }])
    handlers.bridges = () => ({ bridges: { 'word:stf': 1 } })
    await startLens()
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
    click(rows()[0])
    await settle()
    expect($('compareDetail').textContent).toContain('7 documentos · PMI 1,5')
    expect($('compareDetail').querySelector('.detail-bridge')?.textContent).toBe('ponte: as duas lentes precisam dela')
    expect($('compareDetail').textContent).not.toContain('liga os dois vocabulários')
    expect([...$('compareDetail').querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Bluesky', 'Google News'])
  })

  it('lens mode: AC9: the detail line labels each side by its lens and reads "nenhum documento" for a null side', async () => {
    handlers.lenses = () => lensPayload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    await startLens()
    click(rows()[0])
    await settle()
    const detail = $('compareDetail')
    expect(detail.textContent).toContain('reforma')
    expect([...detail.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
    expect(detail.textContent).toContain('nenhum documento')
    expect(detail.textContent).toContain('5 documentos · PMI 1,2')
    expect(detail.querySelector('.detail-bridge')).toBeNull()
  })

  it('lens mode: the docs card columns are labelled by lensLabel, a first then b', async () => {
    handlers.lenses = () => lensPayload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    handlers.docs = () => ({ docs: [], total: 0 })
    await startLens()
    click(rows()[0])
    await settle()
    expect([...document.querySelectorAll('#docs .docs-side-name')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
  })

  it('lens mode: AC11: own-name words are dropped from the chart and counted in #compareHiddenNote', async () => {
    await startLens()
    expect($('compareHiddenNote').hidden).toBe(true)
    expect($('compareHiddenNote').textContent).toBe('')
    handlers.lenses = () => lensPayload([{ term: 'lula', kind: 'word', a: 'name', b: 'name' }, reforma])
    await change('compareDays', '7')
    expect($('compareHiddenNote').hidden).toBe(false)
    expect($('compareHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome da pessoa.')
    expect(rows().map((w) => w.getAttribute('data-term'))).toEqual(['reforma'])
    handlers.lenses = () => lensPayload([{ term: 'lula', kind: 'word', a: 'name', b: side(2) }, { term: 'luiz', kind: 'word', a: side(2), b: 'name' }, reforma])
    await change('compareLimit', '60')
    expect($('compareHiddenNote').textContent).toBe('2 palavras deixadas de fora por ser o próprio nome da pessoa.')
    handlers.lenses = () => lensPayload([reforma])
    await change('compareLimit', '100')
    expect($('compareHiddenNote').hidden).toBe(true)
  })

  it('lens mode: AC10: lenses: empty state', async () => {
    handlers.lenses = () => lensPayload([])
    await startLens()
    expect($('compareRuler').hidden).toBe(false)
    expect($('compareRuler').textContent).toContain('Nenhuma palavra neste recorte.')
    expect(rows()).toHaveLength(0)
    expect($('compareHiddenNote').hidden).toBe(true)
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
  })

  it('lens mode: AC10: lenses: /lenses failure and retry', async () => {
    handlers.lenses = () => {
      throw new Error('offline')
    }
    await startLens()
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
    expect($('compareRuler').querySelector('.ghost-field')).toBeNull()
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
    expect($('compareStatus').hidden).toBe(true)
    expect($('compareThinNote').hidden).toBe(true)
    expect(rows()).toHaveLength(0)
    width = 350
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(rows()).toHaveLength(0)
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
    const retry = $('compareErrorRetry')
    expect(retry).not.toBeNull()
    handlers.lenses = echo
    const before = lensCalls().length
    click(retry)
    await settle(220)
    expect(lensCalls().length).toBe(before + 1)
    expect($('compareRuler').textContent).not.toContain('Não foi possível carregar a comparação.')
    expect(rows()).toHaveLength(1)
  })

  it('lens mode: AC10: lenses: peopleError', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await startLens('', { people: [], peopleError: new Error('down') })
    expect(calls).toEqual([])
    expect($('compareRuler').hidden).toBe(true)
    expect($('compareStatus').hidden).toBe(true)
    expect($('compareHiddenNote').hidden).toBe(true)
    expect($('compareThinNote').hidden).toBe(true)
    expect($('compareDetail').textContent).toContain('Falha de rede ou base indisponível.')
    expect($('compareDetail').textContent).not.toContain('Nenhuma pessoa cadastrada.')
    expect($('compare').querySelector('img')).toBeNull()
    const retry = $('compareRetry')
    expect(retry.textContent).toContain('Tentar novamente')
    click(retry)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('lens mode: AC10: no people says so and fetches nothing', async () => {
    await startLens('', { people: [] })
    expect(calls).toEqual([])
    expect($('compareRuler').hidden).toBe(true)
    expect($('compareDetail').textContent).toContain('Nenhuma pessoa cadastrada.')
  })

  it('lens mode: AC12: lenses: combobox sync after programmatic writes', async () => {
    await startLens('lenses.a=lean:left')
    for (const id of ['compareLensA', 'compareLensB']) expect(select(id).hasAttribute('hidden')).toBe(true)
    expect(input('compareLensAInput').value).toBe('Esquerda')
    expect(input('compareLensBInput').value).toBe('Google News')
    expect(input('compareLensAInput').getAttribute('aria-label')).toBe('Lente A')
    expect(input('compareLensBInput').getAttribute('aria-label')).toBe('Lente B')
    expect(input('compareLensAInput').getAttribute('aria-controls')).toBe('compareLensAList')
    expect(input('compareLensBInput').getAttribute('aria-controls')).toBe('compareLensBList')
    expect($('compareLensAList').getAttribute('role')).toBe('listbox')
    expect($('compareLensAList').getAttribute('aria-label')).toBe('Opções da lente A')
    expect($('compareLensBList').getAttribute('aria-label')).toBe('Opções da lente B')
  })

  it('lens mode: AC12: lenses: an optgroup refill that drops a domain resyncs the input text', async () => {
    await startLens('lenses.a=domain:folha.uol.com.br&lenses.b=domain:g1.globo.com')
    expect(input('compareLensAInput').value).toBe('folha.uol.com.br')
    expect(input('compareLensBInput').value).toBe('g1.globo.com')
    handlers.sources = () => [g1]
    await change('comparePerson', 'bolsonaro')
    expect(input('compareLensAInput').value).toBe('Tudo')
    expect(input('compareLensBInput').value).toBe('g1.globo.com')
  })

  it('lens mode: AC12: picking a listbox option writes the select, fires change and the figure reloads', async () => {
    await startLens()
    const before = lensCalls().length
    let changes = 0
    select('compareLensA').addEventListener('change', () => changes++)
    input('compareLensAInput').dispatchEvent(new Event('focus'))
    flushSync()
    expect($('compareLensAList').hasAttribute('hidden')).toBe(false)
    const option = $('compareLensAList').querySelector('[data-value="domain:g1.globo.com"]') as HTMLElement
    expect(option).not.toBeNull()
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    flushSync()
    await settle(220)
    expect(select('compareLensA').value).toBe('domain:g1.globo.com')
    expect(changes).toBe(1)
    expect(input('compareLensAInput').value).toBe('g1.globo.com')
    expect(lensCalls()).toHaveLength(before + 1)
    expect(lensCalls().pop()!.params.get('a')).toBe('domain:g1.globo.com')
    expect(lensCalls().pop()!.params.get('b')).toBe('source:gnews')
  })

  it('lens mode: Escape inside an open lens combobox closes the list but keeps the pick and the card', async () => {
    await startLens()
    click(rows()[0])
    await settle()
    input('compareLensAInput').dispatchEvent(new Event('focus'))
    flushSync()
    expect($('compareLensAList').hidden).toBe(false)
    input('compareLensAInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
    await settle()
    expect($('compareLensAList').hidden).toBe(true)
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('lens mode: AC13: lenses: Fonte options equal SOURCES', async () => {
    await startLens()
    for (const id of ['compareLensA', 'compareLensB']) {
      const groups = [...select(id).querySelectorAll('optgroup')]
      expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Veículo', 'Viés', 'Fonte'])
      expect([...groups[2].querySelectorAll('option')].map((o) => o.value)).toEqual(SOURCES.map((s) => `source:${s}`))
      expect([...groups[1].querySelectorAll('option')].map((o) => o.value)).toEqual(['lean:left', 'lean:center', 'lean:right'])
      expect(select(id).options[0].value).toBe('all')
    }
  })

  it('lens mode: AC13: the ids exist and the limit options are 20/40/60/100', async () => {
    await startLens()
    for (const id of ['compareTitle', 'compareMode', 'comparePerson', 'compareLensA', 'compareLensB', 'compareLensAOutlets', 'compareLensBOutlets', 'compareLensAInput', 'compareLensAList', 'compareLensBInput', 'compareLensBList', 'compareDays', 'compareLimit', 'compareStatus', 'compareRuler', 'compareDetail', 'compareHiddenNote', 'compareThinNote']) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
    expect([...select('compareLimit').options].map((o) => Number(o.value))).toEqual([20, 40, 60, 100])
    expect(select('compareLimit').value).toBe('20')
    expect([...select('comparePerson').options].map((o) => o.value)).toEqual(['lula', 'bolsonaro'])
  })

  it('lens mode: the group headings, the side labels and the chart aria label name both lenses and the person', async () => {
    const terms: CompareTerm[] = [reforma, { term: 'stf', kind: 'word', a: side(4), b: side(3) }, { term: 'eleicao', kind: 'hashtag', a: null, b: side(6) }]
    handlers.lenses = () => lensPayload(terms, 'domain:folha.uol.com.br', 'lean:right')
    await startLens()
    expect([...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
    expect([...$('compareRuler').querySelectorAll('.butterfly-group-head')].map((e) => e.textContent)).toEqual(['só folha.uol.com.br', 'dos dois', 'só Direita'])
    expect($('compareRuler').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Barras comparando folha.uol.com.br e Direita para Lula')
    expect($('compareRuler').getAttribute('aria-label')).toBe('Barras comparando dois recortes da mesma pessoa')
    expect(rows().find((r) => r.getAttribute('data-term') === 'reforma')!.getAttribute('aria-label')).toBe('reforma: folha.uol.com.br 5 documentos, Direita nenhum documento')
    await change('comparePerson', 'bolsonaro')
    expect($('compareRuler').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Barras comparando folha.uol.com.br e Direita para Bolsonaro')
  })

  it('lens mode: rows are chosen by PMI, not count, and the bars are document share', async () => {
    const terms: CompareTerm[] = Array.from({ length: 25 }, (_, i) => ({ term: `w${i}`, kind: 'word', a: side(100 - i, 0.1 + i * 0.2), b: null }))
    handlers.lenses = () => lensPayload(terms)
    await startLens()
    const shown = rows().map((r) => r.getAttribute('data-term'))
    expect(shown).toHaveLength(20)
    expect(shown).toContain('w24')
    expect(shown).not.toContain('w0')
    const bar = (term: string) => barOf(rows().find((r) => r.getAttribute('data-term') === term)!.querySelector('.butterfly-bar')!)
    expect(bar('w24') / bar('w5')).toBeCloseTo(76 / 95, 5)
    expect(rows().find((r) => r.getAttribute('data-term') === 'w24')!.querySelector('.butterfly-count')?.textContent).toBe('76')
  })

  it('lens mode: the measure and source selects sit under a hidden wrapper and neither reaches the request', async () => {
    await startLens('source=gdelt&compare.measure=pmi')
    expect(select('compareMeasure').closest('[hidden]')).not.toBeNull()
    expect(select('compareSource').closest('[hidden]')).not.toBeNull()
    expect(lensCalls()[0].params.has('measure')).toBe(false)
    expect(lensCalls()[0].params.has('source')).toBe(false)
  })

  it('exactly one ResizeObserver watches the chart in both modes', async () => {
    boot()
    await start()
    expect(observers.filter((o) => o.target === $('compareRuler'))).toHaveLength(1)
    await change('compareMode', 'recortes')
    expect(observers.filter((o) => o.target === $('compareRuler'))).toHaveLength(1)
    expect(observers).toHaveLength(1)
  })

  for (const days of ['30', '60'])
    it(`lens mode: AC25: a shared link with days=${days} leaves the select on 21 and requests days=21 on both routes`, async () => {
      await startLens(`days=${days}`)
      expect(select('compareDays').value).toBe('21')
      expect(lensCalls()[0].params.get('days')).toBe('21')
      expect(of('sources')[0].params.get('days')).toBe('21')
    })

  it('lens mode: AC25: a shared link with days=7 still selects 7 and the first /lenses and /sources carry it', async () => {
    await startLens('days=7')
    expect(select('compareDays').value).toBe('7')
    expect(lensCalls()[0].params.get('days')).toBe('7')
    expect(of('sources')[0].params.get('days')).toBe('7')
  })

  it('lens mode: AC24: the day select offers exactly 7 and 21, in that order, with 21 selected, and the first /lenses and /sources carry days=21', async () => {
    await startLens()
    expect([...select('compareDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect(select('compareDays').value).toBe('21')
    expect(lensCalls()[0].params.get('days')).toBe('21')
    expect(of('sources')[0].params.get('days')).toBe('21')
  })
})

describe('Compare mode switch (#326)', () => {
  it('mode: the select is first with both options and pessoas selected', async () => {
    boot()
    await start()
    const first = document.querySelector('#compare .sentence-line select') as HTMLSelectElement
    expect(first.id).toBe('compareMode')
    expect([...first.options].map((o) => o.value)).toEqual(['pessoas', 'recortes'])
    expect([...first.options].map((o) => o.textContent)).toEqual(['duas pessoas', 'uma pessoa, dois recortes'])
    expect(first.value).toBe('pessoas')
  })

  it('mode: visible controls per mode, shared days and limit are the same nodes', async () => {
    boot()
    await start()
    const hiddenIn = (id: string) => $(id).closest('[hidden]') !== null
    const days = $('compareDays')
    const limit = $('compareLimit')
    for (const id of ['compareA', 'compareB', 'compareSource', 'compareMeasure', 'compareMode', 'compareDays', 'compareLimit']) expect(hiddenIn(id), id).toBe(false)
    for (const id of ['comparePerson', 'compareLensA', 'compareLensB', 'compareLensAInput', 'compareLensBInput']) expect(hiddenIn(id), id).toBe(true)
    await change('compareMode', 'recortes')
    for (const id of ['comparePerson', 'compareLensAInput', 'compareLensBInput', 'compareMode', 'compareDays', 'compareLimit']) expect(hiddenIn(id), id).toBe(false)
    for (const id of ['compareA', 'compareB', 'compareSource', 'compareMeasure']) expect(hiddenIn(id), id).toBe(true)
    expect($('compareDays')).toBe(days)
    expect($('compareLimit')).toBe(limit)
    expect(document.querySelectorAll('#compare .sentence-line .pick')).toHaveLength(10)
  })

  it('mode: days and limit are one state across the modes and reach the next request', async () => {
    boot()
    await start()
    expect([...select('compareLimit').options].map((o) => Number(o.value))).toEqual([20, 40, 60, 100])
    expect(select('compareLimit').value).toBe('20')
    await change('compareDays', '7')
    await change('compareLimit', '60')
    await change('compareMode', 'recortes')
    expect(select('compareDays').value).toBe('7')
    expect(select('compareLimit').value).toBe('60')
    expect(lensCalls()[0].params.get('days')).toBe('7')
    expect(lensCalls()[0].params.get('limit')).toBe('60')
    await change('compareLimit', '100')
    await change('compareMode', 'pessoas')
    expect(select('compareLimit').value).toBe('100')
    expect(compareCalls().pop()!.params.get('limit')).toBe('100')
    expect(compareCalls().pop()!.params.get('days')).toBe('7')
  })

  it('mode: no /sources request at boot in person mode', async () => {
    boot()
    await start()
    await change('compareDays', '7')
    await change('comparePerson', 'bolsonaro').catch(() => {})
    expect(of('sources')).toEqual([])
  })

  it('mode: switching to lens mode requests /sources once, with the shared days', async () => {
    boot()
    await start()
    await change('compareMode', 'recortes')
    expect(of('sources')).toHaveLength(1)
    const c = of('sources')[0]
    expect(c.path).toBe('/api/people/lula/sources')
    expect(c.url).toBe('/api/people/lula/sources?' + sourcesParams({ days: '21', sort: 'count', limit: '80', source: 'all' }).toString())
    expect(c.params.get('days')).toBe('21')
    expect(c.params.get('source')).toBe('all')
    expect(lensCalls()).toHaveLength(1)
  })

  it('mode: compare.mode=recortes opens lens mode', async () => {
    boot({ search: '?compare.mode=recortes' })
    await start()
    await settle(220)
    expect(select('compareMode').value).toBe('recortes')
    expect($('comparePerson').closest('[hidden]')).toBeNull()
    expect($('compareA').closest('[hidden]')).not.toBeNull()
    expect(compareCalls()).toEqual([])
    expect(lensCalls()).toHaveLength(1)
  })

  it('mode: an invalid compare.mode is ignored', async () => {
    boot({ search: '?compare.mode=foo' })
    await start()
    expect(select('compareMode').value).toBe('pessoas')
    expect(compareCalls()).toHaveLength(1)
  })

  it('mode: compare.mode=pessoas wins over lenses.* and a later switch shows the seeded lens', async () => {
    boot({ search: '?compare.mode=pessoas&lenses.a=lean:left' })
    await start()
    expect(select('compareMode').value).toBe('pessoas')
    expect(compareCalls()).toHaveLength(1)
    expect(lensCalls()).toHaveLength(0)
    expect(select('compareLensA').value).toBe('lean:left')
    await change('compareMode', 'recortes')
    expect(lensCalls()[0].params.get('a')).toBe('lean:left')
    expect(input('compareLensAInput').value).toBe('Esquerda')
  })

  it('mode: a domain seed given while person mode opens waits for the first lens-mode fill', async () => {
    boot({ search: '?compare.mode=pessoas&lenses.a=domain:folha.uol.com.br' })
    await start()
    expect(of('sources')).toEqual([])
    await change('compareMode', 'recortes')
    expect(select('compareLensA').value).toBe('domain:folha.uol.com.br')
    expect(lensCalls()[0].params.get('a')).toBe('domain:folha.uol.com.br')
  })

  it('mode: where both seeds name days or limit, the opening mode wins', async () => {
    boot({ search: '?compare.mode=pessoas&compare.days=7&lenses.days=21&compare.limit=40&lenses.limit=60' })
    await start()
    expect(select('compareDays').value).toBe('7')
    expect(select('compareLimit').value).toBe('40')
    remount()
    boot({ search: '?compare.mode=recortes&compare.days=7&lenses.days=21&compare.limit=40&lenses.limit=60' })
    await start()
    await settle(220)
    expect(select('compareDays').value).toBe('21')
    expect(select('compareLimit').value).toBe('60')
  })

  it('mode: switching aborts request and bridges, releases the pick, closes only compare\'s card, paints no stale rows', async () => {
    const terms: CompareTerm[] = [{ term: 'stf', kind: 'word', a: side(5), b: side(5) }]
    let bridgeCall: Call | undefined
    handlers['/api/compare'] = () => payload(terms)
    handlers['/api/compare/bridges'] = (call) => {
      bridgeCall ??= call
      return new Promise(() => {})
    }
    boot()
    await start()
    click(rows()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(bridgeCall!.signal?.aborted).toBe(false)
    fire('compareMode', 'recortes')
    expect(bridgeCall!.signal?.aborted).toBe(true)
    expect(docsCard.isOpen()).toBe(false)
    expect(rows()).toHaveLength(0)
    expect($('compareRuler').querySelectorAll('.butterfly-ghost-row')).toHaveLength(8)
    expect($('compareRuler').textContent).not.toContain('Lula')
    expect($('compareDetail').textContent).not.toContain('stf')
    await settle(220)
    expect(lensCalls()).toHaveLength(1)
    expect(compareCalls()).toHaveLength(1)
    expect(rows().map((r) => r.getAttribute('data-term'))).toEqual(['reforma'])
    expect([...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent)).toEqual(['Bluesky', 'Google News'])

    click(rows()[0])
    await settle()
    atlasCard()
    await settle()
    expect(docsCard.openedBy('compare')).toBe(false)
    await change('compareMode', 'pessoas')
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('mode: after a switch in either direction the figure shows the ghost, not a dimmed old chart', async () => {
    boot()
    await start()
    expect(rows()).toHaveLength(1)
    fire('compareMode', 'recortes')
    await settle()
    expect($('compare').classList.contains('is-loading'), 'person to lens, dimmed').toBe(false)
    expect($('compareRuler').querySelectorAll('.butterfly-ghost-row')).toHaveLength(8)
    await settle(220)
    expect(rows()).toHaveLength(1)
    fire('compareMode', 'pessoas')
    await settle()
    expect($('compare').classList.contains('is-loading'), 'lens to person, dimmed').toBe(false)
    expect(rows()).toHaveLength(0)
    await settle(220)
    expect(rows()).toHaveLength(1)
    expect($('compare').classList.contains('is-loading')).toBe(false)
  })

  it('mode: a /compare held in flight, switch to recortes, /compare resolves while /sources is pending and a resize fires: nothing paints, nothing throws, the old signal is aborted right after flushSync', async () => {
    const compare = held()
    const outlets = held()
    handlers['/api/compare'] = () => compare.promise
    handlers.sources = () => outlets.promise
    boot()
    await start()
    const old = compareCalls()[0]
    expect(old.signal?.aborted).toBe(false)
    fire('compareMode', 'recortes')
    expect(old.signal?.aborted).toBe(true)
    compare.release(payload([reforma]))
    await settle()
    width = 333
    for (const o of observers) expect(() => o.cb()).not.toThrow()
    flushSync()
    await settle()
    expect(rows()).toHaveLength(0)
    expect($('compareRuler').querySelectorAll('.butterfly-ghost-row')).toHaveLength(8)
    outlets.release([folha])
    await settle(220)
    expect(lensCalls()).toHaveLength(1)
    expect(rows()).toHaveLength(1)
    expect([...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent)).toEqual(['Bluesky', 'Google News'])
  })

  it('mode: a second switch during ensureOutlets leaves only the later load', async () => {
    const first = held()
    let n = 0
    handlers.sources = () => (++n === 1 ? first.promise : [folha, g1])
    boot()
    await start()
    fire('compareMode', 'recortes')
    await settle()
    fire('compareMode', 'pessoas')
    await settle()
    fire('compareMode', 'recortes')
    await settle(220)
    first.release([g1])
    await settle(220)
    expect(lensCalls()).toHaveLength(1)
    expect(compareCalls()).toHaveLength(1)
    expect(select('compareMode').value).toBe('recortes')
    expect(outletValues('compareLensAOutlets')).toEqual(['domain:folha.uol.com.br', 'domain:g1.globo.com'])
    expect(rows()).toHaveLength(1)
  })

  it('mode: a stale switch continuation never reloads over the later switch', async () => {
    const stale = held()
    let n = 0
    handlers.sources = () => (++n === 1 ? stale.promise : [folha, g1])
    boot()
    await start()
    expect(compareCalls()).toHaveLength(1)
    fire('compareMode', 'recortes')
    await settle()
    await settle(25000)
    const second = held()
    handlers['/api/compare'] = () => second.promise
    fire('compareMode', 'pessoas')
    await settle(220)
    expect(compareCalls()).toHaveLength(2)
    expect(compareCalls()[1].signal?.aborted).toBe(false)
    stale.release([g1])
    await settle(500)
    expect(compareCalls()).toHaveLength(2)
    expect(compareCalls()[1].signal?.aborted).toBe(false)
    expect(lensCalls()).toEqual([])
    second.release(payload([reforma]))
    await settle(220)
    expect(rows()).toHaveLength(1)
  })

  it('mode: a switch away while /sources is pending drops that fill and loads the other mode', async () => {
    const outlets = held()
    handlers.sources = () => outlets.promise
    boot()
    await start()
    fire('compareMode', 'recortes')
    await settle()
    fire('compareMode', 'pessoas')
    await settle(220)
    outlets.release([folha])
    await settle(220)
    expect(lensCalls()).toEqual([])
    expect(outletValues('compareLensAOutlets')).toEqual([])
    expect([...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent)).toEqual(['Lula', 'Bolsonaro'])
  })

  it('mode: pessoas, recortes, pessoas inside the memo window issues one request per mode, and a memo hit records its own api mark', async () => {
    boot()
    await start()
    const axis = () => [...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent)
    expect(axis()).toEqual(['Lula', 'Bolsonaro'])
    await change('compareMode', 'recortes')
    expect(axis()).toEqual(['Bluesky', 'Google News'])
    const measure = vi.spyOn(performance, 'measure')
    await change('compareMode', 'pessoas')
    expect(axis()).toEqual(['Lula', 'Bolsonaro'])
    await change('compareMode', 'recortes')
    expect(axis()).toEqual(['Bluesky', 'Google News'])
    expect(compareCalls()).toHaveLength(1)
    expect(lensCalls()).toHaveLength(1)
    const hits = measure.mock.calls.filter(([name, o]) => String(name).startsWith('api:') && (o as { detail: { cache: string } }).detail.cache === 'memory').map(([name]) => name)
    expect(hits).toEqual(['api:compare', 'api:lenses'])
    measure.mockRestore()
  })

  it('mode: a days change in person mode refetches /sources on entering lens mode, an unchanged key does not', async () => {
    boot()
    await start()
    await change('compareDays', '7')
    await change('compareMode', 'recortes')
    expect(of('sources')).toHaveLength(1)
    expect(of('sources')[0].params.get('days')).toBe('7')
    await change('compareMode', 'pessoas')
    await change('compareMode', 'recortes')
    expect(of('sources')).toHaveLength(1)
    await change('compareMode', 'pessoas')
    await change('compareDays', '21')
    await change('compareMode', 'recortes')
    expect(of('sources')).toHaveLength(2)
    expect(of('sources')[1].params.get('days')).toBe('21')
  })

  it('mode: sameness text per mode', async () => {
    handlers['/api/compare'] = () => payload([], lula, lula)
    boot()
    await start()
    await change('compareB', 'lula')
    expect($('compareStatus').hidden).toBe(false)
    expect($('compareStatus').textContent).toBe('Os dois lados mostram a mesma pessoa.')
    await change('compareMode', 'recortes')
    expect($('compareStatus').hidden).toBe(true)
    await change('compareLensB', 'source:bluesky')
    expect($('compareStatus').hidden).toBe(false)
    expect($('compareStatus').textContent).toBe('Os dois lados mostram o mesmo recorte.')
    await change('compareMode', 'pessoas')
    expect($('compareStatus').textContent).toBe('Os dois lados mostram a mesma pessoa.')
  })

  it('mode: hidden-note wording per mode', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'lula', kind: 'word', a: 'name', b: side(3) }, reforma])
    handlers.lenses = () => lensPayload([{ term: 'lula', kind: 'word', a: 'name', b: 'name' }, reforma])
    boot()
    await start()
    expect($('compareHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome de uma das duas pessoas.')
    await change('compareMode', 'recortes')
    expect($('compareHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome da pessoa.')
    await change('compareMode', 'pessoas')
    expect($('compareHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome de uma das duas pessoas.')
  })
})

describe('Compare thin note (#326)', () => {
  const thin = () => $('compareThinNote')

  it('thin note: follows the hidden-words note in the DOM and starts hidden', async () => {
    boot()
    await start()
    expect($('compareHiddenNote').nextElementSibling).toBe(thin())
    expect(thin().tagName).toBe('P')
    expect(thin().classList.contains('note')).toBe(true)
    expect(thin().hidden).toBe(true)
  })

  it('thin note: sides below 50, in A then B order with their lens labels', async () => {
    handlers.lenses = () => lensPayload([reforma], 'lean:left', 'lean:right', [14, 25])
    await startLens()
    expect(thin().hidden).toBe(false)
    expect(thin().textContent).toBe('Esquerda tem só 14 textos neste recorte: leia com cuidado. Direita tem só 25 textos neste recorte: leia com cuidado.')
  })

  it('thin note: exactly 50 on both sides is not thin; one thin side names only itself', async () => {
    handlers.lenses = () => lensPayload([reforma], 'lean:left', 'lean:right', [50, 50])
    await startLens()
    expect(thin().hidden).toBe(true)
    expect(thin().textContent).toBe('')
    handlers.lenses = () => lensPayload([reforma], 'lean:left', 'lean:right', [400, 49])
    await change('compareDays', '7')
    expect(thin().textContent).toBe('Direita tem só 49 textos neste recorte: leia com cuidado.')
  })

  it('thin note: says texto for 1 and textos for 0, and a side with no documents draws no bars', async () => {
    handlers.lenses = () => lensPayload([{ term: 'reforma', kind: 'word', a: null, b: side(5) }], 'lean:left', 'lean:right', [1, 400])
    await startLens()
    expect(thin().textContent).toBe('Esquerda tem só 1 texto neste recorte: leia com cuidado.')
    handlers.lenses = () => lensPayload([{ term: 'reforma', kind: 'word', a: null, b: side(5) }], 'lean:left', 'lean:right', [0, 400])
    await change('compareDays', '7')
    expect(thin().textContent).toBe('Esquerda tem só 0 textos neste recorte: leia com cuidado.')
    expect($('compareRuler').querySelectorAll('.butterfly-bar[data-side="a"]')).toHaveLength(0)
    expect($('compareRuler').querySelectorAll('.butterfly-bar[data-side="b"]')).toHaveLength(1)
  })

  it('thin note: identical sentences collapse into one', async () => {
    handlers.lenses = () => lensPayload([reforma], 'lean:left', 'lean:left', [3, 3])
    await startLens()
    expect(thin().textContent).toBe('Esquerda tem só 3 textos neste recorte: leia com cuidado.')
  })

  it('thin note: hidden in person mode even when a side is under 50, and while the ghost shows', async () => {
    const gate = held()
    handlers['/api/compare'] = () => gate.promise
    boot()
    await start()
    expect(thin().hidden).toBe(true)
    gate.release({ ...payload([reforma]), a: { person: lula, about: 10 }, b: { person: bolsonaro, about: 5 } })
    await settle()
    expect(thin().hidden).toBe(true)
    expect(thin().textContent).toBe('')
    const lens = held()
    handlers.lenses = () => lens.promise
    fire('compareMode', 'recortes')
    await settle(220)
    expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    expect(thin().hidden).toBe(true)
    lens.release(lensPayload([reforma], 'lean:left', 'lean:right', [10, 5]))
    await settle()
    expect(thin().hidden).toBe(false)
  })

  it('thin note: hidden on error', async () => {
    handlers.lenses = () => {
      throw new Error('offline')
    }
    await startLens()
    expect(thin().hidden).toBe(true)
  })
})

describe('Compare request failures and the people outage, in both modes (#326)', () => {
  for (const mode of ['pessoas', 'recortes'] as const) {
    const open = async (patch: Partial<{ people: typeof people; peopleError: unknown }> = {}) => {
      boot({ search: `?compare.mode=${mode}`, ...patch })
      await start()
      await settle(220)
    }
    const route = () => (mode === 'pessoas' ? compareCalls() : lensCalls())
    const fail = () => {
      const boom = () => {
        throw new Error('offline')
      }
      if (mode === 'pessoas') handlers['/api/compare'] = boom
      else handlers.lenses = boom
    }

    it(`states: a failed request prints the note and #compareErrorRetry issues a new request (${mode})`, async () => {
      fail()
      await open()
      expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
      expect($('compareRuler').querySelector('img')).toBeNull()
      expect($('compareDetail').textContent).toContain(mode === 'pessoas' ? 'Clique numa palavra para ver os números dos dois lados.' : 'Clique numa palavra para ver os números das duas lentes.')
      expect(document.getElementById('compareRetry')).toBeNull()
      const before = route().length
      handlers['/api/compare'] = () => payload([reforma])
      handlers.lenses = echo
      click($('compareErrorRetry'))
      await settle(220)
      expect(route()).toHaveLength(before + 1)
      expect(rows()).toHaveLength(1)
    })

    it(`states: empty payload prints the empty note (${mode})`, async () => {
      handlers['/api/compare'] = () => payload([])
      handlers.lenses = () => lensPayload([])
      await open()
      expect($('compareRuler').textContent).toContain('Nenhuma palavra neste recorte.')
    })

    it(`states: peopleError fetches nothing, hides the chart and #compareRetry reloads the page (${mode})`, async () => {
      const reload = vi.fn()
      vi.stubGlobal('location', { ...window.location, reload })
      await open({ people: [], peopleError: new Error('down') })
      expect(calls).toEqual([])
      expect($('compareRuler').hidden).toBe(true)
      expect($('compare').querySelector('img')).toBeNull()
      click($('compareRetry'))
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it(`states: no people says so and fetches nothing (${mode})`, async () => {
      await open({ people: [] })
      expect(calls).toEqual([])
      expect($('compareDetail').textContent).toContain('Nenhuma pessoa cadastrada.')
    })

    it(`states: before bootData.ready the ghost shows and nothing fetches (${mode})`, async () => {
      await start()
      expect(calls).toEqual([])
      expect($('compareRuler').querySelector('.ghost-field')).not.toBeNull()
    })
  }

  it('states: a single tracked person works in both modes', async () => {
    boot({ people: [lula] })
    await start()
    expect(select('compareA').value).toBe('lula')
    expect(select('compareB').value).toBe('lula')
    await change('compareMode', 'recortes')
    expect(select('comparePerson').value).toBe('lula')
    expect(lensCalls()).toHaveLength(1)
    expect(rows()).toHaveLength(1)
  })

  it('states: switching to lens mode with a people outage fetches nothing and keeps the retry', async () => {
    boot({ people: [], peopleError: new Error('down') })
    await start()
    await change('compareMode', 'recortes')
    expect(calls).toEqual([])
    expect($('compareRetry')).not.toBeNull()
    expect($('compareRuler').hidden).toBe(true)
  })
})

describe('Compare lens B survives quick switching while /sources and /lenses are held (#326)', () => {
  type Trigger = 'boot' | 'mode' | 'days' | 'person'
  type Order = 'sources, lenses' | 'lenses, sources' | 'sources, lenses reversed' | 'lenses reversed, sources'
  type Pending = { gate: ReturnType<typeof held>; call: Call }

  const lensName = (token: string) => ({ 'lean:left': 'Esquerda', 'lean:center': 'Centro', 'lean:right': 'Direita', 'source:gdelt': 'GDELT', all: 'Tudo' })[token] ?? token
  const sequences = [
    ['lean:left', 'lean:center'],
    ['lean:left', 'lean:center', 'lean:right', 'lean:center'],
    ['lean:center', 'lean:left', 'source:gdelt', 'all', 'lean:left', 'lean:center'],
  ]
  const orders: Order[] = ['sources, lenses', 'lenses, sources', 'sources, lenses reversed', 'lenses reversed, sources']

  const pickByCombobox = (value: string) => {
    input('compareLensBInput').dispatchEvent(new FocusEvent('focus'))
    flushSync()
    const option = $('compareLensBList').querySelector(`[data-value="${value}"]`) as HTMLElement
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    flushSync()
  }
  const pickBySelect = (value: string) => fire('compareLensB', value)

  const run = async (trigger: Trigger, values: string[], gap: number, order: Order, pickWith: (value: string) => void) => {
    const lenses: Pending[] = []
    const sources: ReturnType<typeof held>[] = []
    let holdSources = false
    handlers.sources = () => {
      if (!holdSources) return [folha, g1]
      const gate = held()
      sources.push(gate)
      return gate.promise
    }
    handlers.lenses = (call) => {
      if (!holdLenses) return echo(call)
      const gate = held()
      lenses.push({ gate, call })
      return gate.promise
    }
    let holdLenses = false

    if (trigger === 'boot') {
      holdSources = holdLenses = true
      await startLens()
    } else if (trigger === 'mode') {
      boot()
      await start()
      holdSources = holdLenses = true
      fire('compareMode', 'recortes')
      await settle()
    } else {
      await startLens()
      holdSources = holdLenses = true
      if (trigger === 'days') fire('compareDays', '7')
      else fire('comparePerson', 'bolsonaro')
      await settle()
    }

    for (const value of values) {
      pickWith(value)
      await settle(gap)
    }
    await settle(300)

    const releaseSources = async () => {
      holdSources = false
      sources.splice(0).forEach((gate) => gate.release([folha, g1]))
      await settle(300)
    }
    const releaseLenses = async (reversed: boolean) => {
      const pending = lenses.splice(0)
      ;(reversed ? pending.reverse() : pending).forEach(({ gate, call }) => gate.release(echo(call)))
      await settle(300)
    }
    for (const step of order.split(', ')) {
      if (step === 'sources') await releaseSources()
      else await releaseLenses(step.endsWith('reversed'))
    }
    holdSources = holdLenses = false
    for (let round = 0; round < 4; round++) {
      await releaseSources()
      await releaseLenses(false)
      await settle(300)
    }
  }

  const expectEndsOn = (value: string) => {
    expect(select('compareLensB').value, 'the hidden select').toBe(value)
    expect(input('compareLensBInput').value, 'the combobox input').toBe(lensName(value))
    const last = lensCalls().at(-1)
    expect(last?.params.get('b'), 'the last /lenses request').toBe(value)
    expect(select('compareLensA').value, 'lens A is left alone').toBe('source:bluesky')
    expect([...$('compareRuler').querySelectorAll('.butterfly-axis-label')].map((e) => e.textContent), 'the painted axis labels').toEqual(['Bluesky', lensName(value)])
  }

  for (const trigger of ['boot', 'mode', 'days', 'person'] as Trigger[])
    for (const values of sequences)
      for (const gap of [0, 200])
        for (const order of orders)
          it(`B quick switching: refill by ${trigger}, ${values.join(' > ')}, ${gap} ms apart, resolved ${order}`, async () => {
            await run(trigger, values, gap, order, pickBySelect)
            expectEndsOn(values.at(-1)!)
          })

  for (const trigger of ['boot', 'days'] as Trigger[])
    for (const values of sequences)
      for (const order of orders)
        it(`B quick switching through the combobox: refill by ${trigger}, ${values.join(' > ')}, resolved ${order}`, async () => {
          await run(trigger, values, 0, order, pickByCombobox)
          expectEndsOn(values.at(-1)!)
        })
})

describe('Compare binds a payload to what it was asked for (#326 validator round 1)', () => {
  const chartLabel = () => $('compareRuler').querySelector('[role="group"]')?.getAttribute('aria-label')

  for (const [id, value] of [
    ['comparePerson', 'bolsonaro'],
    ['compareDays', '7'],
  ] as const)
    it(`an old /lenses landing while ${id} waits on /sources is dropped, never painted under the new ${id === 'comparePerson' ? 'person' : 'window'}`, async () => {
      await startLens()
      const lensGate = held()
      handlers.lenses = (call) => lensGate.promise.then(() => lensPayload([{ ...reforma, term: `from-${call.person}-${call.params.get('days')}` }]))
      fire('compareLimit', '40')
      await settle(220)
      const sourcesGate = held()
      handlers.sources = () => sourcesGate.promise
      fire(id, value)
      await settle()
      lensGate.release(null)
      await settle()
      expect(rows().map((r) => r.dataset.term), 'the late response is not painted; the first payload stays, dimmed').toEqual(['reforma'])
      expect($('compare').classList.contains('is-loading')).toBe(true)
      handlers.lenses = (call) => lensPayload([{ ...reforma, term: `from-${call.person}-${call.params.get('days')}` }])
      sourcesGate.release([folha])
      await settle(220)
      expect(rows().map((r) => r.dataset.term)).toEqual([id === 'comparePerson' ? 'from-bolsonaro-21' : 'from-lula-7'])
      expect(chartLabel()).toContain(id === 'comparePerson' ? 'Bolsonaro' : 'Lula')
    })

  it('a payload painted for one person keeps asking for that person after the control moves on', async () => {
    handlers.lenses = (call) => lensPayload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }, { ...reforma, term: `from-${call.person}` }])
    handlers.bridges = () => ({ bridges: {} })
    await startLens()
    expect(chartLabel()).toContain('Lula')
    select('comparePerson').value = 'bolsonaro'
    click(rows().find((r) => r.dataset.term === 'from-lula')!)
    await settle()
    const docs = of('docs')
    expect(docs).toHaveLength(2)
    for (const c of docs) {
      expect(c.path).toBe('/api/people/lula/docs')
      expect(c.params.get('term')).toBe('from-lula')
      expect(c.params.get('days')).toBe('21')
    }
    expect(of('bridges').every((c) => c.path === '/api/people/lula/lenses/bridges')).toBe(true)
  })

  it('person mode: a click asks for the window and source the payload was fetched with', async () => {
    await start()
    boot({ search: '' })
    flushSync()
    await settle(220)
    const gate = held()
    handlers['/api/compare'] = () => gate.promise.then(() => payload([reforma]))
    fire('compareLimit', '40')
    await settle(220)
    fire('compareSource', 'gdelt')
    gate.release(null)
    await settle(220)
    expect(rows()).toHaveLength(1)
    click(rows()[0])
    await settle()
    for (const c of of('docs')) expect(c.params.get('source')).toBe('gdelt')
  })
})
