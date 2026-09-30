// #docsDialog, shared by every figure: takes kicker, title, one or two sides and the opener's
// name per request. The only path to GET /docs; opens on deliberate click only. State lives
// here; DocsCard.svelte owns the dialog element and every listener.

import { createSubscriber } from 'svelte/reactivity'
import * as api from './api.js'
import { paintDocs, paintDocsError, paintDocsHead, paintDocsLoading } from './docs-paint.js'
import { span } from './perf.js'
import { fromScope, readScope } from './state.js'

export type DocsSide = { personId: string; personName: string; query: URLSearchParams; label?: string }
export type DocsRequest = { kicker: string; title: string; sides: DocsSide[]; owner?: string }

type Spot = { x: number; y: number }

type Store = {
  request: DocsRequest | null
  sides: DocsSide[]
  isOpen: boolean
  isFloating: boolean
  spot: Spot | null
}

// What the component renders from. `spot` persists across closes so the card reopens where it
// was. createSubscriber, not a rune, so plain node:test suites still load this module.
const store: Store = { request: null, sides: [], isOpen: false, isFloating: false, spot: null }
let bump = () => {}
const subscribe = createSubscriber((update) => {
  bump = update
  return () => {
    bump = () => {}
  }
})
const set = (patch: Partial<Store>) => {
  Object.assign(store, patch)
  bump()
}

export const card: Readonly<Pick<Store, 'sides' | 'isOpen' | 'isFloating' | 'spot'>> = {
  get sides() {
    subscribe()
    return store.sides
  },
  get isOpen() {
    subscribe()
    return store.isOpen
  },
  get isFloating() {
    subscribe()
    return store.isFloating
  },
  get spot() {
    subscribe()
    return store.spot
  },
}

const FLOATING_MIN = 760
const floating = () => typeof window !== 'undefined' && (window.innerWidth ?? 0) >= FLOATING_MIN

let mounted: HTMLDialogElement | null = null
// The mounted component's element, or the page's own #docsDialog when none is mounted (a stand-in
// document in the figures' suites); guarded because everything here runs after an await.
const find = (): any => mounted ?? (typeof document === 'undefined' ? null : document.getElementById('docsDialog'))
let requestId = 0
let controller: AbortController | null = null

const body = () => (typeof document === 'undefined' ? null : document.getElementById('docs'))

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

export const attach = (el: HTMLDialogElement | null) => {
  mounted = el
}

export const isOpen = () => store.isOpen

// True while the open card is the one `owner` asked for; `selected` alone never says whose it is.
export const openedBy = (owner: string) => store.isOpen && store.request?.owner === owner

const cancel = () => {
  ++requestId
  controller?.abort()
  controller = null
  return requestId
}

export const close = () => {
  const dialog = find()
  cancel()
  set({ isOpen: false })
  if (dialog?.open) dialog.close()
}

// The native close event (Escape, backdrop); a resize-driven reopen must not cancel the new request.
export const onNativeClose = () => {
  const dialog = find()
  if (dialog?.open) return
  cancel()
  set({ isOpen: false })
}

const clamp = () => {
  const dialog = find()
  if (!dialog || !store.spot) return
  if (!dialog.getBoundingClientRect) return
  const box = dialog.getBoundingClientRect()
  const maxX = Math.max(8, window.innerWidth - box.width - 8)
  const maxY = Math.max(8, window.innerHeight - box.height - 8)
  set({ spot: { x: Math.min(Math.max(8, store.spot.x), maxX), y: Math.min(Math.max(8, store.spot.y), maxY) } })
}

const show = () => {
  const dialog = find()
  if (!dialog) return
  const float = floating()
  set({ isFloating: float, ...(float ? {} : { spot: null }) })
  dialog.classList?.toggle('is-floating', float)
  if (!dialog.open) {
    if (float) {
      // Floating card returns focus to prevent stealing keyboard from the map on every click.
      const had = document.activeElement as HTMLElement | null
      dialog.show?.()
      const now = document.activeElement as HTMLElement | null
      if (now && now !== had && dialog.contains?.(now)) {
        if (had && had.focus && had !== document.body) had.focus({ preventScroll: true })
        else now.blur?.()
      }
    } else dialog.showModal?.()
  }
  if (float) clamp()
}

// Pointer capture keeps moves coming when the cursor outruns the card.
export const startDrag = (e: PointerEvent) => {
  const dialog = find()
  const target = e.target as Element | null
  if (!dialog || !floating() || e.button !== 0) return
  if (target?.closest('button')) return
  if (!dialog.getBoundingClientRect) return
  const box = dialog.getBoundingClientRect()
  const dx = e.clientX - box.left
  const dy = e.clientY - box.top
  const head = e.currentTarget as HTMLElement
  const held = dialog
  head.setPointerCapture?.(e.pointerId)
  held.classList.add('is-dragging')
  const onMove = (move: PointerEvent) => {
    set({ spot: { x: move.clientX - dx, y: move.clientY - dy } })
    clamp()
  }
  const onUp = () => {
    head.removeEventListener('pointermove', onMove as EventListener)
    head.removeEventListener('pointerup', onUp)
    head.removeEventListener('pointercancel', onUp)
    held.classList.remove('is-dragging')
  }
  head.addEventListener('pointermove', onMove as EventListener)
  head.addEventListener('pointerup', onUp)
  head.addEventListener('pointercancel', onUp)
  e.preventDefault()
}

// Crossing FLOATING_MIN with the card open: reopen in the other mode, keeping the request.
export const onResize = () => {
  const dialog = find()
  if (!dialog?.open || floating() === store.isFloating || !store.request) return
  set({ spot: null })
  const again = store.request
  dialog.close()
  void open(again)
}

// Memo hit paints from scope; miss shows the documents ghost first.
const fetchSide = async (side: DocsSide, signal: AbortSignal) => ({
  label: side.label ?? null,
  data: await fromScope('docs', side.personId + '?' + side.query, () => api.loadDocs(side.personId, side.query, signal)),
})

// req.sides is one entry for a word/person/outlet, two for the ruler (both people at once).
export const open = async (req: DocsRequest) => {
  const id = cancel()
  set({ request: req, sides: req.sides, isOpen: true })
  const found = find()
  if (!found) return
  found.classList?.toggle('is-wide', req.sides.length === 2)
  paintDocsHead({ kicker: req.kicker, title: req.title })
  const current = new AbortController()
  controller = current
  show()
  const cached = req.sides.every((side) => readScope('docs', side.personId + '?' + side.query))
  if (!cached) paintDocsLoading()
  const painted = span('figure:docs')
  try {
    const sides = await Promise.all(req.sides.map((side) => fetchSide(side, current.signal)))
    if (id !== requestId || !body()) return
    paintDocs(sides)
    // Two sides are two api:docs in Promise.all: this is max(api, api) + paint, not one subtraction.
    painted({ sides: sides.length, urls: req.sides.map((side) => api.endpoint(side.personId) + '/docs?' + side.query).join(' ') })
  } catch (e) {
    if (id === requestId && !aborted(e) && body()) {
      paintDocsError(() => open(req))
    }
  }
}
