// Pure geometry: word packing and edge routing for the radial atlas. No DOM access here —
// text measurement is injected as `measure(text, size, family, weight) => width`, supplied by
// a browser canvas adapter at the call site (see render.ts's createCanvasMeasure). That is what
// lets this module run, and be tested, outside a browser: pass any deterministic stand-in.

import { label, score, type Box, type CenterBox, type Layout, type Measure, type PlacedTerm, type Point, type Routing, type Term } from './format.js'

// Must stay in sync with atlas.css's --sans / --display custom properties: canvas text
// measurement needs literal font-family strings, and canvas cannot read a CSS custom
// property without going through the DOM, which this module deliberately avoids.
export const FONT_SANS = "'Instrument Sans', system-ui, sans-serif"
export const FONT_DISPLAY = "'League Spartan', 'Instrument Sans', system-ui, sans-serif"

export const wrapLines = (measure: Measure, text: string, size: number, maxWidth: number, family = FONT_SANS, weight = 500): string[] => {
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

// A fixed polar grid of placement candidates, computed once at module load: every packPass
// call scores this same set rather than searching a continuous space, so packing stays
// deterministic and fast.
const candidates: { x: number; y: number; r: number }[] = []
for (let r = 110; r <= 334; r += 4) for (let a = 0; a < 360; a += 3) candidates.push({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180), r })

// Type size is relative to how full the ring is, not absolute: the more terms a layout asks
// for, the lower both the ceiling and the floor, so a crowded atlas shrinks to fit the circle
// instead of spilling half its words into the overflow list. SIZE_CEILING is the cap no term
// passes however few of them there are.
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

// Packs once, then retries the whole layout at a few starting phases whenever some terms
// overflowed, keeping the best (most-placed) attempt — a cheap way to dodge an unlucky
// golden-angle seam without a real solver.
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

// Builds a visibility graph around every placed box (center + terms), corners and edge
// midpoints as waypoints, so routesFrom can shortest-path an edge around obstacles instead
// of drawing a straight line through other words.
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

// Dijkstra from every port of `id` to every other placed term's ports. Caches the routing
// graph on `layout.routing` (computed once per layout, on first call), so re-selecting a
// different term never rebuilds the visibility graph.
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

// The beeswarm skeleton both strips share: every item keeps its x (its score on the axis) and
// takes the y closest to the axis where it touches nothing already placed. Bigger items go
// first, so the heavy marks sit on the line and the small ones stack around them. The two
// strips differ only in the shape of a mark, and that difference is the injected `reach(placed,
// item)`: the vertical distance `item` must keep from `placed` at their horizontal distance, or
// null when the two never interfere at that distance. `fits` rejects a placement that would
// leave the figure, sending the item to `overflow` instead of letting it push the height up,
// and `escape` is the last resort when no candidate is free at all. Deterministic: same input,
// same picture, so a test can assert the geometry.
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

// The testimony strip's own shape: circles, so the clearance between two of them shrinks as
// they drift apart horizontally, and nothing is ever dropped (the strip shrinks its radii
// instead, in render.ts). Kept as its own name because every caller and test speaks of a swarm
// of dots, not of the skeleton above.
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

// ---------- figure 3: the ruler (compare two people, issues #91 and #99) ----------

export const RULER_PAD = 28
// How tall the strip may grow before a word is sent to the overflow list instead of drawn.
// Words, unlike dots, cannot shrink past the 11px floor atlas.css sets for the whole site, so
// the ruler trades height for legibility first and only then drops a word -- visibly.
export const RULER_MAX_HEIGHT = 520
export const RULER_SIZE_MIN = 11
const RULER_SIZE_MAX = 30
const RULER_GAP_X = 8
const RULER_GAP_Y = 3

export type RulerItem = { term: string; kind: string; balance: number; combined: number }

export type RulerLayout<T> = {
  words: (T & { text: string; x: number; y: number; size: number; w: number; h: number })[]
  overflow: (T & { text: string; size: number })[]
  x: (balance: number) => number
  half: number
  height: number
  width: number
}

// Figure 3's geometry: the word itself on the -1..+1 balance axis, in the same language figure
// 1 speaks, instead of an anonymous dot. x is the balance, the type size is `combined`
// (documents on both sides, never measure-dependent) on a sqrt ramp so one loud word cannot
// dwarf the rest, and y comes from swarmBy, which stacks the boxes that would collide. Pure:
// text widths arrive through the same injected `measure` the atlas packer uses.
export const rulerLayout = <T extends RulerItem>(measure: Measure, items: T[], width = 860): RulerLayout<T> => {
  const inner = Math.max(80, width - 2 * RULER_PAD)
  const x = (balance: number) => RULER_PAD + ((Math.max(-1, Math.min(1, balance)) + 1) / 2) * inner
  if (!items.length) return { words: [], overflow: [], x, half: 40, height: 80, width }
  const roots = items.map((it) => Math.sqrt(Math.max(0, it.combined)))
  const lo = Math.min(...roots)
  const hi = Math.max(...roots)
  // Narrow viewports get a shorter type ramp, never a smaller floor: the smallest word on a
  // phone is the same 11px it is on a desktop, and only the biggest one gives ground.
  const top = Math.max(RULER_SIZE_MIN + 2, RULER_SIZE_MAX * Math.min(1, Math.max(0.62, width / 860)))
  const sized = items.map((it, i) => {
    const t = hi === lo ? 0.5 : (roots[i] - lo) / (hi - lo)
    const size = Math.round(RULER_SIZE_MIN + (top - RULER_SIZE_MIN) * t)
    const text = label(it)
    const w = measure(text, size) + 10
    // A word is wide where a dot was a point, so a word sitting on either end would hang off
    // the frame and get clipped. Its box is nudged just far enough inward to stay whole; the
    // shift is at most half a word and never reorders anything, since every word at the same
    // balance is nudged the same way.
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
