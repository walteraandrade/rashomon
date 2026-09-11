import { normalize } from './extract.js'
import { LEANS } from './outlets.js'
import { methods } from './scorers/method.js'
import type { CandidatesQuery, CompareQuery, DocsQuery, GraphQuery, RisingQuery, TestimonyQuery, TimelineQuery, ToneQuery } from './graph.js'

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
// acceptance tests against the fixture); 200 remains reachable by scripts. A new page value
// must be added here (test/query.test.ts).
export const LIMITS = [1, 5, 12, 18, 20, 24, 30, 40, 50, 60, 100, 200]

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
export const parseSourceList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => SOURCES.includes(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

export const KINDS = ['hashtag', 'word', 'phrase']

// Same convention as parseSourceList.
export const parseKindList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => KINDS.includes(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

const DOMAIN_TOKEN = /^[a-z0-9.:-]{1,120}$/

// Same convention as parseSourceList.
export const parseDomainList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => DOMAIN_TOKEN.test(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

// Same convention as parseSourceList.
export const parseLeanList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => (LEANS as string[]).includes(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

export const parseQuery = (q: Record<string, string | undefined>): GraphQuery => ({
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: parseKindList(q.kind),
  limit: snapTo(LIMITS, q.limit, 40),
  min: snapTo(MINS, q.min, 2),
  sort: q.sort === 'pmi' ? 'pmi' : 'count',
  // `testimony=1` opts in; the label resolves the same way as /testimony so the two agree.
  method: q.testimony === '1' ? (METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod()) : null,
})

export const parseDocsQuery = (q: Record<string, string | undefined>): DocsQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: parseKindList(q.kind),
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  limit: snapTo(LIMITS, q.limit, 50),
  offset: snapTo(OFFSETS, q.offset, 0),
})

export const parseRisingQuery = (q: Record<string, string | undefined>): RisingQuery => ({
  days: snapDays(q.days, 7),
  baseline: snapTo(BASELINES, q.baseline, 30),
  source: SOURCES.includes(q.source ?? '') ? q.source! : 'all',
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: parseKindList(q.kind),
  limit: snapTo(SMALL_LIMITS, q.limit, 20),
  min: snapTo(MINS, q.min, 3),
})

export const parseTimelineQuery = (q: Record<string, string | undefined>): TimelineQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: parseKindList(q.kind),
  days: snapDays(q.days, 30),
  source: SOURCES.includes(q.source ?? '') ? q.source! : 'all',
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  bucket: q.bucket === 'day' ? 'day' : 'week',
})

// Dedicated parser: min defaults to 3 here, distinct from GraphQuery.min's 2.
export const parseToneQuery = (q: Record<string, string | undefined>): ToneQuery => ({
  days: snapDays(q.days, 30),
  min: snapTo(MINS, q.min, 3),
})

// Dedicated parser: min defaults to 3, a separate literal so changing parseToneQuery's cannot
// silently change this one.
export const parseTestimonyQuery = (q: Record<string, string | undefined>): TestimonyQuery => ({
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  method: METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod(),
  min: snapTo(MINS, q.min, 3),
})

// Own literals (7 / 5 / 50), distinct from every other route's defaults.
export const parseCandidatesQuery = (q: Record<string, string | undefined>): CandidatesQuery => ({
  days: snapDays(q.days, 7),
  min: snapTo(MINS, q.min, 5),
  limit: snapTo(LIMITS, q.limit, 50),
})

// No `min` (see CompareQuery). limit snaps to SMALL_LIMITS, capped at 100.
export const parseCompareQuery = (q: Record<string, string | undefined>): CompareQuery => ({
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: parseKindList(q.kind),
  limit: snapTo(SMALL_LIMITS, q.limit, 40),
})
