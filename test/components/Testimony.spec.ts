import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Testimony from '../../src/ui/Testimony.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { card, close, mountDocsCard, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { docsParams } from '../../src/ui/api.js'
import { clearScopes } from '../../src/ui/state.js'
import { existsSync, readFileSync } from 'node:fs'

// Issue #296: figure 2 as one component. Mirrors the assertions of the retired
// test/figures-testimony.test.ts and test/outlets-fold.test.ts.

const people = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Beto' },
]
const rows = [
  { domain: 'g1.globo.com', source: 'gnews', docs: 5 },
  { domain: null, source: 'bluesky', docs: 9 },
]
const scored = {
  method: 'kikori',
  overall: { score: 1.5, n: 8 },
  by_source: [{ source: 'bluesky', score: 1.2, n: 5 }],
  by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: 1.5, n: 8 }],
}
const empty = { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let urls: string[]
let routes: { sources: unknown; testimony: unknown; docs: unknown }
let failing: Set<string>
let docsHosts: ReturnType<typeof mount>[] = []
let observers: { target: unknown; cb: () => void }[]

const q = (sel: string) => target.querySelector(sel) as HTMLElement | null
const all = (sel: string) => [...target.querySelectorAll(sel)] as HTMLElement[]
const byId = (id: string) => document.getElementById(id) as any

const settle = async (ms = 400) => {
  await vi.advanceTimersByTimeAsync(ms)
  flushSync()
}

const startBoot = async (search = '', opts: Partial<{ people: typeof people; peopleError: unknown }> = {}) => {
  setBoot({ ready: true, people: opts.people ?? people, peopleError: opts.peopleError ?? null, search })
  flushSync()
  await settle()
}

const mountAll = () => {
  instance = mount(Testimony, { target })
  flushSync()
}

const requested = (route: string) => urls.filter((u) => u.includes(`/${route}?`))

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  performance.clearMeasures()
  urls = []
  observers = []
  failing = new Set()
  routes = { sources: rows, testimony: scored, docs: { docs: [], total: 0 } }
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
  target = document.createElement('div')
  document.body.appendChild(target)
  const dialog = document.createElement('div')
  dialog.id = 'docs-host'
  document.body.appendChild(dialog)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: () => void
      constructor(cb: () => void) {
        this.cb = cb
      }
      observe(t: unknown) {
        observers.push({ target: t, cb: this.cb })
      }
      disconnect() {}
      unobserve() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const route = ['sources', 'testimony', 'docs'].find((r) => url.includes(`/${r}?`) || url.includes(`/${r}`))!
      if (failing.has(route)) return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) }
      return { ok: true, status: 200, headers: new Headers(), json: async () => routes[route as keyof typeof routes] }
    }),
  )
})

afterEach(() => {
  close()
  for (const d of docsHosts) unmount(d)
  docsHosts = []
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  document.getElementById('docs-host')?.remove()
  document.querySelectorAll('dialog').forEach((d) => d.remove())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Testimony (issue #296)', () => {
  it('AC1: figures/testimony.ts is gone and app.ts neither imports nor mounts it', () => {
    expect(existsSync('src/ui/figures/testimony.ts')).toBe(false)
    expect(readFileSync('src/ui/app.ts', 'utf8')).not.toMatch(/figures\/testimony|mountTestimony/)
  })

  it('AC2: seeds person, days and source from the querystring', async () => {
    mountAll()
    await startBoot('?person=p2&days=60&source=bluesky')
    expect(byId('testimonyPerson').value).toBe('p2')
    expect(byId('testimonyDays').value).toBe('60')
    expect(byId('testimonySource').value).toBe('bluesky')
    const [s] = requested('sources')
    expect(s).toContain('/people/p2/sources')
    expect(s).toContain('days=60')
    expect(s).toContain('source=bluesky')
    expect(requested('testimony')[0]).toContain('/people/p2/testimony')
  })

  it('AC2: prefixed testimony.<key> seeds beat the bare key', async () => {
    mountAll()
    await startBoot('?days=7&testimony.days=60&testimony.person=p2')
    expect(byId('testimonyDays').value).toBe('60')
    expect(byId('testimonyPerson').value).toBe('p2')
  })

  it('AC2: ignores a seed whose option does not exist', async () => {
    mountAll()
    await startBoot('?person=nobody&days=99&source=nowhere')
    expect(byId('testimonyPerson').value).toBe('p1')
    expect(byId('testimonyDays').value).toBe('30')
    expect(byId('testimonySource').value).toBe('all')
    expect(requested('testimony')[0]).toContain('/people/p1/testimony')
  })

  it('AC3: control change resets focus and refetches', async () => {
    mountAll()
    await startBoot('?person=p1')
    q('[data-domain="g1.globo.com"]')!.click()
    flushSync()
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(openedBy('testimony')).toBe(true)
    const before = urls.length
    byId('testimonyDays').value = '60'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    expect(byId('domainLabel').textContent).toBe('')
    expect(requested('sources').length).toBeGreaterThan(0)
    expect(urls.length).toBeGreaterThan(before)
    expect(urls.slice(before).some((u) => u.includes('/sources?') && u.includes('days=60'))).toBe(true)
    expect(urls.slice(before).some((u) => u.includes('/testimony?') && u.includes('days=60'))).toBe(true)
    expect(openedBy('testimony')).toBe(false)
  })

  it("AC4: outlet pick opens the docs card with the outlet's query", async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1&days=30&source=all')
    q('[data-domain="g1.globo.com"]')!.click()
    flushSync()
    await settle(0)
    const docsCalls = urls.filter((u) => u.includes('/docs'))
    expect(docsCalls).toHaveLength(1)
    const expected = docsParams({ days: '30', source: 'all', domain: 'g1.globo.com' })
    expect(docsCalls[0]).toContain('/people/p1/docs')
    expect(docsCalls[0]).toContain(expected.toString())
    expect(openedBy('testimony')).toBe(true)
  })

  it('AC4: static outlet is not a button', async () => {
    mountAll()
    await startBoot('?person=p1')
    const fold = all('#outletList .outlet.is-static')
    expect(fold).toHaveLength(1)
    expect(fold[0].tagName).toBe('SPAN')
    expect(fold[0].querySelector('.d')!.textContent).toBe('bluesky')
    expect(fold[0].querySelector('.n')!.textContent).toBe('9')
    expect(q('[data-domain="bluesky"]')).toBeNull()
    expect(all('#outletList [data-domain]')).toHaveLength(1)
    expect(q('#outletList button.outlet[data-domain="g1.globo.com"]')).not.toBeNull()
  })

  it('AC5: second pick, background click and Escape release', async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    const pick = () => {
      q('#outletList [data-domain="g1.globo.com"]')!.click()
      flushSync()
    }
    pick()
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(q('#outletList [data-domain="g1.globo.com"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('#outletList dl.metric')).not.toBeNull()
    pick()
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
    pick()
    byId('outletList').click()
    flushSync()
    expect(byId('domainLabel').textContent).toBe('')
    pick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
  })

  it("AC5: release leaves another owner's card", async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'p1', personName: 'Ana', query: new URLSearchParams('term=x') }] })
    await settle(0)
    expect(openedBy('atlas')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    byId('outletList').click()
    flushSync()
    expect(openedBy('atlas')).toBe(true)
  })

  it('AC6: Enter and Space pick a strip mark', async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    const mark = () => q('[data-strip-domain="g1.globo.com"]')!
    expect(mark().getAttribute('role')).toBe('button')
    mark().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(openedBy('testimony')).toBe(true)
    mark().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe('')
    mark().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
  })

  it('AC7: ghost then painted then reload keeps drawing', async () => {
    mountAll()
    setBoot({ ready: true, people, peopleError: null, search: '?person=p1' })
    flushSync()
    expect(q('[aria-busy="true"]')).not.toBeNull()
    await settle()
    expect(q('[aria-busy="true"]')).toBeNull()
    expect(q('#testimonyList .verdict')).not.toBeNull()
    expect(byId('testimonyLabel').textContent).toBe('+1,5')
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(q('#testimonyList')!.classList.contains('is-loading')).toBe(true)
    expect(q('#testimonyList .verdict')).not.toBeNull()
    expect(q('#outletList')!.classList.contains('is-loading')).toBe(true)
    await settle(300)
    expect(q('#testimonyList')!.classList.contains('is-loading')).toBe(false)
  })

  it('AC7: outlets and testimony errors use their own copy', async () => {
    failing.add('sources')
    mountAll()
    await startBoot('?person=p1')
    expect(byId('outletList').textContent).toContain('Não foi possível carregar os veículos.')
    expect(byId('testimonyList').textContent).not.toContain('Não foi possível carregar a avaliação.')
    unmount(instance!)
    target.innerHTML = ''
    clearScopes()
    failing = new Set(['testimony'])
    setBoot({ ready: false })
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyList').textContent).toContain('Não foi possível carregar a avaliação.')
    expect(byId('outletList').textContent).not.toContain('Não foi possível carregar os veículos.')
  })

  it('AC8: null score renders pet-empty', async () => {
    routes.testimony = empty
    mountAll()
    await startBoot('?person=p1')
    const pet = q('#testimonyList .pet-empty')!
    expect(pet).not.toBeNull()
    const img = pet.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/pet-caracara.png')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('width')).toBeTruthy()
    expect(img.getAttribute('height')).toBeTruthy()
    expect(byId('testimonyList').textContent).toContain('Nenhum texto avaliado neste recorte')
    expect(byId('outletList').querySelector('img')).toBeNull()
  })

  it('AC9: peopleError shows retry once', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    mountAll()
    await startBoot('', { people: [], peopleError: new Error('down') })
    expect(byId('testimonyList').textContent).toContain('Falha de rede ou base indisponível.')
    expect(byId('testimonyList').textContent).not.toContain('Nenhuma pessoa cadastrada.')
    expect(byId('testimonyList').textContent).toContain('Nenhuma avaliação fictícia será exibida.')
    expect(all('#testimonyRetry')).toHaveLength(1)
    expect(byId('strip').hidden).toBe(true)
    byId('testimonyRetry').click()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(urls).toHaveLength(0)
    expect(byId('testimonyList').querySelector('img')).toBeNull()
  })

  it('AC9: no people shows empty copy', async () => {
    mountAll()
    await startBoot('', { people: [] })
    expect(byId('testimonyList').textContent).toContain('Nenhuma pessoa cadastrada.')
    expect(byId('strip').hidden).toBe(true)
    expect(urls).toHaveLength(0)
  })

  it('AC10: memo hit records api:sources', async () => {
    mountAll()
    await startBoot('?person=p1&days=30')
    const measure = vi.spyOn(performance, 'measure')
    byId('testimonyDays').value = '60'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    await settle(300)
    measure.mockClear()
    byId('testimonyDays').value = '30'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    await settle(300)
    const names = measure.mock.calls.map(([name]) => String(name)).filter((n) => n.startsWith('api:'))
    expect(names).toContain('api:sources')
    expect(names).not.toContain('api:outlets')
  })

  it('AC11: resize repaints without fetch', async () => {
    mountAll()
    const strip = byId('strip')
    Object.defineProperty(strip, 'clientWidth', { value: 800, configurable: true })
    await startBoot('?person=p1')
    expect(q('#strip svg')!.getAttribute('viewBox')).toMatch(/^0 0 800/)
    const watcher = observers.find((o) => o.target === strip)!
    expect(watcher).toBeTruthy()
    const fetched = urls.length
    Object.defineProperty(strip, 'clientWidth', { value: 400, configurable: true })
    watcher.cb()
    flushSync()
    expect(q('#strip svg')!.getAttribute('viewBox')).toMatch(/^0 0 400/)
    expect(urls).toHaveLength(fetched)
  })

  it('AC12: renders ghost before boot ready', () => {
    mountAll()
    expect(target.textContent).not.toContain('Aguardando dados.')
    expect(all('.ghost-field').length).toBeGreaterThan(0)
    expect(urls).toHaveLength(0)
  })

  it('AC13: strip mark and outlet row markup', async () => {
    mountAll()
    await startBoot('?person=p1')
    const mark = q('#strip [data-strip-domain="g1.globo.com"]')!
    expect(mark.getAttribute('aria-pressed')).toBe('false')
    expect(mark.getAttribute('tabindex')).toBe('0')
    expect(mark.getAttribute('aria-label')).toMatch(/^g1\.globo\.com, \+1,5 em 8 textos$/)
    const row = q('#outletList button.outlet')!
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(row.querySelector('.d')!.textContent).toBe('g1.globo.com')
    expect(row.querySelector('.n')!.textContent).toBe('5')
    expect(q('#testimonyList .source-chip dt')!.textContent).toBe('Bluesky')
  })
})

describe('Testimony (issue #296, review gaps)', () => {
  const fielded = [
    { domain: 'a.example', source: 'gnews', docs: 5, tone: null, field: 1, neighbors: [{ domain: 'b.example', similarity: 0.5 }] },
    { domain: 'b.example', source: 'gnews', docs: 3, tone: null, field: 1, neighbors: [{ domain: 'a.example', similarity: 0.5 }] },
    { domain: 'c.example', source: 'gnews', docs: 2, tone: null, field: 2, neighbors: [] },
    { domain: 'd.example', source: 'gnews', docs: 1, tone: null, field: null, neighbors: [] },
  ]

  it('groups rows by field, field null trailing, no field number in the text (#218)', async () => {
    routes.sources = fielded
    mountAll()
    await startBoot('?person=p1')
    const grids = all('#outletList .outlet-grid')
    expect(grids).toHaveLength(3)
    const eyebrows = all('#outletList > p.eyebrow').map((e) => e.textContent)
    expect(eyebrows).toEqual(['grupo · a.example, b.example', 'grupo · c.example', 'Sem agrupamento suficiente'])
    expect(byId('outletList').textContent!.replace(/\d+/g, '')).not.toMatch(/\bfield\b|grupo\s*\d/i)
    const text = byId('outletList').textContent!
    expect(text.indexOf('a.example')).toBeLessThan(text.indexOf('Sem agrupamento suficiente'))
  })

  it('field groups order by summed docs, never by the Louvain id (#218)', async () => {
    routes.sources = [
      { domain: 'small.example', source: 'gnews', docs: 2, tone: null, field: 0, neighbors: [] },
      { domain: 'big.example', source: 'gnews', docs: 9, tone: null, field: 7, neighbors: [] },
    ]
    mountAll()
    await startBoot('?person=p1')
    const text = byId('outletList').textContent!
    expect(text.indexOf('grupo · big.example')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('grupo · big.example')).toBeLessThan(text.indexOf('grupo · small.example'))
  })

  it("the focused outlet's row is followed by its neighbours or the empty line (#218)", async () => {
    routes.sources = fielded
    mountAll()
    await startBoot('?person=p1')
    q('#outletList [data-domain="a.example"]')!.click()
    flushSync()
    const dl = q('#outletList [data-domain="a.example"]')!.nextElementSibling!
    expect(dl.matches('dl.metric.stat')).toBe(true)
    expect(dl.textContent).toContain('Vocabulário mais parecido com')
    const items = [...dl.querySelectorAll('.outlet-neighbor')]
    expect(items.length).toBeLessThanOrEqual(5)
    expect(items.map((i) => i.textContent)).toEqual(['b.example · 0.50'])
    q('#outletList [data-domain="c.example"]')!.click()
    flushSync()
    const none = q('#outletList [data-domain="c.example"]')!.nextElementSibling!
    expect(none.textContent).toContain('Nenhum veículo com vocabulário parecido neste recorte')
    expect(none.querySelectorAll('.outlet-neighbor')).toHaveLength(0)
  })

  it('carries tone only as a --tone custom property on rows and strip dots', async () => {
    mountAll()
    await startBoot('?person=p1')
    for (const el of [q('#outletList button.outlet')!, q('#strip .strip-dot')!]) {
      const style = el.getAttribute('style') ?? ''
      expect(style).toMatch(/^--tone:/)
      expect(style.split(';').filter((d) => d.trim()).every((d) => d.trim().startsWith('--tone:'))).toBe(true)
    }
  })

  it('a scored payload paints no img in the list; the empty recorte suggests a wider one', async () => {
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyList').querySelector('img')).toBeNull()
    unmount(instance!)
    target.innerHTML = ''
    clearScopes()
    routes.testimony = empty
    setBoot({ ready: false })
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyList').textContent).toContain('Tente um período maior ou outra fonte')
  })

  it('a resize during a reload keeps the old drawing and is-loading until it resolves', async () => {
    mountAll()
    const strip = byId('strip')
    Object.defineProperty(strip, 'clientWidth', { value: 800, configurable: true })
    await startBoot('?person=p1')
    const watcher = observers.find((o) => o.target === strip)!
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const base = globalThis.fetch as unknown as (u: string) => Promise<unknown>
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.includes('/testimony?')) await gate
      return base(u)
    }))
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    expect(strip.classList.contains('is-loading')).toBe(true)
    Object.defineProperty(strip, 'clientWidth', { value: 400, configurable: true })
    watcher.cb()
    flushSync()
    expect(q('#strip svg')!.getAttribute('viewBox')).toMatch(/^0 0 800/)
    expect(strip.classList.contains('is-loading')).toBe(true)
    release()
    await settle(0)
    expect(strip.classList.contains('is-loading')).toBe(false)
  })

  it('a figure-2 control change requests only /sources and /testimony', async () => {
    mountAll()
    await startBoot('?person=p1')
    const before = urls.length
    byId('testimonySource').value = 'bluesky'
    byId('testimonySource').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    const fresh = urls.slice(before)
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.every((u) => u.includes('/sources?') || u.includes('/testimony?'))).toBe(true)
    expect(fresh.some((u) => u.includes('/graph'))).toBe(false)
  })

  it('header, subtitle and select clicks keep the pick', async () => {
    mountAll()
    await startBoot('?person=p1')
    q('#outletList [data-domain="g1.globo.com"]')!.click()
    flushSync()
    for (const el of [q('h2')!, q('.figure-sub')!, byId('testimonyDays'), q('.figure-key')!]) {
      el.click()
      flushSync()
      expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
      expect(openedBy('testimony')).toBe(true)
    }
  })

  it('a pick made while a reload is held is dropped when the new data paints', async () => {
    mountAll()
    await startBoot('?person=p1')
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const base = globalThis.fetch as unknown as (u: string) => Promise<unknown>
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (!u.includes('/testimony?')) return base(u)
      await gate
      return { ok: true, status: 200, headers: new Headers(), json: async () => structuredClone(scored) }
    }))
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    q('#outletList [data-domain="g1.globo.com"]')!.click()
    flushSync()
    await settle(0)
    expect(openedBy('testimony')).toBe(true)
    release()
    await settle(100)
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
  })

  it('a stale pick is dropped on error but another owner card survives', async () => {
    mountAll()
    await startBoot('?person=p1')
    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'p1', personName: 'Ana', query: new URLSearchParams('term=x') }] })
    await settle(0)
    failing.add('testimony')
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('atlas')).toBe(true)
  })
})

const sample = {
  method: 'kikori:q8',
  overall: { score: -2.16, n: 784 },
  by_source: [
    { source: 'bluesky', score: -1.89, n: 621 },
    { source: 'gkg', score: -4.22, n: 39 },
  ],
  by_domain: [
    { domain: 'bbc.com', source: 'gnews', score: -2, n: 6 },
    { domain: 'g1.globo.com', source: 'gnews', score: -3.62, n: 13 },
    { domain: 'fdusp.bsky.social', source: 'bluesky', score: 0.76, n: 3 },
  ],
}
const sampleRows = [
  { domain: 'bbc.com', source: 'gnews', docs: 6 },
  { domain: 'g1.globo.com', source: 'gnews', docs: 13 },
  { domain: 'tiny.example', source: 'gnews', docs: 2 },
]
const pickRow = (d: string) => {
  q(`#outletList [data-domain="${d}"]`)!.click()
  flushSync()
}

describe('Testimony (issue #296, ported paintTestimony/paintStrip/docs-card assertions)', () => {
  beforeEach(() => {
    routes.testimony = sample
    routes.sources = sampleRows
  })

  it('paints the overall score, chips and dt copy; no ranking, no scale, tone only as a custom property', async () => {
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyLabel').textContent).toBe('-2,16')
    const list = byId('testimonyList')
    expect(list.querySelector('.verdict dt')!.textContent).toBe('Média do recorte')
    expect(list.querySelector('.verdict dd')!.textContent).toBe('-2,16')
    expect(list.querySelector('.verdict-class')!.textContent).toBe('neutro · média de 784 textos avaliados')
    const chips = [...list.querySelectorAll('.source-chip')]
    expect(chips.map((c) => c.querySelector('dt')!.textContent)).toEqual(['Bluesky', 'GKG'])
    expect(chips[0].querySelector('.n')!.textContent).toBe('621')
    expect(list.querySelector('[data-testimony-domain]')).toBeNull()
    expect(list.querySelector('.scale')).toBeNull()
    for (const el of target.querySelectorAll('[style]')) {
      for (const decl of (el.getAttribute('style') ?? '').split(';').filter((d) => d.trim())) expect(decl.trim().startsWith('--')).toBe(true)
    }
  })

  it("says the focused outlet's own score, or that it has under 3 scored texts", async () => {
    mountAll()
    await startBoot('?person=p1')
    expect(q('#testimonyList .focus')).toBeNull()
    pickRow('bbc.com')
    const focus = q('#testimonyList .focus')!
    expect(focus.querySelector('b')!.textContent).toBe('bbc.com')
    expect(focus.querySelector('strong')!.textContent).toBe('-2')
    expect(focus.textContent).toBe('bbc.com: -2 em 6 textos. O número acima é o recorte inteiro.')
    expect(byId('testimonyLabel').textContent).toBe('-2,16')
    pickRow('tiny.example')
    expect(q('#testimonyList .focus')!.textContent).toMatch(/^tiny\.example: menos de 3 textos avaliados/)
  })

  it('says when nothing was scored, with the method, and clears the label', async () => {
    routes.testimony = { method: 'kikori:q8:abc', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyLabel').textContent).toBe('')
    expect(byId('testimonyList').textContent).toContain('Nenhum texto avaliado neste recorte (método kikori:q8:abc)')
    expect(byId('testimonyList').querySelector('strong')).toBeNull()
    expect(byId('outletList').textContent).not.toContain('Nenhum veículo neste recorte.')
  })

  it('an empty /sources says so and paints no bird', async () => {
    routes.sources = []
    mountAll()
    await startBoot('?person=p1')
    expect(byId('outletList').textContent).toContain('Nenhum veículo neste recorte.')
    expect(byId('outletList').querySelector('img')).toBeNull()
  })

  it('the strip draws one dot per outlet, marks the active one and states its axis, mean and note', async () => {
    mountAll()
    await startBoot('?person=p1')
    const strip = byId('strip')
    expect(strip.hidden).toBe(false)
    const domains = all('#strip [data-strip-domain]').map((e) => e.getAttribute('data-strip-domain'))
    expect(domains).toEqual(['g1.globo.com', 'bbc.com', 'fdusp.bsky.social'])
    expect(strip.querySelector('.strip-mean')!.getAttribute('style')).toMatch(/^--pos:\s*39\.2%;?$/)
    expect(strip.querySelector('.strip-mean')!.textContent).toBe('média da pessoa -2,16')
    expect(strip.querySelector('.strip-overall')).not.toBeNull()
    const g1 = q('#strip [data-strip-domain="g1.globo.com"] title')!.textContent
    expect(g1).toBe('g1.globo.com · Google News · -3,62 em 13 textos')
    expect([...strip.querySelectorAll('.strip-axis-labels span')].map((e) => e.textContent)).toEqual(['−10 contra', '0', '+10 a favor'])
    expect(strip.querySelector('.note')!.textContent).toContain('O atlas acima não muda.')
    expect(strip.querySelector('.note')!.textContent).not.toContain('toque de novo, ou fora das bolinhas, para soltar')
    const cx = (d: string) => Number(q(`#strip [data-strip-domain="${d}"] .dot-face`)!.getAttribute('cx'))
    expect(cx('g1.globo.com')).toBeLessThan(cx('fdusp.bsky.social'))
    pickRow('bbc.com')
    const active = q('#strip [data-strip-domain="bbc.com"]')!
    expect(active.getAttribute('class')).toBe('strip-dot is-active')
    expect(active.getAttribute('aria-pressed')).toBe('true')
    expect(q('#strip [data-strip-domain="g1.globo.com"]')!.getAttribute('aria-pressed')).toBe('false')
    expect(strip.querySelector('.note')!.textContent).toContain('toque de novo, ou fora das bolinhas, para soltar')
  })

  it('the strip is hidden and empty with no dots', async () => {
    routes.testimony = { ...sample, by_domain: [] }
    mountAll()
    await startBoot('?person=p1')
    expect(byId('strip').hidden).toBe(true)
    expect(byId('strip').textContent!.trim()).toBe('')
    expect(byId('strip').querySelector('svg')).toBeNull()
  })

  it('the ghost paints both figures with their copy and aria-busy while loading', async () => {
    mountAll()
    setBoot({ ready: true, people, peopleError: null, search: '?person=p1' })
    flushSync()
    expect(byId('strip').getAttribute('aria-busy')).toBe('true')
    expect(byId('strip').hidden).toBe(false)
    expect(byId('strip').querySelector('.ghost-field .strip-axis')).not.toBeNull()
    expect(byId('outletList').getAttribute('aria-busy')).toBe('true')
    expect(byId('outletList').querySelector('.ghost-field')).not.toBeNull()
    expect(byId('outletList').textContent).toContain('Lendo os veículos.')
    expect(byId('testimonyList').querySelector('.ghost-field')).not.toBeNull()
    expect(byId('testimonyList').textContent).toContain('Lendo a avaliação.')
    expect(byId('testimonyLabel').textContent).toBe('')
    await settle()
    expect(byId('strip').getAttribute('aria-busy')).toBe('false')
    expect(byId('outletList').getAttribute('aria-busy')).toBe('false')
  })

  it("an outlet pick opens the card: kicker 'Documentos de', title the domain, this figure's person, no term", async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p2')
    expect(urls.filter((u) => u.includes('/docs'))).toHaveLength(0)
    pickRow('g1.globo.com')
    await settle(0)
    const docs = urls.filter((u) => u.includes('/docs'))
    expect(docs).toHaveLength(1)
    expect(docs[0]).toContain('/people/p2/docs?')
    expect(docs[0]).toContain('domain=g1.globo.com')
    expect(docs[0]).toMatch(/term=(&|$)/)
    expect(byId('docsKicker').textContent).toBe('Documentos de')
    expect(byId('docsTitle').textContent).toBe('g1.globo.com')
    pickRow('g1.globo.com')
    await settle(0)
    expect((byId('docsTitle').closest('dialog') as HTMLDialogElement).open).toBe(false)
  })

  it('a bubbling click on a strip dot keeps the pick; Space is default-prevented', async () => {
    mountAll()
    await startBoot('?person=p1')
    pickRow('bbc.com')
    q('#strip [data-strip-domain="g1.globo.com"] .dot-face')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(openedBy('testimony')).toBe(true)
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    q('#strip [data-strip-domain="g1.globo.com"]')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('a later boot does not re-seed or refetch once started', async () => {
    mountAll()
    await startBoot('?person=p2&days=60')
    const before = urls.length
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    await settle(300)
    const after = urls.length
    setBoot({ ready: true, people, peopleError: null, search: '?person=p1&days=30' })
    flushSync()
    await settle(300)
    expect(urls.length).toBe(after)
    expect(after).toBeGreaterThan(before)
    expect(byId('testimonyPerson').value).toBe('p2')
    expect(byId('testimonyDays').value).toBe('7')
  })

  it('exactly one observer watches #strip', async () => {
    mountAll()
    await startBoot('?person=p1')
    expect(observers.filter((o) => o.target === byId('strip'))).toHaveLength(1)
  })

  it('caps the neighbour list at five', async () => {
    routes.sources = [
      {
        domain: 'a.example',
        source: 'gnews',
        docs: 5,
        tone: null,
        field: 1,
        neighbors: Array.from({ length: 6 }, (_, i) => ({ domain: `n${i}.example`, similarity: 0.9 - i / 10 })),
      },
    ]
    mountAll()
    await startBoot('?person=p1')
    pickRow('a.example')
    const items = all('#outletList .outlet-neighbor')
    expect(items).toHaveLength(5)
    expect(items.map((i) => i.textContent)).not.toContain('n5.example · 0.40')
  })
})

describe('Testimony (issue #296, mutation survivors)', () => {
  it('chips carry the per-source score, the active row is pressed, static rows and the note carry their copy', async () => {
    routes.testimony = sample
    routes.sources = [...sampleRows, { domain: null, source: 'bluesky', docs: 9 }]
    mountAll()
    await startBoot('?person=p1')
    expect(all('#testimonyList .source-chip .t').map((e) => e.textContent)).toEqual(['-1,89', '-4,22'])
    expect(q('#outletList .is-static')!.getAttribute('title')).toBe('Textos sem veículo nesta fonte')
    expect(byId('outletList').textContent).toContain('Grupos e vocabulário parecido vêm da construção da janela')
    pickRow('bbc.com')
    const row = q('#outletList button[data-domain="bbc.com"]')!
    expect(row.getAttribute('class')).toBe('outlet is-active')
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(row.getAttribute('title')).toBe('Google News')
  })

  it('a click on the active strip dot releases it, the figure listener sparing marks', async () => {
    mountDocsHost()
    routes.testimony = sample
    routes.sources = sampleRows
    mountAll()
    await startBoot('?person=p1')
    pickRow('bbc.com')
    q('#strip [data-strip-domain="bbc.com"] .dot-face')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
  })

  it("the docs card side is named after the figure's person", async () => {
    mountDocsHost()
    routes.sources = sampleRows
    mountAll()
    await startBoot('?person=p2')
    pickRow('g1.globo.com')
    await settle(0)
    expect(card.sides.map((x) => [x.personId, x.personName])).toEqual([['p2', 'Beto']])
  })

  it('a pick on the dimmed outlet list is dropped when /sources fails', async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const base = globalThis.fetch as unknown as (u: string) => Promise<unknown>
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (!u.includes('/sources?')) return base(u)
      await gate
      return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) }
    }))
    byId('testimonyDays').value = '7'
    byId('testimonyDays').dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle(300)
    pickRow('g1.globo.com')
    await settle(0)
    expect(openedBy('testimony')).toBe(true)
    release()
    await settle(100)
    expect(byId('outletList').textContent).toContain('Não foi possível carregar os veículos.')
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
  })
})

describe('Testimony (issue #296, stale pick versus a live one)', () => {
  const held = () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    return { gate, release }
  }
  const hold = (route: 'testimony' | 'sources', gate: Promise<void>, answer: () => unknown) => {
    const base = globalThis.fetch as unknown as (u: string) => Promise<unknown>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        if (!u.includes(`/${route}?`)) return base(u)
        await gate
        const body = answer()
        return body === 'fail'
          ? { ok: false, status: 500, headers: new Headers(), json: async () => ({}) }
          : { ok: true, status: 200, headers: new Headers(), json: async () => body }
      }),
    )
  }
  const change = (id: string, value: string) => {
    byId(id).value = value
    byId(id).dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
  }

  it('a pick on the live outlet list survives /testimony landing', async () => {
    const { gate, release } = held()
    hold('testimony', gate, () => structuredClone(scored))
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyList').getAttribute('aria-busy')).toBe('true')
    pickRow('g1.globo.com')
    await settle(0)
    release()
    await settle(100)
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(openedBy('testimony')).toBe(true)
  })

  it('a pick on the live outlet list survives /testimony failing', async () => {
    const { gate, release } = held()
    hold('testimony', gate, () => 'fail')
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    pickRow('g1.globo.com')
    await settle(0)
    release()
    await settle(100)
    expect(byId('testimonyList').textContent).toContain('Não foi possível carregar a avaliação.')
    expect(byId('domainLabel').textContent).toBe(' · g1.globo.com')
    expect(openedBy('testimony')).toBe(true)
  })

  it('a pick on the dimmed outlet list is dropped when the new /sources lands', async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    const { gate, release } = held()
    hold('sources', gate, () => [{ domain: 'other.example', source: 'gnews', docs: 4 }])
    change('testimonyDays', '7')
    await settle(300)
    expect(byId('outletList').classList.contains('is-loading')).toBe(true)
    pickRow('g1.globo.com')
    await settle(0)
    expect(openedBy('testimony')).toBe(true)
    release()
    await settle(100)
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
    expect(byId('outletList').textContent).toContain('other.example')
  })

  it('a pick on dimmed data is dropped when the reload fails, sparing another owner', async () => {
    mountDocsHost()
    mountAll()
    await startBoot('?person=p1')
    const { gate, release } = held()
    hold('testimony', gate, () => 'fail')
    change('testimonyDays', '7')
    await settle(300)
    expect(byId('testimonyList').classList.contains('is-loading')).toBe(true)
    pickRow('g1.globo.com')
    await settle(0)
    expect(openedBy('testimony')).toBe(true)
    release()
    await settle(100)
    expect(byId('testimonyList').textContent).toContain('Não foi possível carregar a avaliação.')
    expect(byId('domainLabel').textContent).toBe('')
    expect(openedBy('testimony')).toBe(false)
  })
})

describe('Testimony (issue #296): the route and the component agree on the shape', () => {
  it('what GET /api/people/:id/testimony returns paints without adaptation', async () => {
    process.env.DATA_DIR = 'memory://'
    const { app } = await import('../../src/server.js')
    const { seed } = await import('../fixture.js')
    const { testimonyParams } = await import('../../src/ui/api.js')
    const { signed } = await import('../../src/ui/format.js')
    await seed()
    const res = await app.request('/api/people/tarcisio/testimony?' + testimonyParams({ days: '30', sort: 'count', limit: '18', source: 'all' }) + '&method=stub')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.overall.n).toBeGreaterThan(0)
    routes.testimony = data
    routes.sources = data.by_domain.map((d: { domain: string; source: string; n: number }) => ({ domain: d.domain, source: d.source, docs: d.n }))
    mountAll()
    await startBoot('?person=p1')
    expect(byId('testimonyLabel').textContent).toBe(signed(data.overall.score))
    q('#outletList [data-domain="estadao.com.br"]')!.click()
    flushSync()
    expect(q('#testimonyList .focus b')!.textContent).toBe('estadao.com.br')
  })
})

const mountDocsHost = () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const docs = mount(DocsCard, { target: host })
  docsHosts.push(docs)
  mountDocsCard()
  flushSync()
  return docs
}
