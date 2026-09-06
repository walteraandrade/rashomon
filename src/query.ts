import type { ToneQuery } from './graph.js'

export const int = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// Dedicated parser, not a copy of parseQuery: min defaults to 3 here, distinct from
// GraphQuery.min's default of 2, so a copy-paste from parseQuery can't silently change it.
export const parseToneQuery = (q: Record<string, string | undefined>): ToneQuery => ({
  days: int(q.days, 30, 1, 365),
  min: int(q.min, 3, 1, 1000),
})
