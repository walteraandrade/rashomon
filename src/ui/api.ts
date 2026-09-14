import { routeOf, span } from './perf.js'

export const endpoint = (personId: string) => '/api/people/' + encodeURIComponent(personId)

// word,hashtag,phrase — the full set. GDELT themes are no longer collected or served.
export const ATLAS_KINDS = 'word,hashtag,phrase'

export type GraphOpts = { days: string; sort: string; limit: string; source: string; kind?: string; min?: string }

// `testimony=1` asks /graph for per-term kikori means; always included so a mask toggle never
// refetches. No `domain`: the atlas always answers for the whole recorte.
export const params = ({ days, sort, limit, source, kind = ATLAS_KINDS, min = '2' }: GraphOpts) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, testimony: '1' })

// Drop sort, limit and testimony so a term-ordering change does not evict the outlet list.
export const narrowToSources = (graphParams: URLSearchParams) => {
  const p = new URLSearchParams(graphParams)
  for (const ignored of ['domain', 'sort', 'limit', 'testimony']) p.delete(ignored)
  return p
}

export const sourcesParams = (opts: GraphOpts) => narrowToSources(params(opts))

// Drop sort, limit and domain; `min` is explicit so the panel's copy does not depend on a
// server default. `method` is left to the server.
export const narrowToTestimony = (graphParams: URLSearchParams) =>
  new URLSearchParams({ days: graphParams.get('days') ?? '30', source: graphParams.get('source') ?? 'all', min: '3' })

export const testimonyParams = (opts: GraphOpts) => narrowToTestimony(params(opts))

// `domain` travels only when a figure names an outlet; `day` only when figure 5 names a column.
export type DocsOpts = { days: string; source: string; term?: string; kind?: string; domain?: string; limit?: string; day?: string }

export const docsParams = ({ days, source, term = '', kind = 'all', domain = '', limit = '5', day = '' }: DocsOpts) => {
  const q = new URLSearchParams({ days, source, term, kind, limit })
  if (domain) q.set('domain', domain)
  if (day) q.set('day', day)
  return q
}

// Test stubs hand back a bare object; a real Response always has headers.
const headerOf = (response: Response, name: string) => response.headers?.get(name) ?? null

// One `api:<route>` measure per finished call, success or failure, carrying the two headers
// that place the wait: `cache` (x-vercel-cache: HIT/MISS/STALE) and `server` (server-timing,
// PERF=1 only). Only an abort leaves no entry; a slow 500 is a wait worth seeing.
export const json = async (url: string, signal?: AbortSignal): Promise<any> => {
  const done = span('api:' + routeOf(url))
  let response: Response | null = null
  try {
    response = await fetch(url, { signal })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return await response.json()
  } finally {
    if (!signal?.aborted)
      done({ url, status: response?.status ?? null, cache: response ? headerOf(response, 'x-vercel-cache') : null, server: response ? headerOf(response, 'server-timing') : null })
  }
}

export const loadPeople = (signal?: AbortSignal) => json('/api/people', signal)

export const loadGraph = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/graph?' + queryParams, signal)

export const loadSources = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/sources?' + queryParams, signal)

export const loadDocs = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/docs?' + queryParams, signal)

export const loadTestimony = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/testimony?' + queryParams, signal)

// /api/candidates is not nested under /people/:id.
export const candidatesQuery = ({ days, min = '3', limit = '30' }: { days: string; min?: string; limit?: string }) =>
  new URLSearchParams({ days, min, limit })

export const loadCandidates = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/candidates?' + queryParams, signal)

// /api/compare is not nested under /people/:id; both person ids travel as query params.
export const compareParams = ({ a, b, days, source, limit }: { a: string; b: string; days: string; source: string; limit: string }) =>
  new URLSearchParams({ a, b, days, source, limit, kind: ATLAS_KINDS })

export const loadCompare = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/compare?' + queryParams, signal)

// days/baseline/limit/min stay at the route's own defaults — the figure never exposes them —
// sent explicitly so the figure keeps working the day the server default changes again.
export const risingParams = ({ source }: { source: string }) =>
  new URLSearchParams({ days: '7', baseline: '30', source, kind: ATLAS_KINDS, limit: '40', min: '3' })

export const loadRising = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/rising?' + queryParams, signal)

// days stays fixed at 7, never exposed as a control (issue #147 §4); limit is the only figure
// value, kind the full atlas set.
export const weekParams = ({ source, limit }: { source: string; limit: string }) => new URLSearchParams({ days: '7', source, kind: ATLAS_KINDS, limit })

export const loadWeek = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/week?' + queryParams, signal)

// Figure 1's inspector sparkline: the last 7 rolling days for one word, independent of the
// atlas's own days chip (issue #147 AC20).
export const sparklineParams = (term: string, kind: string, source = 'all') => new URLSearchParams({ term, kind, days: '7', bucket: 'day', source })

export const loadTimeline = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/timeline?' + queryParams, signal)
