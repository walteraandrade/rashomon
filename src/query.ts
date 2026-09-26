import { normalize } from './extract.js'
import { LEANS } from './outlets.js'
import { methods } from './scorers/method.js'
import type { CandidatesQuery, CompareQuery, DocsQuery, GraphQuery, LensesQuery, LensSide, RisingQuery, TestimonyQuery, TimelineQuery, ToneQuery, WeekQuery } from './graph.js'

// Resolved lazily per request through the `methods` map. The label matches doc_testimony only
// when TESTIMONY_DTYPE and TESTIMONY_REVISION are set the same way in every process.
const defaultTestimonyMethod = () => methods.onnx()

// `:` is in the charset so `kikori:<dtype>` / `kikori:<dtype>:<revision>` parse as one token.
const METHOD_TOKEN = /^[\w.:\/-]{1,128}$/

export const int = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// Snaps a numeric parameter onto a fixed set of allowed values. The CDN keys on the full
// query string, so every distinct value is its own cache entry. Ties go to the smaller value.
// A missing or non-numeric value falls back to the caller's default.
export const snapTo = (set: readonly number[], v: string | undefined, d: number): number => {
  const n = Number.parseInt(v ?? '', 10)
  if (!Number.isFinite(n)) return d
  return set.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best))
}

// Only these three windows are cache keys; all route defaults (30 or 7) are members.
export const DAYS = [7, 30, 365]

export const snapDays = (v: string | undefined, d: number): number => snapTo(DAYS, v, d)

// Every `limit` the page sends plus every route default. 1 is "just the top term" (used by
// acceptance tests against the fixture); 8 is week's default; 200 remains reachable by
// scripts. A new page value must be added here (test/query.test.ts).
export const LIMITS = [1, 5, 8, 12, 18, 20, 24, 30, 40, 50, 60, 100, 200]

export const WEEK_TZ = 'America/Sao_Paulo'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const calendarDay = (v: string): string => {
  if (!DAY_RE.test(v)) return ''
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return ''
  return v
}

export const brtDate = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: WEEK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

// Minutes to ADD to a UTC instant to read its wall clock in `timeZone` (Date#getTimezoneOffset's
// own sign convention). Read from the tz database via Intl, not assumed, so a rule change (e.g.
// Brazil restoring DST) cannot make this drift from what the SQL side computes with `at time zone`.
const zoneOffsetMinutes = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return (wallAsUtc - instant.getTime()) / 60_000
}

// JS and SQL must resolve the same midnight for a calendar day, since docsDay/weekQuery cast
// published_at through `at time zone 'America/Sao_Paulo'`. Exported so test/query.test.ts can
// pin the derived instant directly.
export const brtMidnightUtc = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d) // day's midnight, misread as if it were already UTC
  // Two candidates, because the offset in force at 00:00 UTC (21:00 the previous day in São
  // Paulo) is not necessarily the one in force at that day's local midnight. On an ordinary day
  // they are the same instant. On a DST boundary they straddle it -- the local midnight is then
  // either ambiguous (clocks went back) or missing (clocks went forward), and Postgres resolves
  // both cases to standard time, which is the later of the two. Taking the later one is what
  // keeps this in step with `at time zone` on every Brazilian transition since 1951 (the one
  // exception, 1950-04-16, fell back at 01:00 rather than midnight, so neither probe lands past
  // it; keepDay only ever asks about dates inside a 7/30/365-day window, so it is unreachable).
  const first = naive - zoneOffsetMinutes(new Date(naive), WEEK_TZ) * 60_000
  const second = naive - zoneOffsetMinutes(new Date(first), WEEK_TZ) * 60_000
  return new Date(Math.max(first, second))
}

// The day AFTER `day`, so a bucket's end is the next calendar day's own midnight rather than
// start + 24h: a 23h or 25h DST day (were Brazil ever to restore it) would otherwise leak or
// clip an hour of docs at the boundary.
const nextCalendarDay = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export const dayOverlapsWindow = (day: string, days: number, now = new Date()): boolean => {
  if (day > brtDate(now)) return false
  const start = brtMidnightUtc(day)
  const end = brtMidnightUtc(nextCalendarDay(day))
  const windowStart = new Date(now.getTime() - days * 86_400_000)
  return start.getTime() <= now.getTime() && end.getTime() > windowStart.getTime()
}

// A malformed, future or out-of-window day resolves to '', which docsDay reads as "no day
// filter" -- the request unfilters to the full window rather than to zero docs, the same
// fallback-to-default convention every other parser here uses. Pinned by test/server.test.ts's
// "day= unfilters on a bad value" tests.
const keepDay = (raw: string | undefined, days: number): string => {
  const day = calendarDay(raw ?? '')
  return day && dayOverlapsWindow(day, days) ? day : ''
}

// compare and rising cap at 100: each unioned key costs two exact figures instead of one.
export const SMALL_LIMITS = LIMITS.filter((x) => x <= 100)

// 1 is "no floor", used by acceptance tests against the six-doc fixture.
export const MINS = [1, 2, 3, 5]

// Nothing in src/ui sends `baseline`; the only reachable value is rising's default.
export const BASELINES = [30]

// A page of docs is 50 by default; offsets are multiples of 50 up to 1000.
export const OFFSETS = Array.from({ length: 21 }, (_, i) => i * 50)

export const SOURCES = ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado', 'juridico', 'oficial', 'nicho']

// Comma-separated, unknown tokens dropped, falls back to 'all' when nothing valid survives.
const parseList = (keep: (token: string) => boolean) => (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter(keep))]
  return tokens.length ? tokens.join(',') : 'all'
}

export const parseSourceList = parseList((s) => SOURCES.includes(s))

export const KINDS = ['hashtag', 'word', 'phrase']

export const parseKindList = parseList((s) => KINDS.includes(s))

const DOMAIN_TOKEN = /^[a-z0-9.:-]{1,120}$/

export const parseDomainList = parseList((s) => DOMAIN_TOKEN.test(s))

export const parseLeanList = parseList((s) => (LEANS as string[]).includes(s))

export const COUNTRIES = ['br', 'pt']

// Unlike every other shared filter, omitted/all-invalid falls back to 'br' (excludes .pt), not
// 'all'. Naming both known tokens, or 'all' itself, collapses to 'all'.
export const parseCountryList = (v: string | undefined): 'br' | 'pt' | 'all' => {
  const tokens = new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => s === 'all' || COUNTRIES.includes(s)))
  if (tokens.has('all') || (tokens.has('br') && tokens.has('pt'))) return 'all'
  if (tokens.has('pt')) return 'pt'
  return 'br'
}

export type Scope = { days: number; source: string; domain: string; lean: string; kind: string; country: 'br' | 'pt' | 'all' }

export const parseScope = (q: Record<string, string | undefined>, { days }: { days: number }): Scope => ({
  days: snapDays(q.days, days),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: parseKindList(q.kind),
  country: parseCountryList(q.country),
})

export const parseQuery = (q: Record<string, string | undefined>): GraphQuery => ({
  ...parseScope(q, { days: 30 }),
  limit: snapTo(LIMITS, q.limit, 40),
  min: snapTo(MINS, q.min, 2),
  sort: q.sort === 'pmi' ? 'pmi' : 'count',
  // `testimony=1` opts in; the label resolves the same way as /testimony so the two agree.
  method: q.testimony === '1' ? (METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod()) : null,
})

export const parseDocsQuery = (q: Record<string, string | undefined>): DocsQuery => {
  const scope = parseScope(q, { days: 30 })
  return {
    ...scope,
    term: normalize((q.term ?? '').trim()),
    limit: snapTo(LIMITS, q.limit, 50),
    offset: snapTo(OFFSETS, q.offset, 0),
    day: keepDay(q.day, scope.days),
  }
}

export const parseRisingQuery = (q: Record<string, string | undefined>): RisingQuery => ({
  ...parseScope(q, { days: 7 }),
  baseline: snapTo(BASELINES, q.baseline, 30),
  limit: snapTo(SMALL_LIMITS, q.limit, 40),
  min: snapTo(MINS, q.min, 3),
})

export const parseTimelineQuery = (q: Record<string, string | undefined>): TimelineQuery => ({
  ...parseScope(q, { days: 30 }),
  term: normalize((q.term ?? '').trim()),
  bucket: q.bucket === 'day' ? 'day' : 'week',
})

// Dedicated parser: min defaults to 3 here, distinct from GraphQuery.min's 2.
export const parseToneQuery = (q: Record<string, string | undefined>): ToneQuery => ({
  days: snapDays(q.days, 30),
  min: snapTo(MINS, q.min, 3),
})

// Dedicated parser: min defaults to 3, a separate literal so changing parseToneQuery's cannot
// silently change this one.
export const parseTestimonyQuery = (q: Record<string, string | undefined>): TestimonyQuery => {
  const { days, source } = parseScope(q, { days: 30 })
  return {
    days,
    source,
    method: METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod(),
    min: snapTo(MINS, q.min, 3),
  }
}

// Own literals (7 / 5 / 50), distinct from every other route's defaults.
export const parseCandidatesQuery = (q: Record<string, string | undefined>): CandidatesQuery => ({
  days: snapDays(q.days, 7),
  min: snapTo(MINS, q.min, 5),
  limit: snapTo(LIMITS, q.limit, 50),
})

// No `min` (see CompareQuery). limit snaps to SMALL_LIMITS, capped at 100.
export const parseCompareQuery = (q: Record<string, string | undefined>): CompareQuery => ({
  ...parseScope(q, { days: 30 }),
  limit: snapTo(SMALL_LIMITS, q.limit, 40),
})

const ALL_LENS: LensSide = { lens: 'all', domain: 'all', lean: 'all', source: 'all' }

// domain:<host> / lean:<left|right|center> / source:<name>; anything else falls back to `all`,
// same "fall back to a full default" convention as parseDomainList/parseLeanList/parseSourceList.
export const parseLens = (raw: string | undefined): LensSide => {
  const v = (raw ?? '').trim()
  if (v.startsWith('domain:')) {
    const host = v.slice('domain:'.length)
    if (DOMAIN_TOKEN.test(host)) return { lens: `domain:${host}`, domain: host, lean: 'all', source: 'all' }
  } else if (v.startsWith('lean:')) {
    const value = v.slice('lean:'.length)
    if ((LEANS as string[]).includes(value)) return { lens: `lean:${value}`, domain: 'all', lean: value, source: 'all' }
  } else if (v.startsWith('source:')) {
    const value = v.slice('source:'.length)
    if (SOURCES.includes(value)) return { lens: `source:${value}`, domain: 'all', lean: 'all', source: value }
  }
  return ALL_LENS
}

// No `min`, limit snaps to SMALL_LIMITS: same reasons as parseCompareQuery.
export const parseLensesQuery = (q: Record<string, string | undefined>): LensesQuery => ({
  days: snapDays(q.days, 30),
  kind: parseKindList(q.kind),
  limit: snapTo(SMALL_LIMITS, q.limit, 40),
  a: parseLens(q.a),
  b: parseLens(q.b),
})

export const parseWeekQuery = (q: Record<string, string | undefined>): WeekQuery => ({
  ...parseScope(q, { days: 7 }),
  limit: snapTo(LIMITS, q.limit, 8),
  // Same gating as /graph (testimony=1 opts in), same label resolution as /testimony (charset
  // check, then the shared default).
  method: q.testimony === '1' ? (METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod()) : null,
})
