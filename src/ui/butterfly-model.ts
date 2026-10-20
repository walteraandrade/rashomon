import { isBridge, score, type CompareSide, type CompareTerm } from './format.js'

export type ButterflySide = { count: number; share: number }
export type ButterflyRow = {
  term: string
  kind: string
  a: ButterflySide | null
  b: ButterflySide | null
  balance: number
  combined: number
  bridge: boolean
}
export type ButterflyGroupKey = 'a' | 'both' | 'b'
export type ButterflyGroup = { key: ButterflyGroupKey; rows: ButterflyRow[] }
export type ButterflyScale = { domain: number; ticks: number[] }
export type ButterflyModel = { groups: ButterflyGroup[]; hiddenCount: number; scale: ButterflyScale }

type Cell = CompareSide | 'name' | null

const isReal = (v: Cell): v is CompareSide => v !== null && v !== 'name'

const byTerm = (x: { term: string; kind: string }, y: { term: string; kind: string }) =>
  x.term.localeCompare(y.term, 'pt-BR') || x.kind.localeCompare(y.kind)

const share = (side: CompareSide, about: number) => (about > 0 ? (side.count / about) * 100 : 0)

const picked = (terms: CompareTerm[], pick: (t: CompareTerm) => Cell, limit: number, sortMeasure: string) =>
  terms
    .filter((t) => isReal(pick(t)))
    .map((t) => ({ t, s: score(pick(t) as CompareSide, sortMeasure) }))
    .sort((x, y) => y.s - x.s || byTerm(x.t, y.t))
    .slice(0, limit)
    .map(({ t }) => t)

const decimalsOf = (k: number) => Math.max(0, -k)

export const butterflyScale = (max: number): ButterflyScale => {
  if (!(max > 0)) return { domain: 0, ticks: [0] }
  const start = Math.floor(Math.log10(max)) - 1
  for (let k = start; ; k++) {
    for (const mantissa of [1, 2, 5]) {
      const decimals = decimalsOf(k)
      const step = Number((mantissa * 10 ** k).toFixed(decimals))
      const n = Math.ceil(Number((max / step).toFixed(9)))
      if (n > 3) continue
      return { domain: Number((step * n).toFixed(decimals)), ticks: Array.from({ length: n + 1 }, (_, i) => Number((i * step).toFixed(decimals))) }
    }
  }
}

export const butterflyRows = (terms: CompareTerm[], aboutA: number, aboutB: number, limit: number, sortMeasure: string): ButterflyModel => {
  const named = (t: CompareTerm) => t.a === 'name' || t.b === 'name'
  const hiddenCount = terms.filter(named).length
  const kept = terms.filter((t) => !named(t) && (isReal(t.a) || isReal(t.b)))
  const chosen = new Set([...picked(kept, (t) => t.a, limit, sortMeasure), ...picked(kept, (t) => t.b, limit, sortMeasure)])

  const rows = kept
    .filter((t) => chosen.has(t))
    .map((t): ButterflyRow => {
      const a = isReal(t.a) ? { count: t.a.count, share: share(t.a, aboutA) } : null
      const b = isReal(t.b) ? { count: t.b.count, share: share(t.b, aboutB) } : null
      const sA = a?.share ?? 0
      const sB = b?.share ?? 0
      return { term: t.term, kind: t.kind, a, b, balance: sA + sB === 0 ? 0 : (sA - sB) / (sA + sB), combined: sA + sB, bridge: isBridge(t) }
    })

  const order = (x: ButterflyRow, y: ButterflyRow) => y.balance - x.balance || y.combined - x.combined || byTerm(x, y)
  const groups = (
    [
      ['a', rows.filter((r) => r.a && !r.b)],
      ['both', rows.filter((r) => r.a && r.b)],
      ['b', rows.filter((r) => !r.a && r.b)],
    ] as [ButterflyGroupKey, ButterflyRow[]][]
  )
    .filter(([, g]) => g.length)
    .map(([key, g]) => ({ key, rows: g.sort(order) }))

  const max = rows.reduce((m, r) => Math.max(m, r.a?.share ?? 0, r.b?.share ?? 0), 0)
  return { groups, hiddenCount, scale: butterflyScale(max) }
}
