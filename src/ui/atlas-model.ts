import * as api from './api.js'
import type { Term } from './format.js'

type Person = { id: string; name: string }

export const layoutKey = (person: Person | undefined, terms: Term[], sort: string, limit: string) =>
  JSON.stringify(person ? [person.id, person.name, sort, limit, terms.map((n) => [n.id, n.term, n.kind, n.count, n.pmi, n.reach ?? null])] : [])

// `sort` and `min` are dropped: parseDocsQuery reads neither, so keeping them would make every
// sort change look like a new query to the memo and any HTTP cache.
export const docsQuery = (base: URLSearchParams, n: Term | null) =>
  api.docsParams({ days: base.get('days') ?? '21', source: base.get('source') ?? 'all', term: n ? n.term : '', kind: n ? n.kind : 'all' })

export const scopeKeys = (personId: string, graphParams: URLSearchParams, term: Term | null = null) => ({
  graph: personId + '?' + graphParams,
  sources: personId + '?' + api.narrowToSources(graphParams),
  docs: personId + '?' + docsQuery(graphParams, term),
  testimony: personId + '?' + api.narrowToTestimony(graphParams),
})
