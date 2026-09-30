// DOM layer: painters only — all data and callbacks arrive as parameters.

import {
  balanceColor,
  fmt,
  html,
  kinds,
  label,
  safeDocUrl,
  score,
  foldTestimonyDomains,
  testimonyPosition,
  isBridge,
  type CompareSide,
  type CompareTerm,
  type Doc,
  type Lenses,
  type Measure,
  type Rising,
  type RisingAbout,
  type RisingTerm,
  type TestimonyDomainRow,
} from './format.js'
import { FONT_MONO, RULER_PAD, STRIP_MAX_HEIGHT, STRIP_MIN_R, STRIP_PAD, rulerLayout, stripRadius, swarm, type RulerItem } from './layout.js'

export { STRIP_PAD }
import { axis, frame, overflowList } from './marks.js'

// getElementById is HTMLElement | null; callers read per-element fields (~100 sites), so this stays `any`.
const $ = (id: string): any => document.getElementById(id)
// Typed as HTMLElement so `dataset` and `classList` are visible without casting.
const queryAll = (selector: string, root: any = document): NodeListOf<HTMLElement> => root.querySelectorAll(selector)

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

// Strip geometry at a given width; exported so tests can assert placement without a DOM.
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

// Two sides for the ruler (one word, both people); one side for every other figure.
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

// `null` is structurally absent: a present-but-negative-PMI side still reads as "this word is
// A's". When both are present, balance uses clamped-positive pulls against the raw combined
// magnitude, so opposite-signed terms settle short of the ends rather than pinning to them.
const isPresent = (v: CompareSide | 'name' | null): v is CompareSide => v !== null && v !== 'name'

const docsOf = (v: CompareSide | 'name' | null) => (v && v !== 'name' ? v.count : 0)

export type RulerTerm = CompareTerm & { balance: number; combined: number }

// Drops own-name terms (counted in hiddenCount) and scores the rest: balance (−1..+1) and
// combined (docs summed, measure-independent). hiddenCount feeds #compareHiddenNote.
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

// The term written on the ruler. Transparent rect is the hit area; `--cmp` carries side colour.
const rulerWordMarkup = (
  d: { term: string; kind: string; text: string; balance: number; combined: number; bridge?: number; x: number; y: number; size: number; w: number; h: number },
  half: number,
  isSelected: boolean,
) =>
  html`<g class="ruler-word ${isSelected ? 'is-selected' : ''} ${isBridge(d) ? 'ruler-bridge' : ''}" transform="translate(${d.x},${half + d.y})" style="--size:${d.size}px;--cmp:${balanceColor(d.balance)}" data-term="${d.term}" data-kind="${d.kind}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.combined)} documentos"><title>${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.combined)} documentos</title><rect class="ruler-glow" x="${-d.w / 2 - 4}" y="${-d.h / 2 - 3}" width="${d.w + 8}" height="${d.h + 6}"/><rect class="ruler-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}"/><text class="ruler-text" text-anchor="middle" dominant-baseline="central"><tspan x="0" y="0">${d.text}</tspan></text>${isBridge(d) ? html`<line class="ruler-bridge-mark" x1="${-d.w / 2}" x2="${d.w / 2}" y1="${d.h / 2}" y2="${d.h / 2}"/>` : ''}</g>`

// Overflow words: count stated, each still a button with the same data-term/data-kind.
const rulerOverflowMarkup = (
  overflow: { term: string; kind: string; text: string; balance: number }[],
  selected: { term: string; kind: string } | null,
) =>
  overflowList({
    items: overflow,
    cls: 'ruler',
    intro: html`<p>${fmt(overflow.length)} ${overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} na régua sem cobrir as outras. Todas continuam clicáveis aqui:</p>`,
    renderItem: (d) => {
      const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
      return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${d.text}</button>`
    },
  })

// Shared by figure 4 (rising) and figure 6 (lenses): a ruler's end labels, axis, words, axis labels and overflow list,
// with click/keydown on every word. `note` sits between axis and overflow list; `tail` comes after it.
const paintRulerBody = ({
  elementId,
  items,
  metrics,
  selected,
  onPick,
  width,
  endA,
  endB,
  axisLabels,
  ariaLabel,
  note,
  tail = '',
}: {
  elementId: string
  items: RulerItem[]
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width: number
  endA: string
  endB: string
  axisLabels: [string, string, string]
  ariaLabel: string
  note: ReturnType<typeof html> | string
  tail?: ReturnType<typeof html> | string
}) => {
  const ruler = $(elementId)
  const { words, overflow, x, half, height } = rulerLayout(metrics, items, width)
  ruler.innerHTML = html`<div class="ruler-end-row"><span class="ruler-end cmp-a">${endA}</span><span class="ruler-end cmp-b">${endB}</span></div>${frame(
    { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', ariaLabel },
    html`${axis({ x0: RULER_PAD, x1: width - RULER_PAD, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map(x), cls: 'ruler' })}${words.map((d) => rulerWordMarkup(d, half, !!selected && selected.term === d.term && selected.kind === d.kind))}`,
  )}<div class="ruler-axis-labels"><span>${axisLabels[0]}</span><span>${axisLabels[1]}</span><span>${axisLabels[2]}</span></div>${note}${rulerOverflowMarkup(overflow, selected)}${tail}`
  for (const el of queryAll('[data-term]', ruler)) {
    const pick = () => onPick(String(el.dataset.term), String(el.dataset.kind))
    el.addEventListener('click', pick)
    // <g> elements need an explicit key handler; <button>s already handle Enter/Space.
    if (String(el.tagName || '').toLowerCase() !== 'button')
      el.addEventListener('keydown', (event) => {
        const e = event as KeyboardEvent
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pick()
        }
      })
  }
  return { shown: words.length, overflowCount: overflow.length }
}

export type RisingShares = RisingAbout & { words_recent: number; words_baseline: number }

// A payload cached before `present`/`about.words_*` existed must not paint NaN positions, so
// the share rule applies only when both totals arrived; otherwise the ruler falls back to the
// older person-lift rule below, with that rule's own axis prose.
export const hasShares = (data: Rising): data is Rising & { present: RisingTerm[]; about: RisingShares } =>
  Array.isArray(data.present) && Number.isFinite(data.about.words_recent) && Number.isFinite(data.about.words_baseline)

// balance = clamp(log2(share now / share before) / 3, -1, 1), a share being the term's doc count over every doc_terms row
// about the person in that window (about.words_*): shares, not doc counts, so longer texts do not push every word right.
export const shareBalance = (t: { count_recent_raw: number; count_baseline_raw: number }, about: RisingShares) => {
  if (about.words_baseline <= 0) return t.count_recent_raw > 0 ? 1 : 0
  if (about.words_recent <= 0) return -1
  const ratio = (t.count_recent_raw / about.words_recent) / ((t.count_baseline_raw + 1) / about.words_baseline)
  return Math.max(-1, Math.min(1, Math.log2(ratio) / 3))
}

// The fallback rule: clamp(log2(word's lift / the person's own lift) / 3, -1, 1). About.baseline's
// +1 smoothing (the server's own, per term) keeps this finite with no baseline docs at all.
export const liftOfPerson = (about: { recent: number; baseline: number }, days: number, baselineDays: number) => about.recent / days / ((about.baseline + 1) / baselineDays)

export const liftBalance = (t: { lift: number }, liftPerson: number) => {
  const ratio = liftPerson > 0 ? t.lift / liftPerson : t.lift > 0 ? Infinity : 1
  return Math.max(-1, Math.min(1, Math.log2(ratio) / 3))
}

export type RisingItem = RulerItem & { lift: number }

// combined = count_recent_raw + count_baseline_raw, the exact doc counts behind the rounded
// rates, so a word's size on the ruler never compounds the server's own rounding.
export const risingRulerItems = (terms: RisingTerm[], balance: (t: RisingTerm) => number): RisingItem[] =>
  terms.map((t) => ({ term: t.term, kind: t.kind, lift: t.lift, balance: balance(t), combined: t.count_recent_raw + t.count_baseline_raw }))

// The risers off the ruler: `terms` minus what `present` already rules, only those with lift > 1, in the route's lift order,
// listed as buttons that pick like any word; the page shows the first RARE_SHOWN and says how many it left out.
export const RARE_SHOWN = 12

export const rareRisers = (terms: RisingTerm[], present: RisingTerm[]) => {
  const ruled = new Set(present.map((t) => `${t.kind}:${t.term}`))
  return terms.filter((t) => t.lift > 1 && !ruled.has(`${t.kind}:${t.term}`))
}

const rareMarkup = (all: RisingItem[], selected: { term: string; kind: string } | null) => {
  const rare = all.slice(0, RARE_SHOWN)
  if (!rare.length) return ''
  const count = all.length > rare.length ? `${fmt(rare.length)} de ${fmt(all.length)} palavras` : `${fmt(rare.length)} ${rare.length === 1 ? 'palavra' : 'palavras'}`
  return html`<div class="ruler-overflow ruler-rare"><p>Fora da régua, ${count} com poucos textos na semana, mas mais que antes, da maior subida para a menor:</p>${rare.map((d) => {
    const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
    return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${label(d)}</button>`
  })}</div>`
}

export const paintRisingRuler = ({
  data,
  metrics,
  selected,
  onPick,
  width = 860,
}: {
  data: Rising
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width?: number
}) => {
  const ruler = $('risingRuler')
  const shares = hasShares(data)
  const balance = shares ? (t: RisingTerm) => shareBalance(t, data.about) : ((lp) => (t: RisingTerm) => liftBalance(t, lp))(liftOfPerson(data.about, data.days, data.baseline))
  const items = risingRulerItems(shares ? data.present : data.terms, balance)
  const rare = shares ? risingRulerItems(rareRisers(data.terms, data.present), balance) : []
  if (!items.length && !rare.length) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'false')
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  return paintRulerBody({
    elementId: 'risingRuler',
    items,
    metrics,
    selected,
    onPick,
    width,
    endA: 'antes (30 dias)',
    endB: 'agora (7 dias)',
    axisLabels: shares ? ['Fatia menor que antes', 'mesma fatia', 'Fatia maior que antes'] : ['Mais devagar que a pessoa', 'no mesmo ritmo', 'Mais rápido que a pessoa'],
    ariaLabel: 'Régua de termos em alta',
    note: '',
    tail: rareMarkup(rare, selected),
  })
}

export const paintRisingRulerError = () => {
  const ruler = $('risingRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  ruler.innerHTML = '<p class="note">Não foi possível carregar os termos em alta.</p>'
}

// Figure 6 (issue #206): one person, two independently-scoped lenses on the shared ruler body.
// Position is always pmi * ln(1 + count) — there is no measure select on
// this figure — and the two ends are lens labels (lensLabel), not people.
export const paintLensRuler = ({
  data,
  endA,
  endB,
  metrics,
  selected,
  onPick,
  width = 860,
}: {
  data: Lenses
  endA: string
  endB: string
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width?: number
}) => {
  const ruler = $('lensesRuler')
  const { items, hiddenCount } = rulerTerms(data.terms, 'pmi')
  if (!items.length) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'false')
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { hiddenCount, shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  const note = html`<p class="note">Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem das duas lentes somados. Toque numa palavra para ver os números das duas lentes.</p>`
  const { shown, overflowCount } = paintRulerBody({
    elementId: 'lensesRuler',
    items,
    metrics,
    selected,
    onPick,
    width,
    endA,
    endB,
    axisLabels: [`Só de ${endA}`, 'dividida', `Só de ${endB}`],
    ariaLabel: `Régua comparando ${endA} e ${endB} para a mesma pessoa`,
    note,
  })
  return { hiddenCount, shown, overflowCount }
}

export const paintLensRulerError = () => {
  const ruler = $('lensesRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  ruler.innerHTML = '<p class="note">Não foi possível carregar as lentes.</p>'
}

// Selected word's numbers on both lenses; a null side reads "nenhum documento" (measured zero),
// keyed by lens label prose instead of a PersonRef.
export const paintLensDetail = ({ term, endA, endB }: { term: CompareTerm | null; endA: string; endB: string }) => {
  const el = $('lensesDetail')
  if (!el) return
  if (!term) {
    el.innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números das duas lentes.</span>'
    return
  }
  const sideHtml = (endLabel: string, v: CompareSide | 'name' | null) =>
    v === 'name'
      ? html`<div><dt>${endLabel}</dt><dd class="empty-hint">nome da pessoa, fora da régua</dd></div>`
      : v
        ? html`<div><dt>${endLabel}</dt><dd><b>${fmt(v.count)}</b> documentos · PMI <b>${fmt(v.pmi)}</b></dd></div>`
        : html`<div><dt>${endLabel}</dt><dd class="empty-hint">nenhum documento</dd></div>`
  el.innerHTML = html`<span class="term">${label(term)}</span><dl class="detail-sides">${sideHtml(endA, term.a)}${sideHtml(endB, term.b)}</dl>${isBridge(term) ? html`<p class="detail-bridge">ponte: as duas lentes precisam dela</p>` : ''}`
}

const RULER_GHOST_WORDS: [number, number, number, number][] = [
  [110, -14, 86, 20],
  [210, 12, 64, 16],
  [320, -8, 100, 22],
  [430, 0, 72, 18],
  [530, 16, 90, 20],
  [640, -12, 58, 16],
  [740, 8, 80, 18],
]

export const paintRisingLoading = () => {
  const ruler = $('risingRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'true')
  const width = 860
  const height = 88
  const half = 44
  const pad = 28
  ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div>${frame(
    { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}` },
    html`${axis({ x0: pad, x1: width - pad, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map((b) => pad + ((b + 1) / 2) * (width - 2 * pad)), cls: 'ruler' })}${RULER_GHOST_WORDS.map(
      ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
    )}`,
  )}</div><p class="sr-only">Lendo os termos em alta.</p>`
  const about = $('risingAbout')
  if (about) about.textContent = ''
}

export const paintLensesLoading = () => {
  const ruler = $('lensesRuler')
  if (ruler) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'true')
    const width = 860
    const height = 88
    const half = 44
    const pad = 28
    ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div>${frame(
      { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}` },
      html`${axis({ x0: pad, x1: width - pad, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map((b) => pad + ((b + 1) / 2) * (width - 2 * pad)), cls: 'ruler' })}${RULER_GHOST_WORDS.map(
        ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
      )}`,
    )}</div><p class="sr-only">Lendo as lentes.</p>`
  }
  const detail = $('lensesDetail')
  if (!detail) return
  detail.innerHTML = html`<div class="ghost-field" aria-hidden="true">${ghostBar('ghost-title')}<dl class="detail-sides"><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div></dl></div>`
}

