// The documents card (#docsDialog), shared by all three figures.
//
// It used to be private to figures/atlas.ts, which was fine while the atlas was the only thing
// that could open it. It cannot stay there now that figure 2 opens an outlet's texts and figure
// 3 opens a word's on both sides at once: each figure has its own sentence, so a card owned by
// figure 1 would answer with figure 1's recorte and label it with figure 1's person -- a lie
// whenever the sentences disagree. So the card lives here, knows nothing about any figure, and
// takes everything it needs in the request: what to call itself, and one or two sides to fetch.
//
// It is still the only path to GET /docs, and still opens on a deliberate click alone.

import * as api from './api.js'
import { paintDocs, paintDocsError, paintDocsHead, paintDocsLoading } from './render.js'
import { fromScope, readScope } from './state.js'

export type DocsSide = { personId: string; personName: string; query: URLSearchParams; label?: string }
export type DocsRequest = { kicker: string; title: string; sides: DocsSide[] }

// Guarded, unlike the figures' own $: everything here runs after an await, and a page (or a
// test) can have moved on by then. A missing document means there is nothing left to paint.
const $ = (id: string): any => (typeof document === 'undefined' ? null : document.getElementById(id))

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

// Below this width the card stops floating: a window the reader has to drag around a phone is
// worse than the centred sheet, so there the dialog goes back to showModal().
const FLOATING_MIN = 760
const floating = () => typeof window !== 'undefined' && !!window.matchMedia?.(`(min-width: ${FLOATING_MIN}px)`).matches

// Where the card sits while floating, in viewport pixels, plus what it is showing and in which
// of its two shapes. The spot survives a close, so a reader who parked the card out of the way
// finds it there again; it is clamped on every open in case the window shrank in between.
let spot: { x: number; y: number } | null = null
let isFloating = false
let request: DocsRequest | null = null
let requestId = 0
let controller: AbortController | null = null

export const isOpen = () => !!$('docsDialog')?.open

// Bumps the id every open and close, so a response that lands after the reader moved on is
// dropped rather than painted over whatever is on screen now.
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

// `wide` is the two-sided card: the ruler's reading needs room for two columns, so the floating
// card grows rather than stacking them, which would have buried the comparison.
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
      // A <dialog> focuses its first control on open. For the modal that is right; for a card
      // that floats over the figure while the reader goes on picking words it is not -- it would
      // take the keyboard away from the map on every click. So the floating card gives focus
      // straight back to whatever had it.
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

// Dragging by the head. Pointer capture keeps the moves coming when the cursor outruns the
// card, and the grip is the head minus its close button, so that one control still takes its
// own clicks.
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

// One side of the card: a memo hit paints straight from the scope, so re-opening the same word
// after a sort change costs nothing. A miss shows the loading copy first.
const fetchSide = async (side: DocsSide, signal: AbortSignal) => ({
  label: side.label ?? null,
  data: await fromScope('docs', side.personId + '?' + side.query, () => api.loadDocs(side.personId, side.query, signal)),
})

// The one path to GET /docs. `req.sides` is one entry for a single reading (a word, a person,
// an outlet) and two for the ruler, which asks the same word of both people at once.
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

// Wired once, by app.ts, because the card is page-wide: the close button, the modal backdrop,
// the grip, and the resize that swaps its shape when the window crosses FLOATING_MIN.
export const mountDocsCard = () => {
  const dialog = $('docsDialog')
  if (!dialog) return
  $('docsClose')?.addEventListener('click', () => close())
  // A click on the backdrop lands on the dialog element itself, never on its children.
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
