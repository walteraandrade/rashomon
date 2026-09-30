// createFigure: the runFigure skeleton (abort/stale/scope/ghost/background-click/Escape/resize)
// as a Svelte 5 helper. Call it during a component's initialisation: its listeners live in an
// $effect, so the component's teardown removes them and aborts the request in flight.

import * as docsCard from './docs-card.svelte.js'
import { span } from './perf.js'
import { debounce, fromScope, readScope } from './state.js'

export type FigureTarget = { addEventListener: (type: string, listener: (event?: unknown) => void, options?: AddEventListenerOptions) => void }

export type FigureOptions<T> = {
  name: string
  scope?: string
  params: () => URLSearchParams | null
  fetch: (params: URLSearchParams, signal: AbortSignal) => Promise<T>
  ghost: () => void
  paint: (data: T) => void
  paintError: (e: unknown) => void
  detail?: (data: T, params: URLSearchParams) => Record<string, string | number | null>
  el?: FigureTarget | FigureTarget[] | (() => FigureTarget | FigureTarget[] | undefined)
  markSelector?: string
  onRelease?: () => void
}

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

export const createFigure = <T>(opts: FigureOptions<T>) => {
  const { name, scope = name, params, fetch, ghost, paint, paintError, detail, onRelease } = opts
  let data = $state.raw<T | undefined>(undefined)
  let loading = $state(false)
  let error = $state.raw<unknown>(null)
  let requestId = 0
  let controller: AbortController | null = null
  let alive = true

  const load = async () => {
    const id = ++requestId
    controller?.abort()
    controller = new AbortController()
    const current = controller
    const p = params()
    if (p === null) {
      loading = false
      return
    }
    const key = p.toString()
    if (!readScope(scope, key)) {
      loading = true
      ghost()
    }
    const painted = span('figure:' + name)
    try {
      const result = await fromScope(scope, key, () => fetch(p, current.signal))
      if (id !== requestId) return
      data = result
      error = null
      loading = false
      paint(result)
      painted({ query: key, ...(detail ? detail(result, p) : {}) })
    } catch (e) {
      if (id !== requestId || aborted(e)) return
      data = undefined
      loading = false
      error = e
      paintError(e)
    }
  }

  const debouncedLoad = debounce(() => {
    if (alive) void load()
  })

  const reload = () => {
    loading = true
    if (data !== undefined) ghost()
    debouncedLoad()
  }

  // A no-op while loading: painting old data over a ghost would make it clickable again.
  const repaint = () => {
    if (!loading && data !== undefined) paint(data)
  }

  const release = () => {
    onRelease?.()
    if (docsCard.openedBy(name)) docsCard.close()
  }

  // Keyed on el only: a swapped element rewires listeners and never touches the request.
  $effect(() => {
    const stop = new AbortController()
    // Read here, after mount: a bind:this element is undefined at createFigure() time.
    const el = typeof opts.el === 'function' ? opts.el() : opts.el
    const markSelector = opts.markSelector
    const targets = el ? (Array.isArray(el) ? el : [el]) : []
    if (el) {
      if (markSelector) {
        const onClick = (e?: unknown) => {
          const target = (e as { target?: { closest?: (selector: string) => unknown } } | undefined)?.target
          if (target && target.closest && target.closest(markSelector)) return
          release()
        }
        for (const target of targets) target.addEventListener('click', onClick, { signal: stop.signal })
      }
      document.addEventListener('keydown', (e: KeyboardEvent) => e.key === 'Escape' && release(), { signal: stop.signal })
    }
    let observer: ResizeObserver | null = null
    if (el && typeof ResizeObserver !== 'undefined' && targets[0]) {
      let lastWidth = 0
      const target = targets[0] as unknown as { clientWidth?: number }
      observer = new ResizeObserver(() => {
        const width = target.clientWidth ?? 0
        if (!width || width === lastWidth) return
        lastWidth = width
        repaint()
      })
      observer.observe(targets[0] as unknown as Element)
    }
    return () => {
      stop.abort()
      observer?.disconnect()
    }
  })

  // No dependencies: runs once, and its teardown is the component's real destruction.
  $effect(() => {
    alive = true
    return () => {
      alive = false
      ++requestId
      controller?.abort()
      controller = null
      loading = false
    }
  })

  return {
    get data() {
      return data
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    load,
    reload,
    release,
  }
}
