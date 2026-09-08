// Pure geometry: word packing and edge routing for the radial atlas. No DOM access here —
// text measurement is injected as `measure(text, size, family, weight) => width`, supplied by
// a browser canvas adapter at the call site (see public/design-5.html). That is what lets this
// module run, and be tested, outside a browser: pass any deterministic stand-in measure.

import { label, score } from './format.js'

// Must stay in sync with atlas.css's --sans / --display custom properties: canvas text
// measurement needs literal font-family strings, and canvas cannot read a CSS custom
// property without going through the DOM, which this module deliberately avoids.
export const FONT_SANS = 'Inter, system-ui, sans-serif'
export const FONT_SERIF = "'Iowan Old Style', 'Palatino Linotype', Georgia, serif"

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

export const centerLabel = (measure, name) => {
  const size = 52
  const lines = wrapLines(measure, name, size, 286, FONT_SERIF, 400)
  const lineHeight = 57
  const w = Math.max(...lines.map((line) => measure(line, size, FONT_SERIF, 400))) + 28
  return { lines, size, lineHeight, w: Math.max(240, w), h: lines.length * lineHeight + 88, x: 0, y: 0 }
}

const overlaps = (a, b, gap = 7) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap

const inCircle = (box, radius = 346) =>
  [-1, 1].every((sx) => [-1, 1].every((sy) => Math.hypot(box.x + (sx * box.w) / 2, box.y + (sy * box.h) / 2) <= radius))

// A fixed polar grid of placement candidates, computed once at module load: every packPass
// call scores this same set rather than searching a continuous space, so packing stays
// deterministic and fast.
const candidates = []
for (let r = 110; r <= 334; r += 4) for (let a = 0; a < 360; a += 3) candidates.push({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180), r })

export const packPass = (measure, terms, center, sort, phase = 0) => {
  const values = terms.map((n) => score(n, sort))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const placed = []
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
export const pack = (measure, terms, center, sort) => {
  let best = packPass(measure, terms, center, sort)
  for (const phase of [0.5, -0.5, 1.1, -1.1]) {
    if (!best.overflow.length || !best.placed.length) break
    const next = packPass(measure, terms, center, sort, phase)
    if (next.placed.length > best.placed.length) best = next
  }
  return best
}

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
export const routeGraph = (layout) => {
  const obstacles = [layout.center, ...layout.placed].map((p) => ({ ...p, w: p.w + 6, h: p.h + 6 }))
  const points = []
  const ports = new Map()
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
export const routesFrom = (layout, id) => {
  layout.routing ??= routeGraph(layout)
  const { points, ports, adjacent } = layout.routing
  const distances = points.map(() => Infinity)
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
  const routes = new Map()
  for (const [target, ends] of ports) {
    if (target === id) continue
    const end = ends.reduce((best, i) => (distances[i] < (best === null ? Infinity : distances[best]) ? i : best), null)
    if (end === null) continue
    const path = []
    for (let cursor = end; cursor !== null; cursor = previous[cursor]) path.unshift(points[cursor])
    routes.set(target, path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '))
  }
  return routes
}
