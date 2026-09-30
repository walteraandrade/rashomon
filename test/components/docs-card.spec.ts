import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import DocsCard from '../../src/ui/DocsCard.svelte'
import { close, isOpen, mountDocsCard, open, openedBy } from '../../src/ui/docs-card.svelte.js'
import { clearScopes } from '../../src/ui/state.js'

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let calls: { url: string; signal?: AbortSignal; resolve: (body: unknown) => void; fail: () => void }[]

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
const doc = (text: string) => ({ docs: [{ source: 'rss', domain: 'g1.globo.com', text, url: 'https://g1.globo.com/a' }], total: 1 })
const side = (q: string, id = 'p1') => ({ personId: id, personName: 'Pessoa', query: new URLSearchParams(q) })
const req = (sides = [side('term=a')], owner = 'atlas') => ({ kicker: 'Documentos', title: 'Título', sides, owner })
const dialog = () => document.getElementById('docsDialog') as HTMLDialogElement
const body = () => document.getElementById('docs')!

const mountCard = () => {
  instance = mount(DocsCard, { target })
  mountDocsCard()
  flushSync()
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
  flushSync()
}

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  setWidth(1024)
  calls = []
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const entry = {
          url,
          signal: init?.signal,
          resolve: (b: unknown) => resolve({ ok: true, status: 200, headers: new Headers(), json: async () => b }),
          fail: () => reject(new Error('boom')),
        }
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        calls.push(entry)
      }),
    ),
  )
})

afterEach(() => {
  close()
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DocsCard', () => {
  it('opens and closes through the imperative api', async () => {
    mountCard()
    expect(isOpen()).toBe(false)
    const p = open(req())
    calls[0].resolve(doc('um texto'))
    await p
    await settle()
    expect(isOpen()).toBe(true)
    expect(openedBy('atlas')).toBe(true)
    expect(openedBy('compare')).toBe(false)
    expect(body().textContent).toContain('um texto')
    close()
    flushSync()
    expect(isOpen()).toBe(false)
    expect(openedBy('atlas')).toBe(false)
  })

  it('ignores a stale response', async () => {
    mountCard()
    const first = open(req([side('term=a')]))
    const second = open(req([side('term=b')]))
    calls[1].resolve(doc('novo'))
    await second
    calls[0].resolve(doc('velho'))
    await first
    await settle()
    expect(body().textContent).toContain('novo')
    expect(body().textContent).not.toContain('velho')
  })

  it('floats at 760 and is modal below', async () => {
    mountCard()
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const show = vi.spyOn(HTMLDialogElement.prototype, 'show')
    setWidth(759)
    void open(req([side('term=m')]))
    await settle()
    expect(modal).toHaveBeenCalledTimes(1)
    expect(dialog().classList.contains('is-floating')).toBe(false)
    close()
    flushSync()
    setWidth(760)
    void open(req([side('term=f')]))
    await settle()
    expect(show).toHaveBeenCalledTimes(1)
    expect(dialog().classList.contains('is-floating')).toBe(true)
    vi.restoreAllMocks()
  })

  it('switches mode on resize while open', async () => {
    mountCard()
    setWidth(1024)
    const p = open(req())
    calls[0].resolve(doc('conteudo'))
    await p
    await settle()
    expect(dialog().classList.contains('is-floating')).toBe(true)
    setWidth(700)
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(400)
    flushSync()
    await settle()
    expect(isOpen()).toBe(true)
    expect(dialog().classList.contains('is-floating')).toBe(false)
    expect(body().textContent).toContain('conteudo')
    setWidth(900)
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(400)
    await settle()
    expect(dialog().classList.contains('is-floating')).toBe(true)
    expect(body().textContent).toContain('conteudo')
  })

  it('drag clamps to the viewport', async () => {
    mountCard()
    setWidth(1024)
    const p = open(req())
    calls[0].resolve(doc('x'))
    await p
    await settle()
    const grip = document.getElementById('docsGrip')!
    const pointer = (type: string, x: number, y: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as any
      Object.assign(e, { clientX: x, clientY: y, button: 0, pointerId: 1 })
      grip.dispatchEvent(e)
    }
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 99999, 99999)
    flushSync()
    const left = parseFloat(dialog().style.left)
    const top = parseFloat(dialog().style.top)
    expect(left).toBeLessThanOrEqual(window.innerWidth)
    expect(top).toBeLessThanOrEqual(window.innerHeight)
    pointer('pointermove', -5000, -5000)
    flushSync()
    expect(parseFloat(dialog().style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(dialog().style.top)).toBeGreaterThanOrEqual(0)
    pointer('pointerup', 0, 0)
  })

  it('two sides are wide with two columns', async () => {
    mountCard()
    const two = open(req([side('term=a', 'p1'), side('term=a', 'p2')]))
    calls[0].resolve(doc('um'))
    calls[1].resolve(doc('dois'))
    await two
    await settle()
    expect(dialog().classList.contains('is-wide')).toBe(true)
    expect(body().querySelectorAll('.docs-columns > div')).toHaveLength(2)
    close()
    flushSync()
    const one = open(req([side('term=z')]))
    calls[2].resolve(doc('so um'))
    await one
    await settle()
    expect(dialog().classList.contains('is-wide')).toBe(false)
    expect(body().querySelector('.docs-columns')).toBeNull()
  })

  it('an empty side shows the empty text', async () => {
    mountCard()
    const p = open(req())
    calls[0].resolve({ docs: [], total: 0 })
    await p
    await settle()
    expect(body().textContent).toContain('Nenhum documento encontrado.')
  })

  it('a failed request shows the error text', async () => {
    mountCard()
    const p = open(req())
    calls[0].fail()
    await p
    await settle()
    expect(body().textContent).toContain('Não foi possível carregar documentos.')
  })

  it('native close syncs state', async () => {
    mountCard()
    const p = open(req())
    calls[0].resolve(doc('x'))
    await p
    await settle()
    expect(isOpen()).toBe(true)
    dialog().close()
    flushSync()
    expect(isOpen()).toBe(false)
    expect(openedBy('atlas')).toBe(false)
  })

  it('memoises a side and aborts on close', async () => {
    mountCard()
    const first = open(req([side('term=memo')]))
    calls[0].resolve(doc('memo'))
    await first
    await open(req([side('term=memo')]))
    expect(calls).toHaveLength(1)
    void open(req([side('term=slow')]))
    await settle()
    expect(calls).toHaveLength(2)
    close()
    expect(calls[1].signal?.aborted).toBe(true)
  })

  it('removes its listeners on unmount', () => {
    const adds: [string, unknown, string][] = []
    const removes: [string, unknown][] = []
    for (const [name, host] of [['window', window], ['document', document]] as const) {
      const add = host.addEventListener.bind(host)
      const rem = host.removeEventListener.bind(host)
      vi.spyOn(host, 'addEventListener').mockImplementation(((t: string, f: unknown, o?: unknown) => {
        adds.push([t, f, name])
        return add(t, f as any, o as any)
      }) as any)
      vi.spyOn(host, 'removeEventListener').mockImplementation(((t: string, f: unknown, o?: unknown) => {
        removes.push([t, f])
        return rem(t, f as any, o as any)
      }) as any)
    }
    mountCard()
    mountDocsCard()
    unmount(instance!)
    instance = undefined
    for (const [type, fn] of adds) expect(removes.some(([t, f]) => t === type && f === fn), `${type} listener left behind`).toBe(true)
    vi.restoreAllMocks()
  })

  it('open without a mounted component only sets state', async () => {
    await expect(open(req())).resolves.not.toThrow()
    expect(() => close()).not.toThrow()
    expect(openedBy('nobody')).toBe(false)
  })
})
