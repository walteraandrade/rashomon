import { fmt, label, termMask, type PersonTestimony, type ComentionPair, type ComentionPerson, type Measure, type Persistence, type Term, type WeekBucket } from './format.js'

// Literal copy of atlas.css's --mono: canvas measurement cannot read custom properties.
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

// Figure 1's Dispersão: documents on a log x axis, raw PMI on a linear y axis, one constant-radius point per term.
const STEPS = [1, 2, 5]

// 1, 2, 5, 10, 20, 50, ... up to and including the first value strictly above `above`.
const ladder = (above: number): number[] => {
  const out: number[] = []
  for (let p = 0; p < 15; p++)
    for (const m of STEPS) {
      const v = m * 10 ** p
      out.push(v)
      if (v > above) return out
    }
  return out
}

export const logTicks = (min: number, max: number): number[] => {
  const lo = Math.max(1, Number.isFinite(min) ? min : 1)
  const hi = Math.max(lo, Number.isFinite(max) ? max : lo)
  const values = ladder(hi)
  const inside = values.filter((v) => v >= lo && v <= hi)
  if (inside.length >= 2) return inside
  const below = values.filter((v) => v < lo).at(-1)
  const above = values.find((v) => v > hi) as number
  return [...(below === undefined ? [] : [below]), ...inside, above]
}

const clean = (v: number) => Number(v.toPrecision(12))

export const niceTicks = (min: number, max: number, target = 5): number[] => {
  const [lo, hi] = min === max ? [min - 1, max + 1] : [min, max]
  const raw = (hi - lo) / Math.max(1, target)
  const decade = 10 ** Math.floor(Math.log10(raw))
  const step = clean((STEPS.map((m) => m * decade).find((s) => s >= raw * (1 - 1e-9)) ?? 10 * decade))
  let first = Math.floor(lo / step)
  let last = Math.ceil(hi / step)
  if (clean(first * step) > lo) first--
  if (clean(last * step) < hi) last++
  if (last === first) last++
  return Array.from({ length: last - first + 1 }, (_, i) => clean((first + i) * step))
}

export type LabelItem = { id: string; x: number; y: number; r: number; w: number; h: number }
export type LabelBounds = { left: number; top: number; right: number; bottom: number }
export type LabelSide = 'right' | 'left' | 'above' | 'below'
// `x` is where the text anchors (its start, end or middle by `anchor`) and `y` the box's vertical centre.
export type LabelPlacement = { x: number; y: number; anchor: 'start' | 'end' | 'middle'; side: LabelSide }

type Rect = { left: number; top: number; right: number; bottom: number }

const boxesClash = (a: Rect, b: Rect, gap: number) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap

const hitsCircle = (box: Rect, c: { x: number; y: number; r: number }, gap: number) =>
  Math.hypot(c.x - Math.max(box.left, Math.min(c.x, box.right)), c.y - Math.max(box.top, Math.min(c.y, box.bottom))) < c.r + gap

// Items come in priority order and each takes the first of right, left, above, below that stays inside
// `bounds` and clear of every earlier label and every other point; none left, no label.
export const placeLabels = (items: LabelItem[], bounds: LabelBounds, gap: number): Map<string, LabelPlacement> => {
  const placed = new Map<string, LabelPlacement>()
  const taken: Rect[] = []
  for (const it of items) {
    const { x: cx, y: cy, r, w, h } = it
    const tries: { side: LabelSide; anchor: LabelPlacement['anchor']; box: Rect }[] = [
      { side: 'right', anchor: 'start', box: { left: cx + r + gap, top: cy - h / 2, right: cx + r + gap + w, bottom: cy + h / 2 } },
      { side: 'left', anchor: 'end', box: { left: cx - r - gap - w, top: cy - h / 2, right: cx - r - gap, bottom: cy + h / 2 } },
      { side: 'above', anchor: 'middle', box: { left: cx - w / 2, top: cy - r - gap - h, right: cx + w / 2, bottom: cy - r - gap } },
      { side: 'below', anchor: 'middle', box: { left: cx - w / 2, top: cy + r + gap, right: cx + w / 2, bottom: cy + r + gap + h } },
    ]
    const pick = tries.find(
      ({ box }) =>
        box.left >= bounds.left &&
        box.right <= bounds.right &&
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom &&
        !taken.some((t) => boxesClash(box, t, gap)) &&
        !items.some((o) => o.id !== it.id && hitsCircle(box, o, gap)),
    )
    if (!pick) continue
    taken.push(pick.box)
    placed.set(it.id, {
      x: pick.anchor === 'start' ? pick.box.left : pick.anchor === 'end' ? pick.box.right : (pick.box.left + pick.box.right) / 2,
      y: (pick.box.top + pick.box.bottom) / 2,
      anchor: pick.anchor,
      side: pick.side,
    })
  }
  return placed
}

export const SCATTER_PAD = { left: 54, right: 22, top: 36, bottom: 54 }
export const SCATTER_POINT_R = 5
export const SCATTER_LABEL_SIZE = 11
export const SCATTER_LABEL_H = 14
export const SCATTER_LABEL_GAP = 4
export const SCATTER_DEFAULT_WIDTH = 860

export const SCATTER_X_CAPTION = 'documentos (escala log)'
export const SCATTER_Y_CAPTION = 'PMI: quanto a palavra é específica da pessoa'
const SCATTER_CAPTION_LINE = 13

export type ScatterCaptions = {
  x: { text: string; x: number; y: number }
  // Starts at x = 0; one line when it fits the width, else two split after "PMI:".
  y: { x: number; lines: { text: string; y: number }[] }
}

export type ScatterPoint = { id: string; x: number; y: number }
export type ScatterLayout = {
  width: number
  height: number
  plot: LabelBounds
  r: number
  points: ScatterPoint[]
  xTicks: { value: number; x: number }[]
  yTicks: { value: number; y: number }[]
  zeroY: number | null
  labels: Map<string, LabelPlacement>
  captions: ScatterCaptions
}

const finite = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// A count of 0 is read as 1 before the log, a missing pmi as 0, so the layout only ever sees finite numbers.
export const scatterLayout = (measure: Measure, nodes: Term[], width: number): ScatterLayout => {
  const height = Math.round(Math.max(320, Math.min(460, width * 0.55)))
  const captionWidth = (text: string) => measure(text, SCATTER_LABEL_SIZE, FONT_MONO, 500)
  const yText = captionWidth(SCATTER_Y_CAPTION) > width ? [SCATTER_Y_CAPTION.slice(0, 4), SCATTER_Y_CAPTION.slice(5)] : [SCATTER_Y_CAPTION]
  const yLines = yText.map((text, i) => ({ text, y: 14 + i * SCATTER_CAPTION_LINE }))
  const top = Math.max(SCATTER_PAD.top, yLines[yLines.length - 1].y + 12)
  const plot = { left: SCATTER_PAD.left, top, right: Math.max(SCATTER_PAD.left + 1, width - SCATTER_PAD.right), bottom: height - SCATTER_PAD.bottom }
  const half = captionWidth(SCATTER_X_CAPTION) / 2
  const xCaptionX = Math.max(half, Math.min(width - half, (plot.left + plot.right) / 2))
  const counts = nodes.map((n) => Math.max(1, finite(n.count)))
  const pmis = nodes.map((n) => finite(n.pmi))
  const minCount = counts.length ? Math.min(...counts) : 1
  const maxCount = counts.length ? Math.max(...counts) : 1
  const lo = Math.max(1, ladder(minCount).filter((v) => v <= minCount).at(-1) ?? 1)
  const hi = ladder(maxCount).find((v) => v > maxCount) as number
  const yTicksRaw = niceTicks(pmis.length ? Math.min(...pmis) : 0, pmis.length ? Math.max(...pmis) : 0)
  const yFirst = yTicksRaw[0]
  const yLast = yTicksRaw[yTicksRaw.length - 1]
  const x = (count: number) => plot.left + ((Math.log(count) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (plot.right - plot.left)
  const y = (pmi: number) => plot.top + ((yLast - pmi) / (yLast - yFirst)) * (plot.bottom - plot.top)
  const points = nodes.map((n, i) => ({ id: n.id, x: x(counts[i]), y: y(pmis[i]) }))
  const labels = placeLabels(
    points.map((p, i) => ({ ...p, r: SCATTER_POINT_R, w: measure(label(nodes[i]), SCATTER_LABEL_SIZE, FONT_MONO, 500), h: SCATTER_LABEL_H })),
    plot,
    SCATTER_LABEL_GAP,
  )
  return {
    width,
    height,
    plot,
    r: SCATTER_POINT_R,
    points,
    xTicks: logTicks(lo, hi).map((value) => ({ value, x: x(value) })),
    yTicks: yTicksRaw.map((value) => ({ value, y: y(value) })),
    zeroY: yFirst <= 0 && yLast >= 0 ? y(0) : null,
    labels,
    captions: { x: { text: SCATTER_X_CAPTION, x: xCaptionX, y: plot.bottom + 40 }, y: { x: 0, lines: yLines } },
  }
}

// Beeswarm skeleton both strips share: `reach` is the vertical clearance two items need (null if
// they never interfere), `fits` rejects placements outside the figure, `escape` is the last resort.

export type SwarmRules<T> = {
  size: (item: T) => number
  reach: (placed: T & { y: number }, item: T) => number | null
  fits?: (item: T, y: number) => boolean
  escape?: (item: T, candidates: number[]) => number | null
}

export const swarmBy = <T extends { x: number }>(
  items: T[],
  { size, reach, fits = () => true, escape = () => null }: SwarmRules<T>,
): { placed: (T & { y: number })[]; overflow: T[] } => {
  const placed: (T & { y: number })[] = []
  const overflow: T[] = []
  for (const item of [...items].sort((a, b) => size(b) - size(a) || a.x - b.x)) {
    const near: { p: T & { y: number }; dy: number }[] = []
    for (const p of placed) {
      const dy = reach(p, item)
      if (dy !== null) near.push({ p, dy })
    }
    const candidates = [0, ...near.flatMap(({ p, dy }) => [p.y + dy, p.y - dy])]
    const free = candidates
      .filter((c) => near.every(({ p, dy }) => Math.abs(p.y - c) + 1e-6 >= dy))
      .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
    const y = free.find((c) => fits(item, c)) ?? escape(item, candidates)
    if (y === null || y === undefined) overflow.push(item)
    else placed.push({ ...item, y })
  }
  return { placed, overflow }
}

// Circle swarm; no overflow, the strip shrinks its radii in strip-model.ts instead.
export const swarm = <T extends { x: number; r: number }>(items: T[], gap = 1.5): (T & { y: number })[] =>
  swarmBy(items, {
    size: (d) => d.r,
    reach: (p, item) => {
      const need = p.r + item.r + gap
      const dx = p.x - item.x
      return Math.abs(dx) < need ? Math.sqrt(Math.max(0, need * need - dx * dx)) : null
    },
    escape: (item, candidates) => Math.max(...candidates.map(Math.abs)) + item.r + gap,
  }).placed

// Figure 5: one row per word, one column per day; a cell's ink is heatLevel on the week's largest cell.
export type WeekRow = { term: string; kind: string; total: number; cells: (number | null)[] }

export const weekRows = (buckets: WeekBucket[]): { top: number; rows: WeekRow[] } => {
  const rows = new Map<string, WeekRow>()
  buckets.forEach((bucket, i) => {
    for (const t of bucket.terms) {
      const key = t.kind + '\u0000' + t.term
      const row = rows.get(key) ?? { term: t.term, kind: t.kind, total: 0, cells: buckets.map(() => null) }
      row.cells[i] = (row.cells[i] ?? 0) + t.count
      row.total += t.count
      rows.set(key, row)
    }
  })
  const ordered = [...rows.values()].sort((a, b) => b.total - a.total || a.term.localeCompare(b.term, 'pt-BR') || a.kind.localeCompare(b.kind))
  return { top: Math.max(1, ...ordered.flatMap((r) => r.cells.map((c) => c ?? 0))), rows: ordered }
}

// Figure 6: the day of a series' maximum, oldest on a tie, null when all zero.
export type AttentionSeriesPoint = { day: string; value: number }

export const peakDay = (series: AttentionSeriesPoint[]): string | null => {
  let best: AttentionSeriesPoint | null = null
  for (const point of series)
    if (point.value > 0 && (!best || point.value > best.value || (point.value === best.value && point.day < best.day))) best = point
  return best?.day ?? null
}

export const ATTENTION_ROW_WIDTH = 640
// Bar height, not font size: width is bounded by the column step, never by a label's own width.
const ATTENTION_BAR_MIN = 3
const ATTENTION_BAR_MAX = 44
// Gap a bar always leaves before its neighbour's, so two adjacent columns can never touch.
const ATTENTION_BAR_GAP = 3
const ATTENTION_BAR_MIN_WIDTH = 2

// One ramp per row, off its own maximum only: mentions and pageviews never share a scale.
const attentionSizes = (values: number[]): number[] => {
  const max = Math.max(0, ...values)
  if (max <= 0) return values.map(() => ATTENTION_BAR_MIN)
  return values.map((v) => Math.round(ATTENTION_BAR_MIN + (ATTENTION_BAR_MAX - ATTENTION_BAR_MIN) * (Math.max(0, v) / max)))
}

// `size` is the bar's height; `barW` its width, capped to the step. `text` is a <title>/aria-label only.
export type AttentionMark = { day: string; x: number; size: number; barW: number; text: string }
export type AttentionRows = { width: number; mentions: AttentionMark[]; views: AttentionMark[] }

// A monotonic day axis needs a fixed grid, not a beeswarm; series arrive day-aligned and zero-padded.
export const attentionLayout = (measure: Measure, mentions: { day: string; count: number }[], views: { day: string; views: number }[], width = ATTENTION_ROW_WIDTH): AttentionRows => {
  const n = Math.max(mentions.length, views.length, 1)
  const step = width / n
  const x = (i: number) => Math.round(step * (i + 0.5))
  const barW = Math.max(ATTENTION_BAR_MIN_WIDTH, Math.round(step - ATTENTION_BAR_GAP))
  const mentionSizes = attentionSizes(mentions.map((m) => m.count))
  const viewSizes = attentionSizes(views.map((v) => v.views))
  return {
    width,
    mentions: mentions.map((m, i) => ({ day: m.day, x: x(i), size: mentionSizes[i], barW, text: fmt(m.count) })),
    views: views.map((v, i) => ({ day: v.day, x: x(i), size: viewSizes[i], barW, text: fmt(v.views) })),
  }
}

// The comention matrix (figure 8): a half-matrix, upper triangle only; a two-axis grid, no packing.
export const MATRIX_CELL_MIN = 26
export const MATRIX_CELL_MAX = 42
export const MATRIX_ROWHEAD = 140
// Margin on each side of a cell; a column header has none, so it spans the cell plus both gaps.
export const MATRIX_GAP = 1

export type MatrixCell = { a: string; b: string; count: number | null; ink: number }
// `pitch` is one column's full step, shared by headers and cells: cellSize + 2 * gap.
export type MatrixLayout = { cellSize: number; gap: number; pitch: number; rowhead: number; cells: MatrixCell[] }

// Rows/columns follow `persons` (by name); a pair's a/b order is id string order, so lookups sort the ids.
const pairKey = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`)

export const matrixLayout = (persons: ComentionPerson[], pairs: ComentionPair[], width: number): MatrixLayout => {
  const ids = persons.map((p) => p.id)
  const fit = Math.floor((width - MATRIX_ROWHEAD) / Math.max(1, ids.length)) - 2 * MATRIX_GAP
  const cellSize = Math.max(MATRIX_CELL_MIN, Math.min(MATRIX_CELL_MAX, fit))
  const byPair = new Map(pairs.map((p) => [pairKey(p.a, p.b), p.count]))
  const max = pairs.reduce((m, p) => Math.max(m, p.count), 0)
  const cells: MatrixCell[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const count = byPair.get(pairKey(ids[i], ids[j])) ?? null
      cells.push({ a: ids[i], b: ids[j], count, ink: count && max ? Math.max(0.18, count / max) : 0 })
    }
  }
  return { cellSize, gap: MATRIX_GAP, pitch: cellSize + 2 * MATRIX_GAP, rowhead: MATRIX_ROWHEAD, cells }
}

// Level 1..levels on one ramp keyed to the largest count `top`; 0 is only a null count.
export const heatLevel = (count: number | null, top: number, levels = 5): number =>
  count === null ? 0 : Math.min(levels, Math.max(1, Math.ceil((count / Math.max(1, top)) * levels)))

// Figure 9: one ramp keyed to the largest count shown.
export type PersistenceCell = { week: string; count: number | null; level: number }
export type PersistenceRow = { term: string; kind: string; cells: PersistenceCell[] }

export const persistenceLayout = (data: Persistence): { rows: PersistenceRow[] } => {
  const top = Math.max(1, ...data.terms.flatMap((t) => t.series.map((s) => s.count ?? 0)))
  return { rows: data.terms.map((t) => ({ term: t.term, kind: t.kind, cells: t.series.map((s) => ({ week: s.week, count: s.count, level: heatLevel(s.count, top) })) })) }
}

export const STRIP_PAD = 28

// Area grows with n; dots shrink on narrow screens (floor 55%) to avoid a tall stack.
export const stripRadius = (n: number, width = 860) => Math.min(1, Math.max(0.55, width / 860)) * Math.min(30, 4 + 2.8 * Math.sqrt(n))

// Past this cap dots shrink until the swarm fits; STRIP_MIN_R is where shrinking stops.
export const STRIP_MAX_HEIGHT = 320
export const STRIP_MIN_R = 3

export type StripDot = { id: string; term: string; kind: string; score: number; count: number; tone: string; x: number; r: number }

// termMask decides eligibility and colour; the domain always includes the person's own score, so the mean line stays inside the strip.
export const termStripLayout = (nodes: Term[], personTestimony: PersonTestimony | undefined, width = 860) => {
  const personScore = personTestimony?.score ?? null
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  const eligible = nodes
    .map((n) => ({ n, tone: termMask(n, personScore) }))
    .filter((e): e is { n: Term; tone: string } => e.tone !== null)
  if (!eligible.length)
    return { dots: [] as (StripDot & { y: number })[], domainMin: -1, domainMax: 1, ticks: [-1, 0, 1], x: (s: number) => STRIP_PAD + inner / 2, half: 44, height: 88 }
  const scores = eligible.map((e) => e.n.testimony!.score)
  let domainMin = Math.floor(Math.min(...scores, personScore as number))
  let domainMax = Math.ceil(Math.max(...scores, personScore as number))
  if (domainMax - domainMin < 2) {
    domainMin -= 1
    domainMax += 1
  }
  // A float mean a hair from a floor/ceil edge (-3.97 next to -4) never equals it, so the gap
  // is compared to a share of the span.
  const edgeGap = (domainMax - domainMin) * 0.03
  if ((personScore as number) - domainMin < edgeGap) domainMin -= 1
  if (domainMax - (personScore as number) < edgeGap) domainMax += 1
  const span = domainMax - domainMin
  const x = (s: number) => STRIP_PAD + ((Math.max(domainMin, Math.min(domainMax, s)) - domainMin) / span) * inner
  const placed: StripDot[] = eligible.map((e) => ({
    id: e.n.id,
    term: e.n.term,
    kind: e.n.kind,
    score: e.n.testimony!.score,
    count: e.n.count,
    tone: e.tone,
    x: x(e.n.testimony!.score),
    r: stripRadius(e.n.count, width),
  }))
  // A tall swarm shrinks its dots (never below STRIP_MIN_R) until it fits STRIP_MAX_HEIGHT.
  const smallest = placed.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  const attempt = (k: number) => {
    const dots = swarm(placed.map((d) => ({ ...d, r: d.r * k })))
    const reach = dots.reduce((m, d) => Math.max(m, Math.abs(d.y) + d.r), 0)
    return { dots, half: Math.max(44, Math.ceil(reach) + 6) }
  }
  let fit = attempt(scale)
  while (fit.half * 2 > STRIP_MAX_HEIGHT && scale > floor) {
    scale = Math.max(floor, scale * 0.92)
    fit = attempt(scale)
  }
  const ticks: number[] = []
  for (let t = domainMin; t <= domainMax; t++) ticks.push(t)
  return { dots: fit.dots, domainMin, domainMax, ticks, x, half: fit.half, height: fit.half * 2 }
}
