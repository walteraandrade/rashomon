import { AsyncLocalStorage } from 'node:async_hooks'

// Opt-in at import: when PERF is unset, db stays bare and no middleware is registered.
export const perfEnabled = process.env.PERF === '1' || process.env.PERF === 'true'

// PERF_LOG=0 keeps counters and headers but silences the per-request line (used by pnpm bench).
export const perfLogEnabled = perfEnabled && process.env.PERF_LOG !== '0'

export type Counters = { sql: number; dbMs: number }
export type Measured<T> = { value: T; ms: number; sql: number; dbMs: number }

const counters = new AsyncLocalStorage<Counters>()

// No-op outside a measure() scope; scripts using an instrumented db need not know.
const record = (ms: number) => {
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

type AsyncFn = (...args: unknown[]) => Promise<unknown>

const timed =
  (fn: AsyncFn, self: object): AsyncFn =>
  async (...args) => {
    const started = performance.now()
    try {
      return await fn.apply(self, args)
    } finally {
      record(performance.now() - started)
    }
  }

// query and exec bound to the raw target: PGlite's private fields throw through a proxy receiver.
const TIMED = new Set(['query', 'exec'])

export const instrument = <T extends object>(target: T): T =>
  new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t)
      if (typeof value === 'function' && typeof prop === 'string' && TIMED.has(prop)) return timed(value as AsyncFn, t)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })

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

export const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}
