import { parseCriteria as parseSpecCriteria } from '../../src/jev.js'
import type { Answer } from './questions.js'

export type Gap = { criterion: number | null; severity: 'blocker' | 'should' | 'nit'; area: string }
export type Round = { round: number; headSha: string; verdict: 'approve' | 'return'; ms: number | null; gaps: Gap[] }
export type ModelRun = { answers: Answer[]; costUsd: number | null; ms: number | null; error: string | null }
export type Row = {
  pr: number
  issue: number | null
  source: 'replay' | 'shadow'
  merged: boolean
  baseSha: string
  diffAt: 'round1' | 'final'
  rounds: Round[]
  criteria: { n: number; text: string }[]
  diffTokens: number
  skipped: string | null
  jev: ModelRun | null
  sonnet: ModelRun | null
}
export type Model = 'jev' | 'sonnet'
export type Metrics = {
  model: Model
  t: number
  usable: number
  returned: number
  agreed: number
  precision: number | null
  recall: number | null
  clean: number
  cleanFlagged: number
  saved: number
  flaggedAny: number
  costMean: number | null
  msMean: number | null
  validatorMsMean: number | null
}
export type Decision = { kind: 'ship' | 'hold' | 'insufficient'; t: number | null; text: string }

export const THRESHOLDS = [0.7, 0.8, 0.85, 0.9, 0.95]
export const MIN_ROWS = 20
export const MIN_RETURNED = 5
export const MIN_SAVED_SHARE = 0.25

export const parseCriteria = parseSpecCriteria

const FENCE = /```json factory-verify[^\S\n]*\n([\s\S]*?)```/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const toGap = (g: unknown): Gap | null => {
  if (!isRecord(g) || (g.severity !== 'blocker' && g.severity !== 'should' && g.severity !== 'nit')) return null
  return { criterion: typeof g.criterion === 'number' && Number.isInteger(g.criterion) ? g.criterion : null, severity: g.severity, area: typeof g.area === 'string' ? g.area : '' }
}

const toRound = (r: unknown): Round | null => {
  if (!isRecord(r) || typeof r.round !== 'number' || r.round < 1 || (r.verdict !== 'approve' && r.verdict !== 'return')) return null
  const gaps = Array.isArray(r.gaps) ? r.gaps.flatMap((g) => toGap(g) ?? []) : []
  return { round: r.round, headSha: typeof r.headSha === 'string' ? r.headSha : '', verdict: r.verdict, ms: typeof r.ms === 'number' ? r.ms : null, gaps }
}

export const hasVerifyBlock = (prBody: string): boolean => FENCE.test(prBody)

export const parseVerifyBlock = (prBody: string): Round[] => {
  const m = FENCE.exec(prBody)
  if (!m) return []
  try {
    const parsed: unknown = JSON.parse(m[1])
    return Array.isArray(parsed) ? parsed.flatMap((r) => toRound(r) ?? []) : []
  } catch {
    return []
  }
}

// A PR older than the factory-verify block only tells its round-1 outcome when its body says so.
const approvesRoundOne = (line: string): boolean =>
  /\bround 1\b/i.test(line) && /\bapprove[ds]?\b/i.test(line) && !/\bnot\b|n't\b|\bnever\b|\breturn(ed|s)?\b|\bround [2-9]\b/i.test(line)

export const legacyRounds = (prBody: string, headSha: string): Round[] =>
  prBody.split('\n').some(approvesRoundOne) ? [{ round: 1, headSha, verdict: 'approve', ms: null, gaps: [] }] : []

const unmetAt = (a: Answer, t: number): boolean => 1 - a.pTrue >= t - 1e-9

const criterionNumber = (id: string): number | null => {
  const m = /^criterion:(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

const runOf = (row: Row, model: Model): ModelRun | null => row[model]

export const usableRows = (rows: Row[], model: Model): Row[] => rows.filter((r) => r.skipped === null && runOf(r, model) !== null && runOf(r, model)?.error === null)

const answersOf = (row: Row, model: Model): { n: number; answer: Answer }[] =>
  (runOf(row, model)?.answers ?? []).flatMap((answer) => {
    const n = criterionNumber(answer.id)
    return n === null ? [] : [{ n, answer }]
  })

const roundOne = (row: Row): Round | undefined => row.rounds.find((r) => r.round === 1)

const unmetByValidator = (row: Row): Set<number> =>
  new Set((roundOne(row)?.gaps ?? []).flatMap((g) => (g.criterion !== null && g.severity !== 'nit' ? [g.criterion] : [])))

const isReturned = (row: Row): boolean => row.diffAt === 'round1' && roundOne(row)?.verdict === 'return'

const isLabelled = (row: Row): boolean =>
  row.diffAt === 'round1' && (roundOne(row)?.verdict === 'approve' || (roundOne(row)?.gaps ?? []).some((g) => g.criterion !== null))

const mean = (xs: (number | null)[]): number | null => {
  const known = xs.filter((x): x is number => x !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den)

export const metrics = (rows: Row[], model: Model, t: number): Metrics => {
  const usable = usableRows(rows, model)
  const flags = (row: Row) => answersOf(row, model).filter(({ answer }) => unmetAt(answer, t))
  const returned = usable.filter(isReturned)
  const clean = usable.filter((r) => roundOne(r)?.verdict === 'approve')
  const pairs = usable.filter(isLabelled).flatMap((row) => {
    const truth = unmetByValidator(row)
    return answersOf(row, model).map(({ n, answer }) => ({ predicted: unmetAt(answer, t), actual: truth.has(n) }))
  })
  const tp = pairs.filter((p) => p.predicted && p.actual).length
  const fp = pairs.filter((p) => p.predicted && !p.actual).length
  const fn = pairs.filter((p) => !p.predicted && p.actual).length
  return {
    model,
    t,
    usable: usable.length,
    returned: returned.length,
    agreed: pairs.length,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    clean: clean.length,
    cleanFlagged: clean.filter((r) => flags(r).length > 0).length,
    saved: returned.filter((r) => flags(r).some(({ n }) => unmetByValidator(r).has(n))).length,
    flaggedAny: returned.filter((r) => flags(r).length > 0).length,
    costMean: mean(usable.map((r) => runOf(r, model)?.costUsd ?? null)),
    msMean: mean(usable.map((r) => runOf(r, model)?.ms ?? null)),
    validatorMsMean: mean(usable.map((r) => roundOne(r)?.ms ?? null)),
  }
}

const pct = (x: number): string => `${Number((x * 100).toFixed(1))}%`

export const decide = (rows: Row[], model: Model): Decision => {
  const first = metrics(rows, model, THRESHOLDS[0])
  if (first.usable < MIN_ROWS || first.returned < MIN_RETURNED)
    return { kind: 'insufficient', t: null, text: `DECISION: INSUFFICIENT DATA (rows=${first.usable}, returned=${first.returned})` }
  const free = THRESHOLDS.map((t) => metrics(rows, model, t)).find((m) => m.clean > 0 && m.cleanFlagged === 0)
  if (!free) return { kind: 'hold', t: null, text: 'DECISION: HOLD (no threshold without false positives)' }
  const share = free.saved / free.returned
  return share >= MIN_SAVED_SHARE
    ? { kind: 'ship', t: free.t, text: `DECISION: SHIP t=${free.t.toFixed(2)}` }
    : { kind: 'hold', t: free.t, text: `DECISION: HOLD t=${free.t.toFixed(2)} saved=${pct(share)}` }
}

const num = (x: number | null, digits = 2): string => (x === null ? 'n/a' : x.toFixed(digits))
const count = (n: number, of: number): string => `${n}/${of}${of === 0 ? '' : ` (${pct(n / of)})`}`
const seconds = (ms: number | null): string => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`)
const usd = (x: number | null): string => (x === null ? 'n/a' : `$${x.toFixed(4)}`)

const line = (cells: string[]): string => cells.map((c, i) => c.padEnd([8, 6, 6, 8, 14, 12, 12, 22, 20][i] ?? 0)).join(' ').trimEnd()

export const renderTable = (rows: Row[]): string[] => {
  const modelLines = (model: Model) =>
    THRESHOLDS.map((t) => {
      const m = metrics(rows, model, t)
      return line([
        model,
        t.toFixed(2),
        num(m.precision),
        num(m.recall),
        count(m.cleanFlagged, m.clean),
        count(m.saved, m.returned),
        `${m.flaggedAny}/${m.returned}`,
        `${usd(m.costMean)} vs n/a`,
        `${seconds(m.msMean)} vs ${seconds(m.validatorMsMean)}`,
      ])
    })
  const none = metrics(rows, 'jev', THRESHOLDS[0])
  return [
    line(['model', 't', 'prec', 'recall', 'clean-FP', 'saved', 'flag-any', 'cost/PR vs validator', 'wall/PR vs validator']),
    ...modelLines('jev'),
    ...modelLines('sonnet'),
    line(['none', '-', '-', '-', count(0, none.clean), count(0, none.returned), `0/${none.returned}`, '$0.0000 vs n/a', '0.0s vs n/a']),
    `baseline sonnet: ${decide(rows, 'sonnet').text}`,
    decide(rows, 'jev').text,
  ]
}
