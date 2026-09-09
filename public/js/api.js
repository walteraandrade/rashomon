// Network layer: builds the API URLs for GET /api/people, /graph, /sources, /docs, /testimony
// (see CLAUDE.md's stable API contract) and fetches them. No DOM, no rendering — callers decide
// what to do with the parsed JSON.

/** @param {string} personId */
export const endpoint = (personId) => '/api/people/' + encodeURIComponent(personId)

// The kinds the atlas asks for, and the one it leaves out. GDELT's themes (kind 'theme') are
// its own topic codes -- econ_freetrade, env_oil -- machine labels nobody wrote in a sentence,
// so they read as noise next to real words on a map whose whole claim is "this is what people
// say". They stay in the API, and atlas-legacy.html still shows them; only the default recorte
// drops them. Spelled here rather than imported because api.js imports nothing (CLAUDE.md's
// module direction), and shipped as a list because /graph takes kind as a comma-separated one.
export const ATLAS_KINDS = 'word,hashtag,phrase'

// `testimony=1` asks /graph for the per-term kikori mean (and the person's own, in the same
// scope) that the map's colour mask reads; the mask is a paint toggle on the client, so the
// data always comes along and flipping it never refetches.
// No `domain`: /graph and /docs accept one, but the page never narrows itself to an outlet.
// Picking an outlet is a reading inside the second figure and stops there, so the atlas and
// the documents always answer for the whole recorte.
/** @param {{ days: string, sort: string, limit: string, source: string, kind?: string, min?: string }} opts */
export const params = ({ days, sort, limit, source, kind = ATLAS_KINDS, min = '2' }) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, testimony: '1' })

// `sort` and `limit` leave the outlet list's own /sources call (issue #43): src/graph.ts's
// sourcesFor reads only person, days, source and domain, so echoing the term ordering and the
// term count made every sort or limit change look like a different query to the front-end memo
// and to any HTTP cache in front of it. `domain` is dropped too, and now never arrives anyway.
/** @param {URLSearchParams} graphParams */
export const narrowToSources = (graphParams) => {
  const p = new URLSearchParams(graphParams)
  for (const ignored of ['domain', 'sort', 'limit', 'testimony']) p.delete(ignored)
  return p
}

/** @param {Parameters<typeof params>[0]} opts */
export const sourcesParams = (opts) => narrowToSources(params(opts))

// The testimony panel's own call (GET /api/people/:id/testimony): src/graph.ts's testimonyFor
// reads days, source and min, never domain, sort or limit, so only those travel (issue #43's
// rule). `min` is spelled out so the panel's "3 ou mais textos" copy in render.js does not
// hang on a server default. `method` is left to the server, which resolves it through the
// same map `pnpm score` writes under; the response echoes the label it answered with.
/** @param {URLSearchParams} graphParams */
export const narrowToTestimony = (graphParams) => new URLSearchParams({ days: graphParams.get('days') ?? '30', source: graphParams.get('source') ?? 'all', min: '3' })

/** @param {Parameters<typeof params>[0]} opts */
export const testimonyParams = (opts) => narrowToTestimony(params(opts))

/** @param {string} url @param {AbortSignal} [signal] */
export const json = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

// app.js fetches /api/people by hand instead of calling this: the shell's import graph is
// pinned to the two figure modules (test/atlas-modules-acceptance.test.ts), and importing
// api.js there would widen it. Kept as the documented wrapper for the route, and used by
// public/compare.html and test/api.test.ts.
/** @param {AbortSignal} [signal] */
export const loadPeople = (signal) => json('/api/people', signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadGraph = (personId, queryParams, signal) => json(endpoint(personId) + '/graph?' + queryParams, signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadSources = (personId, queryParams, signal) => json(endpoint(personId) + '/sources?' + queryParams, signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadDocs = (personId, queryParams, signal) => json(endpoint(personId) + '/docs?' + queryParams, signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadTestimony = (personId, queryParams, signal) => json(endpoint(personId) + '/testimony?' + queryParams, signal)

// Cross-person by construction: /api/candidates is not nested under /people/:id, so it takes
// its own querystring rather than the graph's params().
/** @param {{ days: string, min?: string, limit?: string }} opts */
export const candidatesQuery = ({ days, min = '3', limit = '30' }) => new URLSearchParams({ days, min, limit })

/** @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadCandidates = (queryParams, signal) => json('/api/candidates?' + queryParams, signal)

// The ruler figure's own call. /api/compare is not nested under /people/:id either (like
// /api/candidates), so both person ids travel as plain query params instead of one in the path.
// domain and lean stay at the server's own default 'all': this figure carries no control for
// either (issue #91 §2).
/** @param {{ a: string, b: string, days: string, source: string, limit: string }} opts */
export const compareParams = ({ a, b, days, source, limit }) => new URLSearchParams({ a, b, days, source, limit, kind: ATLAS_KINDS })

/** @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadCompare = (queryParams, signal) => json('/api/compare?' + queryParams, signal)
