import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Lenses from '../../src/ui/Lenses.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import * as docsCard from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { lensesParams, sourcesParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'
import { SOURCES } from '../../src/query.js'
import { balanceColor } from '../../src/ui/format.js'
import type { CompareTerm, Lenses as LensesData } from '../../src/ui/format.js'

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [lula, bolsonaro]

const side = (count: number, pmi = 1) => ({ count, pmi, tone: null })
const reforma: CompareTerm = { term: 'reforma', kind: 'word', a: side(5, 1.2), b: null }
const payload = (terms: CompareTerm[], a = 'all', b = 'lean:right'): LensesData => ({ days: 21, a: { lens: a, about: 5 }, b: { lens: b, about: 5 }, terms })
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
const input = (id: string) => $(id) as HTMLInputElement
const words = () => [...$('lensesRuler').querySelectorAll('.ruler-word')] as HTMLElement[]
const of = (route: string) => calls.filter((c) => c.route === route)
const lensesCalls = () => of('lenses')
const outletValues = (id: string) => [...$(id).querySelectorAll('option')].map((o) => o.value)

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

const escape = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
}

const boot = (patch: Partial<{ ready: boolean; people: typeof people; peopleError: unknown; search: string }> = {}) =>
  setBoot({ ready: true, people, peopleError: null, search: '', ...patch })

const start = async () => {
  instances.push(mount(Lenses, { target }))
  instances.push(mount(DocsCard, { target }))
  flushSync()
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

const echo: Handler = (call) => payload([reforma], call.params.get('a') ?? 'all', call.params.get('b') ?? 'all')

const held = () => {
  let release: (v: unknown) => void = () => {}
  let fail: (e: unknown) => void = () => {}
  const promise = new Promise((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release: (v: unknown) => release(v), fail: (e: unknown) => fail(e) }
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  handlers = { lenses: echo, sources: () => [folha, g1], bridges: () => ({ bridges: {} }) }
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
      const body = await (handlers[route] ?? (() => ({ docs: [], total: 0 })))(call)
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

describe('Lenses (#294)', () => {
  it('AC2: lenses: request params and defaults', async () => {
    boot()
    await start()
    expect(lensesCalls()).toHaveLength(1)
    const c = lensesCalls()[0]
    expect(c.path).toBe('/api/people/lula/lenses')
    expect(c.url).toBe('/api/people/lula/lenses?' + lensesParams({ a: 'all', b: 'all', days: '21', limit: '40' }).toString())
    expect(c.params.get('a')).toBe('all')
    expect(c.params.get('b')).toBe('all')
    expect(c.params.get('days')).toBe('21')
    expect(c.params.get('limit')).toBe('40')
    expect(c.params.get('kind')).toBe('word,hashtag,phrase')
    expect(of('sources')).toHaveLength(1)
    expect(of('sources')[0].path).toBe('/api/people/lula/sources')
    expect(of('sources')[0].url).toBe('/api/people/lula/sources?' + sourcesParams({ days: '21', sort: 'count', limit: '80', source: 'all' }).toString())
    expect(of('sources')[0].params.get('days')).toBe('21')
    expect(of('sources')[0].params.get('source')).toBe('all')
    expect(of('docs')).toEqual([])
  })

  for (const days of ['30', '60'])
    it(`AC25: a shared link with days=${days} opens on 21 and requests days=21 on both routes`, async () => {
      boot({ search: `?days=${days}` })
      await start()
      expect(select('lensesDays').value).toBe('21')
      expect(lensesCalls()[0].params.get('days')).toBe('21')
      expect(of('sources')[0].params.get('days')).toBe('21')
    })

  it('AC2: nothing fetches before bootData.ready, and the ghost stands in the ruler and the detail', async () => {
    await start()
    expect(calls).toEqual([])
    expect($('lensesRuler').hidden).toBe(false)
    expect($('lensesRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('lensesRuler').textContent).toContain('Lendo as lentes.')
    expect($('lensesRuler').textContent).not.toMatch(/Carregando/)
    expect($('lensesRuler').querySelectorAll('.ruler-axis')).toHaveLength(1)
    expect($('lensesRuler').querySelectorAll('.ruler-tick')).toHaveLength(5)
    expect($('lensesRuler').querySelectorAll('.ghost').length).toBeGreaterThan(0)
    expect($('lensesDetail').querySelector('.detail-sides')).not.toBeNull()
    expect($('lensesStatus').hidden).toBe(true)
    await settle(500)
    expect($('lensesRuler').querySelector('.ghost-field')).not.toBeNull()
    boot()
    flushSync()
    await settle(220)
    expect(lensesCalls()).toHaveLength(1)
    expect($('lensesRuler').querySelector('.ghost-field')).toBeNull()
    expect(words()).toHaveLength(1)
  })

  it('AC3: lenses: seeds from the querystring, a bare a= never seeds lens A', async () => {
    boot({ search: '?person=bolsonaro&lenses.a=all&lenses.b=lean:right&days=7&limit=20' })
    await start()
    const c = lensesCalls()[0]
    expect(c.path).toBe('/api/people/bolsonaro/lenses')
    expect(c.params.get('a')).toBe('all')
    expect(c.params.get('b')).toBe('lean:right')
    expect(c.params.get('days')).toBe('7')
    expect(c.params.get('limit')).toBe('20')
    expect(select('lensesPerson').value).toBe('bolsonaro')
    expect(select('lensesB').value).toBe('lean:right')
    expect(select('lensesDays').value).toBe('7')
    expect(select('lensesLimit').value).toBe('20')
    expect(of('sources')[0].path).toBe('/api/people/bolsonaro/sources')
    expect(of('sources')[0].params.get('days')).toBe('7')

    remount()
    boot({ search: '?a=lean:left&lenses.b=lean:right' })
    await start()
    expect(select('lensesA').value).toBe('all')
    expect(lensesCalls()[0].params.get('a')).toBe('all')
    expect(lensesCalls()[0].params.get('b')).toBe('lean:right')

    remount()
    boot({ search: '?a=lean:left&lenses.a=lean:left' })
    await start()
    expect(select('lensesA').value).toBe('lean:left')
    expect(lensesCalls()[0].params.get('a')).toBe('lean:left')
  })

  it('AC3: lenses: an unknown lens token or option falls back to all', async () => {
    boot({ search: '?lenses.a=lean:nope&lenses.b=source:nope&limit=7&days=9' })
    await start()
    expect(select('lensesA').value).toBe('all')
    expect(select('lensesB').value).toBe('all')
    expect(lensesCalls()[0].params.get('days')).toBe('21')
    expect(lensesCalls()[0].params.get('limit')).toBe('40')
  })

  it('AC3: a later setBoot never re-seeds nor refetches', async () => {
    boot({ search: '?lenses.days=7' })
    await start()
    expect(lensesCalls()).toHaveLength(1)
    await change('lensesDays', '21')
    const before = calls.length
    boot({ search: '?lenses.days=7', people: [...people, { id: 'ciro', name: 'Ciro' }] })
    flushSync()
    await settle(500)
    expect(select('lensesDays').value).toBe('21')
    expect(calls.length).toBe(before)
  })

  it('AC4: lenses: the Veículo optgroup lists each top domain once and skips rows without a domain', async () => {
    handlers.sources = () => [folha, { domain: 'folha.uol.com.br', docs: 3 }, { domain: null, docs: 2 }, g1]
    boot()
    await start()
    expect(outletValues('lensesAOutlets')).toEqual(['domain:folha.uol.com.br', 'domain:g1.globo.com'])
    expect(outletValues('lensesBOutlets')).toEqual(['domain:folha.uol.com.br', 'domain:g1.globo.com'])
  })

  it('AC4: lenses: domain seed deferred until optgroup fills', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    boot({ search: '?lenses.a=domain:folha.uol.com.br&lenses.b=lean:left' })
    await start()
    expect(select('lensesA').value).toBe('all')
    expect(select('lensesB').value).toBe('lean:left')
    expect(input('lensesAInput').value).toBe('Tudo')
    expect(lensesCalls()).toHaveLength(0)
    gate.release([folha, g1])
    await settle(220)
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')
    expect(input('lensesAInput').value).toBe('folha.uol.com.br')
    expect(lensesCalls()).toHaveLength(1)
    expect(lensesCalls()[0].params.get('a')).toBe('domain:folha.uol.com.br')
  })

  it('AC4: lenses: a domain seed the optgroup never gets stays all', async () => {
    handlers.sources = () => [g1]
    boot({ search: '?lenses.a=domain:folha.uol.com.br' })
    await start()
    expect(select('lensesA').value).toBe('all')
    expect(lensesCalls()[0].params.get('a')).toBe('all')
  })

  it('AC4: lenses: touched side skips domain seed', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    boot({ search: '?lenses.a=domain:folha.uol.com.br' })
    await start()
    select('lensesA').value = 'source:rss'
    select('lensesA').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
    gate.release([folha])
    await settle(220)
    expect(select('lensesA').value).toBe('source:rss')
    expect(lensesCalls().pop()!.params.get('a')).toBe('source:rss')
  })

  it('AC4: lenses: a non-domain seed applies at once and a reader change survives the pending fill', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    boot({ search: '?lenses.a=lean:left' })
    await start()
    expect(select('lensesA').value).toBe('lean:left')
    select('lensesA').value = 'source:rss'
    select('lensesA').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
    gate.release([folha])
    await settle(220)
    expect(select('lensesA').value).toBe('source:rss')
    expect(lensesCalls().pop()!.params.get('a')).toBe('source:rss')
  })

  it('AC4: lenses: a limit change while /sources is in flight keeps the deferred domain seed', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    boot({ search: '?lenses.a=domain:folha.uol.com.br' })
    await start()
    await change('lensesLimit', '60')
    gate.release([folha])
    await settle(220)
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')
  })

  it('AC4: lenses: stale /sources response ignored (another person)', async () => {
    const first = held()
    let n = 0
    handlers.sources = (call) => {
      n++
      if (n === 1) return first.promise
      return call.person === 'bolsonaro' ? [folha] : [g1]
    }
    boot()
    await start()
    select('lensesPerson').value = 'bolsonaro'
    select('lensesPerson').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    expect(outletValues('lensesAOutlets')).toEqual(['domain:folha.uol.com.br'])
    select('lensesA').value = 'domain:folha.uol.com.br'
    first.release([g1])
    await settle(220)
    expect(outletValues('lensesAOutlets')).toEqual(['domain:folha.uol.com.br'])
    expect(outletValues('lensesBOutlets')).toEqual(['domain:folha.uol.com.br'])
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')
  })

  it('AC4: lenses: stale /sources response ignored (days back to its starting value)', async () => {
    const first = held()
    let n = 0
    handlers.sources = () => {
      n++
      return n === 1 ? first.promise : [{ domain: 'fresh.example', docs: 1 }]
    }
    boot()
    await start()
    await change('lensesDays', '7')
    await change('lensesDays', '21')
    expect(outletValues('lensesAOutlets')).toEqual(['domain:fresh.example'])
    first.release([{ domain: 'stale.example', docs: 1 }])
    await settle(220)
    expect(outletValues('lensesAOutlets')).toEqual(['domain:fresh.example'])
  })

  it('AC5: lenses: person and days change keep or drop a domain', async () => {
    boot({ search: '?lenses.a=domain:folha.uol.com.br&lenses.b=lean:left' })
    await start()
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')

    handlers.sources = () => [g1]
    await change('lensesPerson', 'bolsonaro')
    expect(select('lensesA').value).toBe('all')
    expect(input('lensesAInput').value).toBe('Tudo')
    expect(select('lensesB').value).toBe('lean:left')
    expect(lensesCalls().pop()!.path).toBe('/api/people/bolsonaro/lenses')
    expect(lensesCalls().pop()!.params.get('a')).toBe('all')

    handlers.sources = () => [folha, g1]
    await change('lensesPerson', 'lula')
    await change('lensesA', 'domain:folha.uol.com.br')
    handlers.sources = () => [folha]
    await change('lensesPerson', 'bolsonaro')
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')
    expect(lensesCalls().pop()!.params.get('a')).toBe('domain:folha.uol.com.br')

    const sourcesBefore = of('sources').length
    handlers.sources = () => [folha]
    await change('lensesDays', '7')
    expect(of('sources').length).toBe(sourcesBefore + 1)
    expect(of('sources').pop()!.params.get('days')).toBe('7')
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')

    handlers.sources = () => [g1]
    await change('lensesDays', '21')
    expect(select('lensesA').value).toBe('all')
    expect($('lensesRuler').getAttribute('aria-label')).not.toContain('folha.uol.com.br')
  })

  it('AC5: lenses: a limit change keeps both sides and does not refetch /sources', async () => {
    boot({ search: '?lenses.a=domain:folha.uol.com.br&lenses.b=lean:left' })
    await start()
    const sources = of('sources').length
    await change('lensesLimit', '100')
    expect(select('lensesA').value).toBe('domain:folha.uol.com.br')
    expect(select('lensesB').value).toBe('lean:left')
    expect(of('sources')).toHaveLength(sources)
    expect(lensesCalls().pop()!.params.get('limit')).toBe('100')
  })

  for (const [id, value, param] of [
    ['lensesA', 'lean:left', 'a'],
    ['lensesB', 'source:rss', 'b'],
    ['lensesDays', '7', 'days'],
    ['lensesLimit', '100', 'limit'],
    ['lensesPerson', 'bolsonaro', 'person'],
  ]) {
    it(`AC5: lenses: control changes refetch and release (#${id})`, async () => {
      boot()
      await start()
      const before = lensesCalls().length
      await change(id, value)
      const added = lensesCalls().slice(before)
      expect(added).toHaveLength(1)
      if (param === 'person') expect(added[0].path).toBe('/api/people/bolsonaro/lenses')
      else expect(added[0].params.get(param)).toBe(value)
      expect(of('docs')).toEqual([])
    })
  }

  it('AC6: lenses: status notice for identical lenses', async () => {
    boot()
    await start()
    expect($('lensesStatus').hidden).toBe(false)
    expect($('lensesStatus').textContent).toBe('Os dois lados mostram o mesmo recorte.')
    await change('lensesB', 'lean:right')
    expect($('lensesStatus').hidden).toBe(true)
    await change('lensesA', 'lean:right')
    expect($('lensesStatus').hidden).toBe(false)
    await change('lensesA', 'all')
    expect($('lensesStatus').hidden).toBe(true)
  })

  it('AC6: #lensesStatus stays hidden while the ghost shows', async () => {
    const gate = held()
    handlers.lenses = () => gate.promise
    boot()
    await start()
    expect($('lensesRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('lensesStatus').hidden).toBe(true)
    gate.release(payload([reforma], 'all', 'all'))
    await settle()
    expect($('lensesStatus').hidden).toBe(false)
  })

  it('AC7: lenses: click opens two-sided docs card', async () => {
    handlers.lenses = () => payload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    boot({ search: '?days=7' })
    await start()
    click(words()[0])
    await settle()
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('lenses')).toBe(true)
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

  it('AC7: lenses: a source lens sends source=, an all lens sends source=all and no domain or lean', async () => {
    handlers.lenses = () => payload([reforma], 'source:rss', 'all')
    boot()
    await start()
    click(words()[0])
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

  it('AC7: lenses: a lean lens on the other side and pressing Enter or Space on a word picks it', async () => {
    handlers.lenses = () => payload([reforma], 'lean:left', 'source:gdelt')
    boot()
    await start()
    for (const key of ['Enter', ' ']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      words()[0].dispatchEvent(e)
      flushSync()
      expect(e.defaultPrevented).toBe(true)
      await settle()
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
      expect(docsCard.openedBy('lenses')).toBe(true)
      escape()
      await settle()
      expect(docsCard.isOpen()).toBe(false)
    }
    const docs = of('docs')
    expect(docs.some((c) => c.params.get('lean') === 'left' && c.params.get('source') === 'all')).toBe(true)
    expect(docs.some((c) => c.params.get('source') === 'gdelt')).toBe(true)
  })

  it('AC7: the same word again, the background and Escape each clear the pick and close the card', async () => {
    boot()
    await start()
    const releasers: [string, () => void][] = [
      ['same word', () => click(words()[0])],
      ['background', () => click($('lensesRuler'))],
      ['escape', escape],
    ]
    for (const [name, release] of releasers) {
      click(words()[0])
      await settle()
      expect(docsCard.openedBy('lenses'), `${name}: open`).toBe(true)
      release()
      await settle()
      expect(docsCard.isOpen(), `${name}: card closed`).toBe(false)
      expect(words()[0].getAttribute('aria-pressed'), `${name}: unpicked`).toBe('false')
      expect($('lensesDetail').textContent).toMatch(/Clique numa palavra para ver os números das duas lentes\./)
    }
  })

  it('AC7: a picked overflow button opens the card the way a word does', async () => {
    const terms: CompareTerm[] = Array.from({ length: 70 }, (_, i) => ({ term: `palavralongademais${i}`, kind: 'word', a: side(3), b: side(2) }))
    handlers.lenses = () => payload(terms)
    boot()
    await start()
    const spilled = [...$('lensesRuler').querySelectorAll('.ruler-overflow [data-term]')] as HTMLElement[]
    expect(spilled.length).toBeGreaterThan(0)
    expect(words().length + spilled.length).toBe(terms.length)
    click(spilled[0])
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(true)
    expect(of('docs').filter((c) => c.params.get('term') === spilled[0].getAttribute('data-term'))).toHaveLength(2)
  })

  it('AC8: lenses: control change releases own card only', async () => {
    boot()
    await start()
    for (const [id, value] of [
      ['lensesA', 'lean:left'],
      ['lensesB', 'lean:center'],
      ['lensesDays', '7'],
      ['lensesLimit', '60'],
      ['lensesPerson', 'bolsonaro'],
    ]) {
      click(words()[0])
      await settle()
      expect(docsCard.openedBy('lenses'), `${id}: open`).toBe(true)
      await change(id, value)
      expect(docsCard.isOpen(), `${id}: closed`).toBe(false)
    }
    click(words()[0])
    await settle()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '21' }) }] })
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(false)
    await change('lensesA', 'source:rss')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('AC8: lenses: resize keeps the pick', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    const before = calls.length
    const markup = $('lensesRuler').innerHTML
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect(docsCard.openedBy('lenses')).toBe(true)
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    expect($('lensesRuler').innerHTML).not.toBe(markup)
    expect(observers.some((o) => o.target === $('lensesRuler'))).toBe(true)
  })

  it('AC8: a resize during loading repaints nothing', async () => {
    boot()
    await start()
    const gate = held()
    handlers.lenses = () => gate.promise
    select('lensesDays').value = '7'
    select('lensesDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    const ghost = $('lensesRuler').innerHTML
    width = 300
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect($('lensesRuler').innerHTML).toBe(ghost)
    gate.release(payload([reforma]))
    await settle()
    expect(words()).toHaveLength(1)
  })

  it('AC8: a click on the header, the subtitle, a select, a combobox or the detail keeps the pick and the card', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    const els = [document.querySelector('#lenses .figure-head')!, document.querySelector('#lenses .figure-sub')!, select('lensesPerson'), select('lensesA'), $('lensesAInput'), $('lensesDetail')]
    for (const el of els) {
      click(el)
      await settle()
      expect(docsCard.openedBy('lenses')).toBe(true)
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('AC8: lenses: stale pick dropped mid-reload (data lands)', async () => {
    boot()
    await start()
    const gate = held()
    handlers.lenses = () => gate.promise
    select('lensesA').value = 'lean:left'
    select('lensesA').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    expect($('lenses').classList.contains('is-loading')).toBe(true)
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(true)
    gate.release(payload([reforma], 'lean:left', 'lean:right'))
    await settle()
    expect($('lenses').classList.contains('is-loading')).toBe(false)
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('AC8: lenses: stale pick dropped mid-reload (reload fails)', async () => {
    boot()
    await start()
    const gate = held()
    handlers.lenses = () => gate.promise
    select('lensesDays').value = '7'
    select('lensesDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(true)
    gate.fail(new Error('boom'))
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect($('lensesRuler').textContent).toContain('Não foi possível carregar as lentes.')
  })

  it('AC8: a card another figure opened over a pick made on dimmed data survives the new data', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '21' }) }] })
    await settle()
    await change('lensesDays', '7')
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('AC9: lenses: bridges applied after paint, aborted on change', async () => {
    const terms: CompareTerm[] = [
      { term: 'stf', kind: 'word', a: side(5), b: side(5) },
      { term: 'pix', kind: 'word', a: side(2), b: null },
    ]
    handlers.lenses = () => payload(terms)
    handlers.bridges = () => ({ bridges: { 'word:stf': 1, 'word:pix': 0 } })
    boot()
    await start()
    const ruler = calls.findIndex((c) => c.route === 'lenses')
    const bridges = calls.findIndex((c) => c.route === 'bridges')
    expect(ruler).toBeGreaterThanOrEqual(0)
    expect(bridges).toBeGreaterThan(ruler)
    expect(calls[bridges].path).toBe('/api/people/lula/lenses/bridges')
    expect(calls[bridges].params.get('ids')).toBe('word:pix,word:stf')
    expect(calls[bridges].params.get('a')).toBe('all')
    expect(calls[bridges].params.get('b')).toBe('all')
    expect(calls[ruler].params.has('bridges')).toBe(false)
    expect($('lensesRuler').querySelectorAll('.ruler-bridge')).toHaveLength(1)
    expect($('lensesRuler').querySelector('.ruler-bridge')?.getAttribute('data-term')).toBe('stf')
  })

  it('AC9: a control change during the bridge load aborts it and its late result is dropped', async () => {
    const terms: CompareTerm[] = [{ term: 'stf', kind: 'word', a: side(5), b: side(5) }]
    const late = held()
    let first: Call | undefined
    handlers.lenses = () => payload(terms)
    handlers.bridges = (call) => {
      first ??= call
      return late.promise
    }
    boot()
    await start()
    expect(first!.signal?.aborted).toBe(false)
    handlers.lenses = () => payload([{ term: 'stf', kind: 'word', a: side(9), b: side(4) }])
    handlers.bridges = () => new Promise(() => {})
    await change('lensesDays', '7')
    expect(first!.signal?.aborted).toBe(true)
    late.release({ bridges: { 'word:stf': 1 } })
    await settle()
    expect($('lensesRuler').querySelectorAll('.ruler-bridge')).toHaveLength(0)
  })

  it('AC9: a control change aborts the bridge load before the new data lands', async () => {
    let first: Call | undefined
    handlers.lenses = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = (call) => {
      first ??= call
      return new Promise(() => {})
    }
    boot()
    await start()
    handlers.lenses = () => new Promise(() => {})
    select('lensesLimit').value = '60'
    select('lensesLimit').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(first!.signal?.aborted).toBe(true)
  })

  it('AC9: unmounting aborts the in-flight bridge request', async () => {
    let first: Call | undefined
    handlers.lenses = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = (call) => {
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

  it('AC9: a failed bridge request leaves the ruler as painted', async () => {
    handlers.lenses = () => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }])
    handlers.bridges = () => {
      throw new Error('nope')
    }
    boot()
    await start()
    expect(words()).toHaveLength(1)
    expect($('lensesRuler').querySelectorAll('.ruler-bridge')).toHaveLength(0)
    expect($('lensesRuler').textContent).not.toMatch(/Não foi possível/)
  })

  it('AC9: lenses: name word and bridge detail copy', async () => {
    handlers.lenses = () => payload([{ term: 'stf', kind: 'word', a: side(7, 1.5), b: side(3, 0.5) }])
    handlers.bridges = () => ({ bridges: { 'word:stf': 1 } })
    boot()
    await start()
    expect($('lensesDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
    click(words()[0])
    await settle()
    expect($('lensesDetail').textContent).toContain('7 documentos · PMI 1,5')
    expect($('lensesDetail').querySelector('.detail-bridge')?.textContent).toBe('ponte: as duas lentes precisam dela')
    expect($('lensesDetail').textContent).not.toContain('liga os dois vocabulários')
    expect([...$('lensesDetail').querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Tudo', 'Direita'])
  })

  it('AC9: the detail line labels each side by its lens and reads "nenhum documento" for a null side', async () => {
    handlers.lenses = () => payload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    boot()
    await start()
    click(words()[0])
    await settle()
    const detail = $('lensesDetail')
    expect(detail.textContent).toContain('reforma')
    expect([...detail.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
    expect(detail.textContent).toContain('nenhum documento')
    expect(detail.textContent).toContain('5 documentos · PMI 1,2')
    expect(detail.querySelector('.detail-bridge')).toBeNull()
  })

  it('AC11: own-name words are dropped from the ruler and counted in #lensesHiddenNote', async () => {
    boot()
    await start()
    expect($('lensesHiddenNote').hidden).toBe(true)
    expect($('lensesHiddenNote').textContent).toBe('')
    handlers.lenses = () => payload([{ term: 'lula', kind: 'word', a: 'name', b: 'name' }, reforma])
    await change('lensesDays', '7')
    expect($('lensesHiddenNote').hidden).toBe(false)
    expect($('lensesHiddenNote').textContent).toBe('1 palavra deixada de fora por ser o próprio nome da pessoa.')
    expect(words().map((w) => w.getAttribute('data-term'))).toEqual(['reforma'])
    handlers.lenses = () => payload([{ term: 'lula', kind: 'word', a: 'name', b: side(2) }, { term: 'luiz', kind: 'word', a: side(2), b: 'name' }, reforma])
    await change('lensesLimit', '60')
    expect($('lensesHiddenNote').textContent).toBe('2 palavras deixadas de fora por ser o próprio nome da pessoa.')
    handlers.lenses = () => payload([reforma])
    await change('lensesLimit', '100')
    expect($('lensesHiddenNote').hidden).toBe(true)
  })

  it('AC10: lenses: empty state', async () => {
    handlers.lenses = () => payload([])
    boot()
    await start()
    expect($('lensesRuler').hidden).toBe(false)
    expect($('lensesRuler').textContent).toContain('Nenhuma palavra neste recorte.')
    expect(words()).toHaveLength(0)
    expect($('lensesHiddenNote').hidden).toBe(true)
    expect($('lensesDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
  })

  it('AC10: lenses: /lenses failure and retry', async () => {
    handlers.lenses = () => {
      throw new Error('offline')
    }
    boot()
    await start()
    expect($('lensesRuler').textContent).toContain('Não foi possível carregar as lentes.')
    expect($('lensesRuler').querySelector('.ghost-field')).toBeNull()
    expect($('lensesDetail').textContent).toContain('Clique numa palavra para ver os números das duas lentes.')
    expect($('lensesStatus').hidden).toBe(true)
    expect(words()).toHaveLength(0)
    width = 350
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(words()).toHaveLength(0)
    expect($('lensesRuler').textContent).toContain('Não foi possível carregar as lentes.')
    const retry = $('lensesRetry')
    expect(retry).not.toBeNull()
    handlers.lenses = echo
    const before = lensesCalls().length
    click(retry)
    await settle(220)
    expect(lensesCalls().length).toBe(before + 1)
    expect($('lensesRuler').textContent).not.toContain('Não foi possível carregar as lentes.')
    expect(words()).toHaveLength(1)
  })

  it('AC10: lenses: peopleError', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    boot({ people: [], peopleError: new Error('down') })
    await start()
    expect(calls).toEqual([])
    expect($('lensesRuler').hidden).toBe(true)
    expect($('lensesStatus').hidden).toBe(true)
    expect($('lensesHiddenNote').hidden).toBe(true)
    expect($('lensesDetail').textContent).toContain('Falha de rede ou base indisponível.')
    expect($('lensesDetail').textContent).not.toContain('Nenhuma pessoa cadastrada.')
    const retry = $('lensesRetry')
    expect(retry.textContent).toContain('Tentar novamente')
    click(retry)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('AC10: no people says so and fetches nothing', async () => {
    boot({ people: [] })
    await start()
    expect(calls).toEqual([])
    expect($('lensesRuler').hidden).toBe(true)
    expect($('lensesDetail').textContent).toContain('Nenhuma pessoa cadastrada.')
  })

  it('AC12: lenses: combobox sync after programmatic writes', async () => {
    boot({ search: '?lenses.a=lean:left' })
    await start()
    for (const id of ['lensesA', 'lensesB']) expect(select(id).hasAttribute('hidden')).toBe(true)
    expect(input('lensesAInput').value).toBe('Esquerda')
    expect(input('lensesBInput').value).toBe('Tudo')
    expect(input('lensesAInput').getAttribute('aria-label')).toBe('Lente A')
    expect(input('lensesBInput').getAttribute('aria-label')).toBe('Lente B')
    expect(input('lensesAInput').getAttribute('aria-controls')).toBe('lensesAList')
    expect(input('lensesBInput').getAttribute('aria-controls')).toBe('lensesBList')
    expect($('lensesAList').getAttribute('role')).toBe('listbox')
    expect($('lensesAList').getAttribute('aria-label')).toBe('Opções da lente A')
    expect($('lensesBList').getAttribute('aria-label')).toBe('Opções da lente B')
  })

  it('AC12: lenses: an optgroup refill that drops a domain resyncs the input text', async () => {
    boot({ search: '?lenses.a=domain:folha.uol.com.br&lenses.b=domain:g1.globo.com' })
    await start()
    expect(input('lensesAInput').value).toBe('folha.uol.com.br')
    expect(input('lensesBInput').value).toBe('g1.globo.com')
    handlers.sources = () => [g1]
    await change('lensesPerson', 'bolsonaro')
    expect(input('lensesAInput').value).toBe('Tudo')
    expect(input('lensesBInput').value).toBe('g1.globo.com')
  })

  it('AC12: picking a listbox option writes the select, fires change and the figure reloads', async () => {
    boot()
    await start()
    const before = lensesCalls().length
    let changes = 0
    select('lensesA').addEventListener('change', () => changes++)
    input('lensesAInput').dispatchEvent(new Event('focus'))
    flushSync()
    expect($('lensesAList').hasAttribute('hidden')).toBe(false)
    const option = $('lensesAList').querySelector('[data-value="domain:g1.globo.com"]') as HTMLElement
    expect(option).not.toBeNull()
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    flushSync()
    await settle(220)
    expect(select('lensesA').value).toBe('domain:g1.globo.com')
    expect(changes).toBe(1)
    expect(input('lensesAInput').value).toBe('g1.globo.com')
    expect(lensesCalls()).toHaveLength(before + 1)
    expect(lensesCalls().pop()!.params.get('a')).toBe('domain:g1.globo.com')
    expect(lensesCalls().pop()!.params.get('b')).toBe('all')
  })

  it('AC13: lenses: Fonte options equal SOURCES', async () => {
    boot()
    await start()
    for (const id of ['lensesA', 'lensesB']) {
      const groups = [...select(id).querySelectorAll('optgroup')]
      expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Veículo', 'Viés', 'Fonte'])
      const fonte = [...groups[2].querySelectorAll('option')].map((o) => o.value)
      expect(fonte).toEqual(SOURCES.map((s) => `source:${s}`))
      expect([...groups[1].querySelectorAll('option')].map((o) => o.value)).toEqual(['lean:left', 'lean:center', 'lean:right'])
      expect(select(id).options[0].value).toBe('all')
    }
  })

  it('AC13: the section keeps its ids, five picks and the limit options', async () => {
    boot()
    await start()
    const section = $('lenses')
    expect(section.tagName).toBe('SECTION')
    expect(section.classList.contains('figure')).toBe(true)
    expect(section.classList.contains('lenses')).toBe(true)
    expect(section.getAttribute('aria-labelledby')).toBe('lensesTitle')
    expect(section.querySelectorAll('.pick')).toHaveLength(5)
    expect(section.querySelector('.eyebrow')?.textContent).toBe('Gráfico 6')
    expect(section.querySelectorAll('.figure-key > div')).toHaveLength(5)
    for (const id of ['lensesTitle', 'lensesPerson', 'lensesA', 'lensesB', 'lensesAOutlets', 'lensesBOutlets', 'lensesAInput', 'lensesAList', 'lensesBInput', 'lensesBList', 'lensesDays', 'lensesLimit', 'lensesStatus', 'lensesRuler', 'lensesDetail', 'lensesHiddenNote']) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
    expect([...select('lensesLimit').options].map((o) => Number(o.value))).toEqual([20, 40, 60, 100])
    expect(select('lensesLimit').value).toBe('40')
    expect([...select('lensesDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('lensesDays').options].map((o) => o.textContent)).toEqual(['7 dias', '21 dias'])
    expect(select('lensesDays').value).toBe('21')
    expect([...select('lensesPerson').options].map((o) => o.value)).toEqual(['lula', 'bolsonaro'])
  })

  it('the ruler carries the lens labels as ends, the axis prose, the aria-label and the note', async () => {
    handlers.lenses = () => payload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    boot()
    await start()
    expect([...$('lensesRuler').querySelectorAll('.ruler-end')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
    expect([...$('lensesRuler').querySelectorAll('.ruler-axis-labels span')].map((e) => e.textContent)).toEqual(['Só de folha.uol.com.br', 'dividida', 'Só de Direita'])
    const svg = $('lensesRuler').querySelector('svg')!
    expect(svg.getAttribute('aria-label')).toBe('Régua comparando folha.uol.com.br e Direita para a mesma pessoa')
    expect(svg.getAttribute('role')).toBe('group')
    expect($('lensesRuler').querySelector('p.note')?.textContent).toBe(
      'Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem das duas lentes somados. Toque numa palavra para ver os números das duas lentes.',
    )
    expect($('lensesRuler').getAttribute('aria-label')).toBe('Régua comparando duas lentes da mesma pessoa')
    expect($('lensesRuler').hidden).toBe(false)
  })

  it('a word carries the shared ruler hooks and is placed by pmi, never by count', async () => {
    handlers.lenses = () =>
      payload([
        { term: 'reforma', kind: 'word', a: { count: 40, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } },
        { term: 'eleicao', kind: 'hashtag', a: { count: 2, pmi: 5, tone: null }, b: { count: 40, pmi: 0.1, tone: null } },
      ])
    boot()
    await start()
    const w = words().find((e) => e.getAttribute('data-term') === 'reforma')!
    const x = (e: HTMLElement) => Number(/translate\(([-\d.]+)/.exec(e.getAttribute('transform') ?? '')![1])
    const e = words().find((el) => el.getAttribute('data-term') === 'eleicao')!
    expect(x(w)).toBeGreaterThan(x(e))
    expect(w.getAttribute('data-kind')).toBe('word')
    expect(e.getAttribute('data-kind')).toBe('hashtag')
    expect(w.getAttribute('aria-pressed')).toBe('false')
    expect(w.getAttribute('aria-label')).toMatch(/documentos/)
    expect(w.getAttribute('tabindex')).toBe('0')
    expect(w.getAttribute('style')).toMatch(/--cmp/)
    expect(w.getAttribute('style')).not.toMatch(/font-size/)
    expect(balanceColor(1)).toBeTruthy()
  })

  it('there is no measure control: the ruler markup carries no select for it', async () => {
    boot()
    await start()
    expect(document.querySelector('#lenses select[id*="Measure"]')).toBeNull()
    expect(lensesCalls()[0].params.has('measure')).toBe(false)
  })
})

describe('lenses: lens sides, bridges and releases', () => {
  it('a touched B skips the deferred domain seed for B', async () => {
    const gate = held()
    handlers.sources = () => gate.promise
    boot({ search: '?lenses.b=domain:folha.uol.com.br' })
    await start()
    select('lensesB').value = 'source:rss'
    select('lensesB').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
    gate.release([folha])
    await settle(220)
    expect(select('lensesB').value).toBe('source:rss')
    expect(lensesCalls().pop()!.params.get('b')).toBe('source:rss')
  })

  it('a person change drops a B domain the new person lacks', async () => {
    boot({ search: '?lenses.b=domain:folha.uol.com.br' })
    await start()
    expect(select('lensesB').value).toBe('domain:folha.uol.com.br')
    handlers.sources = () => [g1]
    await change('lensesPerson', 'bolsonaro')
    expect(select('lensesB').value).toBe('all')
    expect(input('lensesBInput').value).toBe('Tudo')
    expect(lensesCalls().pop()!.params.get('b')).toBe('all')
  })

  it('the bridges request carries both lenses', async () => {
    handlers.lenses = (call) => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }], call.params.get('a')!, call.params.get('b')!)
    boot({ search: '?lenses.a=lean:left&lenses.b=source:rss' })
    await start()
    const bridge = of('bridges').pop()!
    expect(bridge.params.get('a')).toBe('lean:left')
    expect(bridge.params.get('b')).toBe('source:rss')
  })

  it('the docs card columns are labelled by lensLabel, a first then b', async () => {
    handlers.lenses = () => payload([reforma], 'domain:folha.uol.com.br', 'lean:right')
    handlers.docs = () => ({ docs: [], total: 0 })
    boot()
    await start()
    click(words()[0])
    await settle()
    expect([...document.querySelectorAll('#docs .docs-side-name')].map((e) => e.textContent)).toEqual(['folha.uol.com.br', 'Direita'])
  })

  it('a days change closes the lenses card at once, before the new data lands', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(true)
    handlers.lenses = () => new Promise(() => {})
    select('lensesDays').value = '7'
    select('lensesDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('a memoized payload that already carries bridges never asks for them again', async () => {
    handlers.lenses = (call) => payload([{ term: 'stf', kind: 'word', a: side(5), b: side(5) }], call.params.get('a')!, call.params.get('b')!)
    handlers.bridges = () => ({ bridges: { 'word:stf': 1 } })
    boot()
    await start()
    await change('lensesLimit', '60')
    await change('lensesLimit', '40')
    expect(of('bridges')).toHaveLength(2)
  })
})

describe('lenses: combobox Escape', () => {
  it('Escape inside an open lens combobox closes the list but keeps the pick and the card', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    input('lensesAInput').dispatchEvent(new Event('focus'))
    flushSync()
    expect($('lensesAList').hidden).toBe(false)
    input('lensesAInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
    await settle()
    expect($('lensesAList').hidden).toBe(true)
    expect(docsCard.openedBy('lenses')).toBe(true)
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
  })
})

describe('lenses: resize', () => {
  it('watches #lensesRuler with exactly one ResizeObserver', async () => {
    boot()
    await start()
    expect(observers.filter((o) => o.target === $('lensesRuler'))).toHaveLength(1)
  })

  it('a second click on the same word after a resize still releases', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('lenses')).toBe(true)
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    click(words()[0])
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Lenses over the 7 and 21 day windows (issue #313 acceptance)', () => {
  it('AC24: the day select offers exactly 7 and 21, in that order, with 21 selected, and the first /lenses and /sources carry days=21', async () => {
    boot()
    await start()
    expect([...select('lensesDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('lensesDays').options].map((o) => o.textContent)).toEqual(['7 dias', '21 dias'])
    expect(select('lensesDays').value).toBe('21')
    expect(lensesCalls()[0].params.get('days')).toBe('21')
    expect(of('sources')[0].params.get('days')).toBe('21')
  })

  for (const days of ['30', '60'])
    it(`AC25: a shared link with days=${days} leaves the select on 21 and requests days=21`, async () => {
      boot({ search: `?days=${days}` })
      await start()
      expect(select('lensesDays').value).toBe('21')
      expect(lensesCalls()[0].params.get('days')).toBe('21')
    })

  it('AC25: a shared link with days=7 still selects 7', async () => {
    boot({ search: '?days=7' })
    await start()
    expect(select('lensesDays').value).toBe('7')
    expect(lensesCalls()[0].params.get('days')).toBe('7')
  })
})
