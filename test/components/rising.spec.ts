import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Rising from '../../src/ui/Rising.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import * as docsCard from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { risingParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'
import { balanceColor, RARE_SHOWN, shareBalance } from '../../src/ui/format.js'
import type { Rising as RisingData, RisingTerm } from '../../src/ui/format.js'

const lula = { id: 'lula', name: 'Lula' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [lula, bolsonaro]

const term = (over: Partial<RisingTerm> = {}): RisingTerm => ({
  term: 'diretor',
  kind: 'word',
  count_recent: 1.71,
  count_baseline: 0.03,
  count_recent_raw: 12,
  count_baseline_raw: 1,
  lift: 57,
  ...over,
})
const about = { recent: 8, baseline: 3, words_recent: 40, words_baseline: 12 }
const payload = (terms: RisingTerm[], a: RisingData['about'] = about, present: RisingTerm[] = terms): RisingData => ({ days: 7, baseline: 30, terms, present, outlets: [], about: a })
const stale = (terms: RisingTerm[], a: RisingData['about'] = { recent: 10, baseline: 5 }): RisingData => ({ days: 7, baseline: 30, terms, outlets: [], about: a })

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
const words = () => [...$('risingRuler').querySelectorAll('.ruler-word')] as HTMLElement[]
const overflow = () => [...$('risingRuler').querySelectorAll('.ruler-overflow:not(.ruler-rare) [data-term]')] as HTMLElement[]
const rare = () => [...$('risingRuler').querySelectorAll('.ruler-rare [data-term]')] as HTMLElement[]
const risingCalls = () => calls.filter((c) => c.path.endsWith('/rising'))
const docsCalls = () => calls.filter((c) => c.path.endsWith('/docs'))

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

const start = async (props: Record<string, unknown> = {}) => {
  instances.push(mount(Rising, { target, props }))
  instances.push(mount(DocsCard, { target }))
  flushSync()
  await settle()
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

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  calls = []
  handlers = { '/rising': () => payload([term()]) }
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
      const key = u.pathname.endsWith('/rising') ? '/rising' : u.pathname
      const body = await (handlers[key] ?? (() => ({ docs: [], total: 0 })))(call)
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

describe('Rising (#292)', () => {
  it('risingParams sends the fixed window', () => {
    const qp = risingParams({ source: 'gdelt' })
    expect(qp.get('days')).toBe('7')
    expect(qp.get('baseline')).toBe('30')
    expect(qp.get('kind')).toBe('word,hashtag,phrase')
    expect(qp.get('limit')).toBe('40')
    expect(qp.get('min')).toBe('3')
    expect(qp.get('source')).toBe('gdelt')
  })

  it('requests /rising with the fixed recorte plus the selected person and source, and paints the fixture word', async () => {
    boot({ search: '?person=bolsonaro&source=gdelt' })
    await start()
    expect(risingCalls()).toHaveLength(1)
    const call = risingCalls()[0]
    expect(call.path).toBe('/api/people/bolsonaro/rising')
    expect(call.params.get('days')).toBe('7')
    expect(call.params.get('baseline')).toBe('30')
    expect(call.params.get('kind')).toBe('word,hashtag,phrase')
    expect(call.params.get('limit')).toBe('40')
    expect(call.params.get('min')).toBe('3')
    expect(call.params.get('source')).toBe('gdelt')
    expect($('risingRuler').hidden).toBe(false)
    const mark = $('risingRuler').querySelector('[data-term="diretor"]')
    expect(mark).not.toBeNull()
    expect(mark!.getAttribute('data-kind')).toBe('word')
  })

  it('no control besides person and source exists in the sentence', async () => {
    boot()
    await start()
    const ids = [...document.querySelectorAll('#rising .sentence-line select')].map((s) => s.id)
    expect(ids).toEqual(['risingPerson', 'risingSource'])
  })

  it('the static hooks survive', async () => {
    boot()
    await start()
    expect($('rising').tagName).toBe('SECTION')
    expect($('risingTitle').tagName).toBe('H2')
    expect($('risingRuler').tagName).toBe('FIGURE')
    expect($('risingRuler').classList.contains('ruler')).toBe(true)
    expect($('risingRuler').getAttribute('aria-label')).toBeTruthy()
    expect($('risingAbout')).not.toBeNull()
    expect(document.querySelector('#rising .figure-key')).not.toBeNull()
    expect(document.querySelector('#rising .eyebrow')?.textContent).toBe('Gráfico 4')
    expect([...select('risingPerson').options].map((o) => o.value)).toEqual(['lula', 'bolsonaro'])
  })

  it('before bootData.ready the ghost shows with aria-busy and the reading prose, and nothing fetches', async () => {
    await start()
    expect(calls).toEqual([])
    expect($('risingRuler').hidden).toBe(false)
    expect($('risingRuler').getAttribute('aria-busy')).toBe('true')
    expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('risingRuler').querySelectorAll('.ghost').length).toBeGreaterThan(0)
    expect($('risingRuler').querySelectorAll('.ruler-axis')).toHaveLength(1)
    expect($('risingRuler').querySelectorAll('.ruler-tick')).toHaveLength(5)
    expect($('risingRuler').querySelector('.sr-only')?.textContent).toBe('Lendo os termos em alta.')
    expect($('risingRuler').textContent).not.toMatch(/Carregando/)
    expect($('risingAbout').textContent).toBe('')
    await settle(500)
    expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
  })

  it('once boot settles the component fetches and replaces the ghost', async () => {
    await start()
    boot()
    flushSync()
    await settle(220)
    expect(risingCalls()).toHaveLength(1)
    expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
    expect($('risingRuler').getAttribute('aria-busy')).toBe('false')
    expect(words()).toHaveLength(1)
  })

  it('the first request with no data shows the ghost and clears the about line', async () => {
    let release: (v: unknown) => void = () => {}
    handlers['/rising'] = () => new Promise((resolve) => (release = resolve))
    boot()
    await start()
    expect($('risingRuler').getAttribute('aria-busy')).toBe('true')
    expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
    expect($('risingRuler').querySelector('.sr-only')?.textContent).toBe('Lendo os termos em alta.')
    expect($('risingAbout').textContent).toBe('')
    release(payload([term()]))
    await settle()
    expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
    expect($('risingAbout').textContent).not.toBe('')
  })

  it('a reload with data on screen dims the figure and keeps the marks', async () => {
    boot()
    await start()
    let release: (v: unknown) => void = () => {}
    handlers['/rising'] = () => new Promise((resolve) => (release = resolve))
    select('risingSource').value = 'gdelt'
    select('risingSource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    expect($('rising').classList.contains('is-loading')).toBe(true)
    expect(words()).toHaveLength(1)
    expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
    release(payload([term({ term: 'novo' })]))
    await settle()
    expect($('rising').classList.contains('is-loading')).toBe(false)
    expect(words()[0].getAttribute('data-term')).toBe('novo')
  })

  it('peopleError hides the ruler, says so in #risingAbout and sends no request', async () => {
    boot({ people: [], peopleError: new Error('down') })
    await start()
    expect(calls).toEqual([])
    expect($('risingRuler').hidden).toBe(true)
    expect($('risingAbout').textContent).toBe('Falha de rede ou base indisponível.')
  })

  it('no people says so and sends no request', async () => {
    boot({ people: [] })
    await start()
    expect(calls).toEqual([])
    expect($('risingRuler').hidden).toBe(true)
    expect($('risingAbout').textContent).toBe('Nenhuma pessoa cadastrada.')
  })

  it('a failing fetch shows the error note and no marks; a following resize repaints nothing stale', async () => {
    boot()
    await start()
    expect(words()).toHaveLength(1)
    handlers['/rising'] = () => {
      throw new Error('offline')
    }
    await change('risingSource', 'gdelt')
    expect($('risingRuler').hidden).toBe(false)
    expect($('risingRuler').textContent).toContain('Não foi possível carregar os termos em alta.')
    expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
    expect($('risingRuler').getAttribute('aria-busy')).toBe('false')
    expect($('risingAbout').textContent).toBe('')
    expect(words()).toHaveLength(0)
    width = 350
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(words()).toHaveLength(0)
    expect($('risingRuler').textContent).toContain('Não foi possível carregar os termos em alta.')
  })

  it('a first-load failure never leaves the ghost on screen', async () => {
    handlers['/rising'] = () => {
      throw new Error('offline')
    }
    boot()
    await start()
    expect($('risingRuler').textContent).toContain('Não foi possível carregar os termos em alta.')
    expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
  })

  it('an empty terms payload shows the empty note and both window totals', async () => {
    handlers['/rising'] = () => payload([], { recent: 0, baseline: 12, words_recent: 0, words_baseline: 50 })
    boot()
    await start()
    expect($('risingRuler').hidden).toBe(false)
    expect($('risingRuler').textContent).toContain('Nenhuma palavra neste recorte.')
    expect($('risingRuler').getAttribute('aria-busy')).toBe('false')
    expect(words()).toHaveLength(0)
    expect($('risingAbout').textContent).toBe('A pessoa: 0 textos nos últimos 7 dias, 12 nos 30 dias antes; 0 pares texto-palavra agora, 50 antes.')
  })

  it('the about line is singular for one document and one pair', async () => {
    handlers['/rising'] = () => payload([term()], { recent: 1, baseline: 3, words_recent: 1, words_baseline: 12 })
    boot()
    await start()
    expect($('risingAbout').textContent).toBe('A pessoa: 1 texto nos últimos 7 dias, 3 nos 30 dias antes; 1 par texto-palavra agora, 12 antes.')
  })

  it('a payload without words_* says nothing about pairs and prints no NaN anywhere', async () => {
    handlers['/rising'] = () => ({ days: 7, baseline: 30, terms: [term({ term: 'antigo' })], outlets: [], about: { recent: 3, baseline: 12 } })
    boot()
    await start()
    expect($('risingAbout').textContent).toBe('A pessoa: 3 textos nos últimos 7 dias, 12 nos 30 dias antes.')
    expect($('risingAbout').textContent).not.toMatch(/par/)
    expect($('risingRuler').querySelector('[data-term="antigo"]')).not.toBeNull()
    expect($('rising').innerHTML).not.toMatch(/NaN/)
  })

  it('a payload with only one of words_* prints no pairs either', async () => {
    handlers['/rising'] = () => payload([term()], { recent: 3, baseline: 12, words_recent: 9 })
    boot()
    await start()
    expect($('risingAbout').textContent).toBe('A pessoa: 3 textos nos últimos 7 dias, 12 nos 30 dias antes.')
    expect($('rising').innerHTML).not.toMatch(/NaN|undefined/)
  })

  it('a payload with present is placed by share: ends, axis prose, --cmp from shareBalance', async () => {
    const terms = [term({ term: 'igual', count_recent_raw: 5, count_baseline_raw: 1, lift: 2 }), term({ term: 'oito', count_recent_raw: 40, count_baseline_raw: 1, lift: 9 })]
    handlers['/rising'] = () => payload(terms, { recent: 10, baseline: 5, words_recent: 40, words_baseline: 16 })
    boot()
    await start()
    expect([...$('risingRuler').querySelectorAll('.ruler-end')].map((e) => e.textContent)).toEqual(['antes (30 dias)', 'agora (7 dias)'])
    expect([...$('risingRuler').querySelectorAll('.ruler-axis-labels span')].map((e) => e.textContent)).toEqual(['Fatia menor que antes', 'mesma fatia', 'Fatia maior que antes'])
    const byTerm = (t: string) => words().find((w) => w.getAttribute('data-term') === t)!
    expect(byTerm('igual').getAttribute('style')).toContain(`--cmp: ${balanceColor(0)}`)
    expect(byTerm('oito').getAttribute('style')).toContain(`--cmp: ${balanceColor(1)}`)
    expect($('risingRuler').querySelector('.ruler-end.cmp-a')).not.toBeNull()
    expect($('risingRuler').querySelector('.ruler-end.cmp-b')).not.toBeNull()
  })

  it('a payload without present is placed by lift: person-pace axis prose, no rare list, no NaN', async () => {
    const lp = 10 / 7 / ((5 + 1) / 30)
    handlers['/rising'] = () => stale([term({ term: 'igual', lift: lp }), term({ term: 'oito', lift: lp * 8 }), term({ term: 'lenta', lift: lp / 8 })])
    boot()
    await start()
    expect(words()).toHaveLength(3)
    expect([...$('risingRuler').querySelectorAll('.ruler-axis-labels span')].map((e) => e.textContent)).toEqual(['Mais devagar que a pessoa', 'no mesmo ritmo', 'Mais rápido que a pessoa'])
    expect($('risingRuler').querySelector('.ruler-rare')).toBeNull()
    expect($('rising').innerHTML).not.toMatch(/NaN/)
    expect($('rising').innerHTML).not.toMatch(/Fatia/)
    const byTerm = (t: string) => words().find((w) => w.getAttribute('data-term') === t)!
    expect(byTerm('igual').getAttribute('style')).toContain(`--cmp: ${balanceColor(0)}`)
    expect(byTerm('oito').getAttribute('style')).toContain(`--cmp: ${balanceColor(1)}`)
    expect(byTerm('lenta').getAttribute('style')).toContain(`--cmp: ${balanceColor(-1)}`)
  })

  it('stale payload with baseline 0 stays finite', async () => {
    handlers['/rising'] = () => stale([term({ term: 'novo', lift: 40 })], { recent: 5, baseline: 0 })
    boot()
    await start()
    expect(words()).toHaveLength(1)
    expect($('rising').innerHTML).not.toMatch(/NaN/)
  })

  it('risers off the ruler (terms minus present, lift > 1) are listed after the overflow as buttons', async () => {
    const present = [term({ term: 'diretor', count_recent_raw: 12, count_baseline_raw: 1, lift: 2 })]
    const terms = [
      term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
      term({ term: 'vorcaro', kind: 'hashtag', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
      ...present,
      term({ term: 'caiu', count_recent_raw: 3, count_baseline_raw: 9, lift: 0.5 }),
    ]
    handlers['/rising'] = () => payload(terms, about, present)
    boot()
    await start()
    expect(words().map((w) => w.getAttribute('data-term'))).toEqual(['diretor'])
    const list = $('risingRuler').querySelector('.ruler-rare')!
    expect(list.textContent).toMatch(/Fora da régua, 2 palavras com poucos textos na semana, mas mais que antes/)
    expect(rare().map((b) => b.getAttribute('data-term'))).toEqual(['sigilo', 'vorcaro'])
    expect(rare().every((b) => b.tagName === 'BUTTON')).toBe(true)
    expect(rare()[1].getAttribute('data-kind')).toBe('hashtag')
    expect(rare()[1].textContent).toBe('#vorcaro')
    expect($('risingRuler').querySelector('[data-term="caiu"]')).toBeNull()
    expect($('risingRuler').querySelectorAll('[data-term="diretor"]')).toHaveLength(1)
    const all = [...$('risingRuler').children]
    const labels = all.findIndex((e) => e.classList.contains('ruler-axis-labels'))
    const tail = all.findIndex((e) => e.classList.contains('ruler-rare'))
    expect(tail).toBeGreaterThan(labels)
  })

  it('no present words but risers still paints the list, not the empty note', async () => {
    const terms = [term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })]
    handlers['/rising'] = () => payload(terms, about, [])
    boot()
    await start()
    expect(words()).toHaveLength(0)
    expect(rare()).toHaveLength(1)
    expect($('risingRuler').textContent).not.toContain('Nenhuma palavra neste recorte')
  })

  it('only the first RARE_SHOWN risers are listed, in lift order, saying "12 de 30"', async () => {
    const present = [term({ term: 'comum', count_recent_raw: 20, lift: 1.2 })]
    const risers = Array.from({ length: 30 }, (_, i) => term({ term: `rara${i}`, count_recent_raw: 3, count_baseline_raw: 0, lift: 40 - i }))
    handlers['/rising'] = () => payload([...risers, ...present], about, present)
    boot()
    await start()
    expect(RARE_SHOWN).toBe(12)
    expect(rare()).toHaveLength(12)
    expect(rare()[11].getAttribute('data-term')).toBe('rara11')
    expect($('risingRuler').querySelector('[data-term="rara12"]')).toBeNull()
    expect($('risingRuler').querySelector('.ruler-rare p')?.textContent).toMatch(/^Fora da régua, 12 de 30 palavras/)
  })

  it('three risers say "3 palavras" with no "de N"', async () => {
    const present = [term({ term: 'comum', count_recent_raw: 20, lift: 1.2 })]
    const risers = Array.from({ length: 3 }, (_, i) => term({ term: `rara${i}`, count_recent_raw: 3, count_baseline_raw: 0, lift: 40 - i }))
    handlers['/rising'] = () => payload([...risers, ...present], about, present)
    boot()
    await start()
    expect($('risingRuler').querySelector('.ruler-rare p')?.textContent).toMatch(/^Fora da régua, 3 palavras com/)
  })

  it('a picked rare button opens the card the way a word does and is marked selected', async () => {
    const present = [term({ term: 'comum', count_recent_raw: 20, lift: 1.2 })]
    const risers = [term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })]
    handlers['/rising'] = () => payload([...risers, ...present], about, present)
    boot()
    await start()
    click(rare()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    expect(rare()[0].classList.contains('is-selected')).toBe(true)
    expect(rare()[0].getAttribute('aria-pressed')).toBe('true')
    expect(docsCalls()[0].params.get('term')).toBe('sigilo')
  })

  it('words that do not fit are counted and listed as buttons that pick', async () => {
    const terms = Array.from({ length: 200 }, (_, i) => term({ term: `palavralongademais${i}`, count_recent_raw: 50, count_baseline_raw: 1, lift: 9 }))
    handlers['/rising'] = () => payload(terms)
    boot()
    await start()
    const spilled = overflow()
    expect(spilled.length).toBeGreaterThan(0)
    expect(words().length + spilled.length).toBe(200)
    for (const b of spilled) expect(b.tagName).toBe('BUTTON')
    expect($('risingRuler').querySelector('.ruler-overflow p')?.textContent).toMatch(new RegExp(`^${spilled.length} palavras não couberam`))
    click(spilled[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    expect(overflow()[0].classList.contains('is-selected')).toBe(true)
  })

  it('every drawn word keeps its hooks', async () => {
    boot()
    await start()
    const w = words()[0]
    expect(w.getAttribute('data-term')).toBe('diretor')
    expect(w.getAttribute('data-kind')).toBe('word')
    expect(w.getAttribute('role')).toBe('button')
    expect(w.getAttribute('tabindex')).toBe('0')
    expect(w.getAttribute('aria-pressed')).toBe('false')
    expect(w.getAttribute('aria-label')).toBeTruthy()
    expect(w.querySelector('text.ruler-text > tspan')?.textContent).toBe('diretor')
    const style = w.getAttribute('style') ?? ''
    expect(style).toMatch(/--size/)
    expect(style).toMatch(/--cmp/)
    expect(style).not.toMatch(/font-size/)
  })

  it('an injected measure prop is what places the words', async () => {
    const measure = vi.fn((text: string, size: number) => text.length * size)
    boot()
    await start({ measure })
    expect(measure).toHaveBeenCalled()
    expect(words()).toHaveLength(1)
  })

  it('a click picks the word and opens the card once, one side, owned by rising, days=7 and the figure source', async () => {
    boot({ search: '?person=bolsonaro&source=gdelt' })
    await start()
    expect(docsCalls()).toHaveLength(0)
    click(words()[0])
    await settle()
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    expect(words()[0].classList.contains('is-selected')).toBe(true)
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('rising')).toBe(true)
    expect(docsCalls()).toHaveLength(1)
    const c = docsCalls()[0]
    expect(c.path).toBe('/api/people/bolsonaro/docs')
    expect(c.params.get('days')).toBe('7')
    expect(c.params.get('source')).toBe('gdelt')
    expect(c.params.get('term')).toBe('diretor')
    expect(c.params.get('kind')).toBe('word')
  })

  it('the card names the word and the kicker names the kind', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect($('docsTitle').textContent).toBe('diretor')
    expect($('docsKicker').textContent).toBe('Documentos com palavra')
    expect(document.body.textContent).toContain('Lula')
  })

  it('a hashtag pick sends its own kind', async () => {
    handlers['/rising'] = () => payload([term({ term: 'vorcaro', kind: 'hashtag' })])
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(docsCalls()[0].params.get('kind')).toBe('hashtag')
    expect($('docsKicker').textContent).not.toBe('Documentos com palavra')
  })

  for (const key of ['Enter', ' ']) {
    it(`pressing ${key === ' ' ? 'Space' : key} on a word picks it and prevents the default`, async () => {
      boot()
      await start()
      const e = keydown(words()[0], key)
      expect(e.defaultPrevented).toBe(true)
      await settle()
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
      expect(docsCard.openedBy('rising')).toBe(true)
      expect(docsCalls()).toHaveLength(1)
    })
  }

  it('another key on a word does nothing', async () => {
    boot()
    await start()
    const e = keydown(words()[0], 'a')
    expect(e.defaultPrevented).toBe(false)
    await settle()
    expect(docsCard.isOpen()).toBe(false)
  })

  it('the same word again, the background and Escape each release the pick and close the card', async () => {
    boot()
    await start()
    const releasers: [string, () => void][] = [
      ['same word', () => click(words()[0])],
      ['background', () => click($('risingRuler'))],
      ['escape', escape],
    ]
    for (const [name, release] of releasers) {
      click(words()[0])
      await settle()
      expect(docsCard.openedBy('rising'), `${name}: open`).toBe(true)
      release()
      await settle()
      expect(docsCard.isOpen(), `${name}: card closed`).toBe(false)
      expect(words()[0].getAttribute('aria-pressed'), `${name}: unpicked`).toBe('false')
    }
  })

  it('a click on the header, the subtitle or a select keeps the pick and the card', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    for (const el of [document.querySelector('#rising .figure-head')!, document.querySelector('#rising .figure-sub')!, select('risingPerson'), select('risingSource'), $('risingAbout')]) {
      click(el)
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('a control change closes the card this figure owns', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    await change('risingSource', 'gdelt')
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
  })

  for (const [id, value, key] of [
    ['risingPerson', 'bolsonaro', 'person'],
    ['risingSource', 'bluesky', 'source'],
  ]) {
    it(`changing #${id} issues exactly one /rising request carrying the new ${key}`, async () => {
      boot()
      await start()
      const before = calls.length
      await change(id, value)
      const added = calls.slice(before)
      expect(added).toHaveLength(1)
      expect(added[0].path.endsWith('/rising')).toBe(true)
      if (key === 'person') expect(added[0].path).toBe('/api/people/bolsonaro/rising')
      else expect(added[0].params.get('source')).toBe('bluesky')
      expect(added[0].params.get('days')).toBe('7')
    })
  }

  it('a control change leaves a card another figure opened over a rising pick', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    expect(docsCard.openedBy('rising')).toBe(false)
    await change('risingSource', 'gdelt')
    expect(docsCard.isOpen()).toBe(true)
    expect(docsCard.openedBy('atlas')).toBe(true)
  })

  it('Escape and a background click do not close a card the atlas opened', async () => {
    boot()
    await start()
    void docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
    await settle()
    escape()
    click($('risingRuler'))
    await settle()
    expect(docsCard.openedBy('atlas')).toBe(true)
    expect(docsCard.isOpen()).toBe(true)
  })

  it('a resize with the same data keeps the pick and the card, without a fetch', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    const before = calls.length
    const markup = $('risingRuler').innerHTML
    width = 400
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect(calls.length).toBe(before)
    expect(docsCard.openedBy('rising')).toBe(true)
    expect(words()[0].getAttribute('aria-pressed')).toBe('true')
    expect($('risingRuler').innerHTML).not.toBe(markup)
    click(words()[0])
    await settle()
    expect(docsCard.isOpen()).toBe(false)
  })

  it('the resize observer watches #risingRuler and never the whole section', async () => {
    boot()
    await start()
    expect(observers.some((o) => o.target === $('risingRuler'))).toBe(true)
    expect(observers.some((o) => o.target === $('rising'))).toBe(false)
  })

  it('a resize during loading repaints nothing over the ghost', async () => {
    let release: (v: unknown) => void = () => {}
    handlers['/rising'] = () => new Promise((resolve) => (release = resolve))
    boot()
    await start()
    const ghost = $('risingRuler').innerHTML
    width = 300
    for (const o of observers) o.cb()
    flushSync()
    await settle()
    expect($('risingRuler').innerHTML).toBe(ghost)
    release(payload([term()]))
    await settle()
    expect(words()).toHaveLength(1)
  })

  it('a new dataset clears the pick and closes the card it opened', async () => {
    boot()
    await start()
    click(words()[0])
    await settle()
    handlers['/rising'] = () => payload([term()])
    clearScopes()
    await change('risingSource', 'rss')
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
    expect(docsCard.isOpen()).toBe(false)
  })

  it('a pick made on dimmed data is dropped when the new data lands', async () => {
    boot()
    await start()
    let release: (v: unknown) => void = () => {}
    handlers['/rising'] = () => new Promise((resolve) => (release = resolve))
    select('risingSource').value = 'gdelt'
    select('risingSource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    expect($('rising').classList.contains('is-loading')).toBe(true)
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    release(payload([term()]))
    await settle()
    expect($('rising').classList.contains('is-loading')).toBe(false)
    expect(docsCard.isOpen()).toBe(false)
    expect(words()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('a pick made on dimmed data is dropped when that reload fails', async () => {
    boot()
    await start()
    let fail: (e: unknown) => void = () => {}
    handlers['/rising'] = () => new Promise((_, reject) => (fail = reject))
    select('risingSource').value = 'gdelt'
    select('risingSource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(220)
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    fail(new Error('boom'))
    await settle()
    expect(docsCard.isOpen()).toBe(false)
    expect($('risingRuler').textContent).toContain('Não foi possível carregar os termos em alta.')
  })

  it('a pick made inside the reload debounce closes when the new data lands', async () => {
    boot()
    await start()
    select('risingSource').value = 'gdelt'
    select('risingSource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    await settle(220)
    expect(docsCard.isOpen()).toBe(false)
  })

  it('a pick made inside the reload debounce closes when that reload fails', async () => {
    boot()
    await start()
    handlers['/rising'] = () => {
      throw new Error('offline')
    }
    select('risingSource').value = 'gdelt'
    select('risingSource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    click(words()[0])
    await settle()
    expect(docsCard.openedBy('rising')).toBe(true)
    await settle(220)
    expect(docsCard.isOpen()).toBe(false)
    expect($('risingRuler').textContent).toContain('Não foi possível carregar os termos em alta.')
  })

  it('?person= and ?source= seed the controls and the first request', async () => {
    boot({ search: '?person=bolsonaro&source=gdelt' })
    await start()
    expect(select('risingPerson').value).toBe('bolsonaro')
    expect(select('risingSource').value).toBe('gdelt')
    expect(risingCalls()[0].path).toBe('/api/people/bolsonaro/rising')
    expect(risingCalls()[0].params.get('source')).toBe('gdelt')
  })

  it('a prefixed key beats the bare one for this figure only', async () => {
    boot({ search: '?person=bolsonaro&source=gdelt&rising.person=lula&rising.source=rss' })
    await start()
    expect(select('risingPerson').value).toBe('lula')
    expect(select('risingSource').value).toBe('rss')
    remount()
    boot({ search: '?person=bolsonaro&compare.person=lula&week.source=rss' })
    await start()
    expect(select('risingPerson').value).toBe('bolsonaro')
    expect(select('risingSource').value).toBe('all')
  })

  it('rising.source overrides the source for figure 4 only', async () => {
    boot({ search: '?person=bolsonaro&rising.source=gdelt' })
    await start()
    expect(select('risingPerson').value).toBe('bolsonaro')
    expect(risingCalls()[0].params.get('source')).toBe('gdelt')
  })

  it('an unknown person falls back to the first tracked one', async () => {
    boot({ search: '?person=ninguem' })
    await start()
    expect(select('risingPerson').value).toBe('lula')
    expect(risingCalls()[0].path).toBe('/api/people/lula/rising')
  })

  it('an unavailable source is ignored', async () => {
    boot({ search: '?source=nao-existe' })
    await start()
    expect(select('risingSource').value).toBe('all')
    expect(risingCalls()[0].params.get('source')).toBe('all')
  })

  it('a later setBoot never re-seeds nor refetches', async () => {
    boot({ search: '?rising.source=gdelt' })
    await start()
    expect(risingCalls()).toHaveLength(1)
    await change('risingSource', 'rss')
    const before = calls.length
    boot({ search: '?rising.source=gdelt', people: [...people, { id: 'ciro', name: 'Ciro' }] })
    flushSync()
    await settle(500)
    expect(select('risingSource').value).toBe('rss')
    expect(calls.length).toBe(before)
  })

  it('no inline style but the --var overrides, no font-size literal, no style element', async () => {
    const terms = Array.from({ length: 200 }, (_, i) => term({ term: `palavralongademais${i}`, count_recent_raw: 50, count_baseline_raw: 1, lift: 9 }))
    handlers['/rising'] = () => payload([...terms], about, terms.slice(0, 190))
    boot()
    await start()
    expect($('rising').querySelector('style')).toBeNull()
    for (const el of $('rising').querySelectorAll('[style]')) {
      const style = el.getAttribute('style') ?? ''
      expect(style, style).not.toMatch(/font-size/)
      for (const decl of style.split(';').filter(Boolean)) expect(decl.trim(), style).toMatch(/^--[\w-]+:/)
    }
  })
  describe('mutation hardening', () => {
    const held = () => {
      let release: (v: unknown) => void = () => {}
      let fail: (e: unknown) => void = () => {}
      handlers['/rising'] = () => new Promise((resolve, reject) => ((release = resolve), (fail = reject)))
      return { release: (v: unknown) => release(v), fail: (e: unknown) => fail(e) }
    }
    const pickRare = (terms: RisingTerm[]) => {
      const present = [term({ term: 'comum', count_recent_raw: 20, lift: 1.2 })]
      handlers['/rising'] = () => payload([...terms, ...present], about, present)
    }

    it('a lone riser says "1 palavra" in the singular', async () => {
      pickRare([term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })])
      boot()
      await start()
      expect($('risingRuler').querySelector('.ruler-rare p')?.textContent).toMatch(/^Fora da régua, 1 palavra com/)
    })

    it('a word and a hashtag of the same name are two rare buttons, and only the picked kind is selected', async () => {
      pickRare([
        term({ term: 'vorcaro', kind: 'word', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        term({ term: 'vorcaro', kind: 'hashtag', count_recent_raw: 3, count_baseline_raw: 0, lift: 11 }),
        term({ term: 'outra', kind: 'word', count_recent_raw: 3, count_baseline_raw: 0, lift: 10 }),
      ])
      boot()
      await start()
      expect(rare()).toHaveLength(3)
      click(rare()[1])
      await settle()
      expect(rare().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
      expect(rare().map((b) => b.classList.contains('is-selected'))).toEqual([false, true, false])
      expect(docsCalls()[0].params.get('kind')).toBe('hashtag')
    })

    it('picking the same term under another kind moves the pick instead of releasing it', async () => {
      pickRare([
        term({ term: 'vorcaro', kind: 'word', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        term({ term: 'vorcaro', kind: 'hashtag', count_recent_raw: 3, count_baseline_raw: 0, lift: 11 }),
      ])
      boot()
      await start()
      click(rare()[0])
      await settle()
      click(rare()[1])
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      expect(rare().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
      click(rare()[0])
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      expect(rare().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    })

    it('a different word of the same kind is not marked when one is picked', async () => {
      pickRare([
        term({ term: 'a', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        term({ term: 'b', count_recent_raw: 3, count_baseline_raw: 0, lift: 11 }),
      ])
      boot()
      await start()
      click(rare()[0])
      await settle()
      expect(rare().map((b) => b.classList.contains('is-selected'))).toEqual([true, false])
    })

    it('a rare button carries its own side colour', async () => {
      pickRare([term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })])
      boot()
      await start()
      expect(rare()[0].getAttribute('style')).toMatch(/--cmp:\s*\S+/)
      expect(rare()[0].getAttribute('data-kind')).toBe('word')
    })

    it('the ruler svg keeps its accessible name and falls back to 860 wide when unmeasured', async () => {
      width = 0
      boot()
      await start()
      const svg = $('risingRuler').querySelector('svg.ruler-svg')!
      expect(svg.getAttribute('aria-label')).toBe('Régua de termos em alta')
      expect(svg.getAttribute('viewBox')).toMatch(/^0 0 860 /)
    })

    it('a payload with only words_baseline prints no pairs either', async () => {
      handlers['/rising'] = () => payload([term()], { recent: 3, baseline: 12, words_baseline: 9 })
      boot()
      await start()
      expect($('risingAbout').textContent).toBe('A pessoa: 3 textos nos últimos 7 dias, 12 nos 30 dias antes.')
      expect($('rising').innerHTML).not.toMatch(/NaN|undefined/)
    })

    it('a peopleError stays a boot ghost until boot is ready, and no request goes out', async () => {
      setBoot({ ready: false, people: [], peopleError: new Error('down'), search: '' })
      await start()
      expect(calls).toEqual([])
      expect($('risingRuler').hidden).toBe(false)
      expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
      expect($('risingAbout').textContent).toBe('')
    })

    it('an empty registry is still a ghost until boot is ready', async () => {
      setBoot({ ready: false, people: [], peopleError: null, search: '' })
      await start()
      expect($('risingRuler').hidden).toBe(false)
      expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
      expect($('risingAbout').textContent).toBe('')
    })

    it('boot going not-ready again ghosts the figure and blanks the about line', async () => {
      boot()
      await start()
      expect($('risingAbout').textContent).not.toBe('')
      setBoot({ ready: false })
      flushSync()
      expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
      expect($('risingAbout').textContent).toBe('')
    })

    it('no request goes out while a people error sits beside a non-empty list', async () => {
      boot({ peopleError: new Error('down') })
      await start()
      expect(calls).toEqual([])
      expect($('risingAbout').textContent).toBe('Falha de rede ou base indisponível.')
    })

    it('a reload after an error ghosts the figure again, then paints the ruler without the error note', async () => {
      boot()
      handlers['/rising'] = () => {
        throw new Error('offline')
      }
      await start()
      expect($('risingRuler').textContent).toContain('Não foi possível')
      const h = held()
      await change('risingSource', 'gdelt')
      expect($('risingRuler').querySelector('.ghost-field')).not.toBeNull()
      expect($('risingRuler').getAttribute('aria-busy')).toBe('true')
      expect($('risingRuler').textContent).not.toContain('Não foi possível')
      h.release(payload([term({ term: 'novo' })]))
      await settle()
      expect($('risingRuler').textContent).not.toContain('Não foi possível')
      expect(words()[0].getAttribute('data-term')).toBe('novo')
      expect($('risingRuler').querySelector('.ghost-field')).toBeNull()
    })

    it('a failed reload with data on screen leaves neither the dim class nor the ghost behind', async () => {
      boot()
      await start()
      const h = held()
      await change('risingSource', 'gdelt')
      expect($('rising').classList.contains('is-loading')).toBe(true)
      h.fail(new Error('boom'))
      await settle()
      expect($('rising').classList.contains('is-loading')).toBe(false)
      expect($('risingRuler').getAttribute('aria-busy')).toBe('false')
      expect($('risingAbout').textContent).toBe('')
    })

    it('a control change releases the pick before the new data lands', async () => {
      boot()
      await start()
      click(words()[0])
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      const h = held()
      await change('risingSource', 'gdelt')
      expect(docsCard.isOpen()).toBe(false)
      expect(words()[0].getAttribute('aria-pressed')).toBe('false')
      h.release(payload([term()]))
      await settle()
    })

    it('picking another word of the same kind moves the pick and keeps the card', async () => {
      pickRare([
        term({ term: 'a', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 }),
        term({ term: 'b', count_recent_raw: 3, count_baseline_raw: 0, lift: 11 }),
      ])
      boot()
      await start()
      click(rare()[0])
      await settle()
      click(rare()[1])
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      expect(rare().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
      expect(docsCalls().map((c) => c.params.get('term'))).toEqual(['a', 'b'])
    })

    it('the card side carries the tracked person by name', async () => {
      boot()
      await start()
      click(words()[0])
      await settle()
      expect(document.querySelector('#docs .docs-side-name')?.textContent).toBe('Lula')
    })

    it('clicking the same rare riser again releases the pick and closes the card', async () => {
      const riser = term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })
      pickRare([riser])
      boot()
      await start()
      click(rare()[0])
      await settle()
      expect(docsCard.openedBy('rising')).toBe(true)
      click(rare()[0])
      await settle()
      expect(docsCard.isOpen()).toBe(false)
      expect(rare()[0].getAttribute('aria-pressed')).toBe('false')
    })

    it('a rare riser is coloured by its own share balance', async () => {
      const riser = term({ term: 'sigilo', count_recent_raw: 3, count_baseline_raw: 0, lift: 12 })
      pickRare([riser])
      boot()
      await start()
      expect(rare()[0].getAttribute('style')).toContain(`--cmp: ${balanceColor(shareBalance(riser, about))}`)
    })

    it('a person change while people are stale never asks for a person that is not registered', async () => {
      boot()
      await start()
      await change('risingPerson', 'bolsonaro')
      expect(risingCalls().at(-1)!.path).toContain('/people/bolsonaro/rising')
    })

    it('the request spans carry the person', async () => {
      const seen: unknown[] = []
      const measure = performance.measure.bind(performance)
      vi.spyOn(performance, 'measure').mockImplementation(((name: string, opts?: { detail?: unknown }) => {
        if (name === 'figure:rising') seen.push(opts?.detail)
        return measure(name, opts as never)
      }) as never)
      boot()
      await start()
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.at(-1)).toMatchObject({ person: 'lula' })
    })
  })
})
