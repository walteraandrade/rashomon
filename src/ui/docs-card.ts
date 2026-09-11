// #docsDialog, shared by all three figures. Knows nothing about any figure; takes kicker, title
// and one or two sides in each request. The only path to GET /docs; opens on deliberate click only.

import * as api from './api.js'
import { paintDocs, paintDocsError, paintDocsHead, paintDocsLoading } from './render.js'
import { fromScope, readScope } from './state.js'

export type DocsSide = { personId: string; personName: string; query: URLSearchParams; label?: string }
export type DocsRequest = { kicker: string; title: string; sides: DocsSide[] }

// Guarded: everything here runs after an await; a missing element means the page moved on.
const $ = (id: string): any => (typeof document === 'undefined' ? null : document.getElementById(id))

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

// Below FLOATING_MIN the card falls back to showModal() instead of floating.
const FLOATING_MIN = 760
const floating = () => typeof window !== 'undefined' && !!window.matchMedia?.(`(min-width: ${FLOATING_MIN}px)`).matches

// spot persists across closes so the card reopens where the reader left it.
let spot: { x: number; y: number } | null = null
let isFloating = false
let request: DocsRequest | null = null
let requestId = 0
let controller: AbortController | null = null

export const isOpen = () => !!$('docsDialog')?.open

// Bumps requestId so responses from prior opens are dropped.
const cancel = () => {
  ++requestId
  controller?.abort()
  controller = null
  return requestId
}

export const close = () => {
  cancel()
  const dialog = $('docsDialog')
  if (dialog?.open) dialog.close()
}

const clamp = () => {
  const dialog = $('docsDialog')
  if (!dialog || !spot || !dialog.style || !dialog.getBoundingClientRect) return
  const box = dialog.getBoundingClientRect()
  const maxX = Math.max(8, window.innerWidth - box.width - 8)
  const maxY = Math.max(8, window.innerHeight - box.height - 8)
  spot = { x: Math.min(Math.max(8, spot.x), maxX), y: Math.min(Math.max(8, spot.y), maxY) }
  dialog.style.left = `${spot.x}px`
  dialog.style.top = `${spot.y}px`
}

// `wide` is the two-sided card for the ruler's two-column comparison.
const show = (wide: boolean) => {
  const dialog = $('docsDialog')
  if (!dialog) return
  const float = floating()
  isFloating = float
  dialog.classList.toggle('is-floating', float)
  dialog.classList.toggle('is-wide', wide)
  if (!float && dialog.style) {
    spot = null
    dialog.style.left = ''
    dialog.style.top = ''
  }
  if (!dialog.open) {
    if (float) {
      // Floating card returns focus to prevent stealing keyboard from the map on every click.
      const had = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
      dialog.show?.()
      const now = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
      if (now && now !== had && dialog.contains?.(now)) {
        if (had && had.focus && had !== document.body) had.focus({ preventScroll: true })
        else now.blur?.()
      }
    } else dialog.showModal?.()
  }
  if (float) clamp()
}

// Pointer capture keeps moves coming when the cursor outruns the card.
const startDrag = (e: PointerEvent) => {
  const dialog = $('docsDialog')
  const target = e.target as Element | null
  if (!dialog || !floating() || e.button !== 0) return
  if (target?.closest('button')) return
  const box = dialog.getBoundingClientRect()
  const dx = e.clientX - box.left
  const dy = e.clientY - box.top
  const head = e.currentTarget as HTMLElement
  head.setPointerCapture?.(e.pointerId)
  dialog.classList.add('is-dragging')
  const onMove = (move: PointerEvent) => {
    spot = { x: move.clientX - dx, y: move.clientY - dy }
    clamp()
  }
  const onUp = () => {
    head.removeEventListener('pointermove', onMove as EventListener)
    head.removeEventListener('pointerup', onUp)
    head.removeEventListener('pointercancel', onUp)
    dialog.classList.remove('is-dragging')
  }
  head.addEventListener('pointermove', onMove as EventListener)
  head.addEventListener('pointerup', onUp)
  head.addEventListener('pointercancel', onUp)
  e.preventDefault()
}

// Memo hit paints from scope; miss shows the documents ghost first.
const fetchSide = async (side: DocsSide, signal: AbortSignal) => ({
  label: side.label ?? null,
  data: await fromScope('docs', side.personId + '?' + side.query, () => api.loadDocs(side.personId, side.query, signal)),
})

// req.sides is one entry for a word/person/outlet, two for the ruler (both people at once).
export const open = async (req: DocsRequest) => {
  if (!$('docs')) return
  const id = cancel()
  const current = new AbortController()
  controller = current
  request = req
  paintDocsHead({ kicker: req.kicker, title: req.title })
  show(req.sides.length > 1)
  if (!req.sides.every((side) => readScope('docs', side.personId + '?' + side.query))) paintDocsLoading()
  try {
    const sides = await Promise.all(req.sides.map((side) => fetchSide(side, current.signal)))
    if (id !== requestId || !$('docs')) return
    paintDocs(sides)
  } catch (e) {
    if (id === requestId && !aborted(e) && $('docs')) paintDocsError(() => open(req))
  }
}

// Wired once by app.ts: close button, backdrop, grip, and the resize that swaps floating shape.
export const mountDocsCard = () => {
  const dialog = $('docsDialog')
  if (!dialog) return
  $('docsClose')?.addEventListener('click', () => close())
  // Backdrop click lands on the dialog element itself, never on its children.
  dialog.addEventListener('click', (e: MouseEvent) => {
    if (e.target === dialog) close()
  })
  dialog.addEventListener('close', () => cancel())
  $('docsGrip')?.addEventListener('pointerdown', startDrag as EventListener)
  if (typeof window === 'undefined') return
  let pending: ReturnType<typeof setTimeout> | undefined = undefined
  window.addEventListener('resize', () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      if (!dialog.open || floating() === isFloating || !request) return
      spot = null
      const again = request
      dialog.close()
      open(again)
    }, 150)
  })
}
