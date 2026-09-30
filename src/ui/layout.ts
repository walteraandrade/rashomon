import { balanceColor, fmt, isBridge, kinds, label, score, termMask, type PersonTestimony, type Box, type CenterBox, type ComentionPair, type ComentionPerson, type Layout, type Measure, type Persistence, type PlacedTerm, type Point, type Routing, type Term, type WeekTerm } from './format.js'

// Literal copies of atlas.css's --sans / --mono / --display: canvas measurement cannot read custom properties.
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const FONT_DISPLAY = "'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif"

export const wrapLines = (measure: Measure, text: string, size: number, maxWidth: number, family = FONT_MONO, weight = 500): string[] => {
  if (measure(text, size, family, weight) <= maxWidth) return [text]
  const units = Array.from(text)
  const lines: string[] = []
  let line = ''
  for (const ch of units) {
    if (line && measure(line + ch, size, family, weight) > maxWidth) {
      const split = Math.max(line.lastIndexOf(' '), line.lastIndexOf('_'), line.lastIndexOf('-'))
      if (split > line.length * 0.3) {
        lines.push(line.slice(0, split + 1).trimEnd())
        line = line.slice(split + 1) + ch
      } else {
        lines.push(line)
        line = ch
      }
    } else line += ch
  }
  if (line) lines.push(line.trimEnd())
  return lines
}

export const centerLabel = (measure: Measure, name: string): CenterBox => {
  const size = 52
  const lines = wrapLines(measure, name, size, 286, FONT_DISPLAY, 700)
  const lineHeight = 57
  const w = Math.max(...lines.map((line) => measure(line, size, FONT_DISPLAY, 700))) + 28
  return { lines, size, lineHeight, w: Math.max(240, w), h: lines.length * lineHeight + 88, x: 0, y: 0 }
}

const overlaps = (a: Box, b: Box, gap = 7) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap

const inCircle = (box: Box, radius = 346) =>
  [-1, 1].every((sx) => [-1, 1].every((sy) => Math.hypot(box.x + (sx * box.w) / 2, box.y + (sy * box.h) / 2) <= radius))

// Placement candidates: fixed polar grid computed once so packing is deterministic.
const candidates: { x: number; y: number; r: number }[] = []
for (let r = 110; r <= 334; r += 4) for (let a = 0; a < 360; a += 3) candidates.push({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180), r })

// Type size is relative to ring fullness: a crowded atlas shrinks to fit rather than spill.
export const SIZE_CEILING = 38
export const SIZE_FLOOR = 13

export const sizeRange = (count: number): { minSize: number; maxSize: number } => {
  const density = Math.max(0, Math.min(1, (count - 8) / 14))
  return { minSize: 20 - (20 - SIZE_FLOOR) * density, maxSize: SIZE_CEILING - 16 * density }
}

export const packPass = (measure: Measure, terms: Term[], center: CenterBox, sort: string, phase = 0): Layout => {
  const values = terms.map((n) => score(n, sort))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const placed: PlacedTerm[] = []
  const overflow: Term[] = []
  const { minSize, maxSize } = sizeRange(terms.length)
  for (const [rank, n] of terms.entries()) {
    const t = max === min ? 0.5 : (values[rank] - min) / (max - min)
    const size = minSize + (maxSize - minSize) * Math.max(0, Math.min(1, t)) ** 0.7
    const lines = wrapLines(measure, label(n), size, 250)
    const lineHeight = size * 1.18
    const w = Math.max(...lines.map((line) => measure(line, size))) + 18
    const h = lines.length * lineHeight + 12
    const fraction = rank / Math.max(1, terms.length - 1)
    const targetR = 182 + 104 * Math.sqrt(fraction)
    const angle = -Math.PI / 2 + rank * Math.PI * (3 - Math.sqrt(5)) + phase
    const target = { x: targetR * Math.cos(angle), y: targetR * Math.sin(angle) }
    let best: Box | null = null
    let cost = Infinity
    for (const c of candidates) {
      const nextCost = (c.r - targetR) ** 2 * 1.2 + (c.x - target.x) ** 2 * 0.22 + (c.y - target.y) ** 2 * 0.22
      if (nextCost >= cost) continue
      const box = { x: c.x, y: c.y, w, h }
      if (!inCircle(box) || overlaps(box, center, 14) || placed.some((p) => overlaps(box, p))) continue
      best = box
      cost = nextCost
    }
    if (best) placed.push({ ...n, ...best, rank, size, lines, lineHeight, score: values[rank] })
    else overflow.push(n)
  }
  return { placed, overflow, center }
}

// Retries the whole layout at a few starting phases when overflow occurs, keeping the most-placed.
export const pack = (measure: Measure, terms: Term[], center: CenterBox, sort: string): Layout => {
  let best = packPass(measure, terms, center, sort)
  for (const phase of [0.5, -0.5, 1.1, -1.1]) {
    if (!best.overflow.length || !best.placed.length) break
    const next = packPass(measure, terms, center, sort, phase)
    if (next.placed.length > best.placed.length) best = next
  }
  return best
}

const segmentBlocked = (a: Point, b: Point, rect: Box) => {
  let lo = 0
  let hi = 1
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, rect.x - rect.w / 2, rect.x + rect.w / 2],
    [a.y, b.y - a.y, rect.y - rect.h / 2, rect.y + rect.h / 2],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start <= min || start >= max) return false
    } else {
      const t1 = (min - start) / delta
      const t2 = (max - start) / delta
      lo = Math.max(lo, Math.min(t1, t2))
      hi = Math.min(hi, Math.max(t1, t2))
    }
    if (lo >= hi) return false
  }
  return hi > 0 && lo < 1
}

// Visibility graph around every placed box (corners and edge midpoints) for routesFrom.
export const routeGraph = (layout: Layout): Routing => {
  const obstacles = [layout.center, ...layout.placed].map((p) => ({ ...p, w: p.w + 6, h: p.h + 6 }))
  const points: Point[] = []
  const ports = new Map<string, number[]>()
  const add = (x: number, y: number) => {
    if (Math.hypot(x, y) > 355 || obstacles.some((r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(y - r.y) < r.h / 2)) return null
    points.push({ x, y })
    return points.length - 1
  }
  for (const r of obstacles) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(r.x + sx * (r.w / 2 + 1), r.y + sy * (r.h / 2 + 1))
    if (r.id)
      ports.set(
        r.id,
        [
          [r.x - r.w / 2 - 1, r.y],
          [r.x + r.w / 2 + 1, r.y],
          [r.x, r.y - r.h / 2 - 1],
          [r.x, r.y + r.h / 2 + 1],
        ]
          .map(([x, y]) => add(x, y))
          .filter((i): i is number => i !== null),
      )
  }
  const adjacent: { index: number; weight: number }[][] = points.map(() => [])
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]
      const b = points[j]
      if (obstacles.some((r) => segmentBlocked(a, b, r))) continue
      const weight = Math.hypot(a.x - b.x, a.y - b.y)
      adjacent[i].push({ index: j, weight })
      adjacent[j].push({ index: i, weight })
    }
  return { points, ports, adjacent }
}

// Dijkstra from every port of `id`. Routing graph is cached on `layout.routing` on first call.
export const routesFrom = (layout: Layout, id: string): Map<string, string> => {
  const { points, ports, adjacent } = (layout.routing ??= routeGraph(layout))
  const distances = points.map(() => Infinity)
  const previous: (number | null)[] = points.map(() => null)
  const visited = new Set<number>()
  for (const start of ports.get(id) || []) distances[start] = 0
  for (let step = 0; step < points.length; step++) {
    let best = -1
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && Number.isFinite(distances[i]) && (best < 0 || distances[i] < distances[best])) best = i
    if (best < 0) break
    visited.add(best)
    for (const edge of adjacent[best])
      if (distances[best] + edge.weight < distances[edge.index]) {
        distances[edge.index] = distances[best] + edge.weight
        previous[edge.index] = best
      }
  }
  const routes = new Map<string, string>()
  for (const [target, ends] of ports) {
    if (target === id) continue
    let end: number | null = null
    for (const i of ends) if (end === null || distances[i] < distances[end]) end = i
    if (end === null) continue
    const path: Point[] = []
    let cursor: number | null = end
    while (cursor !== null) {
      path.unshift(points[cursor])
      cursor = previous[cursor]
    }
    routes.set(target, path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '))
  }
  return routes
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

export const RULER_PAD = 28
// Words cannot shrink past 11px, so the ruler trades height for legibility before dropping.
export const RULER_MAX_HEIGHT = 520
export const RULER_SIZE_MIN = 11
const RULER_SIZE_MAX = 30
const RULER_GAP_X = 8
const RULER_GAP_Y = 3

export type RulerItem = { term: string; kind: string; balance: number; combined: number; bridge?: number }

export type RulerLayout<T> = {
  words: (T & { text: string; x: number; y: number; size: number; w: number; h: number })[]
  overflow: (T & { text: string; size: number })[]
  x: (balance: number) => number
  half: number
  height: number
  width: number
}

// Word-on-axis layout: x is balance (-1..+1), size sqrt(combined) so one loud word cannot dwarf the rest.
export const rulerLayout = <T extends RulerItem>(measure: Measure, items: T[], width = 860): RulerLayout<T> => {
  const inner = Math.max(80, width - 2 * RULER_PAD)
  const x = (balance: number) => RULER_PAD + ((Math.max(-1, Math.min(1, balance)) + 1) / 2) * inner
  if (!items.length) return { words: [], overflow: [], x, half: 40, height: 80, width }
  const roots = items.map((it) => Math.sqrt(Math.max(0, it.combined)))
  const lo = Math.min(...roots)
  const hi = Math.max(...roots)
  // Narrow viewports get a shorter type ramp but never a smaller floor.
  const top = Math.max(RULER_SIZE_MIN + 2, RULER_SIZE_MAX * Math.min(1, Math.max(0.62, width / 860)))
  const sized = items.map((it, i) => {
    const t = hi === lo ? 0.5 : (roots[i] - lo) / (hi - lo)
    const size = Math.round(RULER_SIZE_MIN + (top - RULER_SIZE_MIN) * t)
    const text = label(it)
    const w = measure(text, size) + 10
    // A word at either extreme would hang off the frame; nudge it just far enough inward.
    const centre = Math.min(Math.max(x(it.balance), w / 2), Math.max(w / 2, width - w / 2))
    return { ...it, text, x: centre, size, w, h: Math.round(size * 1.24) }
  })
  const half = RULER_MAX_HEIGHT / 2
  const { placed, overflow } = swarmBy(sized, {
    size: (d) => d.size,
    reach: (p, item) => (Math.abs(p.x - item.x) < (p.w + item.w) / 2 + RULER_GAP_X ? (p.h + item.h) / 2 + RULER_GAP_Y : null),
    fits: (item, y) => Math.abs(y) + item.h / 2 <= half,
  })
  const reach = placed.reduce((m, p) => Math.max(m, Math.abs(p.y) + p.h / 2), 0)
  const used = Math.max(40, Math.ceil(reach) + 6)
  return { words: placed, overflow, x, half: used, height: used * 2, width }
}

// What Ruler.svelte draws, from rulerLayout's output.
export const rulerModel = (layout: RulerLayout<RulerItem>) => ({
  width: layout.width,
  height: layout.height,
  half: layout.half,
  x0: RULER_PAD,
  x1: layout.width - RULER_PAD,
  ticks: [-1, -0.5, 0, 0.5, 1].map(layout.x),
  words: layout.words.map((d) => ({
    term: d.term,
    kind: d.kind,
    text: d.text,
    x: d.x,
    y: d.y,
    size: d.size,
    w: d.w,
    h: d.h,
    cmp: balanceColor(d.balance),
    bridge: isBridge(d),
    aria: `${d.text}, ${fmt(d.combined)} documentos`,
    title: `${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.combined)} documentos`,
  })),
  overflow: layout.overflow.map((d) => ({ term: d.term, kind: d.kind, text: d.text, cmp: balanceColor(d.balance) })),
})

// Figure 5: one column per day, words stacked around the column's centre (x = 0) by swarmBy's clearance.
export const WEEK_SIZE_MIN = 12
const WEEK_SIZE_MAX = 30
// The cap only guards a runaway day: the widest limit the sentence offers (12) always fits.
export const WEEK_MAX_HEIGHT = 480
const WEEK_MAX_TERMS = 12
export const WEEK_COLUMN_WIDTH = 120
const WEEK_GAP_X = 6
const WEEK_GAP_Y = 3
const WEEK_PAD_X = 6

export type WeekColumnLayout<T> = {
  words: (T & { text: string; lines: string[]; x: number; y: number; size: number; w: number; h: number })[]
  overflow: (T & { text: string; size: number })[]
  half: number
  height: number
}

const weekMaxWidth = (width: number) => Math.max(20, width - WEEK_PAD_X)

// A phrase breaks at spaces or after a hyphen, never inside a word; greedy, first fit.
const weekLines = (measure: Measure, text: string, size: number, maxWidth: number): string[] =>
  text.split(/(?<=-)| /).reduce<string[]>((lines, piece) => {
    const last = lines[lines.length - 1]
    const joined = last === undefined ? piece : last.endsWith('-') ? last + piece : last + ' ' + piece
    if (last !== undefined && measure(joined, size) + 6 <= maxWidth) lines[lines.length - 1] = joined
    else lines.push(piece)
    return lines
  }, [])

const weekLineWidth = (measure: Measure, lines: string[], size: number) => Math.max(...lines.map((line) => measure(line, size))) + 6

// The largest size at which a word still fits the column once wrapped, down to the floor.
const fitSize = (measure: Measure, text: string, maxWidth: number) => {
  let size = WEEK_SIZE_MAX
  while (size > WEEK_SIZE_MIN && weekLineWidth(measure, weekLines(measure, text, size, maxWidth), size) > maxWidth) size--
  return size
}

const weekColumn = <T extends WeekTerm>(measure: Measure, terms: T[], width: number, lo: number, hi: number, top: number): WeekColumnLayout<T> => {
  if (!terms.length) return { words: [], overflow: [], half: 30, height: 60 }
  const maxWidth = weekMaxWidth(width)
  const sized = terms.map((t) => {
    const fraction = hi === lo ? 0.5 : (t.count - lo) / (hi - lo)
    // One ramp for the week, its ceiling `top` shared by every column, so a larger count is
    // never a smaller size; a word wider than the column at its ramp size goes to overflow.
    const size = Math.round(WEEK_SIZE_MIN + (top - WEEK_SIZE_MIN) * fraction)
    const text = label(t)
    const lines = weekLines(measure, text, size, maxWidth)
    const w = weekLineWidth(measure, lines, size)
    return { ...t, text, lines, x: 0, size, w, h: Math.round(size * 1.24) * lines.length }
  })
  // A word wider than the column even wrapped is listed under it, never drawn across the next
  // day; lowering the shared ceiling for it would flatten the whole week.
  const tooWide = sized.filter((d) => d.w > maxWidth)
  const fitting = sized.filter((d) => d.w <= maxWidth)
  // The stack alternates sides, so one side may carry up to one box more than the other.
  const boxes = [...fitting].sort((a, b) => b.size - a.size).slice(0, WEEK_MAX_TERMS)
  const budget = boxes.reduce((sum, d) => sum + d.h + WEEK_GAP_Y, 0) + (boxes[0]?.h ?? 0)
  const half = Math.max(WEEK_MAX_HEIGHT, budget) / 2
  const { placed, overflow: unplaced } = swarmBy(fitting, {
    size: (d) => d.size,
    reach: (p, item) => (Math.abs(p.x - item.x) < (p.w + item.w) / 2 + WEEK_GAP_X ? (p.h + item.h) / 2 + WEEK_GAP_Y : null),
    fits: (item, y) => Math.abs(y) + item.h / 2 <= half,
  })
  const reach = placed.reduce((m, p) => Math.max(m, Math.abs(p.y) + p.h / 2), 0)
  const used = Math.max(30, Math.ceil(reach) + 6)
  const overflow = [...unplaced, ...tooWide].sort((a, b) => b.count - a.count)
  return { words: placed, overflow, half: used, height: used * 2 }
}

// Each column gets its own height but the size ramp is one for the week, its ceiling the largest
// size at which the loudest words fit, so no per-word shrink can invert the ramp.
export const weekLayout = <T extends WeekTerm>(measure: Measure, days: T[][], width = WEEK_COLUMN_WIDTH): WeekColumnLayout<T>[] => {
  const all = days.flat()
  const counts = all.map((t) => t.count)
  const lo = counts.length ? Math.min(...counts) : 0
  const hi = counts.length ? Math.max(...counts) : 0
  const maxWidth = weekMaxWidth(width)
  const fits = all.filter((t) => t.count === hi).map((t) => fitSize(measure, label(t), maxWidth))
  const top = Math.max(WEEK_SIZE_MIN + 2, Math.min(WEEK_SIZE_MAX, ...fits))
  return days.map((terms) => weekColumn(measure, terms, width, lo, hi, top))
}

// Figure 7: the day of a series' maximum, oldest on a tie, null when all zero.
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

// One ramp per row, off its own maximum only (issue #216 AC4).
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

// The comention matrix (figure 9): a half-matrix, upper triangle only; a two-axis grid, no packing.
export const MATRIX_CELL_MIN = 26
export const MATRIX_CELL_MAX = 42
const MATRIX_ROWHEAD = 140

export type MatrixCell = { a: string; b: string; count: number | null; ink: number }
export type MatrixLayout = { cellSize: number; cells: MatrixCell[] }

// Rows/columns follow `persons` (by name); a pair's a/b order is id string order, so lookups sort the ids.
const pairKey = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`)

export const matrixLayout = (persons: ComentionPerson[], pairs: ComentionPair[], width: number): MatrixLayout => {
  const ids = persons.map((p) => p.id)
  const cellSize = Math.max(MATRIX_CELL_MIN, Math.min(MATRIX_CELL_MAX, Math.floor((width - MATRIX_ROWHEAD) / Math.max(1, ids.length))))
  const byPair = new Map(pairs.map((p) => [pairKey(p.a, p.b), p.count]))
  const max = pairs.reduce((m, p) => Math.max(m, p.count), 0)
  const cells: MatrixCell[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const count = byPair.get(pairKey(ids[i], ids[j])) ?? null
      cells.push({ a: ids[i], b: ids[j], count, ink: count && max ? Math.max(0.18, count / max) : 0 })
    }
  }
  return { cellSize, cells }
}

// Figure 10: level 1..PERSISTENCE_LEVELS on one ramp keyed to the largest count; 0 is only a null count.
const PERSISTENCE_LEVELS = 5

export type PersistenceCell = { week: string; count: number | null; level: number }
export type PersistenceRow = { term: string; kind: string; cells: PersistenceCell[] }

export const persistenceLayout = (data: Persistence): { rows: PersistenceRow[] } => {
  const top = Math.max(1, ...data.terms.flatMap((t) => t.series.map((s) => s.count ?? 0)))
  const level = (count: number | null) => (count === null ? 0 : Math.min(PERSISTENCE_LEVELS, Math.max(1, Math.ceil((count / top) * PERSISTENCE_LEVELS))))
  return { rows: data.terms.map((t) => ({ term: t.term, kind: t.kind, cells: t.series.map((s) => ({ week: s.week, count: s.count, level: level(s.count) })) })) }
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
