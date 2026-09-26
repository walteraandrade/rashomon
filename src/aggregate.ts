import seedJson from '../seed.json' with { type: 'json' }
import { communities as louvainCommunities, type CommunityEdge } from './communities.js'
import { db, migrateP } from './db.js'
import { nameTokens } from './extract.js'
import { DAYS, LIMITS, MINS, SOURCES } from './query.js'
import { countryFilter, isName, pmiRank, signatureFloor } from './scoring.js'
import { sql } from './sql.js'
import { inTransaction } from './store.js'
import type { Person } from './types.js'

// grouping sets: one row per source plus one with source null, which becomes 'all'. No country
// axis here: this always precomputes the default (country=br) scope; 'pt'/'all' fall back live.
const windowScope = (days: number) => sql`
  scope as (
    select d.id, d.source from docs d
    where d.published_at >= now() - make_interval(days => ${days})
      and ${countryFilter('br')}
  )`

// Session-temp, dropped on commit. Safe as a fixed name only while windows build sequentially:
// a concurrent-window build needs a per-window-unique name, or two windows on one session collide.
const universeQuery = (days: number) => sql`
  create temp table graph_terms_all on commit drop as
  with ${windowScope(days)},
  tracked as (
    select s.id, s.source from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )
  select ${days}::int as days, coalesce(s.source, 'all') as source, t.term, t.kind, count(*)::int as c_t
  from doc_terms t join tracked s on s.id = t.doc_id
  group by grouping sets ((s.source, t.term, t.kind), (t.term, t.kind))`

// Every listed source gets a row even with zero docs, so /graph never falls back to the
// live scan for a source that simply has nothing in the window. Persons are the argument
// (the list personTermsQuery iterates, so a scope row always has its terms) narrowed to
// the table (the foreign key): a person on one side only gets no row and stays live.
const scopesQuery = (days: number, persons: Pick<Person, 'id'>[]) => sql`
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
  wanted as (select unnest(${['all', ...SOURCES]}::text[]) as source),
  p as (select id from persons where id = any(${persons.map((p) => p.id)}::text[]))
  insert into graph_scopes (days, source, person_id, docs, tracked, about)
  select ${days}::int, w.source, p.id, coalesce(u.docs, 0), coalesce(u.tracked, 0), coalesce(ab.about, 0)
  from wanted w cross join p
  left join u on u.source = w.source
  left join ab on ab.source = w.source and ab.person_id = p.id`

// The most rows any /graph can ask for. The build keeps, per (source, kind), the top `TOP` rows of
// every ordering the route can request (by count, and by pmi * ln(1 + count) once per `min` in MINS),
// so below that ceiling the fast query's own `order by ... limit` reads exactly what the live one would.
export const TOP = Math.max(...LIMITS)

// Same exclusion as graphQuery's term_p: the person's own name words, and phrases carrying one.
// `pmi` is spelled exactly as graphFastQuery spells it, so the ranks here order the same floats
// the read orders. The signature keeps its own five: top pmi among count >= max(3, 5% of about).
const personTermsQuery = (days: number, person: Person, top = TOP) => {
  const exclude = nameTokens(person)
  const byPmi = (m: number) => sql.raw(`by_pmi_${m}`)
  const ranks = MINS.map(
    (m) => sql`row_number() over (partition by source, kind, c_pt >= ${m} order by ${pmiRank(sql.raw('c_pt'))} desc, term, kind) as ${byPmi(m)}`,
  )
  const kept = MINS.map((m) => sql`(c_pt >= ${m} and ${byPmi(m)} <= ${top})`)
  return sql`
  with ${windowScope(days)},
  about as (
    select s.id, s.source from scope s join doc_persons dp on dp.doc_id = s.id and dp.person_id = ${person.id}
  ),
  p as (
    select coalesce(a.source, 'all') as source, t.term, t.kind, count(*)::int as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.id = t.doc_id join docs d on d.id = t.doc_id
    where not ${isName(sql.raw('t.term'), exclude)}
    group by grouping sets ((a.source, t.term, t.kind), (t.term, t.kind))
  ),
  scored as (
    select p.source, p.term, p.kind, p.c_pt, ta.c_t, p.tone, gs.about,
      ln((p.c_pt::float8 * gs.tracked::float8) / (gs.about::float8 * ta.c_t::float8)) / ln(2) as pmi
    from p
    join graph_terms_all ta on ta.days = ${days}::int and ta.source = p.source and ta.term = p.term and ta.kind = p.kind
    join graph_scopes gs on gs.days = ${days}::int and gs.source = p.source and gs.person_id = ${person.id}
  ),
  ranked as (
    select source, term, kind, c_pt, c_t, tone, about,
      row_number() over (partition by source, kind order by c_pt desc, term, kind) as by_count,
      ${sql.join(ranks)},
      row_number() over (partition by source, c_pt >= ${signatureFloor(sql.raw('about'))} order by pmi desc, term, kind) as by_signature
    from scored
  )
  insert into graph_terms (days, source, person_id, term, kind, c_pt, c_t, tone)
  select ${days}::int, source, ${person.id}, term, kind, c_pt, c_t, tone
  from ranked
  where by_count <= ${top}
    or ${sql.join(kept, '\n    or ')}
    or (c_pt >= ${signatureFloor(sql.raw('about'))} and by_signature <= 5)`
}

// `create table ... as` carries no key, and every personTermsQuery joins the universe on it.
const universeKey = sql`alter table graph_terms_all add primary key (days, source, term, kind)`

const windowStatements = (days: number, persons: Person[], top = TOP) => [
  sql`delete from graph_terms where days = ${days}`,
  sql`delete from graph_scopes where days = ${days}`,
  universeQuery(days),
  universeKey,
  scopesQuery(days, persons),
  ...persons.map((p) => personTermsQuery(days, p, top)),
]

const run = (q: { text: string; values: unknown[] }) => db.query(q.text, q.values)

// Fixed: a community number means something only inside one build, never across windows or a library bump.
const COMMUNITY_SEED = 42

const scopePairsQuery = (days: number) => sql`select distinct source, person_id from graph_terms where days = ${days}`

const keptTermsQuery = (days: number, source: string, personId: string) => sql`
  select term, kind from graph_terms where days = ${days} and source = ${source} and person_id = ${personId}`

// linksQuery's join shape against graph_terms' own kept (term, kind) set instead of a live
// per-request `ids` array, which is why this cannot simply import linksQuery.
const communityEdgesQuery = (days: number, source: string, personId: string) => sql`
  with scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => ${days})
      and ${countryFilter('br')}
      and (${source} = 'all' or d.source = ${source})
  ),
  about as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = ${personId}
  ),
  kept as (
    select term, kind from graph_terms where days = ${days} and source = ${source} and person_id = ${personId}
  ),
  hits as (
    select t.doc_id, t.kind || ':' || t.term as id
    from doc_terms t
    join kept k on k.kind = t.kind and k.term = t.term
    join about a on a.doc_id = t.doc_id
  )
  select a.id as a, b.id as b, count(*)::int as count
  from hits a join hits b on a.doc_id = b.doc_id and a.id < b.id
  group by 1, 2 having count(*) >= 2`

const insertCommunitiesQuery = (days: number, source: string, personId: string, terms: string[], kinds: string[], communityIds: number[]) => sql`
  insert into term_communities (days, source, person_id, term, kind, community)
  select ${days}::int, ${source}, ${personId}, u.term, u.kind, u.community
  from unnest(${terms}::text[], ${kinds}::text[], ${communityIds}::int[]) as u(term, kind, community)`

// kind never carries a colon, so splitting on the first one recovers term/kind from an id.
const splitId = (id: string): [kind: string, term: string] => {
  const at = id.indexOf(':')
  return [id.slice(0, at), id.slice(at + 1)]
}

// One Louvain pass per (days, source, person) with graph_terms rows. A term with no surviving
// edge still gets its own singleton row, via the self-referencing entry communities() expects.
const buildCommunitiesForWindow = async (days: number) => {
  await run(sql`delete from term_communities where days = ${days}`)
  const { rows: pairs } = await run(scopePairsQuery(days))
  for (const { source, person_id: personId } of pairs as { source: string; person_id: string }[]) {
    const { rows: kept } = await run(keptTermsQuery(days, source, personId))
    const keptRows = kept as { term: string; kind: string }[]
    if (keptRows.length === 0) continue
    const keptIds = keptRows.map((k) => `${k.kind}:${k.term}`)
    const { rows: edgeRows } = await run(communityEdgesQuery(days, source, personId))
    const edges: CommunityEdge[] = [
      ...(edgeRows as { a: string; b: string; count: number }[]),
      ...keptIds.map((id) => ({ a: id, b: id, count: 0 })),
    ]
    const assignment = louvainCommunities(edges, COMMUNITY_SEED)
    const terms: string[] = []
    const kinds: string[] = []
    const communityIds: number[] = []
    for (const id of keptIds) {
      const community = assignment.get(id)
      if (community === undefined) continue
      const [kind, term] = splitId(id)
      terms.push(term)
      kinds.push(kind)
      communityIds.push(community)
    }
    if (terms.length) await run(insertCommunitiesQuery(days, source, personId, terms, kinds, communityIds))
  }
}

// One window per transaction; the community step runs last, over the graph_terms rows just written.
const buildWindow = async (days: number, persons: Person[], top: number) =>
  inTransaction(async () => {
    for (const q of windowStatements(days, persons, top)) await run(q)
    await buildCommunitiesForWindow(days)
  })

export type AggregateReport = { windows: number[]; scopes: number; terms: number; ms: number }

// The tables the build fills, for the owner process (ingest, reindex) to analyze afterwards.
export const AGGREGATE_TABLES = ['graph_scopes', 'graph_terms'] as const

// Rebuilds graph_scopes and graph_terms from docs/doc_terms/doc_persons. Idempotent; the whole
// build reads the corpus once per window per person and once per window for the universe.
// `top` is the per-ordering ceiling (TOP in production; tests lower it to see the cut).
// Never analyzes: maintenance belongs to the process that owns DATA_DIR.
export const buildGraphAggregates = async (persons: Person[], windows: readonly number[] = DAYS, top = TOP): Promise<AggregateReport> => {
  const started = performance.now()
  await windows.reduce<Promise<void>>(async (acc, d) => (await acc, void (await buildWindow(d, persons, top))), Promise.resolve())
  const { rows: s } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes`)
  const { rows: t } = await db.query<{ n: number }>(`select count(*)::int as n from graph_terms`)
  return { windows: [...windows], scopes: s[0].n, terms: t[0].n, ms: performance.now() - started }
}

// True once any window has been built, in both tables. `pnpm aggregate --if-missing`
// (warm.yml, after a deploy) uses it to skip the build when the last ingest already left the
// tables full. Scopes alone do not count: graph_terms was emptied by hand under a full
// graph_scopes once (2026-09-18) and the skip kept the site blank until the next ingest.
export const hasGraphAggregates = async (): Promise<boolean> => {
  const { rows } = await db.query<{ built: boolean }>(
    `select ${AGGREGATE_TABLES.map((t) => `exists (select 1 from ${t})`).join(' and ')} as built`,
  )
  return rows[0].built
}

export const queries = { universe: universeQuery, scopes: scopesQuery, personTerms: personTermsQuery, window: windowStatements }

const main = async (argv: string[]) => {
  await migrateP()
  if (argv.includes('--if-missing') && (await hasGraphAggregates())) {
    console.log('graph aggregates: already built, skipping')
  } else {
    const report = await buildGraphAggregates(seedJson as Person[])
    console.log(`graph aggregates: ${report.scopes} scopes, ${report.terms} terms, windows ${report.windows.join('/')}, ${Math.round(report.ms)} ms`)
  }
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2))
