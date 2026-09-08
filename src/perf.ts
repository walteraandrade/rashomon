import { AsyncLocalStorage } from 'node:async_hooks'

// Opt-in, read once at import: when PERF is unset `db` stays the bare PGlite instance and
// no middleware is registered, so the disabled path costs nothing and cannot alter a payload.
export const perfEnabled = process.env.PERF === '1' || process.env.PERF === 'true'

// The per-request log line is the noisy half of the instrumentation; PERF_LOG=0 keeps the
// counters and headers while silencing it, which is how `pnpm bench` runs.
export const perfLogEnabled = perfEnabled && process.env.PERF_LOG !== '0'

export type Counters = { sql: number; dbMs: number }
export type Measured<T> = { value: T; ms: number; sql: number; dbMs: number }

const counters = new AsyncLocalStorage<Counters>()

// No-op outside a measure() scope, so an instrumented db used by a script (ingest, bench
// setup) never has to know whether a request is in flight.
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

// Only `query` and `exec` are wrapped, and they are bound to the raw target: PGlite keeps
// state in private fields, which throw when reached through a proxy receiver.
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

// One JSON line per request. Carries the request line and timings only: never a row, a
// response body or an environment value, so no document text and no secret can reach a log.
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
