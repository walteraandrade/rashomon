// DOM layer: painters only — all data and callbacks arrive as parameters.

import {
  fmt,
  html,
  safeDocUrl,
  score,
  foldTestimonyDomains,
  testimonyPosition,
  type CompareSide,
  type CompareTerm,
  type Doc,
  type Measure,
  type TestimonyDomainRow,
} from './format.js'
import { FONT_MONO, STRIP_MAX_HEIGHT, STRIP_MIN_R, STRIP_PAD, stripRadius, swarm } from './layout.js'

export { STRIP_PAD }

// Callers read per-element fields (~100 sites), so this stays `any`.
const $ = (id: string): any => document.getElementById(id)

// The only place that touches a <canvas>; layout.ts stays DOM-free and testable without it.
export const createCanvasMeasure = (): Measure => {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  return (text, size, family = FONT_MONO, weight = 500) => {
    ctx.font = `${weight} ${size}px ${family}`
    const m = ctx.measureText(text)
    return Math.max(m.width, Math.abs(m.actualBoundingBoxLeft || 0) + Math.abs(m.actualBoundingBoxRight || 0))
  }
}

const ghostBar = (cls: string) => html`<span class="ghost ${cls}"></span>`

export const stripLayout = (rows: TestimonyDomainRow[], width: number) => {
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  const x = (score: number) => STRIP_PAD + (testimonyPosition(score) / 100) * inner
  const folded = foldTestimonyDomains(rows).map((d) => ({ ...d, x: x(d.score), r: stripRadius(d.n, width) }))
  const smallest = folded.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  const attempt = (k: number) => {
    const dots = swarm(folded.map((d) => ({ ...d, r: d.r * k })))
    const reach = dots.reduce((m, d) => Math.max(m, Math.abs(d.y) + d.r), 0)
    return { dots, half: Math.max(44, Math.ceil(reach) + 6) }
  }
  let fit = attempt(scale)
  while (fit.half * 2 > STRIP_MAX_HEIGHT && scale > floor) {
    scale = Math.max(floor, scale * 0.92)
    fit = attempt(scale)
  }
  return { dots: fit.dots, x, half: fit.half, height: fit.half * 2, width, scale }
}

export const paintDocsLoading = () => {
  const box = $('docs')
  if (!box) return
  box.setAttribute('aria-busy', 'true')
  box.innerHTML = html`<div class="ghost-field" aria-hidden="true">${[0, 1, 2].map(
    () => html`<article class="doc">${ghostBar('ghost-doc-kicker')}${ghostBar('ghost-doc-line')}${ghostBar('ghost-doc-line is-short')}</article>`,
  )}</div><p class="sr-only">Lendo os documentos.</p>`
}

export const paintDocsHead = ({ kicker, title }: { kicker: string; title: string }) => {
  if ($('docsKicker')) $('docsKicker').textContent = kicker
  if ($('docsTitle')) $('docsTitle').textContent = title
}

const docMarkup = (d: Doc) => {
  const href = safeDocUrl(d)
  return html`<article class="doc"><p class="eyebrow">${d.domain || d.source}</p><p>${d.text}</p>${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>` : ''}</article>`
}

export type DocsSideData = { label: string | null; data: { docs: Doc[]; total: number } }

const sideMarkup = ({ label: name, data }: DocsSideData) =>
  html`${name ? html`<p class="eyebrow docs-side-name">${name}</p>` : ''}${data.docs.length ? html`<p class="docs-summary">Mostrando ${data.docs.length} de ${fmt(data.total)} documentos.</p>${data.docs.map(docMarkup)}` : html`<p>Nenhum documento encontrado.</p>`}`

export const paintDocs = (sides: DocsSideData[]) => {
  const box = $('docs')
  if (!box) return
  box.setAttribute('aria-busy', 'false')
  box.innerHTML = sides.length > 1 ? html`<div class="docs-columns">${sides.map((side) => html`<div>${sideMarkup(side)}</div>`)}</div>` : sides[0] ? sideMarkup(sides[0]) : '<p>Nenhum documento encontrado.</p>'
}

export const paintDocsError = (onRetry: () => void) => {
  const box = $('docs')
  if (!box) return
  box.setAttribute('aria-busy', 'false')
  box.innerHTML = '<p>Não foi possível carregar documentos. <button class="quiet-button" id="retryDocs">Tentar novamente</button></p>'
  $('retryDocs')?.addEventListener('click', onRetry)
}

// `null` is structurally absent; when both sides are present, clamped-positive pulls keep opposite-signed terms short of the ends.
const isPresent = (v: CompareSide | 'name' | null): v is CompareSide => v !== null && v !== 'name'

const docsOf = (v: CompareSide | 'name' | null) => (v && v !== 'name' ? v.count : 0)

export type RulerTerm = CompareTerm & { balance: number; combined: number }

export const rulerTerms = (terms: CompareTerm[], measure: string): { items: RulerTerm[]; hiddenCount: number } => {
  let hiddenCount = 0
  const items: RulerTerm[] = []
  for (const t of terms) {
    if (t.a === 'name' || t.b === 'name') {
      hiddenCount++
      continue
    }
    const aPresent = isPresent(t.a)
    const bPresent = isPresent(t.b)
    let balance = 0
    if (aPresent !== bPresent) {
      balance = aPresent ? -1 : 1
    } else if (aPresent && bPresent) {
      const rawA = score(t.a as CompareSide, measure)
      const rawB = score(t.b as CompareSide, measure)
      const mag = Math.abs(rawA) + Math.abs(rawB)
      balance = mag === 0 ? 0 : Math.max(-1, Math.min(1, (Math.max(0, rawB) - Math.max(0, rawA)) / mag))
    }
    items.push({ ...t, balance, combined: docsOf(t.a) + docsOf(t.b) })
  }
  return { items, hiddenCount }
}
