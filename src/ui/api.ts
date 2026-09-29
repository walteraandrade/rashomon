import { routeOf, span } from './perf.js'

export const endpoint = (personId: string) => '/api/people/' + encodeURIComponent(personId)

// word,hashtag,phrase,org — the full set the atlas (figure 1) requests. GDELT themes are no longer collected or served.
export const ATLAS_KINDS = 'word,hashtag,phrase,org'

// The fixed set figures 3, 4, 5 and 6 send, unaffected by ATLAS_KINDS gaining org.
const FIXED_KINDS = 'word,hashtag,phrase'

export type GraphOpts = { days: string; sort: string; limit: string; source: string; kind?: string; min?: string }

// `testimony=1`/`communities=1` ask /graph for kikori means and term communities; always
// included so cycling either colouring never refetches. No `domain`: the atlas answers whole.
export const params = ({ days, sort, limit, source, kind = ATLAS_KINDS, min = '2' }: GraphOpts) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, testimony: '1', communities: '1' })

// Drop sort, limit, testimony and communities so a term-ordering change does not evict the outlet list.
export const narrowToSources = (graphParams: URLSearchParams) => {
  const p = new URLSearchParams(graphParams)
  for (const ignored of ['domain', 'sort', 'limit', 'testimony', 'communities']) p.delete(ignored)
  return p
}

export const sourcesParams = (opts: GraphOpts) => narrowToSources(params(opts))

// Drop sort, limit and domain; `min` is explicit so the panel's copy does not depend on a
// server default. `method` is left to the server.
export const narrowToTestimony = (graphParams: URLSearchParams) =>
  new URLSearchParams({ days: graphParams.get('days') ?? '30', source: graphParams.get('source') ?? 'all', min: '3' })

export const testimonyParams = (opts: GraphOpts) => narrowToTestimony(params(opts))

// `domain` travels only when a figure names an outlet; `day` only when figure 5 names a column;
// `week` only when figure 10 names a cell (a Monday);
// `lean` only when a figure 6 lens is `lean:<value>` — /docs already accepts it server-side.
export type DocsOpts = { days: string; source: string; term?: string; kind?: string; domain?: string; lean?: string; limit?: string; day?: string; week?: string; withId?: string }

// `withId` (`with` is a reserved word) travels only when the comention matrix names the other
// person of the pair (issue #207); every other caller keeps sending byte-identical params.
export const docsParams = ({ days, source, term = '', kind = 'all', domain = '', lean = '', limit = '5', day = '', week = '', withId = '' }: DocsOpts) => {
  const q = new URLSearchParams({ days, source, term, kind, limit })
  if (domain) q.set('domain', domain)
  if (lean) q.set('lean', lean)
  if (day) q.set('day', day)
  if (week) q.set('week', week)
  if (withId) q.set('with', withId)
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
  new URLSearchParams({ a, b, days, source, limit, kind: FIXED_KINDS })

export const loadCompare = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/compare?' + queryParams, signal)

// The ruler's own recorte plus the terms to score, fetched after the ruler has painted.
export const bridgeParams = (queryParams: URLSearchParams, ids: string[]) => {
  const qp = new URLSearchParams(queryParams)
  qp.set('ids', ids.join(','))
  return qp
}

export const loadCompareBridges = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/compare/bridges?' + queryParams, signal)

// days/baseline/limit/min stay at the route's own defaults — the figure never exposes them —
// sent explicitly so the figure keeps working the day the server default changes again.
export const risingParams = ({ source }: { source: string }) =>
  new URLSearchParams({ days: '7', baseline: '30', source, kind: FIXED_KINDS, limit: '40', min: '3' })

export const loadRising = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/rising?' + queryParams, signal)

// days stays fixed at 7, never exposed as a control (issue #147 §4); limit is the only figure
// value, kind the fixed word/hashtag/phrase set.
export const weekParams = ({ source, limit }: { source: string; limit: string }) => new URLSearchParams({ days: '7', source, kind: FIXED_KINDS, limit })

export const loadWeek = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/week?' + queryParams, signal)

// Figure 10: one fixed scope (all sources, word/hashtag/phrase), so only the two figure values travel.
export const persistenceParams = ({ weeks, limit }: { weeks: string; limit: string }) => new URLSearchParams({ weeks, limit })

export const loadPersistence = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/persistence?' + queryParams, signal)

// Figure 1's inspector sparkline: the last 7 rolling days for one word, independent of the
// atlas's own days chip (issue #147 AC20).
export const sparklineParams = (term: string, kind: string, source = 'all') => new URLSearchParams({ term, kind, days: '7', bucket: 'day', source })

export const loadTimeline = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/timeline?' + queryParams, signal)

// /api/people/:id/lenses (figure 6, issue #206): one person, two independently-scoped lenses.
// `a`/`b` travel as raw tokens (domain:<host>, lean:<value>, source:<name>, or all); the server
// parses and echoes back the normalized one, never the malformed input.
export const lensesParams = ({ a, b, days, limit }: { a: string; b: string; days: string; limit: string }) =>
  new URLSearchParams({ a, b, days, limit, kind: FIXED_KINDS })

export const loadLenses = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/lenses?' + queryParams, signal)

export const loadLensBridges = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/lenses/bridges?' + queryParams, signal)

// Figure 7 (issue #216): /attention has no parameter but days, and the figure never exposes it
// (fixed at 30, weekParams' fixed-days=7 precedent) -- any other field passed in is ignored.
export const attentionParams = (_opts: Record<string, unknown> = {}) => new URLSearchParams({ days: '30' })

export const loadAttention = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) => json(endpoint(personId) + '/attention?' + queryParams, signal)

// /api/agenda is not nested under /people/:id: one call ranks every tracked person's share of
// the top domains at once. `min` stays at the route's own default (5); no UI control.
export const AGENDA_MIN = 5

export const agendaParams = ({ days, source }: { days: string; source: string }) => new URLSearchParams({ days, source })

export const loadAgenda = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/agenda?' + queryParams, signal)

// /api/comention (figure 9, issue #207): not nested under /people/:id, spans every tracked
// person at once, like /api/compare and /api/tone. No `kind`, no `domain`, no `sort`.
export const comentionParams = ({ days, source, lean, min }: { days: string; source: string; lean: string; min: string }) =>
  new URLSearchParams({ days, source, lean, min })

export const loadComention = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/comention?' + queryParams, signal)
