import seedJson from '../seed.json' with { type: 'json' }
import { db, migrate } from './db.js'
import { nameTokens } from './extract.js'
import { sql } from './sql.js'
import { inTransaction } from './store.js'
import type { Person } from './types.js'

// The windows and single sources /graph can answer from graph_terms. Anything else (a
// comma list, a domain, a lean) stays on the live query. Mirrors DAYS and SOURCES in
// query.ts, which sits above this module and cannot be imported here.
export const WINDOWS = [7, 30, 365] as const
export const SOURCES = ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg', 'camara', 'senado', 'juridico', 'oficial', 'nicho'] as const

// grouping sets: one row per source plus one with source null, which becomes 'all'.
const windowScope = (days: number) => sql`
  scope as (
    select d.id, d.source from docs d where d.published_at >= now() - make_interval(days => ${days})
  )`

const universeQuery = (days: number) => sql`
  with ${windowScope(days)},
  tracked as (
    select s.id, s.source from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )
  insert into graph_terms_all (days, source, term, kind, c_t)
  select ${days}::int, coalesce(s.source, 'all'), t.term, t.kind, count(*)::int
  from doc_terms t join tracked s on s.id = t.doc_id
  group by grouping sets ((s.source, t.term, t.kind), (t.term, t.kind))`

// Every listed source gets a row even with zero docs, so /graph never falls back to the
// live scan for a source that simply has nothing in the window.
const scopesQuery = (days: number) => sql`
  with ${windowScope(days)},
  flagged as (
    select s.id, s.source, exists (select 1 from doc_persons dp where dp.doc_id = s.id) as tracked from scope s
  ),
  u as (
    select coalesce(source, 'all') as source, count(*)::int as docs, count(*) filter (where tracked)::int as tracked
    from flagged group by grouping sets ((source), ())
  ),
  ab as (
    select coalesce(s.source, 'all') as source, dp.person_id, count(*)::int as about
    from scope s join doc_persons dp on dp.doc_id = s.id
    group by grouping sets ((s.source, dp.person_id), (dp.person_id))
  ),
  wanted as (select unnest(${['all', ...SOURCES]}::text[]) as source)
  insert into graph_scopes (days, source, person_id, docs, tracked, about)
  select ${days}::int, w.source, p.id, coalesce(u.docs, 0), coalesce(u.tracked, 0), coalesce(ab.about, 0)
  from wanted w cross join persons p
  left join u on u.source = w.source
  left join ab on ab.source = w.source and ab.person_id = p.id`

// Same exclusion as graphQuery's term_p: the person's own name words, and phrases carrying one.
const personTermsQuery = (days: number, person: Person) => {
  const exclude = nameTokens(person)
  return sql`
  with ${windowScope(days)},
  about as (
    select s.id, s.source from scope s join doc_persons dp on dp.doc_id = s.id and dp.person_id = ${person.id}
  ),
  p as (
    select coalesce(a.source, 'all') as source, t.term, t.kind, count(*)::int as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any(${exclude}::text[]))
      and not (position(' ' in t.term) > 0 and string_to_array(t.term, ' ') && ${exclude}::text[])
    group by grouping sets ((a.source, t.term, t.kind), (t.term, t.kind))
  )
  insert into graph_terms (days, source, person_id, term, kind, c_pt, c_t, tone)
  select ${days}::int, p.source, ${person.id}, p.term, p.kind, p.c_pt, ta.c_t, p.tone
  from p join graph_terms_all ta on ta.days = ${days}::int and ta.source = p.source and ta.term = p.term and ta.kind = p.kind`
}

const run = (q: { text: string; values: unknown[] }) => db.query(q.text, q.values)

// One window per transaction: readers see the previous build until the new one commits.
const buildWindow = (days: number, persons: Person[]) =>
  inTransaction(async () => {
    await db.query(`delete from graph_terms where days = $1`, [days])
    await db.query(`delete from graph_terms_all where days = $1`, [days])
    await db.query(`delete from graph_scopes where days = $1`, [days])
    await run(universeQuery(days))
    await run(scopesQuery(days))
    await persons.reduce<Promise<void>>(async (acc, p) => (await acc, void (await run(personTermsQuery(days, p)))), Promise.resolve())
  })

export type AggregateReport = { windows: number[]; scopes: number; terms: number; ms: number }

// The tables the build fills, for the owner process (ingest, reindex) to analyze afterwards.
export const AGGREGATE_TABLES = ['graph_scopes', 'graph_terms_all', 'graph_terms'] as const

// Rebuilds the three window tables from docs/doc_terms/doc_persons. Idempotent; the whole
// build reads the corpus once per window per person and once per window for the universe.
// Never analyzes: maintenance belongs to the process that owns DATA_DIR.
export const buildGraphAggregates = async (persons: Person[], windows: readonly number[] = WINDOWS): Promise<AggregateReport> => {
  const started = performance.now()
  await windows.reduce<Promise<void>>(async (acc, d) => (await acc, void (await buildWindow(d, persons))), Promise.resolve())
  const { rows: s } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes`)
  const { rows: t } = await db.query<{ n: number }>(`select count(*)::int as n from graph_terms`)
  return { windows: [...windows], scopes: s[0].n, terms: t[0].n, ms: performance.now() - started }
}

export const queries = { universe: universeQuery, scopes: scopesQuery, personTerms: personTermsQuery }

const main = async () => {
  await migrate()
  const report = await buildGraphAggregates(seedJson as Person[])
  console.log(`graph aggregates: ${report.scopes} scopes, ${report.terms} terms, windows ${report.windows.join('/')}, ${Math.round(report.ms)} ms`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
