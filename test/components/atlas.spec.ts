import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const docsCard = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), openedBy: vi.fn(() => false), isOpen: vi.fn(() => false) }))
vi.mock('../../src/ui/docs-card.svelte.js', async (orig) => ({ ...(await orig<object>()), ...docsCard }))

// @ts-ignore -- the component is what issue #297 adds
import Atlas from '../../src/ui/Atlas.svelte'
import { docsQuery, scopeKeys } from '../../src/ui/atlas-model.js'
import { params } from '../../src/ui/api.js'
import { scatterLayout, termStripLayout } from '../../src/ui/layout.js'
import { communityRanking, fmt, score, signed, termMask, themeMask } from '../../src/ui/format.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { SCOPE_TTL_MS, clearScopes, readScope } from '../../src/ui/state.js'

// figure 1 (#297). Ported from test/figures-atlas.test.ts (handlers and mask cycle, "no mesmo
// tema", selection toggle, request counting, strip mode, sparkline, reach) and from the
// figure-1 parts of test/app.test.ts and test/render.test.ts (boot ghost, outage, seeding).

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'tarcisio', name: 'Tarcísio' },
]
const stats = (over: Record<string, unknown> = {}) => ({ about: 10, testimony: { method: 'kikori', score: -1, n: 100 }, ...over })
const tone = (score: number, n = 12) => ({ score, n })
const graphOf = (nodes: unknown[], over: Record<string, unknown> = {}, person = people[0]) => ({ person, nodes, links: [], stats: stats(), ...over })
const golpe = { id: 'word:golpe', term: 'golpe', kind: 'word', count: 41, pmi: 2.1, testimony: tone(-3.97) }
const reforma = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 20, pmi: 1.4, testimony: tone(0.2, 8) }
const nodes2 = [golpe, reforma]

type Held = { url: string; signal?: AbortSignal; resolve: (body: unknown) => void; reject: (e: unknown) => void }

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let urls: string[]
let signals: Map<string, AbortSignal | undefined>
let bodies: Record<string, unknown>
let held: Held[]
let holding: RegExp | null
let failing: RegExp | null
let observers: { target: unknown; cb: () => void; disconnect: ReturnType<typeof vi.fn> }[]
const widths: Record<string, number> = {}

const $ = (id: string) => document.getElementById(id) as HTMLElement
const select = (id: string) => $(id) as HTMLSelectElement
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const graphUrls = () => urls.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/graph'))
const timelineUrls = () => urls.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/timeline'))
const q = (u: string) => new URL(u, 'http://localhost').searchParams
const fire = (el: Element, type = 'click') => {
  el.dispatchEvent(new (type === 'keydown' ? KeyboardEvent : Event)(type, { bubbles: true }))
  flushSync()
}
const change = (id: string, value: string) => {
  const el = select(id)
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}
const settle = async (ms = 300) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}
const nodeEl = (id: string) => document.querySelector<HTMLElement>(`[data-node="${id}"]`)!
// The colour lives on the list row's dot and on the scatter point itself.
const paintOf = (id: string, prop: string) => (nodeEl(id).querySelector<HTMLElement>('.list-dot') ?? nodeEl(id)).style.getPropertyValue(prop)
const rows = () => all('#columns [data-node]')
const points = () => all('#scatter [data-node]')
const toScatter = () => fire($('modeScatter'))
const okResponse = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
const start = async (search = '') => {
  setBoot({ ready: true, people, peopleError: null, search })
  instance = mount(Atlas, { target })
  flushSync()
  await settle()
}
const routeOf = (url: string) => new URL(url, 'http://localhost').pathname.split('/').pop() as string

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  urls = []
  signals = new Map()
  held = []
  holding = null
  failing = null
  observers = []
  bodies = { graph: graphOf(nodes2), docs: { docs: [], total: 0 }, timeline: [] }
  for (const k of Object.keys(widths)) delete widths[k]
  docsCard.open.mockClear()
  docsCard.close.mockClear()
  docsCard.openedBy.mockReset()
  docsCard.openedBy.mockReturnValue(false)
  docsCard.isOpen.mockReset()
  docsCard.isOpen.mockReturnValue(false)
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
  ;(globalThis as any).ResizeObserver = class {
    target: unknown
    cb: () => void
    disconnect = vi.fn()
    constructor(cb: () => void) {
      this.cb = cb
    }
    observe(t: unknown) {
      this.target = t
      observers.push({ target: t, cb: this.cb, disconnect: this.disconnect })
    }
    unobserve() {}
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ font: '', measureText: (t: string) => ({ width: t.length * 9, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }) }) as any,
  )
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return widths[(this as HTMLElement).id] ?? 0 } })
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn() } })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      urls.push(String(url))
      signals.set(String(url), init?.signal)
      const route = routeOf(String(url).split('?')[0])
      if (failing?.test(String(url))) return Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
      if (holding?.test(String(url)))
        return new Promise((resolve, reject) => held.push({ url: String(url), signal: init?.signal, resolve: (b) => resolve(okResponse(b)), reject }))
      return Promise.resolve(okResponse(bodies[route] ?? {}))
    }),
  )
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const IDS = [
  'workspace', 'atlasTitle', 'atlasStats', 'keyDefault', 'keyDefaultColor', 'keyTheme', 'keyThemeText', 'keyStrip', 'person', 'days', 'source', 'sort', 'limit', 'status',
  'search', 'searchNote', 'modeColumns', 'modeScatter', 'modeStrip', 'mask', 'clear', 'columns', 'scatter', 'keyScatter', 'keyScatterColor',
  'atlasStrip', 'stripHiddenNote', 'legend', 'inspector', 'selectionNote',
]

describe('Atlas (issue #297)', () => {
  it('atlas AC2: renders every id of the figure exactly once, with the section and the sr-only note as today', async () => {
    await start()
    for (const id of IDS) expect(document.querySelectorAll(`[id="${id}"]`).length, `#${id}`).toBe(1)
    const section = $('workspace')
    expect(section.tagName).toBe('SECTION')
    expect(section.className).toMatch(/\bfigure\b/)
    expect(section.className).toMatch(/\bworkspace\b/)
    expect(section.getAttribute('aria-labelledby')).toBe('atlasTitle')
    expect(section.contains($('status'))).toBe(true)
    expect(section.contains($('atlasStats'))).toBe(true)
    const note = $('selectionNote')
    expect(section.contains(note)).toBe(false)
    expect(section.nextElementSibling).toBe(note)
    expect(note.classList.contains('sr-only')).toBe(true)
    expect(note.getAttribute('role')).toBe('status')
    expect(all('#workspace dl.figure-key').map((d) => d.id)).toEqual(['keyDefault', 'keyScatter', 'keyTheme', 'keyStrip'])
    expect(all('#workspace .segment button').map((b) => b.id)).toEqual(['modeColumns', 'modeScatter', 'modeStrip'])
    for (const gone of ['modeMap', 'zoomGroup', 'viewport', 'overflow']) expect(document.getElementById(gone), gone).toBeNull()
    expect(document.querySelector('h2#atlasTitle')!.textContent).toContain('Atlas de palavras')
    expect(all('#person option').map((o) => o.getAttribute('value'))).toEqual(['lula', 'tarcisio'])
  })

  it('atlas AC3: before boot data is ready it shows the ghost and "Lendo as pessoas.", and asks for nothing', async () => {
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('status').textContent).toBe('Lendo as pessoas.')
    expect($('modeColumns').getAttribute('aria-pressed')).toBe('true')
    expect($('columns').hidden).toBe(false)
    expect($('columns').querySelector('.ghost-field, .ghost')).not.toBeNull()
    expect($('columns').querySelectorAll('.list-row.is-ghost')).toHaveLength(18)
    expect($('columns').querySelector('[data-node], svg')).toBeNull()
    expect($('columns').textContent).not.toContain('Carregando')
    expect(urls).toEqual([])
  })

  it('atlas AC3: once boot is ready it loads exactly once', async () => {
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    setBoot({ ready: true, people, peopleError: null, search: '' })
    flushSync()
    await settle()
    expect(graphUrls()).toHaveLength(1)
    expect(new URL(graphUrls()[0], 'http://localhost').pathname).toBe('/api/people/lula/graph')
    expect($('status').textContent).toMatch(/documentos sobre Lula neste recorte/)
    expect($('atlasStats').textContent).toMatch(/docs ·/)
  })

  it('atlas AC3: a people outage shows the outage note, never an empty person list, and fires no /graph', async () => {
    setBoot({ ready: true, people: [], peopleError: new Error('boom'), search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('status').textContent).toBe('Não foi possível carregar dados reais.')
    expect($('status').classList.contains('error')).toBe(true)
    expect($('columns').textContent).toContain('Falha de rede ou base indisponível')
    expect($('columns').textContent).toContain('Nenhum grafo fictício será exibido')
    expect($('columns').textContent).not.toContain('seed.json')
    expect(document.getElementById('retry')).not.toBeNull()
    expect(urls).toEqual([])
  })

  it('atlas AC3: an empty person list says so and asks for nothing', async () => {
    setBoot({ ready: true, people: [], peopleError: null, search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('status').textContent).toBe('Nenhuma pessoa cadastrada.')
    expect($('columns').textContent).toMatch(/seed\.json/)
    expect($('columns').textContent).not.toMatch(/Falha de rede/)
    expect(urls).toEqual([])
  })

  it('atlas AC4: the defaults are the first /graph request', async () => {
    await start()
    const qs = q(graphUrls()[0])
    expect(qs.get('days')).toBe('21')
    expect(qs.get('sort')).toBe('pmi')
    expect(qs.get('limit')).toBe('18')
    expect(qs.get('source')).toBe('all')
    expect(qs.get('kind')).toBe('word,hashtag,phrase,org')
    expect(qs.get('communities')).toBe('1')
    expect(qs.get('testimony')).toBe('1')
  })

  it('atlas AC24: the period select offers exactly 7 and 21, in that order, with 21 selected on mount', async () => {
    await start()
    expect([...select('days').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('days').options].map((o) => o.textContent)).toEqual(['últimos 7 dias', 'últimos 21 dias'])
    expect(select('days').value).toBe('21')
    expect(q(graphUrls()[0]).get('days')).toBe('21')
    fire(nodeEl('word:golpe'))
    expect($('inspector').textContent).toContain('últimos 21 dias')
  })

  it('atlas AC25: a shared link with days=30 or days=60 opens on 21, never blank, and days=7 still selects 7', async () => {
    for (const days of ['30', '60']) {
      await start(`?days=${days}`)
      expect(select('days').value).toBe('21')
      expect(q(graphUrls()[0]).get('days')).toBe('21')
      unmount(instance!)
      instance = undefined
      target.replaceChildren()
      urls = []
      clearScopes()
    }
    await start('?days=7')
    expect(select('days').value).toBe('7')
    expect(q(graphUrls()[0]).get('days')).toBe('7')
  })

  it('atlas AC4: bare keys seed the controls and the first /graph request', async () => {
    await start('?person=tarcisio&days=7&source=bluesky&sort=count&limit=24')
    expect(select('person').value).toBe('tarcisio')
    expect(select('days').value).toBe('7')
    expect(select('source').value).toBe('bluesky')
    expect(select('sort').value).toBe('count')
    expect(select('limit').value).toBe('24')
    const first = graphUrls()[0]
    expect(new URL(first, 'http://localhost').pathname).toBe('/api/people/tarcisio/graph')
    expect(q(first).get('days')).toBe('7')
    expect(q(first).get('source')).toBe('bluesky')
    expect(q(first).get('sort')).toBe('count')
    expect(q(first).get('limit')).toBe('24')
    expect(graphUrls()).toHaveLength(1)
  })

  it('atlas AC4: a prefixed key beats the bare one', async () => {
    await start('?days=21&atlas.days=7&source=gdelt&atlas.source=rss')
    expect(select('days').value).toBe('7')
    expect(select('source').value).toBe('rss')
    expect(q(graphUrls()[0]).get('days')).toBe('7')
    expect(q(graphUrls()[0]).get('source')).toBe('rss')
  })

  it('atlas AC4: an invalid value is ignored', async () => {
    await start('?person=ninguem&days=9&source=nope&sort=zzz&limit=7')
    expect(select('person').value).toBe('lula')
    expect(select('days').value).toBe('21')
    expect(select('source').value).toBe('all')
    expect(select('sort').value).toBe('pmi')
    expect(select('limit').value).toBe('18')
    expect(q(graphUrls()[0]).get('days')).toBe('21')
  })

  it('atlas AC2: first paint is a list ghost (aria-busy), a reload only dims the section', async () => {
    holding = /\/graph/
    setBoot({ ready: true, people, peopleError: null, search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('status').textContent).toBe('Lendo o recorte.')
    expect($('columns').getAttribute('aria-busy')).toBe('true')
    expect($('columns').querySelector('.ghost-field, .ghost')).not.toBeNull()
    held[0].resolve(graphOf(nodes2))
    await settle()
    expect($('columns').getAttribute('aria-busy')).toBe('false')
    expect($('workspace').classList.contains('is-loading')).toBe(false)
    change('days', '7')
    flushSync()
    await settle(200)
    expect($('workspace').classList.contains('is-loading')).toBe(true)
    held[1].resolve(graphOf(nodes2))
    await settle()
    expect($('workspace').classList.contains('is-loading')).toBe(false)
  })

  it('atlas: a failed /graph shows the outage note and its retry refetches', async () => {
    failing = /\/graph/
    await start()
    expect($('status').textContent).toBe('Não foi possível carregar dados reais.')
    expect($('status').classList.contains('error')).toBe(true)
    expect($('columns').textContent).toContain('Falha de rede ou base indisponível')
    expect($('columns').hidden).toBe(false)
    expect($('columns').querySelector('#retry')).not.toBeNull()
    expect($('scatter').hidden).toBe(true)
    expect($('atlasStrip').hidden).toBe(true)
    const retry = document.getElementById('retry')!
    expect(retry).not.toBeNull()
    failing = null
    fire(retry)
    await settle()
    expect(graphUrls()).toHaveLength(2)
    expect(rows().length).toBe(2)
    expect($('status').classList.contains('error')).toBe(false)
  })

  it('atlas AC3: paints one list row per term in payload order, with the person entry first', async () => {
    bodies.graph = graphOf([
      golpe,
      { id: 'hashtag:stf', term: 'stf', kind: 'hashtag', count: 30, pmi: 1.8 },
      { id: 'org:pt', term: 'PT', kind: 'org', count: 12, pmi: 1.1 },
      { id: 'phrase:primeiro turno', term: 'primeiro turno', kind: 'phrase', count: 9, pmi: 1 },
    ])
    await start()
    expect(rows().map((n) => n.dataset.node)).toEqual(['word:golpe', 'hashtag:stf', 'org:pt', 'phrase:primeiro turno'])
    expect(nodeEl('word:golpe').tagName).toBe('BUTTON')
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(rows().map((r) => r.querySelector('.list-rank')!.textContent)).toEqual(['01', '02', '03', '04'])
    expect(rows().map((r) => r.querySelector('.list-term')!.textContent!.trim())).toEqual(['golpe', '#stf', 'PT org', 'primeiro turno'])
    expect($('columns').firstElementChild!.matches('.column-person[data-person-docs]')).toBe(true)
    expect($('columns').textContent).not.toContain('NO CENTRO DA CONVERSA')
  })

  it('atlas AC7: rows are coloured against the person mean only when they carry a testimony; a null tone is neutral', async () => {
    bodies.graph = graphOf([golpe, { id: 'word:neutro', term: 'neutro', kind: 'word', count: 12, pmi: 1 }])
    await start()
    expect(paintOf('word:golpe', '--mask')).toBe(termMask(golpe as never, -1))
    expect(paintOf('word:neutro', '--mask')).toBe('')
    expect($('columns').classList.contains('is-masked')).toBe(true)
  })

  it('atlas AC5: the mask button cycles avaliação -> tema -> off -> avaliação and swaps the keys', async () => {
    await start()
    const mask = $('mask')
    expect(mask.textContent).toBe('Colorir por avaliação')
    expect(mask.getAttribute('aria-pressed')).toBe('true')
    expect($('keyDefault').hidden).toBe(false)
    expect($('keyTheme').hidden).toBe(true)
    fire(mask)
    expect(mask.textContent).toBe('Colorir por tema')
    expect(mask.getAttribute('aria-pressed')).toBe('true')
    expect($('keyTheme').hidden).toBe(false)
    expect($('keyDefaultColor').hidden).toBe(true)
    fire(mask)
    expect(mask.textContent).toBe('Sem cor')
    expect(mask.getAttribute('aria-pressed')).toBe('false')
    expect($('keyTheme').hidden).toBe(true)
    expect($('keyDefaultColor').hidden).toBe(false)
    fire(mask)
    expect(mask.textContent).toBe('Colorir por avaliação')
    expect(mask.getAttribute('aria-pressed')).toBe('true')
    expect(graphUrls()).toHaveLength(1)
  })

  it('atlas AC5: tema colours by var(--theme-N) from communityRanking, and a null community stays neutral', async () => {
    bodies.graph = graphOf([
      { ...golpe, community: 3 },
      { id: 'word:stf', term: 'stf', kind: 'word', count: 30, pmi: 1.8, community: 3 },
      { id: 'word:solto', term: 'solto', kind: 'word', count: 10, pmi: 1, community: null },
    ])
    await start()
    fire($('mask'))
    expect($('columns').classList.contains('is-themed')).toBe(true)
    expect(paintOf('word:golpe', '--theme')).toBe('var(--theme-1)')
    expect(paintOf('word:stf', '--theme')).toBe('var(--theme-1)')
    expect(paintOf('word:solto', '--theme')).toBe('')
    expect($('keyThemeText').textContent).toMatch(/caminharam juntas/)
    expect($('keyThemeText').textContent).not.toMatch(/não tem temas/)
  })

  it('atlas AC5: with no community anywhere, the theme key says the build has none', async () => {
    await start()
    fire($('mask'))
    expect($('keyThemeText').textContent).toMatch(/não tem temas/)
    expect($('keyThemeText').textContent).not.toMatch(/caminharam juntas/)
    expect(all('#columns [style*="--theme"]')).toHaveLength(0)
  })

  it('atlas AC5: the chosen mask survives a round trip through strip mode, and the control hides there', async () => {
    await start()
    fire($('mask'))
    fire($('modeStrip'))
    expect($('mask').hidden).toBe(true)
    expect($('keyTheme').hidden).toBe(true)
    fire($('modeColumns'))
    expect($('mask').hidden).toBe(false)
    expect($('mask').textContent).toBe('Colorir por tema')
    expect($('keyTheme').hidden).toBe(false)
    toScatter()
    expect($('keyTheme').hidden).toBe(false)
    fire($('mask'))
    fire($('modeStrip'))
    fire($('modeColumns'))
    expect($('mask').textContent).toBe('Sem cor')
  })

  it('atlas AC5: "No mesmo tema" lists community mates only in tema mode and each is reachable by a click', async () => {
    bodies.graph = graphOf([
      { ...golpe, community: 3 },
      { id: 'word:stf', term: 'stf', kind: 'word', count: 30, pmi: 1.8, community: 3 },
      { ...reforma, community: 9 },
    ])
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    expect($('inspector').textContent).not.toMatch(/No mesmo tema/)
    fire($('mask'))
    expect($('inspector').textContent).toMatch(/No mesmo tema/)
    const mate = document.querySelector<HTMLElement>('#inspector [data-related="word:stf"]')
    expect(mate).not.toBeNull()
    fire(mate!)
    await settle()
    expect(docsCard.open.mock.calls.at(-1)![0].sides[0].query.get('term')).toBe('stf')
  })

  it('atlas AC6: a click marks the word selected, fills #inspector, writes #selectionNote and opens the card', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    expect(nodeEl('word:reforma').getAttribute('aria-pressed')).toBe('false')
    expect($('selectionNote').textContent).toMatch(/golpe selecionado\. Detalhes atualizados\./)
    expect($('inspector').textContent).toContain('golpe')
    expect($('inspector').querySelector('.sparkline')).not.toBeNull()
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.sides).toHaveLength(1)
    expect(req.sides[0].personId).toBe('lula')
    expect(req.title).toBe('golpe')
    const expected = docsQuery(params({ days: '21', sort: 'pmi', limit: '18', source: 'all' }), golpe as any)
    expect(req.sides[0].query.toString()).toBe(expected.toString())
    expect(req.sides[0].query.get('term')).toBe('golpe')
    expect(req.sides[0].query.get('kind')).toBe('word')
    expect(req.sides[0].query.has('sort')).toBe(false)
  })

  it('atlas AC6: a pick closes whatever card was open first, whoever owns it (behaviour unchanged)', async () => {
    docsCard.openedBy.mockReturnValue(false)
    await start()
    fire(nodeEl('word:golpe'))
    expect(docsCard.close).toHaveBeenCalled()
    expect(docsCard.close.mock.invocationCallOrder[0]).toBeLessThan(docsCard.open.mock.invocationCallOrder[0])
  })

  it('atlas AC6: clicking the same word again releases it and closes the card', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect($('selectionNote').textContent).toBe('Seleção limpa.')
    expect(docsCard.close).toHaveBeenCalled()
    expect(docsCard.open).toHaveBeenCalledTimes(1)
  })

  it('atlas AC6: picking another word moves the selection', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    fire(nodeEl('word:reforma'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(nodeEl('word:reforma').getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.open).toHaveBeenCalledTimes(2)
  })

  it('atlas AC9: empty space in the list or the scatter releases the selection; a row, a point and the person entry do not count as empty', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    fire(document.querySelector('#columns .column-person')!)
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    fire($('columns'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(docsCard.close).toHaveBeenCalled()
    toScatter()
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    fire(document.querySelector('#scatter .column-person')!)
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    fire($('scatter'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
  })

  it('atlas AC6: a click on the heading, the sentence or a select keeps the pick', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    fire($('atlasTitle'))
    fire($('workspace'))
    fire($('person'))
    fire($('legend'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    expect(docsCard.close).not.toHaveBeenCalled()
  })

  it('atlas AC4: a later setBoot never re-seeds the controls nor loads again', async () => {
    await start('?days=7')
    expect(graphUrls()).toHaveLength(1)
    change('days', '21')
    await settle()
    expect(graphUrls()).toHaveLength(2)
    setBoot({ search: '?days=7&person=tarcisio', people: [...people] })
    flushSync()
    await settle()
    expect(select('days').value).toBe('21')
    expect(select('person').value).toBe('lula')
    expect(graphUrls()).toHaveLength(2)
  })

  it('atlas AC6: empty space with nothing selected does nothing', async () => {
    await start()
    fire($('columns'))
    expect(docsCard.close).not.toHaveBeenCalled()
    expect($('selectionNote').textContent).toBe('')
  })

  it('atlas AC6/AC10: Escape closes an open card first and keeps the selection; the next Escape clears it', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    docsCard.isOpen.mockReturnValue(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(docsCard.close).toHaveBeenCalledTimes(1)
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    docsCard.isOpen.mockReturnValue(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(docsCard.close).toHaveBeenCalled()
  })

  it('atlas AC6: any other key does nothing; "Limpar seleção" clears the search box and the selection', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    flushSync()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    const search = $('search') as HTMLInputElement
    search.value = 'gol'
    fire(search, 'input')
    fire($('clear'))
    expect(search.value).toBe('')
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(graphUrls()).toHaveLength(1)
  })

  it('atlas AC8: the person entry opens her documents with no term, and clears a selected word first', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.open.mockClear()
    fire(document.querySelector('#columns .column-person[data-person-docs]')!)
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.title).toBe('Lula')
    expect(req.kicker).toBe('Documentos sobre')
    expect(req.sides[0].query.get('term')).toBe('')
    expect(req.sides[0].query.get('kind')).toBe('all')
  })

  it('atlas AC8: the same entry point heads the scatter, before its svg, and in Avaliação there is none', async () => {
    await start()
    toScatter()
    docsCard.open.mockClear()
    const head = document.querySelector<HTMLElement>('#scatter .column-person[data-person-docs]')!
    expect(head).not.toBeNull()
    expect($('scatter').firstElementChild).toBe(head)
    expect(head.nextElementSibling!.tagName.toLowerCase()).toBe('svg')
    expect(head.textContent).toMatch(/Textos sobre\s+Lula\s+·\s+10 documentos/)
    fire(head)
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    expect((docsCard.open.mock.calls[0][0] as any).sides[0].query.get('term')).toBe('')
    fire($('modeStrip'))
    expect(all('#atlasStrip [data-person-docs]')).toHaveLength(0)
    expect(document.querySelector('.center-label')).toBeNull()
  })

  it('atlas AC6: the word inspector sparkline is one /timeline?days=7&bucket=day on the atlas source, seven bars', async () => {
    bodies.timeline = [1, 2, 3, 4, 5, 6, 99].map((count, i) => ({ bucket_start: `2026-09-0${i + 1}T00:00:00.000Z`, count }))
    await start('?source=bluesky&days=21')
    fire(nodeEl('word:golpe'))
    await settle()
    expect(timelineUrls()).toHaveLength(1)
    const qs = q(timelineUrls()[0])
    expect(qs.get('term')).toBe('golpe')
    expect(qs.get('kind')).toBe('word')
    expect(qs.get('days')).toBe('7')
    expect(qs.get('bucket')).toBe('day')
    expect(qs.get('source')).toBe('bluesky')
    expect(all('#inspector .spark-bar')).toHaveLength(7)
    expect($('inspector').textContent).toMatch(/Últimos 7 dias corridos/)
  })

  it('atlas AC6: no word in focus never asks for /timeline; releasing the word asks for nothing new', async () => {
    await start()
    expect(timelineUrls()).toEqual([])
    fire(nodeEl('word:golpe'))
    await settle()
    expect(timelineUrls()).toHaveLength(1)
    fire(nodeEl('word:golpe'))
    await settle()
    expect(timelineUrls()).toHaveLength(1)
    expect($('inspector').querySelector('.sparkline')).toBeNull()
  })

  it('atlas AC6: a failed sparkline leaves the inspector numbers and paints no bars', async () => {
    failing = /\/timeline/
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    expect(all('#inspector .spark-bar')).toHaveLength(0)
    expect($('inspector').textContent).toContain('golpe')
  })

  it('atlas AC6: a sparkline that resolves after another pick is discarded', async () => {
    holding = /\/timeline/
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    expect($('inspector').querySelector('.spark-ghost, .ghost-field')).not.toBeNull()
    expect(all('#inspector .spark-bar')).toHaveLength(0)
    fire(nodeEl('word:reforma'))
    await settle()
    expect(held[0].signal?.aborted).toBe(true)
    held[0].resolve([{ bucket_start: '2026-09-08T00:00:00.000Z', count: 99 }])
    await settle()
    expect(all('#inspector .spark-bar')).toHaveLength(0)
    expect($('inspector').textContent).not.toContain('99')
  })

  it('atlas AC7: a control change issues one debounced /graph; two quick changes coalesce', async () => {
    await start()
    change('limit', '24')
    change('days', '7')
    expect(graphUrls()).toHaveLength(1)
    await settle()
    expect(graphUrls()).toHaveLength(2)
    expect(q(graphUrls()[1]).get('days')).toBe('7')
    expect(q(graphUrls()[1]).get('limit')).toBe('24')
  })

  it('atlas AC7: person, sort, limit and source each reload; the request names what changed', async () => {
    await start()
    change('person', 'tarcisio')
    await settle()
    expect(new URL(graphUrls().at(-1)!, 'http://localhost').pathname).toBe('/api/people/tarcisio/graph')
    change('sort', 'count')
    await settle()
    expect(q(graphUrls().at(-1)!).get('sort')).toBe('count')
    change('limit', '24')
    await settle()
    expect(q(graphUrls().at(-1)!).get('limit')).toBe('24')
    change('source', 'gnews')
    await settle()
    expect(q(graphUrls().at(-1)!).get('source')).toBe('gnews')
    expect(graphUrls()).toHaveLength(5)
  })

  it('atlas AC7: an in-flight request is aborted by the next one, and its stale response never paints', async () => {
    await start()
    holding = /\/graph/
    change('days', '7')
    await settle()
    change('limit', '24')
    await settle()
    expect(held).toHaveLength(2)
    expect(held[0].signal?.aborted).toBe(true)
    held[1].resolve(graphOf([reforma]))
    await settle()
    held[0].resolve(graphOf([golpe]))
    await settle()
    expect(rows().map((n) => n.dataset.node)).toEqual(['word:reforma'])
  })

  it('atlas AC7: a repeated identical recorte inside SCOPE_TTL_MS is served from the memo, with no second request', async () => {
    await start()
    change('days', '7')
    await settle()
    expect(graphUrls()).toHaveLength(2)
    change('days', '21')
    await settle()
    expect(graphUrls()).toHaveLength(2)
    expect(rows().length).toBe(2)
    vi.setSystemTime(Date.now() + SCOPE_TTL_MS + 1000)
    change('days', '7')
    await settle()
    change('days', '21')
    await settle()
    expect(graphUrls().length).toBeGreaterThan(2)
  })

  it('atlas AC7: the graph memo is keyed by scopeKeys, and a hit records that key under api:graph', async () => {
    await start()
    const first = q(graphUrls()[0])
    first.delete('person')
    const key = scopeKeys('lula', first).graph
    expect(readScope('graph', key)).not.toBeNull()
    change('days', '7')
    await settle()
    const measure = vi.spyOn(performance, 'measure')
    change('days', '21')
    await settle()
    expect(graphUrls()).toHaveLength(2)
    const hit = measure.mock.calls.find(([name, o]) => name === 'api:graph' && (o as { detail: { cache: string } }).detail.cache === 'memory')
    expect((hit?.[1] as { detail: { url: string } }).detail.url).toBe(key)
    measure.mockRestore()
  })

  it('atlas AC7: new data drops a pick made on the old recorte and closes its card, even when the word survives', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    holding = /\/graph/
    change('days', '7')
    await settle()
    expect(held).toHaveLength(1)
    held[0].resolve(graphOf(nodes2))
    await settle()
    expect(all('#columns [aria-pressed="true"]')).toHaveLength(0)
    expect(docsCard.close).toHaveBeenCalled()
    expect($('selectionNote').textContent).toBe('')
  })

  it('atlas AC7: alcance resizes without a refetch when the wire sort is unchanged; pmi refetches', async () => {
    bodies.graph = graphOf([
      { id: 'word:comum', term: 'comum', kind: 'word', count: 40, pmi: 1, reach: 2 },
      { id: 'word:raro', term: 'raro', kind: 'word', count: 3, pmi: 1, reach: 900 },
    ])
    await start('?sort=count')
    change('sort', 'reach')
    await settle(200)
    expect(graphUrls()).toHaveLength(1)
    expect($('legend').textContent).toMatch(/alcance/)
    expect($('legend').textContent).not.toMatch(/frequência/)
    change('sort', 'pmi')
    await settle(200)
    expect(graphUrls()).toHaveLength(2)
    for (const u of graphUrls()) expect(q(u).get('sort')).not.toBe('reach')
  })

  it('atlas AC8: alcance ranks the highest reach first (ties by term then kind) and pmi/count keep the server order', async () => {
    const tied = [
      { id: 'word:b', term: 'b', kind: 'word', count: 9, pmi: 1, reach: 5 },
      { id: 'hashtag:b', term: 'b', kind: 'hashtag', count: 8, pmi: 1, reach: 5 },
      { id: 'word:a', term: 'a', kind: 'word', count: 7, pmi: 1, reach: 5 },
    ]
    const viaReach = [
      { id: 'word:comum', term: 'comum', kind: 'word', count: 40, pmi: 1, reach: 2 },
      { id: 'word:raro', term: 'raro', kind: 'word', count: 3, pmi: 1, reach: 900 },
      { id: 'word:medio', term: 'medio', kind: 'word', count: 10, pmi: 1, reach: 50 },
    ]
    bodies.graph = graphOf([...viaReach, ...tied], { stats: { about: 10 } })
    await start('?sort=reach&limit=24')
    expect(rows().map((c) => c.dataset.node)).toEqual(['word:raro', 'word:medio', 'word:a', 'hashtag:b', 'word:b', 'word:comum'])
    expect(document.querySelector<HTMLElement>('#inspector [data-related]')?.dataset.related).toBe('word:raro')
    for (const sort of ['pmi', 'count']) {
      unmount(instance!)
      instance = undefined
      target.replaceChildren()
      clearScopes()
      await start(`?sort=${sort}&limit=24`)
      expect(rows()[0].dataset.node, sort).toBe('word:comum')
    }
  })

  it('atlas AC8: alcance with no Bluesky reach anywhere says so and never paints NaN', async () => {
    bodies.graph = graphOf([
      { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, reach: null },
      { id: 'word:b', term: 'b', kind: 'word', count: 4, pmi: 1, reach: null },
    ])
    await start('?sort=reach')
    expect($('legend').textContent).toMatch(/alcance/)
    expect($('legend').textContent).toMatch(/Nenhum documento do Bluesky/)
    expect($('columns').innerHTML).not.toMatch(/NaN/)
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([{ id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1, reach: 40 }])
    await start('?sort=reach')
    expect($('legend').textContent).not.toMatch(/Nenhum documento do Bluesky/)
  })

  it('atlas AC1: Lista is the default and the segment reads Lista, Dispersão, Avaliação', async () => {
    await start()
    const before = urls.length
    expect(all('#workspace .segment button').map((b) => [b.id, b.textContent])).toEqual([['modeColumns', 'Lista'], ['modeScatter', 'Dispersão'], ['modeStrip', 'Avaliação']])
    expect($('modeColumns').getAttribute('aria-pressed')).toBe('true')
    expect($('modeScatter').getAttribute('aria-pressed')).toBe('false')
    expect($('modeStrip').getAttribute('aria-pressed')).toBe('false')
    expect($('columns').hidden).toBe(false)
    expect($('scatter').hidden).toBe(true)
    expect($('atlasStrip').hidden).toBe(true)
    expect(rows().map((c) => c.dataset.node)).toEqual(['word:golpe', 'word:reforma'])
    expect($('columns').firstElementChild!.matches('.column-person')).toBe(true)
    expect(points()).toHaveLength(0)
    expect(urls.length).toBe(before)
  })

  it('atlas AC10: strip mode is a local repaint with its own key, hiding the list, the scatter and the mask', async () => {
    await start()
    const before = urls.length
    fire($('modeStrip'))
    expect($('columns').hidden).toBe(true)
    expect($('scatter').hidden).toBe(true)
    expect($('atlasStrip').hidden).toBe(false)
    expect($('mask').hidden).toBe(true)
    expect($('keyDefault').hidden).toBe(true)
    expect($('keyScatter').hidden).toBe(true)
    expect($('keyStrip').hidden).toBe(false)
    expect(urls.length).toBe(before)
    fire($('modeColumns'))
    expect($('atlasStrip').hidden).toBe(true)
    expect($('stripHiddenNote').hidden).toBe(true)
    expect($('keyStrip').hidden).toBe(true)
  })

  it('atlas AC8: strip mode paints one circle per scored term, positioned by mean tone', async () => {
    bodies.graph = graphOf([
      { ...golpe, testimony: tone(-6) },
      { ...reforma, testimony: tone(4) },
      { id: 'word:sem', term: 'sem', kind: 'word', count: 5, pmi: 1 },
    ])
    await start()
    fire($('modeStrip'))
    const dots = all('#atlasStrip .strip-dot')
    expect(dots.map((d) => d.dataset.node).sort()).toEqual(['word:golpe', 'word:reforma'])
    for (const dot of dots) {
      expect(dot.querySelector('circle.dot-face')).not.toBeNull()
      expect(dot.style.getPropertyValue('--tone')).not.toBe('')
    }
    const cx = (id: string) => Number(nodeEl(id).querySelector('circle.dot-face')!.getAttribute('cx'))
    expect(cx('word:golpe')).toBeLessThan(cx('word:reforma'))
    expect($('stripHiddenNote').hidden).toBe(false)
    expect($('stripHiddenNote').textContent).toMatch(/1 palavra deixada de fora por ter menos de 3 textos avaliados/)
    expect($('legend').textContent).toMatch(/Tamanho = quantos textos/)
    expect($('legend').textContent).not.toMatch(/Linha = documentos em comum/)
    expect($('legend').textContent).not.toMatch(/zoom e rolagem/)
    expect($('atlasStrip').textContent).toMatch(/média da pessoa/)
  })

  it('atlas AC8: on a corpus with no tone the strip says so and paints no invented value', async () => {
    bodies.graph = graphOf(
      [
        { id: 'word:a', term: 'a', kind: 'word', count: 9, pmi: 1 },
        { id: 'word:b', term: 'b', kind: 'word', count: 4, pmi: 1 },
      ],
      { stats: stats({ testimony: { method: 'kikori', score: null, n: 0 } }) },
    )
    await start()
    fire($('modeStrip'))
    expect(all('#atlasStrip .strip-dot')).toHaveLength(0)
    expect($('atlasStrip').textContent).toMatch(/Nenhuma palavra com avaliação suficiente neste recorte/)
    expect($('stripHiddenNote').hidden).toBe(false)
    expect($('stripHiddenNote').textContent).toMatch(/não tem média de avaliação/)
    expect($('atlasStrip').innerHTML).not.toMatch(/NaN/)
    expect(all('#columns [style*="--mask"]')).toHaveLength(0)
  })

  it('atlas AC8: a strip pick opens one side for the word, and empty space in the strip releases it', async () => {
    await start()
    fire($('modeStrip'))
    fire(document.querySelector('#atlasStrip [data-node="word:golpe"]')!)
    await settle()
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.sides).toHaveLength(1)
    expect(req.sides[0].query.get('term')).toBe('golpe')
    expect(document.querySelector('#atlasStrip [data-node="word:golpe"]')!.classList.contains('is-selected')).toBe(true)
    docsCard.close.mockClear()
    fire($('atlasStrip'))
    expect(docsCard.close).toHaveBeenCalled()
    expect(document.querySelector('#atlasStrip [data-node="word:golpe"]')!.classList.contains('is-selected')).toBe(false)
  })

  it('atlas AC8: a word selected before switching to the strip keeps its mark there', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    fire($('modeStrip'))
    expect(document.querySelector('#atlasStrip [data-node="word:golpe"]')!.classList.contains('is-selected')).toBe(true)
  })

  it('atlas AC8: a failed reload while in strip mode hides the strip and its note', async () => {
    await start()
    fire($('modeStrip'))
    failing = /\/graph/
    change('person', 'tarcisio')
    await settle()
    expect($('columns').hidden).toBe(false)
    expect($('scatter').hidden).toBe(true)
    expect($('atlasStrip').hidden).toBe(true)
    expect($('stripHiddenNote').hidden).toBe(true)
  })

  it('atlas AC11: the scatter draws at the container width (860 until measured) and redraws only on a width change', async () => {
    await start()
    toScatter()
    const svg = () => $('scatter').querySelector('svg')!
    expect(svg().getAttribute('width')).toBe('860')
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 860 /)
    expect(svg().getAttribute('style') ?? '').toBe('')
    const before = urls.length
    widths.scatter = 500
    observers.find((o) => o.target === $('scatter'))!.cb()
    flushSync()
    expect(svg().getAttribute('width')).toBe('500')
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 500 /)
    const drawn = svg().innerHTML
    observers.find((o) => o.target === $('scatter'))!.cb()
    flushSync()
    expect(svg().innerHTML).toBe(drawn)
    expect(svg().getAttribute('width')).toBe('500')
    expect(urls.length).toBe(before)
  })

  it('atlas AC11: a measured container width is used as soon as the scatter opens', async () => {
    widths.scatter = 640
    await start()
    toScatter()
    expect($('scatter').querySelector('svg')!.getAttribute('width')).toBe('640')
  })

  it('atlas AC9: #atlasStrip paints at its own measured width and repaints on resize, without a fetch', async () => {
    widths.atlasStrip = 800
    await start()
    fire($('modeStrip'))
    const svg = () => $('atlasStrip').querySelector('svg')!
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 800 /)
    const before = urls.length
    widths.atlasStrip = 400
    observers.find((o) => o.target === $('atlasStrip'))!.cb()
    flushSync()
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 400 /)
    expect(svg().getAttribute('width')).toBe('400')
    expect(urls.length).toBe(before)
  })

  it('atlas AC9: unmounting disconnects both observers and aborts the in-flight request', async () => {
    holding = /\/graph/
    setBoot({ ready: true, people, peopleError: null, search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect(held).toHaveLength(1)
    const mine = observers.filter((o) => o.target === $('scatter') || o.target === $('atlasStrip'))
    expect(mine).toHaveLength(2)
    unmount(instance)
    instance = undefined
    for (const o of mine) expect(o.disconnect).toHaveBeenCalled()
    expect(held[0].signal?.aborted).toBe(true)
  })

  it('atlas AC9: unmounting stops the Escape listener', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    unmount(instance!)
    instance = undefined
    docsCard.close.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(docsCard.close).not.toHaveBeenCalled()
  })

  it('atlas AC17: search marks matching rows and points, dims the rest, counts them and never reloads or closes the card', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    docsCard.close.mockClear()
    const before = urls.length
    const search = $('search') as HTMLInputElement
    search.value = 'gol'
    fire(search, 'input')
    expect($('searchNote').textContent).toBe('1 termo encontrado no recorte.')
    expect($('searchNote').textContent).not.toMatch(/posições/)
    expect(nodeEl('word:reforma').classList.contains('is-dim')).toBe(true)
    expect(nodeEl('word:golpe').classList.contains('is-match')).toBe(true)
    toScatter()
    docsCard.close.mockClear()
    expect(nodeEl('word:reforma').classList.contains('is-dim')).toBe(true)
    expect(nodeEl('word:golpe').classList.contains('is-match')).toBe(true)
    search.value = 'o'
    fire(search, 'input')
    expect($('searchNote').textContent).toBe('2 termos encontrados no recorte.')
    search.value = ''
    fire(search, 'input')
    expect($('searchNote').textContent).toBe('')
    expect(all('#scatter .is-match')).toHaveLength(0)
    expect(urls.length).toBe(before)
    expect(docsCard.close).not.toHaveBeenCalled()
  })

  it('atlas AC18: an empty recorte says so in the list and in the scatter, draws neither rows, entry nor svg, and never paints NaN', async () => {
    bodies.graph = graphOf([], { stats: stats({ about: 0 }) })
    await start()
    expect($('columns').textContent).toContain('Nenhum termo neste recorte.')
    expect($('columns').querySelector('[data-node], [data-person-docs]')).toBeNull()
    expect($('legend').textContent).toBe('Sem dados para desenhar.')
    toScatter()
    expect($('scatter').hidden).toBe(false)
    expect($('scatter').textContent).toContain('Nenhum termo neste recorte.')
    expect($('scatter').querySelector('svg, [data-node], [data-person-docs]')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/NaN/)
  })

  it('atlas AC18: an absent stats.about prints 0, never NaN or undefined', async () => {
    bodies.graph = graphOf(nodes2, { stats: { testimony: { method: 'kikori', score: -1, n: 100 } } })
    await start()
    expect($('atlasStats').textContent).toBe('0 docs · todas as fontes')
    expect($('columns').querySelector('.column-person')!.textContent).toMatch(/· 0 documentos/)
    expect($('status').textContent).toMatch(/^0 documentos sobre Lula/)
    toScatter()
    expect($('scatter').querySelector('.column-person')!.textContent).toMatch(/· 0 documentos/)
    expect(document.body.innerHTML).not.toMatch(/NaN|undefined/)
  })

  it('atlas: the empty recorte suggests a wider window only below 21 days, the widest', async () => {
    bodies.graph = graphOf([], { stats: stats({ about: 0 }) })
    await start()
    expect(select('days').value).toBe('21')
    expect($('columns').textContent).toContain('Experimente outra pessoa.')
    expect($('columns').textContent).not.toContain('período maior')
    change('days', '7')
    await settle()
    expect($('columns').textContent).toContain('Nenhum termo neste recorte.')
    expect($('columns').textContent).toContain('Experimente outra pessoa ou um período maior.')
  })

  it('atlas: the figure never touches figure 2\'s #strip, #testimonyList or #outletList', async () => {
    const probe = document.createElement('div')
    probe.innerHTML = '<div id="strip">keep</div><div id="testimonyList">keep</div><div id="outletList">keep</div>'
    document.body.append(probe)
    await start()
    fire(nodeEl('word:golpe'))
    fire($('modeStrip'))
    change('days', '7')
    await settle()
    for (const id of ['strip', 'testimonyList', 'outletList']) expect(document.getElementById(id)!.textContent).toBe('keep')
    probe.remove()
  })

  it('atlas: the ghost and the outage never carry a candidate list any more', async () => {
    await start()
    expect(document.getElementById('candidateList')).toBeNull()
    expect(urls.some((u) => u.includes('/candidates'))).toBe(false)
  })
})

describe('Atlas: word marks, map, selection, columns, inspector, strip and loading ghost', () => {
  const person = { method: 'kikori:q8', score: -2.4, n: 500 }
  const withPerson = (nodes: unknown[], over: Record<string, unknown> = {}) => graphOf(nodes, { stats: stats({ testimony: person }), ...over })
  const at = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', count: 9, pmi: 1, ...over })

  it('a point carries the mask colour and the testimony in its title only when the word has one; under MASK_MIN the title stays and the colour goes', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a', testimony: tone(-4.9, 12) }), at({ id: 'word:b', term: 'b' }), at({ id: 'word:c', term: 'c', testimony: tone(-4.9, 2) })])
    await start()
    toScatter()
    expect(paintOf('word:a', '--mask')).toBe('rgb(255,122,138)')
    expect(nodeEl('word:a').querySelector('title')!.textContent).toMatch(/· avaliação -4,9 em 12 textos$/)
    expect(paintOf('word:b', '--mask')).toBe('')
    expect(nodeEl('word:b').querySelector('title')!.textContent).not.toMatch(/avaliação/)
    expect(paintOf('word:c', '--mask')).toBe('')
    expect(nodeEl('word:c').querySelector('title')!.textContent).toMatch(/avaliação/)
  })

  it('atlas AC6: only an org row carries the org tag, and nothing sets a size from the term', async () => {
    bodies.graph = withPerson(['word', 'hashtag', 'phrase', 'org', 'weird'].map((kind) => at({ id: `${kind}:x`, term: 'x', kind })))
    await start('?limit=24')
    expect(rows()).toHaveLength(5)
    for (const kind of ['word', 'hashtag', 'phrase', 'weird']) expect(nodeEl(`${kind}:x`).querySelector('.list-tag'), kind).toBeNull()
    const tag = nodeEl('org:x').querySelector('.list-tag')!
    expect(tag.textContent).toBe('org')
    expect(all('#workspace .list-tag')).toHaveLength(1)
    expect($('workspace').querySelector('.underline, [data-kind]')).toBeNull()
    for (const el of all('#workspace [style]')) expect(el.getAttribute('style')!.split(';').every((d) => !d.trim() || /^--(w|mask|theme|pos|tone|h):/.test(d.trim())), el.getAttribute('style')!).toBe(true)
    expect($('workspace').innerHTML).not.toMatch(/--size|font-size/)
    toScatter()
    expect($('workspace').innerHTML).not.toMatch(/--size|font-size/)
    expect(all('#workspace .list-tag')).toHaveLength(0)
  })

  it('atlas AC7: the dot of a row holds termMask in --mask and, only inside the ranking, themeMask in --theme', async () => {
    bodies.graph = withPerson([
      at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20), community: 3 }),
      at({ id: 'word:b', term: 'b', count: 5, testimony: null, community: 9 }),
      at({ id: 'word:c', term: 'c', count: 4, community: null }),
    ])
    await start('?sort=count')
    const a = nodeEl('word:a')
    expect(paintOf('word:a', '--mask')).toBe('rgb(116,220,134)')
    expect(paintOf('word:a', '--theme')).toBe('var(--theme-1)')
    expect(a.querySelector('.list-dot')).not.toBeNull()
    expect(paintOf('word:b', '--mask')).toBe('')
    expect(paintOf('word:b', '--theme')).toBe('var(--theme-2)')
    expect(paintOf('word:c', '--mask')).toBe('')
    expect(paintOf('word:c', '--theme')).toBe('')
    expect(nodeEl('word:c').querySelector('.list-dot')).not.toBeNull()
    expect(a.querySelector('.list-rank')!.textContent).toBe('01')
  })

  it('a top-6 community paints --theme on every placed word, not only the first, and the key names build coverage', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a', community: 11 }), at({ id: 'word:b', term: 'b', count: 5, community: 22 })])
    await start()
    expect(paintOf('word:a', '--theme')).toBe('var(--theme-1)')
    expect(paintOf('word:b', '--theme')).toBe('var(--theme-2)')
    expect($('legend').querySelector('#themeLegend')!.textContent).toMatch(/caminharam juntas/)
    expect(($('legend').querySelector('#themeLegend') as HTMLElement).hidden).toBe(true)
  })

  it('the legend names build coverage without borrowing the MASK_MIN wording when no node has a community', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a', community: null }), at({ id: 'word:b', term: 'b' })])
    await start()
    expect($('legend').querySelector('#themeLegend')!.textContent).toMatch(/não tem temas calculados/)
    expect($('legend').querySelector('#themeLegend')!.textContent).not.toMatch(/textos avaliados/)
    expect(all('#columns [style*="--theme"]')).toHaveLength(0)
  })

  it('is-masked needs a person mean to compare against, is-themed only in tema, and the two never coexist', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20), community: 3 })])
    await start()
    const cls = () => [$('columns').classList.contains('is-masked'), $('columns').classList.contains('is-themed')]
    expect(cls()).toEqual([true, false])
    fire($('mask'))
    expect(cls()).toEqual([false, true])
    fire($('mask'))
    expect(cls()).toEqual([false, false])
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20) })], { stats: stats({ testimony: { method: 'kikori', score: null, n: 0 } }) })
    await start()
    expect(cls()).toEqual([false, false])
  })

  it('the mask legend reads the person mean, and says so when there is none', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a' })])
    await start()
    expect($('maskLegend').textContent).toMatch(/média da pessoa \(-2,4\)/)
    expect($('maskLegend').textContent).toMatch(/menos de 3 textos avaliados/)
    expect(($('maskLegend') as HTMLElement).hidden).toBe(false)
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a' })], { stats: stats({ testimony: { method: 'kikori', score: null, n: 0 } }) })
    await start()
    expect($('maskLegend').textContent).toMatch(/Sem avaliação neste recorte para colorir as palavras/)
  })

  it('the inspector reads the two numbers out for the selected term, against the person mean', async () => {
    bodies.graph = withPerson([at({ id: 'word:a', term: 'a', testimony: tone(-3.1, 12) }), at({ id: 'word:b', term: 'b', testimony: tone(-2.2, 12) }), at({ id: 'word:c', term: 'c', testimony: tone(5, 2) }), at({ id: 'word:d', term: 'd' })])
    await start()
    fire(nodeEl('word:a'))
    expect($('inspector').textContent).toMatch(/-3,1 de avaliação em 12 textos, contra -2,4 da pessoa no recorte\. mais hostis que a média da pessoa\./)
    expect($('inspector').querySelector('strong.score-highlight')).not.toBeNull()
    fire(nodeEl('word:b'))
    expect($('inspector').textContent).toMatch(/na média da pessoa/)
    fire(nodeEl('word:c'))
    expect($('inspector').textContent).toMatch(/poucos textos para comparar/)
    fire(nodeEl('word:d'))
    expect($('inspector').textContent).not.toMatch(/Textos com este termo/)
  })

  it('the inspector carries no documents button, no docs container and no <details>', async () => {
    await start()
    for (const pick of [null, 'word:golpe']) {
      if (pick) fire(nodeEl(pick))
      const html = $('inspector').innerHTML
      expect(html).not.toMatch(/docs-open|id="docsOpen"|Ler documentos/)
      expect(html).not.toMatch(/id="docs"/)
      expect(html).not.toMatch(/<details|id="termDocs"|id="showDocs"/)
    }
  })

  it('the sparkline: seven ghost bars while loading, bars sized from the counts, and a silent hole on error', async () => {
    holding = /\/timeline/
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    expect($('inspector').querySelector('.sparkline.ghost-field')).not.toBeNull()
    expect(all('#inspector .spark-ghost')).toHaveLength(7)
    expect($('inspector').textContent).not.toContain('Carregando')
    held[0].resolve([0, 1, 2, 10, 3, 0, 1].map((count, i) => ({ bucket_start: `2026-09-0${i + 1}T00:00:00.000Z`, count })))
    await settle()
    const heights = all('#inspector .spark-bar').map((b) => parseFloat(b.style.getPropertyValue('--h')))
    expect(heights).toHaveLength(7)
    expect(heights[3]).toBe(Math.max(...heights))
    expect($('inspector').textContent).toMatch(/Últimos 7 dias corridos/)
  })

  it('a failed sparkline leaves an empty aria-hidden hole and no note, and the numbers stay', async () => {
    failing = /\/timeline/
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    const hole = $('inspector').querySelector('.sparkline')!
    expect(hole.getAttribute('aria-hidden')).toBe('true')
    expect(hole.children).toHaveLength(0)
    expect($('inspector').textContent).not.toMatch(/Últimos 7 dias|Não foi possível carregar/)
    expect($('inspector').textContent).toMatch(/PMI bruto/)
    expect($('inspector').textContent).toMatch(/documentos/)
  })

  describe('"No mesmo tema"', () => {
    const community = (n: unknown[]) => {
      bodies.graph = graphOf(n)
    }
    const g = { ...golpe, community: 3 }
    const stf = { id: 'word:stf', term: 'stf', kind: 'word', count: 30, pmi: 1.8, community: 3 }
    const ref = { ...reforma, community: 9 }

    it('shows only in tema, never for a focused term with no community or no mate, and never lists the term itself', async () => {
      community([g, stf, ref, { id: 'word:solo', term: 'solo', kind: 'word', count: 15, pmi: 1.1, community: null }])
      await start('?limit=24')
      fire(nodeEl('word:golpe'))
      expect($('inspector').textContent, 'avaliação mode never shows the tema list').not.toMatch(/No mesmo tema/)
      fire($('mask'))
      expect($('inspector').textContent).toMatch(/No mesmo tema/)
      expect(document.querySelector('#inspector [data-related="word:stf"]')).not.toBeNull()
      expect(document.querySelector('#inspector [data-related="word:golpe"]')).toBeNull()
      expect(document.querySelector('#inspector [data-related="word:reforma"]')).toBeNull()
      fire(nodeEl('word:reforma'))
      expect($('inspector').textContent, 'no other node shares community 9').not.toMatch(/No mesmo tema/)
      fire(nodeEl('word:solo'))
      expect($('inspector').textContent).not.toMatch(/No mesmo tema/)
    })
  })

  it('atlas AC8: the person entry is one real button-like entry point per container, painting opens nothing, and a row is never the person', async () => {
    await start()
    expect(all('#columns [data-person-docs]')).toHaveLength(1)
    expect(all('#columns .list-row[data-person-docs]')).toHaveLength(0)
    const entry = document.querySelector('#columns .column-person')!
    expect(entry.getAttribute('role')).toBe('button')
    expect(entry.getAttribute('tabindex')).toBe('0')
    expect(entry.querySelector('strong')!.textContent).toBe('Lula')
    expect(docsCard.open).not.toHaveBeenCalled()
    toScatter()
    expect(all('#scatter [data-person-docs]')).toHaveLength(1)
    expect(docsCard.open).not.toHaveBeenCalled()
  })

  it('atlas AC8: rows, points and the person entry are keyboard-operable: Enter and Space pick, other keys do nothing', async () => {
    await start()
    const key = (el: Element, k: string) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      flushSync()
    }
    key(nodeEl('word:golpe'), 'a')
    expect(docsCard.open).not.toHaveBeenCalled()
    fire(nodeEl('word:golpe'))
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    key(document.querySelector('#columns .column-person')!, 'Enter')
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    key(document.querySelector('#columns .column-person')!, ' ')
    expect(docsCard.open).toHaveBeenCalledTimes(3)
    expect((docsCard.open.mock.calls[2][0] as any).title).toBe('Lula')
    expect((docsCard.open.mock.calls[2][0] as any).sides[0].query.get('term')).toBe('')
    toScatter()
    docsCard.open.mockClear()
    key(nodeEl('word:reforma'), 'a')
    expect(docsCard.open).not.toHaveBeenCalled()
    key(nodeEl('word:reforma'), 'Enter')
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    expect(nodeEl('word:reforma').getAttribute('aria-pressed')).toBe('true')
    key(nodeEl('word:golpe'), ' ')
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    key(document.querySelector('#scatter .column-person')!, 'Enter')
    expect(docsCard.open).toHaveBeenCalledTimes(3)
    expect((docsCard.open.mock.calls[2][0] as any).sides[0].query.get('term')).toBe('')
  })

  it('a word opens its texts under its own kind in the kicker', async () => {
    bodies.graph = graphOf([{ id: 'hashtag:stf', term: 'stf', kind: 'hashtag', count: 30, pmi: 1.8 }])
    await start()
    fire(nodeEl('hashtag:stf'))
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.kicker).toBe('Documentos com hashtag')
    expect(req.title).toBe('#stf')
  })

  it('strip: the tone of each circle is termMask, the axis ends are signed, the mean line follows the person score', async () => {
    bodies.graph = withPerson([{ ...golpe, testimony: tone(-3.97, 12) }, { ...reforma, testimony: tone(0, 6) }, at({ id: 'word:agenda', term: 'agenda', testimony: tone(2.5, 9) })])
    await start()
    fire($('modeStrip'))
    const tones = all('#atlasStrip .strip-dot').map((d) => d.style.getPropertyValue('--tone'))
    expect(tones.every((t) => /^rgb\(/.test(t))).toBe(true)
    const labels = [...$('atlasStrip').querySelectorAll('.strip-axis-labels span')].map((s) => s.textContent)
    expect(labels[0]).toMatch(/^-?\d+ contra$/)
    expect(labels[1]).toMatch(/^\+?\d+ a favor$/)
    expect($('atlasStrip').querySelector('line.strip-overall')).not.toBeNull()
    expect($('atlasStrip').querySelector('.strip-mean')!.textContent).toBe('média da pessoa -2,4')
    for (const el of all('#atlasStrip [style]')) expect(el.getAttribute('style')!.startsWith('--')).toBe(true)
  })

  it('strip: the axis-end labels are the signed domainMin and domainMax of the layout, not a fixed 10', async () => {
    const nodes = [{ ...golpe, testimony: tone(-3.97, 12) }, { ...reforma, testimony: tone(0, 6) }, at({ id: 'word:agenda', term: 'agenda', testimony: tone(2.5, 9) })]
    bodies.graph = withPerson(nodes)
    await start()
    fire($('modeStrip'))
    const layout = termStripLayout(nodes as never, person as never, 860)
    const labels = [...$('atlasStrip').querySelectorAll('.strip-axis-labels span')].map((el) => el.textContent)
    expect(labels).toEqual([`${signed(layout.domainMin)} contra`, `${signed(layout.domainMax)} a favor`])
  })

  it('strip: with no person mean there is neither the mean label nor the dashed line', async () => {
    bodies.graph = graphOf([golpe], { stats: stats({ testimony: { method: 'kikori', score: null, n: 0 } }) })
    await start()
    fire($('modeStrip'))
    expect($('atlasStrip').textContent).not.toMatch(/média da pessoa/)
    expect($('atlasStrip').querySelector('line.strip-overall')).toBeNull()
  })

  it('strip: an empty recorte and a recorte with no eligible word each get their own message; the note counts singular and plural', async () => {
    const note = () => $('stripHiddenNote').textContent
    bodies.graph = withPerson([{ ...golpe, testimony: tone(-3, 12) }, { ...reforma, testimony: tone(1, 2) }])
    await start()
    fire($('modeStrip'))
    expect(note()).toBe('1 palavra deixada de fora por ter menos de 3 textos avaliados.')
    for (const [nodes, text] of [
      [[{ ...golpe, testimony: tone(-3, 12) }, { ...reforma, testimony: tone(1, 2) }, { ...at({ id: 'word:s', term: 's' }), testimony: null }], '2 palavras deixadas de fora por terem menos de 3 textos avaliados.'],
      [[{ ...golpe, testimony: tone(-3, 12) }, { ...reforma, testimony: tone(1, 12) }], ''],
    ] as const) {
      unmount(instance!)
      instance = undefined
      target.replaceChildren()
      clearScopes()
      bodies.graph = withPerson([...nodes])
      await start()
      fire($('modeStrip'))
      expect($('stripHiddenNote').hidden).toBe(text === '')
      expect(note()).toBe(text)
    }
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([golpe, reforma], { stats: stats({ testimony: { method: 'kikori', score: null, n: 0 } }) })
    await start()
    fire($('modeStrip'))
    expect(note()).toBe('2 palavras deixadas de fora: esta pessoa não tem média de avaliação neste recorte.')
  })

  it('atlas AC2: the boot and first-load ghost holds the entry bar, limit-many ghost rows and the inspector silhouette, with no inline style that is not a --var', async () => {
    await start().then(() => unmount(instance!))
    instance = undefined
    target.replaceChildren()
    instance = mount(Atlas, { target })
    flushSync()
    expect($('columns').innerHTML).toMatch(/ghost-field/)
    expect($('columns').querySelectorAll('.list-row .ghost')).toHaveLength(18 * 4)
    expect($('columns').querySelector('.column-person.is-ghost')).not.toBeNull()
    expect($('columns').querySelector('[data-node], svg, [data-person-docs]')).toBeNull()
    expect($('columns').innerHTML).not.toMatch(/Carregando/)
    expect($('inspector').innerHTML).toMatch(/ghost-kicker/)
    expect($('columns').getAttribute('aria-busy')).toBe('true')
    for (const el of all('#columns [style], #inspector [style]')) expect(el.getAttribute('style')!.startsWith('--')).toBe(true)
  })

  it('a control change reloads /graph alone: no other route is asked', async () => {
    await start()
    const before = urls.length
    change('days', '7')
    await settle()
    const added = urls.slice(before).map(routeOf)
    expect(added).toEqual(['graph'])
  })

  it('the outage note carries the perched bird and the retry button, and an empty seed carries no bird', async () => {
    setBoot({ ready: true, people: [], peopleError: new Error('boom'), search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('columns').innerHTML).toMatch(/src="\/pet-caracara-perched\.png"/)
    expect($('columns').innerHTML).toMatch(/id="retry"/)
    fire(document.getElementById('retry')!)
    expect((window.location.reload as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect($('inspector').textContent).toMatch(/Use tentar novamente quando a API estiver disponível/)
    unmount(instance)
    instance = undefined
    target.replaceChildren()
    setBoot({ ready: true, people: [], peopleError: null, search: '' })
    instance = mount(Atlas, { target })
    flushSync()
    await settle()
    expect($('columns').innerHTML).not.toMatch(/pet-caracara/)
  })
})

// Behaviour the port's first pass left unpinned, several of it asserted by the deleted painter suites.
describe('Atlas: mode, reload, layout and mask edges', () => {
  const at = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', count: 9, pmi: 1, ...over })
  it('alcance: the list leads with the highest reach', async () => {
    bodies.graph = graphOf([
      { id: 'word:comum', term: 'comum', kind: 'word', count: 40, pmi: 1, reach: 2 },
      { id: 'word:raro', term: 'raro', kind: 'word', count: 3, pmi: 1, reach: 900 },
      { id: 'word:medio', term: 'medio', kind: 'word', count: 10, pmi: 1, reach: 50 },
    ], { stats: { about: 10 } })
    await start('?sort=reach')
    expect(rows()[0].dataset.node).toBe('word:raro')
  })

  it('no stats.testimony at all: nothing is masked', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20) })], { stats: { about: 10 } })
    await start()
    expect($('columns').classList.contains('is-masked')).toBe(false)
    expect(paintOf('word:a', '--mask')).toBe('')
    toScatter()
    expect($('scatter').querySelector('svg')!.classList.contains('is-masked')).toBe(false)
  })

  it('"No mesmo tema" disappears again once the mask cycles to off', async () => {
    bodies.graph = graphOf([{ ...golpe, community: 3 }, { id: 'word:stf', term: 'stf', kind: 'word', count: 30, pmi: 1.8, community: 3 }])
    await start()
    fire(nodeEl('word:golpe'))
    fire($('mask'))
    expect($('inspector').textContent).toMatch(/No mesmo tema/)
    fire($('mask'))
    expect($('mask').textContent).toBe('Sem cor')
    expect($('inspector').textContent).not.toMatch(/No mesmo tema/)
  })

  it('each strip circle carries exactly termMask(node, personScore) as --tone', async () => {
    const nodes = [{ ...golpe, testimony: tone(-3.97, 12) }, { ...reforma, testimony: tone(2, 6) }]
    bodies.graph = graphOf(nodes)
    await start()
    fire($('modeStrip'))
    for (const n of nodes) expect(nodeEl(n.id).style.getPropertyValue('--tone')).toBe(termMask(n as never, -1))
  })

  it('the strip dots are laid out at the measured width, not at 860', async () => {
    const nodes = [{ ...golpe, testimony: tone(-6) }, { ...reforma, testimony: tone(4) }]
    bodies.graph = graphOf(nodes)
    widths.atlasStrip = 400
    await start()
    fire($('modeStrip'))
    const expected = termStripLayout(nodes as never, { method: 'kikori', score: -1, n: 100 } as never, 400)
    for (const d of expected.dots) expect(Number(nodeEl(d.id).querySelector('circle.dot-face')!.getAttribute('cx'))).toBeCloseTo(d.x)
    for (const d of expected.dots) expect(Number(nodeEl(d.id).querySelector('circle.dot-face')!.getAttribute('r'))).toBeCloseTo(d.r)
  })

  it('atlas AC10: switching mode closes the card, keeps the pick, the search and the sentence, and switching back keeps the pick', async () => {
    await start('?days=7&sort=count')
    fire(nodeEl('word:golpe'))
    const search = $('search') as HTMLInputElement
    search.value = 'o'
    fire(search, 'input')
    docsCard.close.mockClear()
    const before = urls.length
    toScatter()
    expect(docsCard.close).toHaveBeenCalled()
    expect($('scatter').hidden).toBe(false)
    expect($('columns').hidden).toBe(true)
    expect($('modeScatter').getAttribute('aria-pressed')).toBe('true')
    expect($('modeColumns').getAttribute('aria-pressed')).toBe('false')
    expect($('keyScatter').hidden).toBe(false)
    expect($('keyDefault').hidden).toBe(true)
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    expect(nodeEl('word:golpe').classList.contains('is-selected')).toBe(true)
    expect(search.value).toBe('o')
    expect(select('days').value).toBe('7')
    expect(select('sort').value).toBe('count')
    fire($('modeColumns'))
    expect($('columns').hidden).toBe(false)
    expect($('scatter').hidden).toBe(true)
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    expect(urls.length).toBe(before)
  })

  it('atlas AC10: a person, days, source, sort or limit change keeps the chosen mode', async () => {
    await start()
    toScatter()
    for (const [id, value] of [['person', 'tarcisio'], ['days', '7'], ['source', 'gnews'], ['sort', 'count'], ['limit', '24']] as const) {
      change(id, value)
      await settle()
      expect($('modeScatter').getAttribute('aria-pressed'), id).toBe('true')
      expect($('scatter').hidden, id).toBe(false)
      expect(points(), id).toHaveLength(2)
    }
    fire($('modeStrip'))
    change('days', '21')
    await settle()
    expect($('modeStrip').getAttribute('aria-pressed')).toBe('true')
    expect($('atlasStrip').hidden).toBe(false)
  })

  it('a failed reload drops the pick, closes its card and clears #atlasStats', async () => {
    await start()
    fire(nodeEl('word:golpe'))
    docsCard.close.mockClear()
    failing = /\/graph/
    change('days', '7')
    await settle()
    expect(docsCard.close).toHaveBeenCalled()
    expect($('atlasStats').textContent).toBe('')
    expect(rows()).toHaveLength(0)
  })

  it('unmounting aborts an in-flight sparkline too', async () => {
    holding = /\/timeline/
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    unmount(instance!)
    instance = undefined
    expect(held[0].signal?.aborted).toBe(true)
  })

  it('new data resets the search box', async () => {
    await start()
    const search = $('search') as HTMLInputElement
    search.value = 'gol'
    fire(search, 'input')
    change('days', '7')
    await settle()
    expect(search.value).toBe('')
  })

  it('#maskLegend hides outside avaliação', async () => {
    await start()
    fire($('mask'))
    expect(($('maskLegend') as HTMLElement).hidden).toBe(true)
  })

  it('a reload keeps the list aria-busy and the status on "Lendo o recorte." until it lands', async () => {
    await start()
    holding = /\/graph/
    change('days', '7')
    await settle()
    expect($('columns').getAttribute('aria-busy')).toBe('true')
    expect($('status').textContent).toBe('Lendo o recorte.')
    held[0].resolve(graphOf(nodes2))
    await settle()
    expect($('columns').getAttribute('aria-busy')).toBe('false')
  })

  it('limit cuts the payload, and #atlasStats names the source label', async () => {
    bodies.graph = graphOf(Array.from({ length: 14 }, (_, i) => at({ id: `word:w${i}`, term: `w${i}`, count: 30 - i })))
    await start('?limit=12&source=bluesky')
    expect(rows()).toHaveLength(12)
    expect($('atlasStats').textContent).toBe('10 docs · Bluesky')
  })

  it('list: the picked row is is-selected, its linked row is-neighbor, the others dim', async () => {
    bodies.graph = graphOf([golpe, reforma, at({ id: 'word:z', term: 'z' })], { links: [{ source: 'word:golpe', target: 'word:reforma', count: 2 }] })
    await start()
    fire(nodeEl('word:golpe'))
    const card = (id: string) => nodeEl(id)
    expect(card('word:golpe').classList.contains('is-selected')).toBe(true)
    expect(card('word:reforma').classList.contains('is-dim')).toBe(false)
    expect(card('word:reforma').classList.contains('is-neighbor')).toBe(true)
    expect(card('word:z').classList.contains('is-dim')).toBe(true)
  })

  it('a search hides the neighbour mark', async () => {
    bodies.graph = graphOf([golpe, reforma], { links: [{ source: 'word:golpe', target: 'word:reforma', count: 2 }] })
    await start()
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:reforma').classList.contains('is-neighbor')).toBe(true)
    const search = $('search') as HTMLInputElement
    search.value = 'ref'
    fire(search, 'input')
    expect(nodeEl('word:reforma').classList.contains('is-neighbor')).toBe(false)
  })

  it('the inspector starts with the top five and a pick lists co-occurrence counts', async () => {
    bodies.graph = graphOf(Array.from({ length: 7 }, (_, i) => at({ id: `word:w${i}`, term: `w${i}`, count: 30 - i })), {
      links: [{ source: 'word:w0', target: 'word:w1', count: 17 }],
    })
    await start()
    expect(all('#inspector [data-related]')).toHaveLength(5)
    fire(nodeEl('word:w0'))
    expect(document.querySelector('#inspector [data-related="word:w1"] b')!.textContent).toBe('17')
  })

  it('a word of unknown kind opens under "o termo"; a favourable word reads so', async () => {
    bodies.graph = graphOf([at({ id: 'x:y', term: 'y', kind: 'weird', testimony: tone(1, 12) })])
    await start()
    fire(nodeEl('x:y'))
    expect((docsCard.open.mock.calls[0][0] as any).kicker).toBe('Documentos com o termo')
    expect($('inspector').textContent).toMatch(/mais favoráveis que a média da pessoa/)
  })

  it('alcance with only some words carrying reach shows no "Nenhum documento" note', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', reach: 5 }), at({ id: 'word:b', term: 'b', reach: null })])
    await start('?sort=reach')
    expect($('legend').textContent).not.toMatch(/Nenhum documento do Bluesky/)
  })

  it('sparkline bars: a zero day is 2px, the loudest 34px', async () => {
    bodies.timeline = [0, 1, 2, 10, 3, 0, 1].map((count, i) => ({ bucket_start: `2026-09-0${i + 1}T00:00:00.000Z`, count }))
    await start()
    fire(nodeEl('word:golpe'))
    await settle()
    const heights = all('#inspector .spark-bar').map((b) => parseFloat(b.style.getPropertyValue('--h')))
    expect(heights[0]).toBe(2)
    expect(heights[3]).toBe(34)
  })

  it('the strip mean label sits at the person mean on the inner axis', async () => {
    const nodes = [{ ...golpe, testimony: tone(-6) }, { ...reforma, testimony: tone(4) }]
    bodies.graph = graphOf(nodes)
    widths.atlasStrip = 500
    await start()
    fire($('modeStrip'))
    const l = termStripLayout(nodes as never, { method: 'kikori', score: -1, n: 100 } as never, 500)
    const pos = parseFloat(document.querySelector<HTMLElement>('.strip-mean')!.style.getPropertyValue('--pos'))
    expect(pos).toBeCloseTo(((l.x(-1) - 28) / (500 - 56)) * 100)
  })
})

describe('Atlas: Lista and Dispersão (issue #328)', () => {
  const at = (over: Record<string, unknown>) => ({ id: 'word:x', term: 'x', kind: 'word', count: 9, pmi: 1, ...over })
  const share = (id: string) => parseFloat(nodeEl(id).querySelector<HTMLElement>('.list-bar')!.style.getPropertyValue('--w'))
  const value = (id: string) => nodeEl(id).querySelector('.list-value')!.textContent
  const ofKey = (id: string) => [...$(id).querySelectorAll('dt')].map((dt) => dt.textContent!.trim())
  const press = (el: Element, key: string) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    flushSync()
  }

  it('AC3: each row shows its rank, label and a mono value equal to fmt(score) in the sentence measure', async () => {
    const list = [at({ id: 'word:a', term: 'a', count: 40, pmi: 0.5 }), at({ id: 'hashtag:b', term: 'b', kind: 'hashtag', count: 12, pmi: 2 }), at({ id: 'word:c', term: 'c', count: 3, pmi: 3.3 })]
    bodies.graph = graphOf(list)
    await start('?sort=count')
    expect(rows().map((r) => r.dataset.node)).toEqual(['word:a', 'hashtag:b', 'word:c'])
    expect(rows().map((r) => r.querySelector('.list-value')!.textContent)).toEqual(['40', '12', '3'])
    expect(nodeEl('hashtag:b').querySelector('.list-term')!.textContent!.trim()).toBe('#b')
    expect(nodeEl('hashtag:b').getAttribute('aria-label')).toBe('#b, 12 documentos; frequência em documentos: 12')
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    await start('?sort=pmi')
    expect(rows().map((r) => r.querySelector('.list-value')!.textContent)).toEqual(list.map((n) => fmt(score(n as never, 'pmi'))))
    expect(nodeEl('word:a').getAttribute('aria-label')).toBe(`a, 40 documentos; PMI × ln(1 + docs): ${fmt(score(list[0] as never, 'pmi'))}`)
  })

  it('AC4: the bar share is score over the largest score shown, and never NaN', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', count: 8 }), at({ id: 'word:b', term: 'b', count: 4 }), at({ id: 'word:c', term: 'c', count: 2 })])
    await start('?sort=count')
    expect([share('word:a'), share('word:b'), share('word:c')]).toEqual([1, 0.5, 0.25])
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', count: 8, pmi: 1 }), at({ id: 'word:n', term: 'n', count: 8, pmi: -2 })])
    await start('?sort=pmi')
    expect(share('word:a')).toBe(1)
    expect(share('word:n')).toBe(0)
    expect(value('word:n')).toBe(fmt(-2 * Math.log1p(8)))
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', count: 0, pmi: 0 }), at({ id: 'word:b', term: 'b', count: 0, pmi: null })])
    await start('?sort=count')
    expect([share('word:a'), share('word:b')]).toEqual([0, 0])
    expect($('columns').innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('AC5: sort=reach without reach gives empty bars, a 0 value and the legend sentence; a node at 0 beside one with reach prints 0', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', reach: null }), at({ id: 'word:b', term: 'b', reach: 0 })])
    await start('?sort=reach')
    expect([share('word:a'), share('word:b')]).toEqual([0, 0])
    expect([value('word:a'), value('word:b')]).toEqual(['0', '0'])
    expect($('legend').textContent).toContain('Nenhum documento do Bluesky neste recorte tem alcance registrado: as barras ficam vazias.')
    expect($('columns').textContent).not.toMatch(/[—–]|NaN/)
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', reach: 5 }), at({ id: 'word:b', term: 'b', reach: 0 })])
    await start('?sort=reach')
    expect([share('word:a'), share('word:b')]).toEqual([1, 0])
    expect([value('word:a'), value('word:b')]).toEqual(['5', '0'])
    expect($('legend').textContent).not.toMatch(/alcance registrado/)
  })

  it('AC7: the dot follows the mask, is neutral without a colour, and the column goes with the mask off', async () => {
    const list = [at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20), community: 3 }), at({ id: 'word:b', term: 'b', testimony: tone(4, 2) })]
    bodies.graph = graphOf(list, { stats: stats({ testimony: { method: 'kikori', score: -2.4, n: 500 } }) })
    await start()
    expect(rows().every((r) => r.querySelector('.list-dot'))).toBe(true)
    expect($('columns').classList.contains('has-dot')).toBe(true)
    expect(paintOf('word:a', '--mask')).toBe(termMask(list[0] as never, -2.4))
    expect(paintOf('word:b', '--mask')).toBe('')
    fire($('mask'))
    expect(paintOf('word:a', '--theme')).toBe(themeMask(list[0] as never, communityRanking(list as { community?: number | null }[])))
    expect(paintOf('word:b', '--theme')).toBe('')
    expect($('columns').classList.contains('is-themed')).toBe(true)
    fire($('mask'))
    expect($('mask').textContent).toBe('Sem cor')
    expect(all('#columns .list-dot')).toHaveLength(0)
    expect($('columns').classList.contains('has-dot')).toBe(false)
    expect(rows()).toHaveLength(2)
    toScatter()
    expect(paintOf('word:a', '--mask')).toBe(termMask(list[0] as never, -2.4))
    fire($('mask'))
    expect($('mask').textContent).toBe('Colorir por avaliação')
    fire($('modeColumns'))
    expect(all('#columns .list-dot')).toHaveLength(2)
  })

  it('AC9: a row pick fills the inspector, asks for /timeline once and opens one side; again releases it', async () => {
    await start('?source=bluesky')
    fire(nodeEl('word:golpe'))
    await settle()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    expect($('termHeading').textContent).toBe('golpe')
    expect($('inspector').textContent).toContain(fmt(2.1))
    expect($('inspector').textContent).toContain('41')
    expect(timelineUrls()).toHaveLength(1)
    expect(q(timelineUrls()[0]).get('days')).toBe('7')
    expect(q(timelineUrls()[0]).get('bucket')).toBe('day')
    expect(q(timelineUrls()[0]).get('source')).toBe('bluesky')
    const req = docsCard.open.mock.calls[0][0] as any
    expect(req.owner ?? 'atlas').toBe('atlas')
    expect(req.sides).toHaveLength(1)
    expect(req.sides[0].query.get('term')).toBe('golpe')
    expect(req.sides[0].query.get('kind')).toBe('word')
    docsCard.close.mockClear()
    fire(nodeEl('word:golpe'))
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
    expect(docsCard.close).toHaveBeenCalled()
  })

  it('AC11: the scatter holds one focusable point per node, with title and aria-label', async () => {
    bodies.graph = graphOf([golpe, reforma, { id: 'org:pt', term: 'PT', kind: 'org', count: 12, pmi: 1.1 }])
    widths.scatter = 720
    await start()
    toScatter()
    expect(all('#scatter svg')).toHaveLength(1)
    expect(points().map((p) => p.dataset.node)).toEqual(['word:golpe', 'word:reforma', 'org:pt'])
    for (const p of points()) {
      expect(p.getAttribute('role')).toBe('button')
      expect(p.getAttribute('tabindex')).toBe('0')
      expect(p.getAttribute('aria-pressed')).toBe('false')
      expect(p.querySelector('title')!.textContent).toMatch(/ · \d+ documentos · PMI /)
      expect(p.getAttribute('aria-label')).toMatch(/documentos; PMI /)
    }
    expect(nodeEl('word:golpe').querySelector('title')!.textContent).toMatch(/^golpe · Palavra · 41 documentos · PMI 2,1 · avaliação -3,97 em 12 textos$/)
    expect(nodeEl('org:pt').querySelector('title')!.textContent).toBe('PT · Organização · 12 documentos · PMI 1,1')
    expect($('scatter').querySelector('svg')!.getAttribute('width')).toBe('720')
    expect($('scatter').querySelector('svg')!.getAttribute('aria-label')).toBe('Dispersão: documentos por PMI')
  })

  it('AC11: a point sits where scatterLayout puts it, and the axes carry the captions and a label for every tick', async () => {
    const list = [golpe, reforma, { id: 'word:neg', term: 'neg', kind: 'word', count: 6, pmi: -0.8 }]
    bodies.graph = graphOf(list)
    widths.scatter = 700
    await start()
    toScatter()
    const layout = scatterLayout(((t: string, size: number) => t.length * size * 0.6) as never, list as never, 700)
    const circle = (id: string) => nodeEl(id).querySelector('circle.scatter-dot')!
    for (const p of layout.points) {
      expect(Number(circle(p.id).getAttribute('cx'))).toBeCloseTo(p.x)
      expect(Number(circle(p.id).getAttribute('cy'))).toBeCloseTo(p.y)
      expect(Number(circle(p.id).getAttribute('r'))).toBe(layout.r)
    }
    const text = [...$('scatter').querySelectorAll('svg > text')].map((t) => t.textContent)
    for (const t of [...layout.xTicks, ...layout.yTicks]) expect(text).toContain(fmt(t.value))
    expect(text).toContain('documentos (escala log)')
    expect(text).toContain('PMI: quanto a palavra é específica da pessoa')
    expect(text).toContain('0 = acaso')
    expect($('scatter').querySelectorAll('.scatter-zero')).toHaveLength(1)
  })

  it('AC11: with every pmi above the first tick there is no zero line', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', count: 5, pmi: 1.4 }), at({ id: 'word:b', term: 'b', count: 9, pmi: 2.1 })])
    await start()
    toScatter()
    expect($('scatter').querySelector('.scatter-zero')).toBeNull()
    expect($('scatter').textContent).not.toContain('0 = acaso')
  })

  it('AC11: a missing pmi lays out as 0 and the row prints 0, never NaN', async () => {
    bodies.graph = graphOf([at({ id: 'word:a', term: 'a', pmi: null }), at({ id: 'word:b', term: 'b', pmi: 2 })])
    await start()
    expect(value('word:a')).toBe('0')
    toScatter()
    expect(nodeEl('word:a').querySelector('title')!.textContent).toMatch(/PMI 0$/)
    expect($('scatter').innerHTML).not.toMatch(/NaN/)
  })

  it('AC15: an unlabelled point stays clickable and keyboard reachable', async () => {
    bodies.graph = graphOf(Array.from({ length: 24 }, (_, i) => at({ id: `word:p${i}`, term: `ponto${i}`, count: 9, pmi: 1 })))
    widths.scatter = 300
    await start('?limit=24')
    toScatter()
    expect(points()).toHaveLength(24)
    const bare = points().filter((p) => !p.querySelector('text'))
    expect(bare.length).toBeGreaterThanOrEqual(1)
    expect(bare.length).toBeLessThan(24)
    const lone = bare.at(-1)!
    expect(lone.querySelector('title')!.textContent).toMatch(/ponto\d+ · Palavra · 9 documentos · PMI 1/)
    expect(lone.getAttribute('role')).toBe('button')
    expect(lone.getAttribute('tabindex')).toBe('0')
    fire(lone)
    expect(docsCard.open).toHaveBeenCalledTimes(1)
    expect(lone.getAttribute('aria-pressed')).toBe('true')
    fire(lone)
    expect(lone.getAttribute('aria-pressed')).toBe('false')
    const other = bare[0]
    press(other, 'Enter')
    expect(docsCard.open).toHaveBeenCalledTimes(2)
    expect(other.getAttribute('aria-pressed')).toBe('true')
  })

  it('AC16: picking a point highlights its linked terms and dims the rest, with no line, and the labels do not move', async () => {
    bodies.graph = graphOf([golpe, reforma, { id: 'word:stf', term: 'stf', kind: 'word', count: 30, pmi: 1.8 }, { id: 'word:solo', term: 'solo', kind: 'word', count: 15, pmi: 1.1 }, { id: 'word:fora', term: 'fora', kind: 'word', count: 5, pmi: 0.4 }], {
      links: [
        { source: 'word:golpe', target: 'word:reforma', count: 4 },
        { source: 'word:golpe', target: 'word:stf', count: 2 },
        { source: 'word:golpe', target: 'word:ausente', count: 9 },
      ],
    })
    await start()
    toScatter()
    const labelled = () => points().filter((p) => p.querySelector('text')).map((p) => p.dataset.node)
    const before = labelled()
    expect(before.length).toBeGreaterThan(0)
    fire(nodeEl('word:golpe'))
    const cls = (c: string) => points().filter((p) => p.classList.contains(c)).map((p) => p.dataset.node)
    expect(cls('is-selected')).toEqual(['word:golpe'])
    expect(cls('is-neighbor').sort()).toEqual(['word:reforma', 'word:stf'])
    expect(cls('is-dim').sort()).toEqual(['word:fora', 'word:solo'])
    expect($('scatter').querySelectorAll('path, .edge')).toHaveLength(0)
    expect($('scatter').querySelectorAll('svg line:not(.scatter-gridline):not(.scatter-axis):not(.scatter-zero)')).toHaveLength(0)
    expect(labelled()).toEqual(before)
    fire(nodeEl('word:golpe'))
    expect(cls('is-selected')).toEqual([])
    expect(cls('is-neighbor')).toEqual([])
    expect(cls('is-dim')).toEqual([])
    expect(labelled()).toEqual(before)
  })

  it('AC7: a scatter point is coloured by --mask under avaliação, --theme under tema and falls to --muted with the mask off or no person score', async () => {
    const list = [at({ id: 'word:a', term: 'a', testimony: tone(0.1, 20), community: 3 }), at({ id: 'word:b', term: 'b', count: 5, testimony: null, community: null })]
    bodies.graph = graphOf(list, { stats: stats({ testimony: { method: 'kikori', score: -2.4, n: 500 } }) })
    await start()
    toScatter()
    const svg = () => $('scatter').querySelector('svg')!
    expect(svg().classList.contains('is-masked')).toBe(true)
    expect(svg().classList.contains('is-themed')).toBe(false)
    expect(paintOf('word:a', '--mask')).toBe(termMask(list[0] as never, -2.4))
    expect(paintOf('word:b', '--mask')).toBe('')
    fire($('mask'))
    expect(svg().classList.contains('is-themed')).toBe(true)
    expect(svg().classList.contains('is-masked')).toBe(false)
    expect(paintOf('word:a', '--theme')).toBe(themeMask(list[0] as never, communityRanking(list as { community?: number | null }[])))
    expect(paintOf('word:b', '--theme')).toBe('')
    fire($('mask'))
    expect($('mask').textContent).toBe('Sem cor')
    expect(svg().classList.contains('is-masked') || svg().classList.contains('is-themed')).toBe(false)
    unmount(instance!)
    instance = undefined
    target.replaceChildren()
    clearScopes()
    bodies.graph = graphOf(list, { stats: stats({ testimony: null }) })
    await start()
    expect($('columns').classList.contains('is-masked')).toBe(false)
    expect(all('#columns .list-dot')).toHaveLength(2)
    toScatter()
    expect(svg().classList.contains('is-masked')).toBe(false)
  })

  it('AC9: Escape closes an open card first, keeps the pick, and the next Escape clears it, in Dispersão too', async () => {
    await start()
    toScatter()
    fire(nodeEl('word:golpe'))
    docsCard.isOpen.mockReturnValue(true)
    docsCard.close.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flushSync()
    expect(docsCard.close).toHaveBeenCalled()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('true')
    docsCard.isOpen.mockReturnValue(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flushSync()
    expect(nodeEl('word:golpe').getAttribute('aria-pressed')).toBe('false')
  })

  it('AC15: every point is reachable with Tab and picked with Enter or Space, labelled or not', async () => {
    bodies.graph = graphOf(Array.from({ length: 24 }, (_, i) => at({ id: `word:p${i}`, term: `ponto${i}`, count: 9, pmi: 1 })))
    widths.scatter = 300
    await start('?limit=24')
    toScatter()
    const tabbable = all('#scatter [tabindex="0"]').filter((e) => e.dataset.node)
    expect(tabbable).toHaveLength(24)
    const unlabelled = points().filter((p) => !p.querySelector('text'))
    expect(unlabelled.length).toBeGreaterThan(0)
    for (const p of unlabelled) {
      expect(p.getAttribute('aria-label')).toMatch(/^ponto\d+, 9 documentos; PMI /)
      expect(p.tagName.toLowerCase()).toBe('g')
    }
    for (const key of ['Enter', ' ']) {
      docsCard.open.mockClear()
      const p = unlabelled[0]
      press(p, key)
      expect(docsCard.open, key).toHaveBeenCalledTimes(1)
      expect(p.getAttribute('aria-pressed')).toBe('true')
      press(p, key)
      expect(p.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('AC19: each mode shows its own key and the Barra line is the same in the page and in the dialog', async () => {
    await start()
    expect(ofKey('keyDefault')).toEqual(['Barra', 'Cor', 'Organização', 'Clique'])
    expect(ofKey('keyScatter')).toEqual(['Posição', 'Cor', 'Clique'])
    expect(ofKey('keyStrip')).toEqual(['Posição', 'AaAaTamanho', 'Cor', 'Clique'])
    expect([...$('keyStrip').querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['média da avaliação dos textos com a palavra', 'quantos textos', 'distância da média da pessoa', 'textos da palavra'])
    const hidden = () => ['keyDefault', 'keyScatter', 'keyStrip'].map((id) => $(id).hidden)
    expect(hidden()).toEqual([false, true, true])
    expect($('keyDefault').querySelector('dd')!.textContent).toBe('frequência, PMI ponderado ou alcance: a medida escolhida na frase')
    toScatter()
    expect(hidden()).toEqual([true, false, true])
    fire($('modeStrip'))
    expect(hidden()).toEqual([true, true, false])
    fire($('modeColumns'))
    fire($('mask'))
    expect($('keyDefaultColor').hidden).toBe(true)
    toScatter()
    expect($('keyScatterColor').hidden).toBe(true)
    expect($('keyTheme').hidden).toBe(false)
    fire($('mask'))
    fire($('mask'))
    expect($('keyScatterColor').hidden).toBe(false)
  })

  it('the sentence names the measure, the legend explains the scatter axes, and the inspector speaks of the bar', async () => {
    await start()
    expect(select('sort').getAttribute('aria-label')).toBe('Medida')
    expect($('workspace').querySelector('.figure-sub')!.textContent).toBe('Palavras nos textos que citam a pessoa, na ordem da medida da frase. Como ler.')
    expect($('legend').textContent).toContain('Barra = PMI × ln(1 + docs)')
    expect($('legend').textContent).not.toMatch(/Linha = documentos em comum|zoom e rolagem|Tamanho/)
    expect($('inspector').textContent).toContain('A pessoa')
    expect($('inspector').textContent).not.toMatch(/no centro|campo limpo/i)
    toScatter()
    expect($('legend').textContent).toContain('Eixo x = documentos, escala log · eixo y = PMI bruto · Tab + Enter para selecionar')
    fire(nodeEl('word:golpe'))
    expect($('inspector').textContent).toMatch(/PMI × ln\(1 \+ docs\) · medida da barra\./)
    expect($('inspector').textContent).not.toMatch(/score usado no tamanho/)
  })

  it('AC20: no radial markup is rendered in any mode', async () => {
    await start()
    for (const mode of ['modeColumns', 'modeScatter', 'modeStrip']) {
      fire($(mode))
      expect($('workspace').querySelector('.map-svg, .atlas-word, .center-label, .zoom, .mobile-hint, .edge, .viewport, .map-stage, .overflow')).toBeNull()
    }
  })
})
