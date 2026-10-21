import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
// @ts-ignore -- the component is what issue #289 adds
import Comention from '../../src/ui/Comention.svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { close, isOpen, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { setBoot } from '../../src/ui/boot.svelte.js'
import { fmt } from '../../src/ui/format.js'
import { matrixLayout } from '../../src/ui/layout.js'
import { clearScopes } from '../../src/ui/state.js'

type Pending = { url: string; resolve: (body: unknown) => void }

const lula = { id: 'lula', name: 'Lula' }
const tarcisio = { id: 'tarcisio', name: 'Tarcísio' }
const bolsonaro = { id: 'bolsonaro', name: 'Bolsonaro' }
const three = [bolsonaro, lula, tarcisio]
const inverted = [
  { id: 'dino', name: 'Aline' },
  { id: 'bolsonaro', name: 'Zeca' },
]
const payload = (persons: { id: string; name: string }[], pairs: { a: string; b: string; count: number }[]) => ({ days: 21, persons, pairs })

let target: HTMLElement
let cardTarget: HTMLElement
let instances: ReturnType<typeof mount>[]
let fetches: string[]
let pending: Pending[]
let hold: boolean
let body: unknown
let observers: { cb: () => void }[]
let media: { matches: boolean; listeners: Set<(e?: { matches: boolean }) => void> }
let clientWidth = 0

const respond = (b: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => b })

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  fetches = []
  pending = []
  hold = false
  observers = []
  instances = []
  ;(globalThis as any).ResizeObserver = class {
    constructor(cb: () => void) {
      observers.push({ cb })
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
  media = { matches: true, listeners: new Set() }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      get matches() {
        return media.matches
      },
      addEventListener: (_type: string, l: (e?: { matches: boolean }) => void) => media.listeners.add(l),
      removeEventListener: (_type: string, l: (e?: { matches: boolean }) => void) => media.listeners.delete(l),
    })),
  })
  clientWidth = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => clientWidth)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetches.push(url)
      if (url.includes('/docs')) return Promise.resolve(respond({ docs: [], total: 0 }))
      if (hold) return new Promise((resolve) => pending.push({ url, resolve: (b) => resolve(respond(b)) }))
      return Promise.resolve(respond(body))
    }),
  )
  target = document.createElement('div')
  cardTarget = document.createElement('div')
  document.body.append(target, cardTarget)
  instances.push(mount(DocsCard, { target: cardTarget }))
})

afterEach(() => {
  close()
  instances.forEach((i) => unmount(i))
  target.remove()
  cardTarget.remove()
  vi.restoreAllMocks()
  delete (window as any).matchMedia
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setBoot({ ready: false, people: [], peopleError: null, search: '' })
})

const settle = async () => {
  await vi.advanceTimersByTimeAsync(300)
  flushSync()
}

const start = async (b: unknown, people = three, search = '', peopleError: unknown = null) => {
  body = b
  setBoot({ people, peopleError, search, ready: true })
  instances.push(mount(Comention, { target }))
  flushSync()
  await settle()
}

const matrix = () => target.querySelector('#comentionMatrix') as HTMLElement
const about = () => target.querySelector('#comentionAbout')!.textContent
const cell = (a: string, b: string) => matrix().querySelector(`.comention-cell[data-a="${a}"][data-b="${b}"]`) as HTMLElement | null
const item = (a: string, b: string) => matrix().querySelector(`.comention-listitem[data-a="${a}"][data-b="${b}"]`) as HTMLElement | null
const items = () => [...matrix().querySelectorAll<HTMLElement>('.comention-listitem[data-a]')]
const names = () => items().map((el) => el.querySelector('.comention-name')!.textContent)
const widths = () => items().map((el) => Number.parseFloat((el.querySelector('.comention-bar') as HTMLElement).style.getPropertyValue('--w')))
const toggle = () => target.querySelector('#comentionToggle') as HTMLButtonElement | null
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const docsUrls = () => fetches.filter((u) => u.includes('/docs'))
const comentionUrls = () => fetches.filter((u) => u.includes('/api/comention'))
const pickItem = async (a: string, b: string) => {
  click(item(a, b)!)
  await settle()
}
const pick = async (a: string, b: string) => {
  click(cell(a, b)!)
  await settle()
}
const showGrid = async () => {
  click(toggle()!)
  await settle()
}
const fireMedia = (matches: boolean) => {
  media.matches = matches
  media.listeners.forEach((l) => l({ matches }))
  flushSync()
}
const select = (id: string) => target.querySelector(`#${id}`) as HTMLSelectElement
const change = async (id: string, value: string) => {
  const el = select(id)
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}
const remount = () => {
  unmount(instances.pop()!)
  target.innerHTML = ''
  clearScopes()
}
const searchOf = (url: string) => new URL(url, 'http://localhost').searchParams

const many = Array.from({ length: 27 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, name: `Pessoa ${String(i).padStart(2, '0')}` }))
const manyPairs = [
  { a: 'p00', b: 'p01', count: 9 },
  { a: 'p05', b: 'p26', count: 4 },
  { a: 'p25', b: 'p26', count: 2 },
]
const manyPayload = payload(many, manyPairs)
const px = (el: HTMLElement, name: string) => Number.parseFloat(el.style.getPropertyValue(name))
const grid = () => matrix().querySelector('.comention-grid') as HTMLElement
const rows = () => [...grid().querySelectorAll<HTMLElement>(':scope > .comention-row')]
const resizeTo = async (width: number) => {
  clientWidth = width
  observers.forEach((o) => o.cb())
  await settle()
}
const startGrid = async (b: unknown, people = three, search = '') => {
  await start(b, people, search)
  await showGrid()
}

const filled = payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }])

// ids sort the opposite way to names, so a name resolved by position would be wrong
const alphabet = ['Álvaro', 'Ana', 'Bia', 'Caio', 'Dani', 'Eva', 'Fábio', 'Gil', 'Hugo', 'Iara', 'João', 'Kátia', 'Léo', 'Maria', 'Nina', 'Otto', 'Paulo', 'Rui']
const crowd = alphabet.map((_, i) => ({ id: `q${String(i).padStart(2, '0')}`, name: alphabet[17 - i] }))
// q00 (Rui) pairs with everyone; k = 14..16 tie at 2 across the 15/16 cut, in the order
// Bia, Ana, Álvaro by id and Álvaro, Ana, Bia in pt-BR collation
const crowdPairs = Array.from({ length: 17 }, (_, k) => ({ a: 'q00', b: `q${String(k + 1).padStart(2, '0')}`, count: k < 14 ? 40 - k : 2 }))
const crowdPayload = payload(crowd, crowdPairs)

const team = [
  { id: 'a1', name: 'Zeca' },
  { id: 'b2', name: 'Yara' },
  { id: 'c3', name: 'Xuxa' },
  { id: 'd4', name: 'Wanda' },
  { id: 'e5', name: 'Alone' },
]
const teamPairs = [
  { a: 'a1', b: 'b2', count: 8 },
  { a: 'a1', b: 'c3', count: 4 },
  { a: 'a1', b: 'd4', count: 4 },
  { a: 'b2', b: 'd4', count: 2 },
]
const teamPayload = payload(team, teamPairs)

describe('Comention', () => {
  it('forwards days, source, lean and min (AC1)', async () => {
    await start(filled)
    await change('comentionDays', '7')
    await change('comentionSource', 'gdelt')
    await change('comentionLean', 'left')
    await change('comentionMin', '5')
    const qs = searchOf(comentionUrls().at(-1)!)
    expect(qs.get('days')).toBe('7')
    expect(qs.get('source')).toBe('gdelt')
    expect(qs.get('lean')).toBe('left')
    expect(qs.get('min')).toBe('5')
  })

  it('AC24: the period select offers exactly 7 and 21 with 21 selected, and the first /comention carries days=21', async () => {
    await start(filled)
    expect([...select('comentionDays').options].map((o) => o.value)).toEqual(['7', '21'])
    expect([...select('comentionDays').options].map((o) => o.textContent)).toEqual(['últimos 7 dias', 'últimos 21 dias'])
    expect(select('comentionDays').value).toBe('21')
    expect(searchOf(comentionUrls()[0]).get('days')).toBe('21')
  })

  it('AC25: a shared link with days=30 or days=60 opens on 21, and days=7 still selects 7', async () => {
    for (const days of ['30', '60']) {
      await start(filled, three, `?days=${days}`)
      expect(select('comentionDays').value).toBe('21')
      expect(searchOf(comentionUrls().at(-1)!).get('days')).toBe('21')
      remount()
    }
    await start(filled, three, '?days=7')
    expect(select('comentionDays').value).toBe('7')
  })

  it('person select: todas first, default, options from bootData.people', async () => {
    await start(filled, inverted)
    const options = [...select('comentionPerson').options]
    expect(options[0].value).toBe('')
    expect(options[0].textContent).toBe('todas as pessoas')
    expect(options.slice(1).map((o) => [o.value, o.textContent])).toEqual(inverted.map((p) => [p.id, p.name]))
    expect(select('comentionPerson').value).toBe('')
  })

  it('person seeds: prefixed beats bare, unknown id ignored, lean/min stay prefixed-only', async () => {
    await start(filled, three, '?person=lula')
    expect(select('comentionPerson').value).toBe('lula')
    remount()
    await start(filled, three, '?comention.person=lula')
    expect(select('comentionPerson').value).toBe('lula')
    remount()
    await start(filled, three, '?person=bolsonaro&comention.person=lula')
    expect(select('comentionPerson').value).toBe('lula')
    remount()
    await start(filled, three, '?person=nobody')
    expect(select('comentionPerson').value).toBe('')
    remount()
    await start(filled, three, '?lean=left&min=5')
    expect(select('comentionLean').value).toBe('all')
    expect(select('comentionMin').value).toBe('3')
    remount()
    await start(filled, three, '?comention.lean=left&comention.min=5')
    expect(select('comentionLean').value).toBe('left')
    expect(select('comentionMin').value).toBe('5')
  })

  it('person never reaches /comention and never refetches or writes the URL', async () => {
    const search = location.search
    await start(teamPayload, team)
    expect(comentionUrls()).toHaveLength(1)
    await change('comentionPerson', 'a1')
    await change('comentionPerson', 'b2')
    await change('comentionPerson', '')
    expect(comentionUrls()).toHaveLength(1)
    for (const url of comentionUrls()) expect(searchOf(url).has('person')).toBe(false)
    expect(location.search).toBe(search)
  })

  it("changing the person releases the pick and spares another owner's card", async () => {
    await start(filled)
    await pickItem('lula', 'tarcisio')
    expect(openedBy('comention')).toBe(true)
    await change('comentionPerson', 'lula')
    expect(isOpen()).toBe(false)
    expect(item('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')

    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams('term=a') }] })
    await settle()
    await change('comentionPerson', '')
    expect(openedBy('atlas')).toBe(true)
  })

  it('todas shows the top 15 by count, ties by pt-BR label, names resolved by id', async () => {
    await start(crowdPayload, crowd)
    expect(items()).toHaveLength(15)
    const expected = crowdPairs.slice(0, 14).map((p, k) => `Rui × ${alphabet[16 - k]}`)
    expect(names()).toEqual([...expected, 'Rui × Álvaro'])
    const counts = items().map((el) => el.querySelector('.comention-count')!.textContent)
    expect(counts).toEqual([...crowdPairs.slice(0, 14).map((p) => fmt(p.count)), fmt(2)])
    expect(items()[0].getAttribute('aria-label')).toBe(`Rui e Paulo: ${fmt(40)} textos juntos`)
    expect(Math.max(...widths())).toBe(1)
  })

  it('todas prints A × B with A the pair a, on names that sort against ids', async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]), inverted)
    expect(names()).toEqual(['Zeca × Aline'])
  })

  it("person mode lists only that person's partners, scale keyed to the largest", async () => {
    await start(teamPayload, team)
    await change('comentionPerson', 'a1')
    expect(names()).toEqual(['Yara', 'Wanda', 'Xuxa'])
    expect(widths()).toEqual([1, 0.5, 0.5])
    expect(items()[0].getAttribute('aria-label')).toBe(`Zeca e Yara: ${fmt(8)} textos juntos`)
    await change('comentionPerson', 'b2')
    expect(names()).toEqual(['Zeca', 'Wanda'])
    expect(widths()).toEqual([1, 0.25])
    await change('comentionPerson', 'c3')
    expect(names()).toEqual(['Zeca'])
    expect(widths()).toEqual([1])
  })

  it('min applies in both modes', async () => {
    await start(teamPayload, team)
    await change('comentionPerson', 'a1')
    body = payload(team, [{ a: 'a1', b: 'b2', count: 8 }])
    await change('comentionMin', '5')
    expect(searchOf(comentionUrls().at(-1)!).get('min')).toBe('5')
    expect(names()).toEqual(['Yara'])
    await change('comentionPerson', '')
    expect(names()).toEqual(['Zeca × Yara'])
    body = teamPayload
    await change('comentionMin', '1')
    expect(searchOf(comentionUrls().at(-1)!).get('min')).toBe('1')
    expect(items()).toHaveLength(4)
    await change('comentionPerson', 'd4')
    expect(names()).toEqual(['Zeca', 'Yara'])
  })

  it('a person with no partners shows the empty copy and no NaN', async () => {
    await start(payload(three, [{ a: 'bolsonaro', b: 'tarcisio', count: 4 }]))
    await change('comentionPerson', 'lula')
    expect(items()).toHaveLength(0)
    expect(matrix().querySelector('.note')!.textContent).toBe('Ninguém apareceu junto com Lula em 3 textos ou mais.')
    expect(target.textContent).not.toMatch(/NaN|undefined/)
  })

  it("the zero-partner note reads the min the shown payload was loaded with, not the live select", async () => {
    await start(payload(three, []))
    await change('comentionPerson', 'lula')
    hold = true
    const sel = select('comentionMin')
    sel.value = '5'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    flushSync()
    expect(matrix().querySelector('.note')!.textContent).toBe('Ninguém apareceu junto com Lula em 3 textos ou mais.')
    expect(about()).toContain('com 3 textos em comum')
    pending.at(-1)!.resolve(payload(three, []))
    await settle()
    expect(matrix().querySelector('.note')!.textContent).toBe('Ninguém apareceu junto com Lula em 5 textos ou mais.')
  })

  it('about line: partner count in person mode, pair count in todas, empty copy', async () => {
    await start(teamPayload, team)
    expect(about()).toBe('4 pares de pessoas citadas juntas nos 21 dias.')
    await change('comentionPerson', 'a1')
    expect(about()).toBe('Zeca tem 3 parceiros nos 21 dias, com 3 textos em comum ou mais.')
    await change('comentionPerson', 'c3')
    expect(about()).toBe('Xuxa tem 1 parceiro nos 21 dias, com 3 textos em comum ou mais.')
    await change('comentionPerson', 'e5')
    expect(about()).toBe('Alone tem 0 parceiros nos 21 dias, com 3 textos em comum ou mais.')
    remount()
    await start(payload(team, []), team)
    expect(about()).toBe('Ninguém apareceu junto o suficiente nesta janela.')
    await change('comentionPerson', 'a1')
    expect(about()).toBe('Zeca tem 0 parceiros nos 21 dias, com 3 textos em comum ou mais.')
  })

  it('a row opens one docs side with with=<partner> in person mode, smaller id first in todas', async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]), inverted)
    await change('comentionLean', 'left')
    await pickItem('bolsonaro', 'dino')
    expect(docsUrls()).toHaveLength(1)
    expect(docsUrls()[0]).toMatch(/\/api\/people\/bolsonaro\/docs\?/)
    let qs = searchOf(docsUrls()[0])
    expect(qs.get('with')).toBe('dino')
    expect(qs.get('days')).toBe('21')
    expect(qs.get('lean')).toBe('left')
    expect(openedBy('comention')).toBe(true)

    await pickItem('bolsonaro', 'dino')
    await change('comentionPerson', 'dino')
    await pickItem('bolsonaro', 'dino')
    expect(docsUrls()).toHaveLength(2)
    expect(docsUrls()[1]).toMatch(/\/api\/people\/dino\/docs\?/)
    qs = searchOf(docsUrls()[1])
    expect(qs.get('with')).toBe('bolsonaro')
    expect(document.getElementById('docsTitle')!.textContent).toBe('Aline e Zeca')
  })

  it('row click does not release; second click, background and Escape do; the toggle keeps the pick', async () => {
    await start(filled)
    await pickItem('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    expect(item('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('true')
    await pickItem('lula', 'tarcisio')
    expect(isOpen()).toBe(false)
    expect(item('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')

    await pickItem('lula', 'tarcisio')
    click(matrix().querySelector('.comention-list')!)
    await settle()
    expect(isOpen()).toBe(false)

    await pickItem('lula', 'tarcisio')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isOpen()).toBe(false)

    await pickItem('lula', 'tarcisio')
    click(target.querySelector('.figure-sub')!)
    click(target.querySelector('.figure-sub a')!)
    click(select('comentionDays'))
    await showGrid()
    expect(isOpen()).toBe(true)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('background click and Escape release a pick made on the matrix', async () => {
    await startGrid(filled)
    await pick('lula', 'tarcisio')
    click(matrix().querySelector('.comention-rowhead')!)
    await settle()
    expect(isOpen()).toBe(false)
    await pick('lula', 'tarcisio')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isOpen()).toBe(false)
  })

  it("release never closes a card another figure opened", async () => {
    await start(filled)
    void open({ kicker: 'k', title: 't', owner: 'atlas', sides: [{ personId: 'lula', personName: 'Lula', query: new URLSearchParams('term=a') }] })
    await settle()
    click(matrix().querySelector('.comention-list')!)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
  })

  it('toggle: absent under 900px, labels flip, list and grid never together', async () => {
    await start(filled)
    expect(toggle()!.textContent).toBe('ver a grade inteira')
    expect(toggle()!.getAttribute('aria-controls')).toBe('comentionMatrix')
    expect(toggle()!.closest('#comentionMatrix')).toBeNull()
    expect(grid()).toBeNull()
    expect(matrix().querySelector('.comention-list')).not.toBeNull()
    await showGrid()
    expect(toggle()!.textContent).toBe('ver a lista')
    expect(grid()).not.toBeNull()
    expect(matrix().querySelector('.comention-list')).toBeNull()
    await showGrid()
    expect(toggle()!.textContent).toBe('ver a grade inteira')
    expect(grid()).toBeNull()
    expect(matrix().querySelector('.comention-list')).not.toBeNull()
    remount()
    media.matches = false
    await start(filled)
    expect(toggle()).toBeNull()
    expect(grid()).toBeNull()
    expect(items()).toHaveLength(1)
  })

  it('showMatrix survives person and filter changes; the matrix shows every pair', async () => {
    await startGrid(teamPayload, team)
    expect(matrix().querySelectorAll('.comention-cell[data-a]')).toHaveLength(4)
    await change('comentionPerson', 'a1')
    expect(matrix().querySelectorAll('.comention-cell[data-a]')).toHaveLength(4)
    await change('comentionDays', '7')
    await change('comentionSource', 'gdelt')
    await change('comentionLean', 'left')
    await change('comentionMin', '5')
    expect(grid()).not.toBeNull()
    expect(toggle()!.textContent).toBe('ver a lista')
    expect(matrix().querySelectorAll('.comention-cell[data-a]')).toHaveLength(4)
    remount()
    await startGrid(payload(three, []), three)
    await change('comentionPerson', 'lula')
    expect(matrix().querySelectorAll('.comention-grid .comention-row:not(.comention-headrow)')).toHaveLength(3)
    expect(matrix().querySelector('[data-a]')).toBeNull()
  })

  it('matchMedia change re-evaluates and unmount removes the listener', async () => {
    await startGrid(filled)
    expect(media.listeners.size).toBe(1)
    fireMedia(false)
    expect(toggle()).toBeNull()
    expect(grid()).toBeNull()
    expect(items()).toHaveLength(1)
    fireMedia(true)
    expect(toggle()!.textContent).toBe('ver a lista')
    expect(grid()).not.toBeNull()
    remount()
    expect(media.listeners.size).toBe(0)
  })

  it('without matchMedia the figure stays on the list', async () => {
    delete (window as any).matchMedia
    await start(filled)
    expect(toggle()).toBeNull()
    expect(items()).toHaveLength(1)
  })

  it('selection is by normalized pair across list and matrix, and the docs requests agree', async () => {
    const only = payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }])
    await start(only, inverted)
    await pickItem('bolsonaro', 'dino')
    await showGrid()
    expect(cell('dino', 'bolsonaro')!.getAttribute('aria-pressed')).toBe('true')
    expect(cell('dino', 'bolsonaro')!.classList.contains('is-selected')).toBe(true)
    await pick('dino', 'bolsonaro')
    expect(isOpen()).toBe(false)
    await pick('dino', 'bolsonaro')
    await showGrid()
    expect(item('bolsonaro', 'dino')!.getAttribute('aria-pressed')).toBe('true')
    expect(item('bolsonaro', 'dino')!.classList.contains('is-selected')).toBe(true)
  })

  it('todas: the row and the cell of one pair issue byte-identical /docs urls', async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]), inverted)
    await pickItem('bolsonaro', 'dino')
    await pickItem('bolsonaro', 'dino')
    clearScopes()
    await showGrid()
    await pick('dino', 'bolsonaro')
    expect(docsUrls()).toHaveLength(2)
    expect(docsUrls()[0]).toBe(docsUrls()[1])
    expect(docsUrls()[0]).toMatch(/\/api\/people\/bolsonaro\/docs\?/)
  })

  it("person mode: the row asks for the picked person's texts, never normalised to the smaller id", async () => {
    await start(payload(inverted, [{ a: 'bolsonaro', b: 'dino', count: 4 }]), inverted)
    await change('comentionPerson', 'bolsonaro')
    await pickItem('bolsonaro', 'dino')
    await pickItem('bolsonaro', 'dino')
    clearScopes()
    await showGrid()
    await pick('dino', 'bolsonaro')
    expect(docsUrls()[0]).toBe(docsUrls()[1])
    await pick('dino', 'bolsonaro')
    await showGrid()
    clearScopes()
    await change('comentionPerson', 'dino')
    await pickItem('bolsonaro', 'dino')
    const row = docsUrls().at(-1)!
    expect(row).toMatch(/\/api\/people\/dino\/docs\?/)
    expect(searchOf(row).get('with')).toBe('bolsonaro')
    await pickItem('bolsonaro', 'dino')
    await showGrid()
    clearScopes()
    await pick('dino', 'bolsonaro')
    const viaCell = docsUrls().at(-1)!
    expect(viaCell).toMatch(/\/api\/people\/bolsonaro\/docs\?/)
    expect(searchOf(viaCell).get('with')).toBe('dino')
    const rest = (url: string) => [...searchOf(url).entries()].filter(([k]) => k !== 'with')
    expect(rest(row)).toEqual(rest(viaCell))
  })

  it('showing the matrix re-measures its width without a fetch', async () => {
    clientWidth = 1200
    await start(manyPayload, many)
    const requests = fetches.length
    clientWidth = 700
    await showGrid()
    expect(fetches.length).toBe(requests)
    const wide = matrixLayout(many, manyPairs, 1200)
    const narrow = matrixLayout(many, manyPairs, 700)
    expect(narrow.cellSize).not.toBe(wide.cellSize)
    expect(px(grid(), '--cell')).toBe(narrow.cellSize)
  })

  it('peopleError skips the fetch and writes the failure note (AC7)', async () => {
    await start(filled, three, '', new Error('down'))
    expect(comentionUrls()).toHaveLength(0)
    expect(matrix().hidden).toBe(true)
    expect(toggle()).toBeNull()
    expect(about()).toBe('Falha de rede ou base indisponível.')
  })

  it('seeds apply only when among the options (AC8)', async () => {
    await start(filled, three, '?days=7&source=gdelt&comention.lean=left&comention.min=5')
    expect(select('comentionDays').value).toBe('7')
    expect(select('comentionSource').value).toBe('gdelt')
    expect(select('comentionLean').value).toBe('left')
    expect(select('comentionMin').value).toBe('5')
    remount()
    await start(filled, three, '?days=999&source=nope&comention.lean=zzz&comention.min=999')
    expect(select('comentionDays').value).toBe('21')
    expect(select('comentionLean').value).toBe('all')
    expect(select('comentionMin').value).toBe('3')
    remount()
    await start(filled, three, '?lean=left&min=5')
    expect(select('comentionLean').value).toBe('all')
    expect(select('comentionMin').value).toBe('3')
    expect([...select('comentionSource').options].some((o) => o.value === select('comentionSource').value)).toBe(true)
    expect(select('comentionSource').value).not.toBe('nope')
  })

  it('paints the list ghost while /api/people is still pending, and the 27x27 ghost once the grid is toggled in', async () => {
    setBoot({ people: [], peopleError: null, search: '', ready: false })
    instances.push(mount(Comention, { target }))
    flushSync()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).toBe('true')
    expect(matrix().querySelectorAll('.comention-list .comention-listitem.ghost')).toHaveLength(6)
    expect(grid()).toBeNull()
    expect(comentionUrls()).toHaveLength(0)
    click(toggle()!)
    flushSync()
    const ghost = grid()
    expect(ghost.classList.contains('is-ghost')).toBe(true)
    expect(ghost.style.getPropertyValue('--pitch')).toBe('')
    expect(ghost.querySelectorAll('.comention-row')).toHaveLength(27)
    expect(ghost.querySelectorAll('.comention-cell.ghost')).toHaveLength(27 * 27)
    expect(matrix().querySelector('.comention-list')).toBeNull()
  })

  it('a failed fetch shows the note and an empty about line', async () => {
    vi.mocked(fetch).mockImplementation((url: any) => {
      fetches.push(String(url))
      return Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as Response)
    })
    await start(filled)
    expect(matrix().hidden).toBe(false)
    expect(matrix().querySelector('.note')!.textContent).toBe('Não foi possível carregar quem aparece junto.')
    expect(about()).toBe('')
    expect(toggle()).not.toBeNull()
  })

  it('empty response paints no row and the empty sentence', async () => {
    await start(payload([], []))
    expect(matrix().querySelector('[data-a]')).toBeNull()
    expect(about()).toContain('Ninguém apareceu junto o suficiente nesta janela.')
  })

  it('an empty pairs list still draws the full matrix when toggled in', async () => {
    await startGrid(payload(three, []))
    expect(matrix().querySelectorAll('.comention-grid .comention-row:not(.comention-headrow)')).toHaveLength(3)
    expect(matrix().querySelector('[data-a]')).toBeNull()
    expect(about()).toContain('Ninguém apareceu junto o suficiente nesta janela.')
  })

  it('blank cell is not a button and clicking it opens no card', async () => {
    await startGrid(filled)
    const empty = matrix().querySelector('.comention-cell.is-empty')
    expect(empty).not.toBeNull()
    expect(empty!.tagName).not.toBe('BUTTON')
    click(empty!)
    await settle()
    expect(isOpen()).toBe(false)
    expect(docsUrls()).toHaveLength(0)
    expect(matrix().querySelectorAll('.comention-cell[data-a]')).toHaveLength(1)
  })

  it('a pick made during a pending fetch is dropped when new data arrives', async () => {
    await start(filled)
    hold = true
    const sel = select('comentionMin')
    sel.value = '5'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    flushSync()
    click(item('lula', 'tarcisio')!)
    await settle()
    expect(isOpen()).toBe(true)
    pending.at(-1)!.resolve(payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }]))
    await settle()
    expect(isOpen()).toBe(false)
    expect(item('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('a pick is dropped when the next load fails', async () => {
    await start(filled)
    await pickItem('lula', 'tarcisio')
    expect(isOpen()).toBe(true)
    vi.mocked(fetch).mockImplementation((url: any) => {
      fetches.push(String(url))
      return Promise.resolve({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as Response)
    })
    await change('comentionMin', '5')
    expect(isOpen()).toBe(false)
    expect(item('lula', 'tarcisio')).toBeNull()
  })

  it('ghost on first load, dim on reload, aria-busy toggles (AC9)', async () => {
    hold = true
    body = filled
    setBoot({ people: three, peopleError: null, search: '', ready: true })
    instances.push(mount(Comention, { target }))
    flushSync()
    await vi.advanceTimersByTimeAsync(0)
    flushSync()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).toBe('true')
    expect(matrix().querySelectorAll('.comention-list .comention-listitem.ghost')).toHaveLength(6)
    expect(grid()).toBeNull()
    expect(matrix().querySelector('.sr-only')!.textContent).toBe('Lendo quem aparece junto.')
    pending[0].resolve(filled)
    await settle()
    expect(matrix().hidden).toBe(false)
    expect(matrix().getAttribute('aria-busy')).not.toBe('true')
    expect(item('lula', 'tarcisio')).not.toBeNull()

    const sel = select('comentionDays')
    sel.value = '7'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    flushSync()
    expect(item('lula', 'tarcisio')).not.toBeNull()
    expect(matrix().querySelector('.ghost')).toBeNull()
    expect(target.querySelector('.is-loading')).not.toBeNull()
    pending.at(-1)!.resolve(filled)
    await settle()
    expect(target.querySelector('.is-loading')).toBeNull()
    expect(matrix().getAttribute('aria-busy')).not.toBe('true')
  })

  it('a resize repaints without a fetch and keeps the selected pair; new data clears it (AC10)', async () => {
    await startGrid(filled)
    await pick('lula', 'tarcisio')
    const before = fetches.length
    clientWidth = 520
    observers.forEach((o) => o.cb())
    flushSync()
    expect(fetches.length).toBe(before)
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('true')
    body = payload(three, [{ a: 'lula', b: 'tarcisio', count: 5 }])
    await change('comentionMin', '5')
    expect(cell('lula', 'tarcisio')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('header and cells share the grid custom properties and pitch arithmetic at 1440 (AC6)', async () => {
    await startGrid(manyPayload, many)
    await resizeTo(1440)
    const l = matrixLayout(many, manyPairs, 1440)
    const g = grid()
    expect(g.style.getPropertyValue('--n')).toBe('27')
    expect(px(g, '--rowhead')).toBe(l.rowhead)
    expect(px(g, '--pitch')).toBe(l.pitch)
    expect(px(g, '--cell')).toBe(l.cellSize)
    expect(px(g, '--gap')).toBe(l.gap)
    expect(px(g, '--pitch')).toBe(px(g, '--cell') + 2 * px(g, '--gap'))
    expect(27 * px(g, '--pitch') + px(g, '--rowhead')).toBe(l.rowhead + 27 * l.pitch)
    expect(l.rowhead + 27 * l.pitch).toBeLessThanOrEqual(1440)
  })

  it('header row and every row have n+1 children and matching column order (AC6)', async () => {
    await startGrid(manyPayload, many)
    await resizeTo(1440)
    const [head, ...body] = rows()
    expect(body).toHaveLength(27)
    expect(head.children).toHaveLength(28)
    body.forEach((row, i) => {
      expect(row.children).toHaveLength(28)
      const name = row.querySelector('.comention-rowhead')!.textContent
      const colhead = head.children[i + 1] as HTMLElement
      expect(colhead.classList.contains('comention-colhead')).toBe(true)
      expect(colhead.getAttribute('title')).toBe(name)
      expect(name).toBe(many[i].name)
      const own = row.children[i + 1] as HTMLElement
      expect(own.classList.contains('is-blank')).toBe(true)
      for (let j = i + 1; j < 27; j++) {
        const c = row.children[j + 1] as HTMLElement
        const pair = manyPairs.find((p) => p.a === many[i].id && p.b === many[j].id)
        expect(c.getAttribute('data-a') ?? null).toBe(pair ? many[i].id : null)
        expect(c.getAttribute('data-b') ?? null).toBe(pair ? many[j].id : null)
        expect(c.classList.contains('comention-cell')).toBe(true)
        expect(head.children[j + 1].getAttribute('title')).toBe(many[j].name)
      }
    })
    expect(cell('p25', 'p26')).not.toBeNull()
    expect(cell('p25', 'p26')!.parentElement).toBe(rows()[26])
  })

  it('below the floor width the pitch still equals cell plus two gaps (AC6)', async () => {
    await startGrid(manyPayload, many)
    await resizeTo(600)
    const l = matrixLayout(many, manyPairs, 600)
    const g = grid()
    expect(px(g, '--cell')).toBe(l.cellSize)
    expect(px(g, '--pitch')).toBe(px(g, '--cell') + 2 * px(g, '--gap'))
    expect(px(g, '--rowhead') + 27 * px(g, '--pitch')).toBe(l.rowhead + 27 * l.pitch)
    expect(rows()[0].children).toHaveLength(28)
  })
})
