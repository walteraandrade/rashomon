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

// `domain` travels only when a figure names an outlet.
export type DocsOpts = { days: string; source: string; term?: string; kind?: string; domain?: string; limit?: string }

export const docsParams = ({ days, source, term = '', kind = 'all', domain = '', limit = '5' }: DocsOpts) => {
  const q = new URLSearchParams({ days, source, term, kind, limit })
  if (domain) q.set('domain', domain)
  return q
}

export const json = async (url: string, signal?: AbortSignal): Promise<any> => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

// app.ts fetches /api/people by hand so its import graph stays the three figures.
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
