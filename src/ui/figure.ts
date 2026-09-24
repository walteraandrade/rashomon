// The abort/stale/scope/ghost/background-click/Escape/resize skeleton every figure but the
// atlas hand-wrote. Sits between docs-card.ts and figures/*.ts in the import order.

import * as docsCard from './docs-card.js'
import { span } from './perf.js'
import { debounce, fromScope, readScope } from './state.js'

export type FigureHandle = {
  load: () => Promise<void>
  reload: () => void
  repaint: () => void
  release: () => void
}

// Structural, not the DOM lib's Element, so a bare { addEventListener } stub still satisfies it.
export type FigureTarget = { addEventListener: (type: string, listener: (event?: unknown) => void) => void }

export type FigureOptions<T> = {
  name: string
  scope?: string
  params: () => URLSearchParams | null
  fetch: (params: URLSearchParams, signal: AbortSignal) => Promise<T>
  ghost: () => void
  paint: (data: T) => void
  paintError: (e: unknown) => void
  detail?: (data: T, params: URLSearchParams) => Record<string, string | number | null>
  el?: FigureTarget | FigureTarget[]
  markSelector?: string
  onRelease?: () => void
}

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

export const runFigure = <T>(opts: FigureOptions<T>): FigureHandle => {
  const { name, scope = name, params, fetch, ghost, paint, paintError, detail, el, markSelector, onRelease } = opts
  let requestId = 0
  let controller: AbortController | null = null
  let hasData = false
  let lastData: T | undefined

  const load = async () => {
    const id = ++requestId
    controller?.abort()
    controller = new AbortController()
    const current = controller
    const p = params()
    if (p === null) return
    const key = p.toString()
    if (!readScope(scope, key)) ghost()
    const painted = span('figure:' + name)
    try {
      const data = await fromScope(scope, key, () => fetch(p, current.signal))
      if (id !== requestId) return
      hasData = true
      lastData = data
      paint(data)
      painted({ query: key, ...(detail ? detail(data, p) : {}) })
    } catch (e) {
      if (id !== requestId) return
      if (aborted(e)) return
      hasData = false
      lastData = undefined
      paintError(e)
    }
  }

  const reload = debounce(load)

  // Never gates on in-flight state: a resize mid-reload must still repaint the on-screen data.
  const repaint = () => {
    if (hasData) paint(lastData as T)
  }

  const release = () => {
    onRelease?.()
    if (docsCard.openedBy(name)) docsCard.close()
  }

  if (el) {
    const targets = Array.isArray(el) ? el : [el]
    if (markSelector) {
      const onClick = (e?: unknown) => {
        const target = (e as { target?: { closest?: (selector: string) => unknown } } | undefined)?.target
        if (target && target.closest && target.closest(markSelector)) return
        release()
      }
      for (const target of targets) target.addEventListener('click', onClick)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') release()
      })
    }
    if (typeof ResizeObserver !== 'undefined' && targets[0]) {
      let lastWidth = 0
      const target = targets[0] as unknown as { clientWidth?: number }
      new ResizeObserver(() => {
        const width = target.clientWidth ?? 0
        if (!width || width === lastWidth) return
        lastWidth = width
        repaint()
      }).observe(targets[0] as unknown as Element)
    }
  }

  return { load, reload, repaint, release }
}
