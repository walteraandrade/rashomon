import { foldTestimonyDomains, testimonyPosition, type TestimonyDomainRow } from './format.js'
import { STRIP_MAX_HEIGHT, STRIP_MIN_R, STRIP_PAD, stripRadius, swarm } from './layout.js'

export { STRIP_PAD }

export const stripLayout = (rows: TestimonyDomainRow[], width: number, span = 10) => {
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  const x = (score: number) => STRIP_PAD + (testimonyPosition(score, span) / 100) * inner
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
  return { dots: fit.dots, x, half: fit.half, height: fit.half * 2, width, scale, span }
}

// Names the extremes, then the largest dots, in a band above or below the swarm; a name that
// overlaps in both bands is left to the list under the strip. `keep` is a span already taken up top.
export const LABEL_BAND = 26
const LABEL_CHAR = 7
const LABEL_GAP = 12

type StripDot = { domain: string; score: number; n: number; x: number; y: number; r: number }

export const stripLabels = (dots: StripDot[], half: number, width: number, count = 6, keep?: [number, number]) => {
  if (!dots.length) return []
  const byScore = [...dots].sort((a, b) => a.score - b.score)
  const bySize = [...dots].sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
  const wanted = [...new Set([byScore[0], byScore[byScore.length - 1], ...bySize])]
  const bands: { top: [number, number][]; bottom: [number, number][] } = { top: keep ? [keep] : [], bottom: [] }
  const free = (spans: [number, number][], a: number, b: number) => spans.every(([s, e]) => b + LABEL_GAP <= s || a >= e + LABEL_GAP)
  const placed: { domain: string; x: number; y: number; dotX: number; dotY: number; side: 'top' | 'bottom' }[] = []
  for (const d of wanted) {
    if (placed.length >= count) break
    const w = d.domain.length * LABEL_CHAR
    const x = Math.max(w / 2, Math.min(width - w / 2, d.x))
    const order: ('top' | 'bottom')[] = d.y <= 0 ? ['top', 'bottom'] : ['bottom', 'top']
    const side = order.find((s) => free(bands[s], x - w / 2, x + w / 2))
    if (!side) continue
    bands[side].push([x - w / 2, x + w / 2])
    const dotY = half + d.y + (side === 'top' ? -d.r : d.r)
    placed.push({ domain: d.domain, x, y: side === 'top' ? -LABEL_BAND + 12 : 2 * half + LABEL_BAND - 6, dotX: d.x, dotY, side })
  }
  return placed
}
