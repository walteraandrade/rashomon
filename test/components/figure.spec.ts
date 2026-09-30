import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import FigureProbe from './FigureProbe.svelte'
import { clearScopes } from '../../src/ui/state.js'

type Deferred = { promise: Promise<any>; resolve: (v: any) => void; reject: (e: unknown) => void; signal: AbortSignal }
const deferred = (signal: AbortSignal): Deferred => {
  let resolve!: (v: any) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<any>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject, signal }
}

let target: HTMLElement
let el: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let observers: { cb: () => void; disconnected: boolean }[]
let n = 0

beforeEach(() => {
  vi.useFakeTimers()
  clearScopes()
  observers = []
  ;(globalThis as any).ResizeObserver = class {
    entry: { cb: () => void; disconnected: boolean }
    constructor(cb: () => void) {
      this.entry = { cb, disconnected: false }
      observers.push(this.entry)
    }
    observe() {}
    unobserve() {
      this.entry.disconnected = true
    }
    disconnect() {
      this.entry.disconnected = true
    }
  }
  target = document.createElement('div')
  el = document.createElement('div')
  el.innerHTML = '<span class="mark">m</span><span class="bg">b</span>'
  document.body.append(target, el)
})

afterEach(() => {
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  el.remove()
  vi.useRealTimers()
})

const setup = (over: Record<string, unknown> = {}) => {
  const calls = { ghost: 0, paint: [] as unknown[], paintError: 0, release: 0, fetches: [] as Deferred[] }
  let current = 'a=1'
  const opts = {
    name: `probe${++n}`,
    params: () => new URLSearchParams(current),
    fetch: (_p: URLSearchParams, signal: AbortSignal) => {
      const d = deferred(signal)
      calls.fetches.push(d)
      return d.promise
    },
    ghost: () => void calls.ghost++,
    paint: (d: unknown) => void calls.paint.push(d),
    paintError: () => void calls.paintError++,
    el,
    markSelector: '.mark',
    onRelease: () => void calls.release++,
    ...over,
  }
  let handle: any
  instance = mount(FigureProbe, { target, props: { opts, onHandle: (f: any) => (handle = f) } })
  flushSync()
  return { calls, handle: handle as any, opts, set: (q: string) => (current = q) }
}

const text = (id: string) => target.querySelector(`#${id}`)?.textContent

describe('createFigure', () => {
  it('drops a stale result', async () => {
    const { calls, handle, set } = setup()
    const first = handle.load()
    set('a=2')
    const second = handle.load()
    calls.fetches[1].resolve({ v: 'new' })
    await second
    calls.fetches[0].resolve({ v: 'old' })
    await first
    flushSync()
    expect(handle.data).toEqual({ v: 'new' })
    expect(text('probe-data')).toContain('new')
    expect(calls.paint.some((d: any) => d.v === 'old')).toBe(false)
  })

  it('aborts on reload', async () => {
    const { calls, handle } = setup()
    void handle.load()
    expect(calls.fetches).toHaveLength(1)
    handle.reload()
    await vi.advanceTimersByTimeAsync(300)
    expect(calls.fetches[0].signal.aborted).toBe(true)
    expect(calls.fetches.length).toBeGreaterThan(1)
  })

  it('ghosts only on scope miss', async () => {
    const { calls, handle } = setup()
    const first = handle.load()
    expect(calls.ghost).toBe(1)
    calls.fetches[0].resolve({ v: 1 })
    await first
    await handle.load()
    expect(calls.ghost).toBe(1)
    expect(calls.fetches).toHaveLength(1)
  })

  it('reload sets loading at once when data is on screen', async () => {
    const { calls, handle } = setup()
    const first = handle.load()
    calls.fetches[0].resolve({ v: 1 })
    await first
    flushSync()
    expect(handle.loading).toBe(false)
    handle.reload()
    flushSync()
    expect(handle.loading).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
  })

  it('a caught error clears data before setting error', async () => {
    const { calls, handle } = setup()
    const ok = handle.load()
    calls.fetches[0].resolve({ v: 1 })
    await ok
    handle.reload()
    await vi.advanceTimersByTimeAsync(300)
    calls.fetches[1].reject(new Error('boom'))
    await vi.advanceTimersByTimeAsync(10)
    flushSync()
    expect(handle.data ?? null).toBeNull()
    expect(handle.error).toBeTruthy()
    expect(handle.loading).toBe(false)
  })

  it('escape and outside click release', () => {
    const { calls } = setup()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(calls.release).toBe(1)
    el.querySelector('.bg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.release).toBe(2)
    el.querySelector('.mark')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.release).toBe(2)
  })

  it('width change repaints without fetch', async () => {
    const { calls, handle } = setup()
    const p = handle.load()
    calls.fetches[0].resolve({ v: 1 })
    await p
    const before = calls.paint.length
    let width = 300
    Object.defineProperty(el, 'clientWidth', { get: () => width, configurable: true })
    observers[0].cb()
    expect(calls.paint.length).toBe(before + 1)
    observers[0].cb()
    expect(calls.paint.length).toBe(before + 1)
    width = 500
    observers[0].cb()
    expect(calls.paint.length).toBe(before + 2)
    expect(calls.fetches).toHaveLength(1)
  })

  it('teardown removes listeners', async () => {
    const { calls, handle } = setup()
    void handle.load()
    unmount(instance!)
    instance = undefined
    expect(observers.every((o) => o.disconnected)).toBe(true)
    expect(calls.fetches[0].signal.aborted).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(calls.release).toBe(0)
  })
})
