import { AsyncLocalStorage } from 'node:async_hooks'

// Opt-in at import: when PERF is unset, db.ts skips the counting SqlClient wrapper and no middleware is registered.
export const perfEnabled = process.env.PERF === '1' || process.env.PERF === 'true'

// PERF_LOG=0 keeps counters and headers but silences the per-request line (used by pnpm bench).
export const perfLogEnabled = perfEnabled && process.env.PERF_LOG !== '0'

export type Counters = { sql: number; dbMs: number }
export type Measured<T> = { value: T; ms: number; sql: number; dbMs: number }

const counters = new AsyncLocalStorage<Counters>()

// No-op outside a measure() scope; exported so db.ts can also count a statement sent straight through the SqlClient, not only one that passes through db.query/db.exec.
export const record = (ms: number) => {
  const current = counters.getStore()
  if (!current) return
  current.sql += 1
  current.dbMs += ms
}

export const measure = async <T>(fn: () => Promise<T>): Promise<Measured<T>> => {
  const current: Counters = { sql: 0, dbMs: 0 }
  const started = performance.now()
  const value = await counters.run(current, fn)
  return { value, ms: performance.now() - started, sql: current.sql, dbMs: current.dbMs }
}

export type RequestPerf = { method: string; path: string; query: string; status: number } & Omit<Measured<unknown>, 'value'>

// One JSON line per request: timings only, never document text or env values.
export const perfLine = (r: RequestPerf) =>
  JSON.stringify({
    perf: 'request',
    method: r.method,
    path: r.path,
    query: r.query,
    status: r.status,
    ms: round(r.ms),
    db_ms: round(r.dbMs),
    sql: r.sql,
  })

export const round = (n: number) => Math.round(n * 100) / 100

// Same two timings as the x-perf-* headers, in the shape DevTools/PerformanceResourceTiming expect.
// `total` is the route's wall-clock, `db` the sum awaited on statements; they overlap, so db > total on a fan-out.
export const serverTiming = ({ ms, sql, dbMs }: Omit<Measured<unknown>, 'value'>) =>
  `db;dur=${round(dbMs)};desc="${sql} sql", total;dur=${round(ms)}`

export const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}
