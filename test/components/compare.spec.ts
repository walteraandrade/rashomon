import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Compare from '../../src/ui/Compare.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import * as docsCard from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { compareParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'
import { balanceColor } from '../../src/ui/format.js'
import type { Compare as CompareData, CompareTerm } from '../../src/ui/format.js'

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const ciro = { id: 'ciro', name: 'Ciro' }
const people = [lula, bolsonaro]

const side = (count: number, pmi = 1) => ({ count, pmi, tone: null })
const reforma: CompareTerm = { term: 'reforma', kind: 'word', a: side(5, 1.2), b: null }
const payload = (terms: CompareTerm[], a = lula, b = bolsonaro): CompareData => ({ days: 30, a: { person: a, about: 5 }, b: { person: b, about: 5 }, terms })

type Call = { url: string; path: string; params: URLSearchParams; signal?: AbortSignal }
type Handler = (call: Call) => unknown
let calls: Call[]
let handlers: Record<string, Handler>
let width: number
let observers: { cb: () => void; target: unknown }[]
let target: HTMLElement
let instances: ReturnType<typeof mount>[]

const $ = (id: string) => document.getElementById(id) as HTMLElement
const select = (id: string) => $(id) as HTMLSelectElement
const words = () => [...$('compareRuler').querySelectorAll('.ruler-word')] as HTMLElement[]
const overflow = () => [...$('compareRuler').querySelectorAll('.ruler-overflow [data-term]')] as HTMLElement[]
const compareCalls = () => calls.filter((c) => c.path === '/api/compare')

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
  docsCard.mountDocsCard()
  flushSync()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  handlers = { '/api/compare': () => payload([reforma]), '/api/compare/bridges': () => ({ bridges: {} }) }
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
      const call: Call = { url, path: u.pathname, params: u.searchParams, signal: init?.signal }
      calls.push(call)
      const body = await (handlers[u.pathname] ?? (() => ({ docs: [], total: 0 })))(call)
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

  it('AC2: one .ruler-word per drawn term with data-term, data-kind, aria-pressed=false and an aria-label; overflow terms are buttons with the same hooks', async () => {
    const terms: CompareTerm[] = Array.from({ length: 70 }, (_, i) => ({ term: `palavralongademais${i}`, kind: i % 2 ? 'hashtag' : 'word', a: side(3 + (i % 9)), b: i % 3 ? side(2) : null }))
    handlers['/api/compare'] = () => payload(terms)
    boot()
    await start()
    const drawn = words()
    const spilled = overflow()
    expect(drawn.length).toBeGreaterThan(0)
    expect(spilled.length).toBeGreaterThan(0)
    expect(drawn.length + spilled.length).toBe(terms.length)
    for (const w of drawn) {
      expect(w.getAttribute('data-term')).toBeTruthy()
      expect(['word', 'hashtag']).toContain(w.getAttribute('data-kind'))
      expect(w.getAttribute('aria-pressed')).toBe('false')
      expect(w.getAttribute('aria-label')).toMatch(/documentos/)
    }
    for (const b of spilled) {
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('data-term')).toBeTruthy()
      expect(['word', 'hashtag']).toContain(b.getAttribute('data-kind'))
    }
  })

  it('AC2: a picked overflow button opens the card the same way a word does', async () => {
    const terms: CompareTerm[] = Array.from({ length: 70 }, (_, i) => ({ term: `palavralongademais${i}`, kind: 'word', a: side(3), b: side(2) }))
    handlers['/api/compare'] = () => payload(terms)
    boot()
    await start()
    const button = overflow()[0]
    click(button)
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(calls.filter((c) => c.path.endsWith('/docs') && c.params.get('term') === button.getAttribute('data-term'))).toHaveLength(2)
  })

  it('AC3: a click picks the word and opens the card once with both people, owned by compare', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
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
      const e = keydown(words()[0], key)
      expect(e.defaultPrevented).toBe(true)
      await settle()
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
      expect(docsCard.openedBy('compare')).toBe(true)
    })
  }

  it('AC3: the same word again, the background and Escape each clear the pick and close the card', async () => {
    boot()
    await start()
    const releasers: [string, () => void][] = [
      ['same word', () => click(words()[0])],
      ['background', () => click($('compareRuler'))],
      ['escape', escape],
    ]
    for (const [name, release] of releasers) {
      click(words()[0])
      await settle()
      expect(docsCard.openedBy('compare'), `${name}: open`).toBe(true)
      release()
      await settle()
      expect(docsCard.isOpen(), `${name}: card closed`).toBe(false)
      expect(words()[0].getAttribute('aria-pressed'), `${name}: unpicked`).toBe('false')
      expect($('compareDetail').textContent).toMatch(/Clique numa palavra/)
    }
  })

  it('AC4: a control change leaves a card another figure opened over a compare pick', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    expect(docsCard.openedBy('compare')).toBe(false)
    await change('compareDays', '7')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('AC4: a control change closes the card compare owns', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    await change('compareDays', '7')
    expect(docsCard.isOpen()).toBe(false)
  })

  it('AC5: changing the measure repaints and issues no fetch, keeping the pick', async () => {
    handlers['/api/compare'] = () => payload([{ term: 'mixed', kind: 'word', a: side(10, 0.1), b: side(2, 5) }])
    boot()
    await start()
    click(words()[0])
    await settle()
    clearScopes()
    const before = calls.length
    const markup = $('compareRuler').innerHTML
    await change('compareMeasure', 'pmi')
    expect(calls.length).toBe(before)
    expect($('compareRuler').innerHTML).not.toBe(markup)
    expect($('compareDetail').textContent).toMatch(/mixed/)
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
  })

  for (const [id, value] of [
    ['compareA', 'bolsonaro'],
    ['compareB', 'lula'],
    ['compareDays', '60'],
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
    boot({ search: '?days=7&compare.days=60' })
    await start()
    expect(select('compareDays').value).toBe('60')
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
    expect(words().map((w) => w.getAttribute('data-term'))).toEqual(['reforma'])
  })

  it('AC9: the detail line names both people, "nenhum documento" for a side without the word', async () => {
    boot()
    await start()
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números dos dois lados.')
    click(words()[0])
    await settle()
    const detail = $('compareDetail').textContent ?? ''
    expect(detail).toContain('reforma')
    expect(detail).toContain('Lula')
    expect(detail).toContain('Bolsonaro')
    expect(detail).toContain('nenhum documento')
    expect(detail).not.toMatch(/\b0 documentos/)
  })

  it('AC10: bridges load after the ruler paints and repaint it with the bridge underlined', async () => {
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
    expect($('compareRuler').querySelectorAll('.ruler-bridge').length).toBe(1)
    expect($('compareRuler').querySelector('.ruler-bridge')?.getAttribute('data-term')).toBe('stf')
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
    expect($('compareRuler').querySelectorAll('.ruler-bridge')).toHaveLength(0)
  })

  it('a click on the header, the subtitle or a select keeps the pick and the card', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    for (const el of [document.querySelector('#compare .figure-head')!, document.querySelector('#compare .figure-sub')!, select('compareA'), select('compareMeasure'), $('compareDetail')]) {
      click(el)
      await settle()
      expect(docsCard.openedBy('compare')).toBe(true)
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
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
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('compare')).toBe(true)
    release(payload([{ term: 'reforma', kind: 'word', a: side(9), b: null }]))
    await settle()
    expect($('compare').classList.contains('is-loading')).toBe(false)
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
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
    click(words()[0])
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
    await change('compareDays', '60')
    const before = calls.length
    boot({ search: '?compare.days=7', people: [...people, ciro] })
    flushSync()
    await settle(500)
    expect(select('compareDays').value).toBe('60')
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
  it('review K3: ghost: axis, five ticks, sr-only prose, detail sides', async () => {
    await start()
    expect($('compareRuler').textContent).toContain('Lendo a régua.')
    expect($('compareRuler').querySelectorAll('.ruler-axis')).toHaveLength(1)
    expect($('compareRuler').querySelectorAll('.ruler-tick')).toHaveLength(5)
    expect($('compareDetail').querySelector('.detail-sides')).not.toBeNull()
  })
  it('review K4: note says how many words the recorte carries', async () => {
    handlers['/api/compare'] = () => payload([reforma, { term: 'pix', kind: 'word', a: null, b: side(2) }, { term: 'stf', kind: 'word', a: side(3), b: side(3) }])
    boot()
    await start()
    expect($('compareRuler').querySelector('p.note')?.textContent).toMatch(/: 3 palavras neste recorte\.$/)
  })
  it('review K5: word label, title, hooks and text shape', async () => {
    boot()
    await start()
    const w = words()[0]
    expect(w.getAttribute('aria-label')).toBe('reforma, 5 documentos')
    expect(w.querySelector('title')?.textContent).toBe('reforma · Palavra · 5 documentos')
    expect(w.getAttribute('tabindex')).toBe('0')
    expect(w.querySelector('.ruler-hit')).not.toBeNull()
    expect(w.querySelector('.ruler-glow')).not.toBeNull()
    expect(w.querySelector('text.ruler-text > tspan[x="0"][y="0"]')?.textContent).toBe('reforma')
    expect(w.getAttribute('style')).toContain(`--cmp: ${balanceColor(-1)}`)
    const svg = $('compareRuler').querySelector('svg')!
    const half = Number(svg.getAttribute('height')) / 2
    expect(w.getAttribute('transform')).toMatch(new RegExp(`,${half}\\)$`))
  })
  it('review K6: axis: RULER_PAD ends, five ticks 10px tall', async () => {
    boot()
    await start()
    const axis = $('compareRuler').querySelector('.ruler-axis')!
    expect(axis.getAttribute('x1')).toBe('28')
    const ticks = [...$('compareRuler').querySelectorAll('.ruler-tick')]
    expect(ticks).toHaveLength(5)
    expect(Number(ticks[0].getAttribute('y2')) - Number(ticks[0].getAttribute('y1'))).toBe(10)
  })
  it('review K7: ends, axis prose and svg label name both people', async () => {
    boot()
    await start()
    expect([...$('compareRuler').querySelectorAll('.ruler-end')].map((e) => e.textContent)).toEqual(['Lula', 'Bolsonaro'])
    expect([...$('compareRuler').querySelectorAll('.ruler-axis-labels span')].map((e) => e.textContent)).toEqual(['Só de Lula', 'dividida', 'Só de Bolsonaro'])
    const svg = $('compareRuler').querySelector('svg')!
    expect(svg.getAttribute('aria-label')).toBe('Régua comparando Lula e Bolsonaro')
    expect(svg.getAttribute('role')).toBe('group')
  })
  it('review K8: overflow intro states the count in the plural; a picked button is is-selected', async () => {
    const terms: CompareTerm[] = Array.from({ length: 70 }, (_, i) => ({ term: `palavralongademais${i}`, kind: 'word', a: side(3), b: side(2) }))
    handlers['/api/compare'] = () => payload(terms)
    boot()
    await start()
    const n = overflow().length
    expect(n).toBeGreaterThan(1)
    expect($('compareRuler').querySelector('.ruler-overflow p')?.textContent).toMatch(new RegExp(`^${n} palavras não couberam`))
    click(overflow()[0])
    await settle()
    expect(overflow()[0].classList.contains('is-selected')).toBe(true)
  })
  it('review K9: the card names the word and both people, on the figure recorte', async () => {
    boot({ search: '?source=gdelt&days=7' })
    await start()
    click(words()[0])
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
    click(words()[0])
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
    await change('compareDays', '30')
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
    expect($('compareRuler').textContent).toContain('Lendo a régua.')
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
    await change('compareDays', '30')
    expect(calls.filter((c) => c.path === '/api/compare/bridges').length).toBeGreaterThanOrEqual(3)
    expect($('compareRuler').querySelectorAll('.ruler-bridge')).toHaveLength(0)
  })

  it('AC11: a width change repaints without a fetch and keeps the pick and the card', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    const before = calls.length
    const markup = $('compareRuler').innerHTML
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect(docsCard.openedBy('compare')).toBe(true)
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    expect($('compareRuler').innerHTML).not.toBe(markup)
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
    expect(words()).toHaveLength(1)
  })

  it('AC12: a failed request writes the error note and detail hint, and a later resize repaints nothing stale', async () => {
    boot()
    await start()
    expect(words()).toHaveLength(1)
    handlers['/api/compare'] = () => {
      throw new Error('offline')
    }
    await change('compareDays', '7')
    expect($('compareRuler').textContent).toContain('Não foi possível carregar a comparação.')
    expect($('compareDetail').textContent).toContain('Clique numa palavra para ver os números dos dois lados.')
    expect(words()).toHaveLength(0)
    width = 350
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(words()).toHaveLength(0)
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
    expect(words()).toHaveLength(1)
  })

  it('AC15: the ruler paints a style custom property per word and no font-size literal', async () => {
    boot()
    await start()
    const style = words()[0].getAttribute('style') ?? ''
    expect(style).toMatch(/--size/)
    expect(style).toMatch(/--cmp/)
    expect(style).not.toMatch(/font-size/)
  })
})
