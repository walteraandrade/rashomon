import type { queries as graphQueries } from '../../src/graph.js'
import type { Sql } from '../../src/sql.js'
import type { Person } from '../../src/types.js'

export type Queries = typeof graphQueries

export type Ctx = { person: Person; other: Person; ids: string[]; term: string; window: number }

export type ReadCase = { name: string; sql: (q: Queries, c: Ctx) => Sql }

// The atlas sends the full kind set; rising keeps its own fixed three.
const KINDS = 'word,hashtag,phrase,org'

const scope = (w: number) => ({ days: w, source: 'all', domain: 'all', lean: 'all', country: 'br' as const })
const graphQ = (w: number, communities: boolean) => ({ ...scope(w), kind: KINDS, limit: 40, min: 2, sort: 'pmi' as const, communities })
const docsQ = (w: number, term: string) => ({ ...scope(w), term, kind: term ? 'word' : KINDS, limit: 50, offset: 0, day: '', with: '' })
const weekQ = (w: number) => ({ ...scope(w), kind: KINDS, limit: 8 })

// One entry per statement a route sends, with the parameters the page sends, the window swapped in.
export const readCases: ReadCase[] = [
  { name: 'graph', sql: (q, c) => q.graph(c.person, graphQ(c.window, false)) },
  { name: 'graphFast', sql: (q, c) => q.graphFast(c.person, graphQ(c.window, true)) },
  { name: 'links', sql: (q, c) => q.links(c.person, scope(c.window), c.ids) },
  { name: 'sources', sql: (q, c) => q.sources(c.person, scope(c.window)) },
  { name: 'docs', sql: (q, c) => q.docs(c.person, docsQ(c.window, '')) },
  { name: 'docs.term', sql: (q, c) => q.docs(c.person, docsQ(c.window, c.term)) },
  { name: 'docsCount', sql: (q, c) => q.docsCount(c.person, docsQ(c.window, '')) },
  { name: 'timeline', sql: (q, c) => q.timeline(c.person, { ...docsQ(c.window, ''), bucket: 'day' }) },
  { name: 'rising', sql: (q, c) => q.rising(c.person, { ...scope(c.window), kind: 'word,hashtag,phrase', baseline: 30, min: 3, limit: 40 }) },
  { name: 'tone', sql: (q, c) => q.tone({ days: c.window, min: 3 }) },
  { name: 'agenda', sql: (q, c) => q.agenda({ days: c.window, source: 'all', min: 5, limit: 30 }) },
  { name: 'testimonySummary', sql: (q, c) => q.testimonySummary(c.person, { days: c.window, source: 'all', method: 'stub', min: 3 }) },
  { name: 'termTestimony', sql: (q, c) => q.termTestimony(c.person, scope(c.window), 'stub', c.ids) },
  { name: 'candidates', sql: (q, c) => q.candidates({ days: c.window, min: 5, limit: 50 }) },
  { name: 'compare', sql: (q, c) => q.compare(c.person, c.other, { ...scope(c.window), kind: KINDS, limit: 40, bridges: false }) },
  {
    name: 'lenses',
    sql: (q, c) =>
      q.lenses(c.person, {
        days: c.window,
        kind: KINDS,
        limit: 40,
        bridges: false,
        a: { lens: 'source:gkg', domain: 'all', lean: 'all', source: 'gkg' },
        b: { lens: 'source:rss', domain: 'all', lean: 'all', source: 'rss' },
      }),
  },
  { name: 'week', sql: (q, c) => q.week(c.person, weekQ(c.window)) },
  { name: 'weekTestimony', sql: (q, c) => q.weekTestimony(c.person, weekQ(c.window), 'stub') },
  { name: 'comention', sql: (q, c) => q.comention({ days: c.window, source: 'all', lean: 'all', min: 3 }) },
]

export const BUILD_CASE = 'aggregate'

export const ALL_CASES = [BUILD_CASE, ...readCases.map((c) => c.name)]

// The id list the atlas hands to links/termTestimony: the person's 40 most frequent terms in the window.
// The seed is legacy-shaped until the tree's own migrate converts it, so one seed serves a base tree and a candidate.
export const idsSql = (converted: boolean) => `
  select ${converted ? 'v.kind || \':\' || v.term' : 't.kind || \':\' || t.term'} as id
  from doc_terms t ${converted ? 'join terms v on v.id = t.term_id ' : ''}join doc_persons p on p.doc_id = t.doc_id join docs d on d.id = t.doc_id
  where p.person_id = $1 and d.published_at >= now() - make_interval(days => $2::int)
  group by ${converted ? 'v.id, v.kind, v.term' : 't.kind, t.term'} order by count(*) desc, ${converted ? 'v.kind, v.term' : 't.kind, t.term'} limit 40`

type Query = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

export const idsFor = async (query: Query, person: string, window: number): Promise<string[]> => {
  const converted = (await query(`select to_regclass('public.terms') is not null as converted`)).rows[0].converted === true
  return (await query(idsSql(converted), [person, window])).rows.map((r) => String(r.id))
}

export const buildResultSql = [
  `select days, source, person_id, docs, tracked, about from graph_scopes where days = $1 order by source, person_id`,
  `select * from graph_terms where days = $1 order by source, person_id, term, kind`,
  `select * from term_communities where days = $1 order by source, person_id, term, kind`,
]
