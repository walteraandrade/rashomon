// Network layer: builds the API URLs for GET /api/people, /graph, /sources, /docs, /testimony
// (see CLAUDE.md's stable API contract) and fetches them. No DOM, no rendering — callers decide
// what to do with the parsed JSON.

export const endpoint = (personId: string) => '/api/people/' + encodeURIComponent(personId)

// The kinds the atlas asks for, and the one it leaves out. GDELT's themes (kind 'theme') are
// its own topic codes -- econ_freetrade, env_oil -- machine labels nobody wrote in a sentence,
// so they read as noise next to real words on a map whose whole claim is "this is what people
// say". They stay in the API, and atlas-legacy.html still shows them; only the default recorte
// drops them. Spelled here rather than imported because api.ts imports nothing (CLAUDE.md's
// module direction), and shipped as a list because /graph takes kind as a comma-separated one.
export const ATLAS_KINDS = 'word,hashtag,phrase'

// The graph sentence's own controls, as every route-narrowing helper below reads them.
export type GraphOpts = { days: string; sort: string; limit: string; source: string; kind?: string; min?: string }

// `testimony=1` asks /graph for the per-term kikori mean (and the person's own, in the same
// scope) that the map's colour mask reads; the mask is a paint toggle on the client, so the
// data always comes along and flipping it never refetches.
// No `domain`: /graph and /docs accept one, but the page never narrows itself to an outlet.
// Picking an outlet is a reading inside the second figure and stops there, so the atlas and
// the documents always answer for the whole recorte.
export const params = ({ days, sort, limit, source, kind = ATLAS_KINDS, min = '2' }: GraphOpts) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, testimony: '1' })

// `sort` and `limit` leave the outlet list's own /sources call (issue #43): src/graph.ts's
// sourcesFor reads only person, days, source and domain, so echoing the term ordering and the
// term count made every sort or limit change look like a different query to the front-end memo
// and to any HTTP cache in front of it. `domain` is dropped too, and now never arrives anyway.
export const narrowToSources = (graphParams: URLSearchParams) => {
  const p = new URLSearchParams(graphParams)
  for (const ignored of ['domain', 'sort', 'limit', 'testimony']) p.delete(ignored)
  return p
}

export const sourcesParams = (opts: GraphOpts) => narrowToSources(params(opts))

// The testimony panel's own call (GET /api/people/:id/testimony): src/graph.ts's testimonyFor
// reads days, source and min, never domain, sort or limit, so only those travel (issue #43's
// rule). `min` is spelled out so the panel's "3 ou mais textos" copy in render.ts does not
// hang on a server default. `method` is left to the server, which resolves it through the
// same map `pnpm score` writes under; the response echoes the label it answered with.
export const narrowToTestimony = (graphParams: URLSearchParams) =>
  new URLSearchParams({ days: graphParams.get('days') ?? '30', source: graphParams.get('source') ?? 'all', min: '3' })

export const testimonyParams = (opts: GraphOpts) => narrowToTestimony(params(opts))

// The documents query, in one place because all three figures build one now: /docs reads term,
// kind, days, source, domain and limit and nothing the graph's own ordering carries, and the
// card always asks for five rows. `domain` travels only when a figure names an outlet -- the
// atlas and the ruler always answer for the whole recorte.
export type DocsOpts = { days: string; source: string; term?: string; kind?: string; domain?: string; limit?: string }

export const docsParams = ({ days, source, term = '', kind = 'all', domain = '', limit = '5' }: DocsOpts) => {
  const q = new URLSearchParams({ days, source, term, kind, limit })
  if (domain) q.set('domain', domain)
  return q
}

// Every payload below is whatever the route answered with: the front-end's own shapes live in
// format.ts and each figure narrows there, so this layer stays a fetch and a parse.
export const json = async (url: string, signal?: AbortSignal): Promise<any> => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

// app.ts fetches /api/people by hand instead of calling this: the shell's import graph is
// pinned to the two figure modules (test/atlas-modules-acceptance.test.ts), and importing
// api.ts there would widen it. Kept as the documented wrapper for the route; test/api.test.ts
// is what exercises it now that public/compare.html is gone.
export const loadPeople = (signal?: AbortSignal) => json('/api/people', signal)

export const loadGraph = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/graph?' + queryParams, signal)

export const loadSources = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/sources?' + queryParams, signal)

export const loadDocs = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/docs?' + queryParams, signal)

export const loadTestimony = (personId: string, queryParams: URLSearchParams, signal?: AbortSignal) =>
  json(endpoint(personId) + '/testimony?' + queryParams, signal)

// Cross-person by construction: /api/candidates is not nested under /people/:id, so it takes
// its own querystring rather than the graph's params().
export const candidatesQuery = ({ days, min = '3', limit = '30' }: { days: string; min?: string; limit?: string }) =>
  new URLSearchParams({ days, min, limit })

export const loadCandidates = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/candidates?' + queryParams, signal)

// The ruler figure's own call. /api/compare is not nested under /people/:id either (like
// /api/candidates), so both person ids travel as plain query params instead of one in the path.
// domain and lean stay at the server's own default 'all': this figure carries no control for
// either (issue #91 §2).
export const compareParams = ({ a, b, days, source, limit }: { a: string; b: string; days: string; source: string; limit: string }) =>
  new URLSearchParams({ a, b, days, source, limit, kind: ATLAS_KINDS })

export const loadCompare = (queryParams: URLSearchParams, signal?: AbortSignal) => json('/api/compare?' + queryParams, signal)
