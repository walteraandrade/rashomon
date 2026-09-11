import { normalize } from './extract.js'
import { LEANS } from './outlets.js'
import { methods } from './scorers/method.js'
import type { CandidatesQuery, CompareQuery, DocsQuery, GraphQuery, RisingQuery, TestimonyQuery, TimelineQuery, ToneQuery } from './graph.js'

// Resolved lazily, per request, through the same `methods` map `pnpm score` uses (never a
// literal): the default label is whatever `pnpm score`'s own default scorer would currently
// write: `kikori:<dtype>` when TESTIMONY_REVISION is unset, `kikori:<dtype>:<revision>` when it
// is not. This only matches what is actually in doc_testimony if TESTIMONY_DTYPE and
// TESTIMONY_REVISION are set the same way in the process that ran `pnpm score` and the process
// serving this route — see README's testimony section for the failure mode when they are not.
// Still independent of TESTIMONY_SCORER (src/score.ts): a client can request method=stub in
// tests/debugging regardless of what `pnpm score` last ran.
const defaultTestimonyMethod = () => methods.onnx()

// `:` is part of the charset because the kikori scorer labels its rows `kikori:<dtype>` and,
// once a model revision is pinned, `kikori:<dtype>:<revision>`; without it the parser silently
// fell back to 'onnx' and returned the placeholder rows. The revision's own charset
// (src/scorers/method.ts) is narrower than this one, so a whole label always fits here.
const METHOD_TOKEN = /^[\w.:\/-]{1,128}$/

export const int = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// Snap a numeric parameter onto a small set of allowed values instead of clamping it. The CDN
// keys on the full query string, so every distinct value a clamp lets through is its own cache
// entry, its own cold function invocation and its own real query (issues #111, #127). Ties go to
// the smaller value: `set` is ascending and the comparison is strict, so the first (cheapest)
// candidate wins. A missing or non-numeric value falls back to the caller's default instead of
// snapping, exactly like `int` does.
export const snapTo = (set: readonly number[], v: string | undefined, d: number): number => {
  const n = Number.parseInt(v ?? '', 10)
  if (!Number.isFinite(n)) return d
  return set.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best))
}

// The window is the one query parameter with no natural ceiling on distinct values: `days`
// clamped to [1, 365], so `?days=364`, `?days=363`, ... were 365 distinct CDN keys per person
// per filter set. Only these three windows are reachable now — the same three every <select> in
// public/design-5.html offers. Every route's own default (30, or 7 on the trend routes) is one
// of them, so a caller that sends no `days` sees no change.
export const DAYS = [7, 30, 365]

export const snapDays = (v: string | undefined, d: number): number => snapTo(DAYS, v, d)

// Every `limit` the page sends plus every route default: the atlas <select id="limit"> offers
// 12/18/24, the compare select 20/40/60/100, docsParams sends 5, candidatesQuery sends 30, and
// the routes default to 40 (graph, compare), 50 (docs, candidates) and 20 (rising). Two values
// the page never sends: 1, "just the top term", which the acceptance tests for issues #32 and
// #93 pin against the fixture, and 200, the old documented ceiling, so a script can still ask
// for everything. Unlike DAYS there is no per-figure select to read these from, so a new value
// the page starts sending has to be added here (test/query.test.ts
// checks).
export const LIMITS = [1, 5, 12, 18, 20, 24, 30, 40, 50, 60, 100, 200]

// rising and compare used to clamp `limit` to [1, 100], narrower than the others' [1, 200]:
// each unioned compare key costs two exact figures instead of one (issue #93). The subset keeps
// that ceiling.
export const SMALL_LIMITS = LIMITS.filter((x) => x <= 100)

// The page sends min=2 (graph) and min=3 (candidates); the route defaults are 2, 3 and 5. 1 is
// "no floor", which the page never asks for but the acceptance tests for issues #5, #21 and #32
// do, against a six-doc fixture where nothing else surfaces a single-doc row.
export const MINS = [1, 2, 3, 5]

// Nothing in src/ui sends `baseline`; the only reachable value is rising's default.
export const BASELINES = [30]

// Nothing in src/ui sends `offset`. A page of docs is 50 by default, so offsets are multiples
// of 50 up to a ceiling of 1000: deep enough for a script that walks a term's documents, small
// enough that every page is one of 21 keys.
export const OFFSETS = Array.from({ length: 21 }, (_, i) => i * 50)

export const SOURCES = ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado', 'juridico', 'oficial', 'nicho']

// Accepts a comma-separated list, drops unknown tokens silently, dedupes, and falls
// back to 'all' when nothing valid survives — a superset of the old single-token check,
// so a lone valid token behaves exactly as before.
export const parseSourceList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => SOURCES.includes(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

export const KINDS = ['hashtag', 'word', 'phrase']

// Same convention as parseSourceList: comma-separated, unknown tokens dropped, 'all' when
// nothing valid survives. A lone valid token behaves exactly as the old single-token check
// did, which is what lets `kind=word` keep working unchanged; the list exists so a caller
// can ask for any subset of the three kinds without a new parameter.
export const parseKindList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => KINDS.includes(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

const DOMAIN_TOKEN = /^[a-z0-9.:-]{1,120}$/

// Accepts a comma-separated list of hosts, drops tokens that fail the existing
// single-domain shape check, dedupes, and falls back to 'all' when nothing valid
// survives — a superset of the old single-token check, so `domain=<host>` alone
// keeps behaving exactly as it does today.
export const parseDomainList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => DOMAIN_TOKEN.test(s)))]
  return tokens.length ? tokens.join(',') : 'all'
}

// Mirrors parseSourceList/parseDomainList's convention: comma-separated, unknown
// tokens dropped silently, falls back to 'all' (no filter) when nothing survives.
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
  // Opt-in, so the default /graph response (and docs/perf-baseline.md) is untouched; the
  // label resolves exactly like /testimony's, so the two never disagree about the default.
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

// Dedicated parser, not a copy of parseQuery: min defaults to 3 here, distinct from
// GraphQuery.min's default of 2, so a copy-paste from parseQuery can't silently change it.
export const parseToneQuery = (q: Record<string, string | undefined>): ToneQuery => ({
  days: snapDays(q.days, 30),
  min: snapTo(MINS, q.min, 3),
})

// Own dedicated parser, not a copy of parseQuery's or parseToneQuery's min: this one
// defaults to 3 too, but as a separate literal, so changing either of theirs cannot
// silently change this one.
export const parseTestimonyQuery = (q: Record<string, string | undefined>): TestimonyQuery => ({
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  method: METHOD_TOKEN.test(q.method ?? '') ? q.method! : defaultTestimonyMethod(),
  min: snapTo(MINS, q.min, 3),
})

// Own literals (7 / 5 / 50), per issue #32: distinct from every other route's defaults.
export const parseCandidatesQuery = (q: Record<string, string | undefined>): CandidatesQuery => ({
  days: snapDays(q.days, 7),
  min: snapTo(MINS, q.min, 5),
  limit: snapTo(LIMITS, q.limit, 50),
})

// No `min` (see CompareQuery). limit snaps to SMALL_LIMITS, capped at 100 where graph's goes to
// 200: each unioned key costs two exact figures instead of one, per issue #93's spec.
export const parseCompareQuery = (q: Record<string, string | undefined>): CompareQuery => ({
  days: snapDays(q.days, 30),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: parseKindList(q.kind),
  limit: snapTo(SMALL_LIMITS, q.limit, 40),
})
