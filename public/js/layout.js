// Pure geometry: word packing and edge routing for the radial atlas. No DOM access here —
// text measurement is injected as `measure(text, size, family, weight) => width`, supplied by
// a browser canvas adapter at the call site (see public/design-5.html). That is what lets this
// module run, and be tested, outside a browser: pass any deterministic stand-in measure.

import { foldTestimonyDomains, label, score, testimonyPosition } from './format.js'

/** @typedef {import('./format.js').Box} Box */
/** @typedef {import('./format.js').CenterBox} CenterBox */
/** @typedef {import('./format.js').Layout} Layout */
/** @typedef {import('./format.js').Measure} Measure */
/** @typedef {import('./format.js').PlacedTerm} PlacedTerm */
/** @typedef {import('./format.js').TestimonyDomainRow} TestimonyDomainRow */
/** @typedef {import('./format.js').Term} Term */

// Must stay in sync with atlas.css's --sans / --display custom properties: canvas text
// measurement needs literal font-family strings, and canvas cannot read a CSS custom
// property without going through the DOM, which this module deliberately avoids.
export const FONT_SANS = "'Instrument Sans', system-ui, sans-serif"
export const FONT_DISPLAY = "'League Spartan', 'Instrument Sans', system-ui, sans-serif"

/**
 * @param {Measure} measure
 * @param {string} text
 * @param {number} size
 * @param {number} maxWidth
 * @param {string} [family]
 * @param {number} [weight]
 * @returns {string[]}
 */
export const wrapLines = (measure, text, size, maxWidth, family = FONT_SANS, weight = 500) => {
  if (measure(text, size, family, weight) <= maxWidth) return [text]
  const units = Array.from(text)
  const lines = []
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

/**
 * @param {Measure} measure
 * @param {string} name
 * @returns {CenterBox}
 */
export const centerLabel = (measure, name) => {
  const size = 52
  const lines = wrapLines(measure, name, size, 286, FONT_DISPLAY, 700)
  const lineHeight = 57
  const w = Math.max(...lines.map((line) => measure(line, size, FONT_DISPLAY, 700))) + 28
  return { lines, size, lineHeight, w: Math.max(240, w), h: lines.length * lineHeight + 88, x: 0, y: 0 }
}

/** @param {Box} a @param {Box} b @param {number} [gap] */
const overlaps = (a, b, gap = 7) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap

/** @param {Box} box @param {number} [radius] */
const inCircle = (box, radius = 346) =>
  [-1, 1].every((sx) => [-1, 1].every((sy) => Math.hypot(box.x + (sx * box.w) / 2, box.y + (sy * box.h) / 2) <= radius))

// A fixed polar grid of placement candidates, computed once at module load: every packPass
// call scores this same set rather than searching a continuous space, so packing stays
// deterministic and fast.
/** @type {{ x: number, y: number, r: number }[]} */
const candidates = []
for (let r = 110; r <= 334; r += 4) for (let a = 0; a < 360; a += 3) candidates.push({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180), r })

/**
 * @param {Measure} measure
 * @param {Term[]} terms
 * @param {CenterBox} center
 * @param {string} sort
 * @param {number} [phase]
 * @returns {Layout}
 */
export const packPass = (measure, terms, center, sort, phase = 0) => {
  const values = terms.map((n) => score(n, sort))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  /** @type {PlacedTerm[]} */
  const placed = []
  /** @type {Term[]} */
  const overflow = []
  const maxSize = terms.length > 18 ? 38 : 44
  for (const [rank, n] of terms.entries()) {
    const t = max === min ? 0.5 : (values[rank] - min) / (max - min)
    const size = 22 + (maxSize - 22) * Math.max(0, Math.min(1, t)) ** 0.7
    const lines = wrapLines(measure, label(n), size, 250)
    const lineHeight = size * 1.18
    const w = Math.max(...lines.map((line) => measure(line, size))) + 18
    const h = lines.length * lineHeight + 12
    const fraction = rank / Math.max(1, terms.length - 1)
    const targetR = 182 + 104 * Math.sqrt(fraction)
    const angle = -Math.PI / 2 + rank * Math.PI * (3 - Math.sqrt(5)) + phase
    const target = { x: targetR * Math.cos(angle), y: targetR * Math.sin(angle) }
    /** @type {Box | null} */
    let best = null
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
/**
 * @param {Measure} measure
 * @param {Term[]} terms
 * @param {CenterBox} center
 * @param {string} sort
 * @returns {Layout}
 */
export const pack = (measure, terms, center, sort) => {
  let best = packPass(measure, terms, center, sort)
  for (const phase of [0.5, -0.5, 1.1, -1.1]) {
    if (!best.overflow.length || !best.placed.length) break
    const next = packPass(measure, terms, center, sort, phase)
    if (next.placed.length > best.placed.length) best = next
  }
  return best
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b @param {Box} rect */
const segmentBlocked = (a, b, rect) => {
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
/**
 * @param {Layout} layout
 * @returns {import('./format.js').Routing}
 */
export const routeGraph = (layout) => {
  const obstacles = [layout.center, ...layout.placed].map((p) => ({ ...p, w: p.w + 6, h: p.h + 6 }))
  /** @type {import('./format.js').Point[]} */
  const points = []
  /** @type {Map<string, number[]>} */
  const ports = new Map()
  /** @param {number} x @param {number} y */
  const add = (x, y) => {
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
          .filter((i) => i !== null),
      )
  }
  /** @type {{ index: number, weight: number }[][]} */
  const adjacent = points.map(() => [])
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
/**
 * @param {Layout} layout
 * @param {string} id
 * @returns {Map<string, string>}
 */
export const routesFrom = (layout, id) => {
  layout.routing ??= routeGraph(layout)
  const { points, ports, adjacent } = layout.routing
  const distances = points.map(() => Infinity)
  /** @type {(number | null)[]} */
  const previous = points.map(() => null)
  const visited = new Set()
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
  /** @type {Map<string, string>} */
  const routes = new Map()
  for (const [target, ends] of ports) {
    if (target === id) continue
    /** @type {number | null} */
    let end = null
    for (const i of ends) if (end === null || distances[i] < distances[end]) end = i
    if (end === null) continue
    /** @type {import('./format.js').Point[]} */
    const path = []
    /** @type {number | null} */
    let cursor = end
    while (cursor !== null) {
      path.unshift(points[cursor])
      cursor = previous[cursor]
    }
    routes.set(target, path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '))
  }
  return routes
}

// A one-dimensional beeswarm for the testimony strip: every item keeps its x (its score on the
// axis) and gets the y closest to the axis where it touches nothing already placed. Bigger
// items go first so the heavy outlets sit on the line and the small ones stack around them.
// Deterministic: same input, same picture, so a test can assert the geometry.
/**
 * @template {{ x: number, r: number }} T
 * @param {T[]} items
 * @param {number} [gap]
 * @returns {(T & { y: number })[]}
 */
export const swarm = (items, gap = 1.5) => {
  /** @type {(T & { y: number })[]} */
  const placed = []
  for (const item of [...items].sort((a, b) => b.r - a.r || a.x - b.x)) {
    const near = placed.filter((p) => Math.abs(p.x - item.x) < p.r + item.r + gap)
    const candidates = [0]
    for (const p of near) {
      const need = p.r + item.r + gap
      const dy = Math.sqrt(Math.max(0, need * need - (p.x - item.x) ** 2))
      candidates.push(p.y + dy, p.y - dy)
    }
    const free = candidates
      .filter((c) => near.every((p) => Math.hypot(p.x - item.x, p.y - c) >= p.r + item.r + gap - 1e-6))
      .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
    placed.push({ ...item, y: free.length ? free[0] : Math.max(...candidates.map(Math.abs)) + item.r + gap })
  }
  return placed
}

export const STRIP_PAD = 28

// Dot radius from the number of scored texts: area grows with n, so 100 texts read as
// noticeably more than 10 without a single outlet swallowing the axis. On a narrow strip the
// dots shrink with it (down to 55%), or a phone would get a stack three times taller than
// the axis is wide.
/** @param {number} n @param {number} [width] */
export const stripRadius = (n, width = 860) => Math.min(1, Math.max(0.55, width / 860)) * Math.min(30, 4 + 2.8 * Math.sqrt(n))

// The strip never grows past this: a person with many outlets on similar scores (Lula: 148
// outlets in under half the axis) stacked a 1262px tower at full size. Past the cap the dots
// shrink together until the swarm fits, so every outlet stays, none overlap, and only the
// absolute size gives -- which is fine, the strip compares outlets of one person, never two
// people. STRIP_MIN_R is where shrinking stops and the height is allowed to grow again.
export const STRIP_MAX_HEIGHT = 320
export const STRIP_MIN_R = 3

// The geometry of the strip at a given pixel width: one circle per outlet on the -10..+10
// axis, stacked by `swarm` where they would overlap. Exported so a test can assert the
// placement without a browser. `scale` is the shrink factor the cap forced (1 = none).
/** @param {import('./format.js').TestimonyDomainRow[]} rows @param {number} width */
export const stripLayout = (rows, width) => {
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  /** @param {number} score */
  const x = (score) => STRIP_PAD + (testimonyPosition(score) / 100) * inner
  const folded = foldTestimonyDomains(rows).map((d) => ({ ...d, x: x(d.score), r: stripRadius(d.n, width) }))
  const smallest = folded.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  /** @param {number} k */
  const attempt = (k) => {
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

// The strip under the map: the same outlets as the panel's "Por veículo" block, drawn on the
// axis so the distance between two outlets is visible, which a list cannot show. Clicking a
// dot narrows the recorte exactly like the panel and the outlet list do. Text stays in HTML
// (the SVG only holds shapes), so labels never scale down with the axis on a narrow screen.
