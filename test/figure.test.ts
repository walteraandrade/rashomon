// Issue #193: runFigure's own contract — abort/stale/scope/ghost/background-click/Escape/resize
// — tested in isolation from any real figure module, against a minimal DOM double.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { clearScopes, writeScope } from '../src/ui/state.js'
import * as docsCard from '../src/ui/docs-card.js'

class FakeEl {
  _listeners: Record<string, ((e?: unknown) => void)[]> = {}
  attributes: Record<string, string> = {}
  classes: Record<string, boolean> = {}
  clientWidth = 100
  classList = {
    add: (n: string) => (this.classes[n] = true),
    remove: (n: string) => (this.classes[n] = false),
    toggle: (n: string, on?: boolean) => (this.classes[n] = on ?? !this.classes[n]),
  }
  open = false
  html = ''
  get innerHTML() {
    return this.html
  }
  set innerHTML(v: string) {
    this.html = String(v)
  }
  setAttribute(n: string, v: string) {
    this.attributes[n] = v
  }
  getAttribute(n: string) {
    return this.attributes[n] ?? null
  }
  style: Record<string, string> = {}
  addEventListener(type: string, fn: (e?: unknown) => void) {
    ;(this._listeners[type] ??= []).push(fn)
  }
  removeEventListener() {}
  fire(type: string, e?: unknown) {
    for (const fn of [...(this._listeners[type] ?? [])]) fn(e)
  }
  show() {
    this.open = true
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
    this.fire('close')
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 }
  }
}

// A click target that reports whether it lives inside markSelector.
const targetOutside = () => ({ closest: () => null })
const targetInside = () => ({ closest: () => ({}) })

class FakeResizeObserver {
  cb: (entries: unknown[]) => void
  observed: unknown[] = []
  constructor(cb: (entries: unknown[]) => void) {
    this.cb = cb
  }
  observe(el: unknown) {
    this.observed.push(el)
  }
  disconnect() {}
  trigger() {
    this.cb([])
  }
}

let els: Record<string, FakeEl>
let docListeners: Record<string, ((e?: unknown) => void)[]>
let resizeObservers: FakeResizeObserver[]
let previous: { document: unknown; ResizeObserver: unknown; fetch: unknown }

const setupDom = () => {
  els = {
    docsDialog: new FakeEl(),
    docs: new FakeEl(),
    docsKicker: new FakeEl(),
    docsTitle: new FakeEl(),
    docsClose: new FakeEl(),
    docsGrip: new FakeEl(),
    host: new FakeEl(),
  }
  docListeners = {}
  resizeObservers = []
  const fakeDocument = {
    getElementById: (id: string) => els[id] ?? null,
    addEventListener: (type: string, fn: (e?: unknown) => void) => {
      ;(docListeners[type] ??= []).push(fn)
    },
    removeEventListener: () => {},
  }
  previous = {
    document: (globalThis as { document?: unknown }).document,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
    fetch: globalThis.fetch,
  }
  ;(globalThis as { document?: unknown }).document = fakeDocument
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(cb: (entries: unknown[]) => void) {
      const instance = new FakeResizeObserver(cb)
      resizeObservers.push(instance)
      return instance as unknown as FakeResizeObserver
    }
  }
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ docs: [], total: 0 }) })) as unknown as typeof fetch
}

const teardownDom = () => {
  ;(globalThis as { document?: unknown }).document = previous.document
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = previous.ResizeObserver
  globalThis.fetch = previous.fetch as typeof fetch
}

const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms))

describe('figure.ts: runFigure abort/stale/scope/ghost/background/Escape/resize runtime', () => {
  before(() => clearScopes())
  after(() => clearScopes())

  it('a second load aborts the first and paints only the second', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      const painted: string[] = []
      let n = 0
      const handle = runFigure<string>({
        name: 'ac3',
        params: () => new URLSearchParams({ n: String(++n) }),
        fetch: (params, signal) =>
          new Promise((resolve, reject) => {
            const value = params.get('n')!
            const timer = setTimeout(() => resolve('result-' + value), value === '1' ? 40 : 5)
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
        ghost: () => {},
        paint: (data) => painted.push(data),
        paintError: () => painted.push('error'),
      })
      const first = handle.load()
      const second = handle.load()
      await Promise.all([first, second])
      await flush(60)
      assert.deepEqual(painted, ['result-2'])
    } finally {
      teardownDom()
    }
  })

  it('a stale resolved response is dropped, neither paint nor paintError', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let calls = 0
      const painted: unknown[] = []
      const errored: unknown[] = []
      const handle = runFigure<string>({
        name: 'ac4',
        params: () => new URLSearchParams({ c: String(++calls) }),
        fetch: () => (calls === 1 ? new Promise((resolve) => setTimeout(() => resolve('slow'), 30)) : Promise.resolve('fast')),
        ghost: () => {},
        paint: (d) => painted.push(d),
        paintError: (e) => errored.push(e),
      })
      const p1 = handle.load()
      const p2 = handle.load()
      await Promise.all([p1, p2])
      await flush(60)
      assert.deepEqual(painted, ['fast'])
      assert.equal(errored.length, 0)
    } finally {
      teardownDom()
    }
  })

  it('a stale rejected response is dropped', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let calls = 0
      const errored: unknown[] = []
      const painted: unknown[] = []
      const handle = runFigure<string>({
        name: 'ac4b',
        params: () => new URLSearchParams({ c: String(++calls) }),
        fetch: () => (calls === 1 ? new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 30)) : Promise.resolve('fast')),
        ghost: () => {},
        paint: (d) => painted.push(d),
        paintError: (e) => errored.push(e),
      })
      const p1 = handle.load()
      const p2 = handle.load()
      await Promise.all([p1, p2])
      await flush(60)
      assert.deepEqual(painted, ['fast'])
      assert.equal(errored.length, 0)
    } finally {
      teardownDom()
    }
  })

  it('an aborted rejection is dropped, not painted as an error', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      const errored: unknown[] = []
      const handle = runFigure<string>({
        name: 'ac-abort',
        params: () => new URLSearchParams({ x: '1' }),
        fetch: (_params, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
        ghost: () => {},
        paint: () => {},
        paintError: (e) => errored.push(e),
      })
      const p1 = handle.load()
      handle.load()
      await Promise.allSettled([p1])
      await flush(20)
      assert.equal(errored.length, 0)
    } finally {
      teardownDom()
    }
  })

  it('readScope hit skips the ghost, miss paints it first', async () => {
    setupDom()
    try {
      writeScope('ac5', new URLSearchParams({ hit: '1' }).toString(), 'cached')
      const { runFigure } = await import('../src/ui/figure.js')
      const ghosted: string[] = []
      const paintedHit: unknown[] = []
      const hitHandle = runFigure<string>({
        name: 'ac5',
        params: () => new URLSearchParams({ hit: '1' }),
        fetch: () => Promise.resolve('fresh-should-not-be-used'),
        ghost: () => ghosted.push('hit-ghost'),
        paint: (d) => paintedHit.push(d),
        paintError: () => {},
      })
      await hitHandle.load()
      assert.deepEqual(ghosted, [])
      assert.deepEqual(paintedHit, ['cached'])

      const missGhosted: string[] = []
      const missHandle = runFigure<string>({
        name: 'ac5',
        params: () => new URLSearchParams({ hit: '2' }),
        fetch: () => Promise.resolve('fresh'),
        ghost: () => missGhosted.push('miss-ghost'),
        paint: () => {},
        paintError: () => {},
      })
      await missHandle.load()
      assert.deepEqual(missGhosted, ['miss-ghost'])
    } finally {
      teardownDom()
    }
  })

  it('params() returning null skips fetch, ghost and paint entirely', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      const calls: string[] = []
      const handle = runFigure<string>({
        name: 'ac-null',
        params: () => null,
        fetch: () => {
          calls.push('fetch')
          return Promise.resolve('x')
        },
        ghost: () => calls.push('ghost'),
        paint: () => calls.push('paint'),
        paintError: () => calls.push('error'),
      })
      await handle.load()
      assert.deepEqual(calls, [])
    } finally {
      teardownDom()
    }
  })

  it('a background click or Escape outside markSelector releases and calls onRelease', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let released = 0
      const handle = runFigure<string>({
        name: 'owner-a',
        params: () => new URLSearchParams(),
        fetch: () => Promise.resolve('ok'),
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
        el: els.host,
        markSelector: '[data-term]',
        onRelease: () => released++,
      })
      void handle
      els.host.fire('click', { target: targetOutside() })
      assert.equal(released, 1)

      docListeners.keydown?.forEach((fn) => fn({ key: 'Escape' }))
      assert.equal(released, 2)
    } finally {
      teardownDom()
    }
  })

  it('a click on markSelector does not release', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let released = 0
      runFigure<string>({
        name: 'owner-b',
        params: () => new URLSearchParams(),
        fetch: () => Promise.resolve('ok'),
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
        el: els.host,
        markSelector: '[data-term]',
        onRelease: () => released++,
      })
      els.host.fire('click', { target: targetInside() })
      assert.equal(released, 0)
    } finally {
      teardownDom()
    }
  })

  it('release closes the docs card only when openedBy(name) is true', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      docsCard.open({
        kicker: 'k',
        title: 't',
        owner: 'owner-x',
        sides: [{ personId: 'p1', personName: 'P1', query: new URLSearchParams() }],
      })
      await flush(20)
      assert.equal(docsCard.openedBy('owner-x'), true)

      const handleOther = runFigure<string>({
        name: 'owner-y',
        params: () => new URLSearchParams(),
        fetch: () => Promise.resolve('ok'),
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
        el: els.host,
        markSelector: '[data-term]',
        onRelease: () => {},
      })
      handleOther.release()
      assert.equal(els.docsDialog.open, true, 'a different owner must not close the card')

      const handleOwner = runFigure<string>({
        name: 'owner-x',
        params: () => new URLSearchParams(),
        fetch: () => Promise.resolve('ok'),
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
        el: els.host,
        markSelector: '[data-term]',
        onRelease: () => {},
      })
      handleOwner.release()
      assert.equal(els.docsDialog.open, false, 'the owning figure must close its own card')
    } finally {
      teardownDom()
    }
  })

  it('a width change on el calls repaint without refetching', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let fetches = 0
      let repaints = 0
      const handle = runFigure<string>({
        name: 'ac9',
        params: () => new URLSearchParams(),
        fetch: () => {
          fetches++
          return Promise.resolve('ok')
        },
        ghost: () => {},
        paint: () => repaints++,
        paintError: () => {},
        el: els.host,
      })
      await handle.load()
      assert.equal(fetches, 1)
      assert.equal(repaints, 1)
      resizeObservers[0].trigger()
      assert.equal(fetches, 1, 'a resize must never refetch')
      assert.equal(repaints, 2, 'a resize repaints from the last successful result')
    } finally {
      teardownDom()
    }
  })

  it('a resize callback with an unchanged width does not repaint (gap 2)', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let repaints = 0
      const handle = runFigure<string>({
        name: 'ac-resize-nochange',
        params: () => new URLSearchParams(),
        fetch: () => Promise.resolve('ok'),
        ghost: () => {},
        paint: () => repaints++,
        paintError: () => {},
        el: els.host,
      })
      await handle.load()
      assert.equal(repaints, 1)
      resizeObservers[0].trigger()
      assert.equal(repaints, 2, 'the first callback establishes the observed width and repaints')
      resizeObservers[0].trigger()
      assert.equal(repaints, 2, 'a callback reporting the same clientWidth again must not repaint')
    } finally {
      teardownDom()
    }
  })

  it('the fromScope/readScope bucket is `scope`, defaulting to `name`, so a memo hit records `api:<scope>` (gap 3)', async () => {
    setupDom()
    try {
      writeScope('sources', new URLSearchParams({ x: '1' }).toString(), 'cached-rows')
      const { runFigure } = await import('../src/ui/figure.js')
      const painted: unknown[] = []
      const handle = runFigure<string>({
        name: 'outlets',
        scope: 'sources',
        params: () => new URLSearchParams({ x: '1' }),
        fetch: () => Promise.reject(new Error('must not fetch on a scope hit')),
        ghost: () => {},
        paint: (d) => painted.push(d),
        paintError: () => {},
      })
      await handle.load()
      assert.deepEqual(painted, ['cached-rows'])
      const before = performance.getEntriesByType('measure').length
      await handle.load()
      const marks = performance.getEntriesByType('measure').slice(before)
      assert.ok(marks.some((m) => m.name === 'api:sources'), 'a memo hit must record api:<scope>, not api:<name>')
      assert.ok(!marks.some((m) => m.name === 'api:outlets'), 'the figure name must not leak into the memo route')
    } finally {
      teardownDom()
    }
  })

  it('a caught error resets hasData/lastData, so a later width change repaints nothing (gap 1)', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let calls = 0
      let paints = 0
      let fetches = 0
      const handle = runFigure<string>({
        name: 'ac-error-reset',
        params: () => new URLSearchParams({ c: String(++calls) }),
        fetch: () => {
          fetches++
          return calls === 1 ? Promise.resolve('first') : Promise.reject(new Error('boom'))
        },
        ghost: () => {},
        paint: () => paints++,
        paintError: () => {},
        el: els.host,
      })
      await handle.load()
      assert.equal(paints, 1)
      await handle.load()
      assert.equal(paints, 1, 'the failed load must not repaint the stale result')
      resizeObservers[0].trigger()
      resizeObservers[0].trigger()
      assert.equal(paints, 1, 'a width change after an error must call neither paint nor fetch')
      assert.equal(fetches, 2, 'the resize itself must never fetch')
    } finally {
      teardownDom()
    }
  })

  it('repaint() still repaints the stale data while a reload is in flight, like a resize crossing a breakpoint mid-load', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let calls = 0
      let resolveB: (v: string) => void = () => {}
      const painted: string[] = []
      const handle = runFigure<string>({
        name: 'ac-loading-guard',
        params: () => new URLSearchParams({ c: String(++calls) }),
        fetch: () => (calls === 1 ? Promise.resolve('A') : new Promise<string>((resolve) => (resolveB = resolve))),
        ghost: () => {},
        paint: (d) => painted.push(d),
        paintError: () => {},
      })
      await handle.load()
      assert.deepEqual(painted, ['A'])
      const loadB = handle.load()
      handle.repaint()
      assert.deepEqual(painted, ['A', 'A'], 'a repaint while B is in flight must still repaint the on-screen A, at the new width')
      resolveB('B')
      await loadB
      assert.deepEqual(painted, ['A', 'A', 'B'])
      handle.repaint()
      assert.deepEqual(painted, ['A', 'A', 'B', 'B'], 'repaint() keeps working once the in-flight fetch has settled')
    } finally {
      teardownDom()
    }
  })

  it('reload is debounced; two rapid calls yield one load', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let fetches = 0
      const handle = runFigure<string>({
        name: 'ac-debounce',
        params: () => new URLSearchParams(),
        fetch: () => {
          fetches++
          return Promise.resolve('ok')
        },
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
      })
      handle.reload()
      handle.reload()
      await flush(250)
      assert.equal(fetches, 1)
    } finally {
      teardownDom()
    }
  })

  it('an optional detail(data, params) is merged into the figure:<name> span close (gap 5)', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      const handle = runFigure<{ rows: number }>({
        name: 'ac-detail',
        params: () => new URLSearchParams({ person: 'lula' }),
        fetch: () => Promise.resolve({ rows: 3 }),
        ghost: () => {},
        paint: () => {},
        paintError: () => {},
        detail: (data, params) => ({ person: params.get('person'), rows: data.rows }),
      })
      const before = performance.getEntriesByType('measure').filter((m) => m.name === 'figure:ac-detail').length
      await handle.load()
      const marks = performance.getEntriesByType('measure').filter((m) => m.name === 'figure:ac-detail')
      assert.equal(marks.length, before + 1)
      const last = marks[marks.length - 1] as PerformanceMeasure
      assert.equal((last.detail as Record<string, unknown>).person, 'lula')
      assert.equal((last.detail as Record<string, unknown>).rows, 3)
      assert.equal((last.detail as Record<string, unknown>).query, 'person=lula')
    } finally {
      teardownDom()
    }
  })

  it('repaint() re-paints from the last successful result with no fetch', async () => {
    setupDom()
    try {
      const { runFigure } = await import('../src/ui/figure.js')
      let fetches = 0
      let paints = 0
      const handle = runFigure<string>({
        name: 'ac-repaint',
        params: () => new URLSearchParams(),
        fetch: () => {
          fetches++
          return Promise.resolve('ok')
        },
        ghost: () => {},
        paint: () => paints++,
        paintError: () => {},
      })
      await handle.load()
      assert.equal(fetches, 1)
      assert.equal(paints, 1)
      handle.repaint()
      assert.equal(fetches, 1)
      assert.equal(paints, 2)
    } finally {
      teardownDom()
    }
  })
})
