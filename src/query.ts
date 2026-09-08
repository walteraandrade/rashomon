import { normalize } from './extract.js'
import { LEANS } from './outlets.js'
import type { CandidatesQuery, DocsQuery, GraphQuery, RisingQuery, TestimonyQuery, TimelineQuery, ToneQuery } from './graph.js'

// Independent of TESTIMONY_SCORER's own default in src/score.ts: a client can request
// method=stub in tests/debugging regardless of what `pnpm score` last ran.
const DEFAULT_TESTIMONY_METHOD = 'onnx'

export const int = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

export const SOURCES = ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado']

// Accepts a comma-separated list, drops unknown tokens silently, dedupes, and falls
// back to 'all' when nothing valid survives — a superset of the old single-token check,
// so a lone valid token behaves exactly as before.
export const parseSourceList = (v: string | undefined): string => {
  const tokens = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => SOURCES.includes(s)))]
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
  days: int(q.days, 30, 1, 365),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  limit: int(q.limit, 40, 1, 200),
  min: int(q.min, 2, 1, 1000),
  sort: q.sort === 'pmi' ? 'pmi' : 'count',
})

export const parseDocsQuery = (q: Record<string, string | undefined>): DocsQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  days: int(q.days, 30, 1, 365),
  source: parseSourceList(q.source),
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  limit: int(q.limit, 50, 1, 200),
  offset: int(q.offset, 0, 0, 1_000_000),
})

export const parseRisingQuery = (q: Record<string, string | undefined>): RisingQuery => ({
  days: int(q.days, 7, 1, 365),
  baseline: int(q.baseline, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado'].includes(q.source ?? '') ? q.source! : 'all',
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  limit: int(q.limit, 20, 1, 100),
  min: int(q.min, 3, 1, 1000),
})

export const parseTimelineQuery = (q: Record<string, string | undefined>): TimelineQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  days: int(q.days, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado'].includes(q.source ?? '') ? q.source! : 'all',
  domain: parseDomainList(q.domain),
  lean: parseLeanList(q.lean),
  bucket: q.bucket === 'day' ? 'day' : 'week',
})

// Dedicated parser, not a copy of parseQuery: min defaults to 3 here, distinct from
// GraphQuery.min's default of 2, so a copy-paste from parseQuery can't silently change it.
export const parseToneQuery = (q: Record<string, string | undefined>): ToneQuery => ({
  days: int(q.days, 30, 1, 365),
  min: int(q.min, 3, 1, 1000),
})

// Own dedicated parser, not a copy of parseQuery's or parseToneQuery's min: this one
// defaults to 3 too, but as a separate literal, so changing either of theirs cannot
// silently change this one.
export const parseTestimonyQuery = (q: Record<string, string | undefined>): TestimonyQuery => ({
  days: int(q.days, 30, 1, 365),
  source: parseSourceList(q.source),
  method: /^[\w.\/-]{1,128}$/.test(q.method ?? '') ? q.method! : DEFAULT_TESTIMONY_METHOD,
  min: int(q.min, 3, 1, 1000),
})

// Own literals (7 / 5 / 50), per issue #32: distinct from every other route's defaults.
export const parseCandidatesQuery = (q: Record<string, string | undefined>): CandidatesQuery => ({
  days: int(q.days, 7, 1, 365),
  min: int(q.min, 5, 1, 1000),
  limit: int(q.limit, 50, 1, 200),
})
