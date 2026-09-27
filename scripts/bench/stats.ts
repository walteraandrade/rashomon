import { createHash } from 'node:crypto'

export type Cell = {
  scale: string
  case: string
  window: number
  medianMs: number
  p95Ms: number
  samplesMs: number[]
  rows: number
  hash: string
  timedOut?: boolean
}

export type Report = {
  meta: {
    src: string
    rev: string
    node: string
    cpu: string
    anchor: string
    runs: number
    windows: number[]
    scales: string[]
    calibrationMs: number
    startedAt: string
  }
  cells: Cell[]
}

const nearestRank = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

export const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Nearest rank: with 5 samples p95 is the slowest sample.
export const p95 = (values: number[]) => nearestRank(values, 95)

// Floats are compared at 9 significant digits: a rewrite that sums the same values in a
// different order must not read as a different answer.
const canonical = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toPrecision(9))
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
  return v
}

// Row order is part of the answer: every route statement orders its own output.
export const resultHash = (rows: unknown[]) => createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex').slice(0, 16)

// `same` is null when either side timed out, or read aggregates whose build timed out: no rows to diff.
export type Verdict = {
  scale: string
  case: string
  window: number
  baseMs: number
  candMs: number
  baseTimedOut: boolean
  candTimedOut: boolean
  ratio: number
  same: boolean | null
  fast: boolean
}

const key = (c: Pick<Cell, 'scale' | 'case' | 'window'>) => `${c.scale}|${c.case}|${c.window}`

const READS_AGGREGATES = ['graphFast']

// A change is kept only when every comparable cell returns the same rows and every targeted cell
// is at least `gain` faster (candidate median <= (1 - gain) x base median). A timed-out base median
// is its timeout, a lower bound, so the ratio against it overstates the candidate's time, never
// understates it; a timed-out candidate is never fast.
// `strict` also requires every base cell in the candidate (the full equivalence run); otherwise only
// the targeted ones, so an iteration can measure just its own cases.
export const compare = (base: Report, cand: Report, targets: string[], gain = 0.2, strict = false) => {
  const byKey = new Map(cand.cells.map((c) => [key(c), c]))
  const buildTimedOut = (r: Report, scale: string, window: number) =>
    r.cells.some((c) => c.case === 'aggregate' && c.scale === scale && c.window === window && c.timedOut)
  const verdicts: Verdict[] = base.cells.flatMap((b) => {
    const c = byKey.get(key(b))
    if (!c) return []
    const ratio = c.medianMs / b.medianMs
    const blind = b.timedOut || c.timedOut || (READS_AGGREGATES.includes(b.case) && (buildTimedOut(base, b.scale, b.window) || buildTimedOut(cand, b.scale, b.window)))
    return [{
      scale: b.scale, case: b.case, window: b.window, baseMs: b.medianMs, candMs: c.medianMs,
      baseTimedOut: !!b.timedOut, candTimedOut: !!c.timedOut, ratio,
      same: blind ? null : b.hash === c.hash, fast: !c.timedOut && ratio <= 1 - gain,
    }]
  })
  const missing = base.cells.filter((b) => (strict || targets.includes(b.case)) && !byKey.has(key(b))).map(key)
  const targeted = verdicts.filter((v) => targets.includes(v.case))
  const diverged = verdicts.filter((v) => v.same === false)
  const unverified = verdicts.filter((v) => v.same === null)
  const slow = targeted.filter((v) => !v.fast)
  const kept = missing.length === 0 && diverged.length === 0 && targeted.length > 0 && slow.length === 0
  return { kept, verdicts, targeted, diverged, unverified, slow, missing }
}

const ms = (x: number, timedOut: boolean) => `${timedOut ? '> ' : ''}${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)}`
const sameLabel = (s: boolean | null) => (s === null ? 'n/a (timeout)' : s ? 'yes' : '**NO**')

export const table = (verdicts: Verdict[]) =>
  [
    '| scale | case | window | base median ms | new median ms | new / base | same rows |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...verdicts.map(
      (v) =>
        `| ${v.scale} | ${v.case} | ${v.window}d | ${ms(v.baseMs, v.baseTimedOut)} | ${ms(v.candMs, v.candTimedOut)} | ${v.baseTimedOut && !v.candTimedOut ? '< ' : ''}${v.ratio.toFixed(2)} | ${sameLabel(v.same)} |`,
    ),
  ].join('\n')
