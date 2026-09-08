// Network layer: builds the API URLs for GET /api/people, /graph, /sources, /docs (see
// CLAUDE.md's stable API contract) and fetches them. No DOM, no rendering — callers decide
// what to do with the parsed JSON.

export const endpoint = (personId) => '/api/people/' + encodeURIComponent(personId)

export const params = ({ days, sort, limit, source, domain, kind = 'all', min = '2' }) =>
  new URLSearchParams({ days, sort, limit, min, source, kind, domain })

// The outlet sidebar picks `domain`, so its own /sources fetch must never send one back —
// spec amendment A1 (issue #26): sending domain here would hide every outlet but the
// selected one, right after the click that selected it.
export const sourcesParams = (opts) => {
  const p = params(opts)
  p.delete('domain')
  return p
}

export const json = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

export const loadPeople = (signal) => json('/api/people', signal)

export const loadGraph = (personId, queryParams, signal) => json(endpoint(personId) + '/graph?' + queryParams, signal)

export const loadSources = (personId, queryParams, signal) => json(endpoint(personId) + '/sources?' + queryParams, signal)

export const loadDocs = (personId, queryParams, signal) => json(endpoint(personId) + '/docs?' + queryParams, signal)
