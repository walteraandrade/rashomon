// Network layer: builds the API URLs for GET /api/people, /graph, /sources, /docs (see
// CLAUDE.md's stable API contract) and fetches them. No DOM, no rendering — callers decide
// what to do with the parsed JSON.

/** @param {string} personId */
export const endpoint = (personId) => '/api/people/' + encodeURIComponent(personId)

/** @param {{ days: string, sort: string, limit: string, source: string, domain: string, kind?: string, min?: string }} opts */
export const params = ({ days, sort, limit, source, domain, kind = 'all', min = '2' }) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, domain })

// The outlet sidebar picks `domain`, so its own /sources fetch must never send one back —
// spec amendment A1 (issue #26): sending domain here would hide every outlet but the
// selected one, right after the click that selected it.
/** @param {Parameters<typeof params>[0]} opts */
export const sourcesParams = (opts) => {
  const p = params(opts)
  p.delete('domain')
  return p
}

/** @param {string} url @param {AbortSignal} [signal] */
export const json = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

/** @param {AbortSignal} [signal] */
export const loadPeople = (signal) => json('/api/people', signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadGraph = (personId, queryParams, signal) => json(endpoint(personId) + '/graph?' + queryParams, signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadSources = (personId, queryParams, signal) => json(endpoint(personId) + '/sources?' + queryParams, signal)

/** @param {string} personId @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadDocs = (personId, queryParams, signal) => json(endpoint(personId) + '/docs?' + queryParams, signal)

// Cross-person by construction: /api/candidates is not nested under /people/:id, so it takes
// its own querystring rather than the graph's params().
/** @param {{ days: string, min?: string, limit?: string }} opts */
export const candidatesQuery = ({ days, min = '3', limit = '30' }) => new URLSearchParams({ days, min, limit })

/** @param {URLSearchParams} queryParams @param {AbortSignal} [signal] */
export const loadCandidates = (queryParams, signal) => json('/api/candidates?' + queryParams, signal)
