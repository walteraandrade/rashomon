import { db } from './db.js'
import { nameTokens } from './extract.js'
import { labelFor, resolveScope } from './outlets.js'
import { sql, type Sql } from './sql.js'
import type { Person } from './types.js'

const run = <T>(q: Sql) => db.query<T>(q.text, q.values)

export type GraphQuery = {
  days: number
  source: string
  domain: string
  lean: string
  kind: string
  limit: number
  min: number
  sort: 'count' | 'pmi'
  // `testimony=1` adds per-term kikori means; absent by default so the response shape is stable.
  method?: string | null
}

export type DocsQuery = {
  term: string
  kind: string
  days: number
  source: string
  domain: string
  lean: string
  limit: number
  offset: number
}

export type RisingQuery = {
  days: number
  baseline: number
  source: string
  domain: string
  lean: string
  kind: string
  limit: number
  min: number
}

export type TimelineQuery = {
  term: string
  kind: string
  days: number
  source: string
  domain: string
  lean: string
  bucket: 'day' | 'week'
}

export type ToneQuery = {
  days: number
  min: number
}

export type TestimonyQuery = {
  days: number
  source: string
  method: string
  min: number
}

// No `min` (see CompareQuery): a term present for one side and absent for the other is a
// measured null, so a floor tied to one side's count cannot apply symmetrically. No `sort`:
// both selection criteria always run, see compareQuery.
export type CompareQuery = {
  days: number
  source: string
  domain: string
  lean: string
  kind: string
  limit: number
}

type TermRow = { term: string; kind: string; count: number; pmi: number; tone: number | null }
type SignatureRow = { term: string; kind: string; count: number; pmi: number }
type SourceRow = { domain: string | null; source: string; docs: number; tone: number | null; tone_n: number }
type LinkRow = { s: string; t: string; count: number }
type Stats = { docs: number; about: number }
type GraphAggregates = Stats & { nodes: TermRow[]; signature: SignatureRow[] }
type DocRow = { id: number; source: string; domain: string | null; published_at: Date; text: string; uri: string; tone: number | null }
type RisingRow = { term: string; kind: string; count_recent: number; count_baseline: number; lift: number }
type TimelineRow = { bucket_start: Date; count: number }
type ToneCellRow = { person_id: string; domain: string; tone: number; n: number }
type ToneListRow = { id: string; name: string }
type CompareTermRow = {
  term: string
  kind: string
  is_name_a: boolean
  is_name_b: boolean
  a_count: number | null
  a_pmi: number | null
  a_tone: number | null
  b_count: number | null
  b_pmi: number | null
  b_tone: number | null
}
type CompareAggregates = { about_a: number; about_b: number; terms: CompareTermRow[] }

// `source` must already be normalized by parseSourceList; an unknown or empty source scopes to
// zero docs. domain+lean resolve into the effective domain scope; an empty intersection produces
// an empty array for `= any(...)` and correctly matches nothing.
type Scope = { days: number; source: string; domain: string; lean: string }
const scopeCte = (person: Person, q: Scope) => {
  const { domain } = resolveScope(q.domain, q.lean)
  return sql`
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => ${q.days})
      and (${q.source} = 'all' or d.source = any(string_to_array(${q.source}, ',')))
      and (${domain} = 'all' or d.domain = any(string_to_array(${domain}, ',')))
  ),
  about as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = ${person.id}
  )`
}

// PMI's universe: doc_terms only exists for docs naming at least one tracked person, so the
// numerator's universe is that set; n.total and term_all must be restricted to it too.
const trackedCte = sql`
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`

// One statement for nodes, signature and stats; `materialized` is spelled out rather than left
// to the planner. term_p is not kind-filtered: signature ignores kind, and the nodes filter is
// on a group key, so applying it after the aggregate selects the same rows. term_all stays
// unrestricted even though it only feeds an inner join against term_p: narrowing it was measured
// as slower (index scan + merge-join vs seq scan). c_pt/c_t are count(*): doc_terms' PK makes
// doc_id unique per (term, kind) group, so count(distinct) was pure cost. A person's own name
// words are dropped by the exclude filter; phrases carrying them by namePhrase. `position(' ' in
// ...)` guards the string_to_array split so single words (the vast majority) never pay for it.
const namePhrase = (names: string[]) => sql`(position(' ' in t.term) > 0 and string_to_array(t.term, ' ') && ${names}::text[])`

// compareQuery's flag for "this (term, kind) key is (or contains) that side's own name word":
// evaluated on the unioned key rather than on doc_terms.term, so it cannot reuse namePhrase.
const isName = (col: Sql, names: string[]) =>
  sql`(${col} = any(${names}::text[]) or (position(' ' in ${col}) > 0 and string_to_array(${col}, ' ') && ${names}::text[]))`

const graphQuery = (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const sortKey = sql`(case when ${q.sort} = 'pmi' then pmi * ln(1 + count) else count end)`
  return sql`
  with ${scopeCte(person, q)}, ${trackedCte},
  n as materialized (select count(*)::float8 as total from tracked),
  np as materialized (select count(*)::float8 as total from about),
  term_p as materialized (
    select t.term, t.kind, count(*)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any(${exclude}::text[])) and not ${namePhrase(exclude)}
    group by 1, 2
  ),
  term_all as materialized (
    select t.term, t.kind, count(*)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  nodes_scored as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= ${q.min} and (${q.kind} = 'all' or p.kind = any(string_to_array(${q.kind}, ',')))
  ),
  nodes_top as (
    select term, kind, count,
      round(pmi::numeric, 2)::float8 as pmi_rounded,
      round(tone::numeric, 2)::float8 as tone_rounded,
      ${sortKey} as sort_key
    from nodes_scored
    order by ${sortKey} desc, term, kind
    limit ${q.limit}
  ),
  signature_scored as (
    select p.term, p.kind, p.c_pt::int as count,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= greatest(3, np.total * 0.05)
  ),
  signature_top as (
    select term, kind, count, round(pmi::numeric, 2)::float8 as pmi
    from signature_scored
    order by pmi desc, term, kind
    limit 5
  )
  select
    (select count(*) from scope)::int as docs,
    (select count(*) from about)::int as about,
    coalesce((
      select json_agg(json_build_object('term', term, 'kind', kind, 'count', count, 'pmi', pmi_rounded, 'tone', tone_rounded)
        order by sort_key desc, term, kind)
      from nodes_top
    ), '[]'::json) as nodes,
    coalesce((
      select json_agg(json_build_object('term', term, 'kind', kind, 'count', count, 'pmi', pmi) order by pmi desc, term, kind)
      from signature_top
    ), '[]'::json) as signature`
}

// count(*): doc_terms' PK + about's PK (doc_persons with person_id fixed) make doc_id unique
// inside each (s, t) group. Order by is spelled out rather than relying on plan emission order.
const linksQuery = (person: Person, q: Scope, ids: string[]) => sql`
  with ${scopeCte(person, q)}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(*)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any(${ids}::text[]) and (b.kind || ':' || b.term) = any(${ids}::text[])
  group by 1, 2 having count(*) >= 2
  order by 1, 2`

// Per-term testimony means for the mask that colours the map: each term's mean score minus
// the person's own mean over the same `about`, so the colour shows distance from the person
// rather than from zero (cancels the name prior). Runs only when asked; count(*) is one row
// per doc per term by doc_terms' PK.
const termTestimonyQuery = (person: Person, q: Scope, method: string, ids: string[]) => sql`
  with ${scopeCte(person, q)},
  scored as (
    select a.doc_id, dt.score
    from about a join doc_testimony dt on dt.doc_id = a.doc_id and dt.person_id = ${person.id} and dt.method = ${method}
    where dt.score is not null
  )
  select
    (select json_build_object('score', round(avg(score)::numeric, 2)::float8, 'n', count(*)::int) from scored) as overall,
    coalesce((
      select json_agg(json_build_object('id', id, 'score', score, 'n', n) order by id) from (
        select t.kind || ':' || t.term as id, round(avg(s.score)::numeric, 2)::float8 as score, count(*)::int as n
        from doc_terms t join scored s on s.doc_id = t.doc_id
        where (t.kind || ':' || t.term) = any(${ids}::text[])
        group by 1
      ) x
    ), '[]'::json) as terms`

type TermTestimonyRow = { overall: { score: number | null; n: number }; terms: { id: string; score: number; n: number }[] }

const sourcesQuery = (person: Person, q: Scope) => sql`
  with ${scopeCte(person, q)}
  select d.domain, d.source, count(*)::int as docs,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as tone_n
  from docs d join about a on a.doc_id = d.id
  group by 1, 2 order by docs desc, domain limit 80`

export const sourcesFor = async (person: Person, q: GraphQuery) => {
  const { rows } = await run<SourceRow>(sourcesQuery(person, q))
  return rows.map((r) => ({ ...r, ...labelFor(r.domain) }))
}

// term/kind reuse the doc_terms (kind, term) index via exists, so a doc carrying the term
// under two kinds is still counted/returned once. An unrecognized kind falls back to 'all'.
// Exported so tests can compare the kind array against query.ts's KINDS without a third copy.
const docsWhere = (term: string, kind: string) => sql`(
    ${term} = '' or exists (
      select 1 from doc_terms t where t.doc_id = d.id and t.term = ${term}
        and (${kind} = 'all' or t.kind = any(string_to_array(${kind}, ',')) or not (string_to_array(${kind}, ',') <@ array['hashtag', 'word', 'phrase']))
    )
  )`
export const docsWhereSql = docsWhere('', 'all').text

const docsQuery = (person: Person, q: DocsQuery) => sql`
  with ${scopeCte(person, q)}
  select d.id, d.source, d.domain, d.published_at, d.text, d.uri, d.tone
  from docs d join about a on a.doc_id = d.id
  where ${docsWhere(q.term, q.kind)}
  order by d.published_at desc, d.id desc
  limit ${q.limit} offset ${q.offset}`

const docsCountQuery = (person: Person, q: DocsQuery) => sql`
  with ${scopeCte(person, q)}
  select count(*)::int as total
  from docs d join about a on a.doc_id = d.id
  where ${docsWhere(q.term, q.kind)}`

export const docsFor = async (person: Person, q: DocsQuery) => {
  const { outlets } = resolveScope(q.domain, q.lean)
  const [docs, count] = await Promise.all([run<DocRow>(docsQuery(person, q)), run<{ total: number }>(docsCountQuery(person, q))])
  return { total: count.rows[0].total, docs: docs.rows, outlets }
}

// Buckets count backward from now() in fixed steps; i = 0 is the most recent, open-ended so
// future-dated docs land somewhere and the sum-of-buckets invariant holds. bucket=week is a
// rolling 7-day window. Each doc's bucket: ceil(age / bucket_days) - 1; greatest/least clamp.
const timelineQuery = (person: Person, q: TimelineQuery) => {
  const bucketDays = q.bucket === 'day' ? 1 : 7
  return sql`
  with ${scopeCte(person, q)},
  bounds as (
    select ${q.days}::int as days, ${bucketDays}::int as bucket_days,
      ceil(${q.days}::float8 / ${bucketDays}::float8)::int - 1 as last_i
  ),
  buckets as (
    select i,
      greatest(
        now() - make_interval(days => b.days),
        now() - make_interval(days => (i + 1) * b.bucket_days)
      ) as bucket_start
    from bounds b, generate_series(0, b.last_i) as i
  ),
  hits as (
    select least(
        b.last_i,
        greatest(0, ceil(extract(epoch from now() - d.published_at) / (b.bucket_days * 86400))::int - 1)
      ) as i,
      count(*)::int as count
    from about a
    join docs d on d.id = a.doc_id
    cross join bounds b
    where ${docsWhere(q.term, q.kind)}
    group by 1
  )
  select b.bucket_start, coalesce(h.count, 0)::int as count
  from buckets b
  left join hits h on h.i = b.i
  order by b.bucket_start asc`
}

// lean narrows which docs count toward each bucket via resolveScope, but outlets/basis are
// not surfaced here since that would require wrapping the array in an object.
export const timelineFor = async (person: Person, q: TimelineQuery) => (await run<TimelineRow>(timelineQuery(person, q))).rows

// Cross-person: avg()/count() ignore SQL null, so untoned docs contribute nothing without a
// source filter. `tone is not null` removes rows both aggregates already ignore, so counts are
// unchanged; it only lets a group survive the `count(d.tone) >= min` floor when min >= 1.
const toneQuery = (q: ToneQuery) => sql`
  select p.id as person_id, d.domain as domain,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as n
  from docs d
  join doc_persons dp on dp.doc_id = d.id
  join persons p on p.id = dp.person_id
  where d.published_at >= now() - make_interval(days => ${q.days})
    and d.domain is not null
    and d.tone is not null
  group by p.id, d.domain
  having count(d.tone) >= ${q.min}
  order by p.id, d.domain`

const tonePersonsQuery = sql`select id, name from persons order by name`

export const toneFor = async (q: ToneQuery) => {
  const [cells, people] = await Promise.all([run<ToneCellRow>(toneQuery(q)), run<ToneListRow>(tonePersonsQuery)])
  const domains = [...new Set(cells.rows.map((c) => c.domain))].sort()
  return { persons: people.rows, domains, cells: cells.rows }
}

// Scoped to one person: testimony's PK carries person_id, so the inner join on
// (doc_id, person_id, method) never leaks another person's score for a shared doc.
// Inner join (not left join) means an unscored pair contributes nothing anywhere.
const testimonyScopeCte = (person: Person, q: TestimonyQuery) => sql`
  scope as (
    select d.source, d.domain, dt.score
    from doc_persons dp
    join docs d on d.id = dp.doc_id
    join doc_testimony dt on dt.doc_id = dp.doc_id and dt.person_id = dp.person_id and dt.method = ${q.method}
    where dp.person_id = ${person.id}
      and d.published_at >= now() - make_interval(days => ${q.days})
      and (${q.source} = 'all' or d.source = any(string_to_array(${q.source}, ',')))
  )`

// GROUPING SETS walks scope once for all three levels. `materialized` is spelled out since the
// outer select reads it three times. grouping(source)/grouping(domain) distinguish a subtotal
// from a genuine null. Level filters are asymmetric by design: overall has no floor, by_source
// floors at 1, only by_domain sees the caller's min.
const testimonySummaryQuery = (person: Person, q: TestimonyQuery) => sql`
  with ${testimonyScopeCte(person, q)},
  summary as materialized (
    select grouping(source) as g_source, grouping(domain) as g_domain, source, domain,
      round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
    from scope
    group by grouping sets ((), (source), (domain, source))
  )
  select
    (select json_build_object('score', score, 'n', n) from summary where g_source = 1 and g_domain = 1) as overall,
    coalesce((
      select json_agg(json_build_object('source', source, 'score', score, 'n', n) order by source)
      from summary where g_source = 0 and g_domain = 1 and n >= 1
    ), '[]'::json) as by_source,
    coalesce((
      select json_agg(json_build_object('domain', domain, 'source', source, 'score', score, 'n', n) order by domain, source)
      from summary where g_domain = 0 and domain is not null and n >= ${q.min}
    ), '[]'::json) as by_domain`

type TestimonyOverallRow = { score: number | null; n: number }
type TestimonyBySourceRow = { source: string; score: number; n: number }
type TestimonyByDomainRow = { domain: string; source: string; score: number; n: number }
type TestimonySummary = { overall: TestimonyOverallRow | null; by_source: TestimonyBySourceRow[]; by_domain: TestimonyByDomainRow[] }

export const testimonyFor = async (person: Person, q: TestimonyQuery) => {
  const { rows } = await run<TestimonySummary>(testimonySummaryQuery(person, q))
  const { overall, by_source, by_domain } = rows[0]
  return {
    method: q.method,
    overall: overall ?? { score: null, n: 0 },
    by_source,
    by_domain,
  }
}

// Two disjoint windows (recent, then the baseline immediately before it) so a doc is never
// double-counted. c_recent/c_baseline are count(*) for the same reason as graphQuery's term_p.
// `kind` closes the order by because (lift, term) alone does not break ties between two kinds
// of one term text.
const risingQuery = (person: Person, q: RisingQuery) => {
  const exclude = nameTokens(person)
  const { domain } = resolveScope(q.domain, q.lean)
  const termsOf = (about: Sql, count: Sql) => sql`
    select t.term, t.kind, count(*)::float8 as ${count}
    from doc_terms t join ${about} a on a.doc_id = t.doc_id
    where (${q.kind} = 'all' or t.kind = any(string_to_array(${q.kind}, ','))) and not (t.term = any(${exclude}::text[])) and not ${namePhrase(exclude)}
    group by 1, 2`
  return sql`
  with
  recent_scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => ${q.days})
      and (${q.source} = 'all' or d.source = ${q.source})
      and (${domain} = 'all' or d.domain = any(string_to_array(${domain}, ',')))
  ),
  recent_about as (
    select dp.doc_id from doc_persons dp join recent_scope s on s.id = dp.doc_id where dp.person_id = ${person.id}
  ),
  baseline_scope as (
    select d.id from docs d
    where d.published_at < now() - make_interval(days => ${q.days})
      and d.published_at >= now() - make_interval(days => ${q.days}::int + ${q.baseline}::int)
      and (${q.source} = 'all' or d.source = ${q.source})
      and (${domain} = 'all' or d.domain = any(string_to_array(${domain}, ',')))
  ),
  baseline_about as (
    select dp.doc_id from doc_persons dp join baseline_scope s on s.id = dp.doc_id where dp.person_id = ${person.id}
  ),
  recent_terms as (${termsOf(sql.raw('recent_about'), sql.raw('c_recent'))}
  ),
  baseline_terms as (${termsOf(sql.raw('baseline_about'), sql.raw('c_baseline'))}
  )
  select r.term, r.kind,
    round((r.c_recent / ${q.days})::numeric, 2)::float8 as count_recent,
    round((coalesce(b.c_baseline, 0) / ${q.baseline})::numeric, 2)::float8 as count_baseline,
    round(((r.c_recent / ${q.days}) / ((coalesce(b.c_baseline, 0) + 1) / ${q.baseline}))::numeric, 2)::float8 as lift
  from recent_terms r left join baseline_terms b using (term, kind)
  where r.c_recent >= ${q.min}
  order by lift desc, term, kind
  limit ${q.limit}`
}

export type CandidatesQuery = { days: number; min: number; limit: number }
type CandidateRow = { name: string; count: number; sources: number; previous: number }
type CandidateSampleRow = { name: string; id: number; source: string; text: string }
export type Candidate = CandidateRow & { samples: Omit<CandidateSampleRow, 'name'>[] }

// Cross-person: candidates are names nobody tracks, so there is no person_id to scope by.
const candidatesQuery = (q: CandidatesQuery) => sql`
  with recent as (
    select c.name, count(distinct c.doc_id)::int as count, count(distinct d.source)::int as sources
    from doc_candidates c join docs d on d.id = c.doc_id
    where d.published_at >= now() - make_interval(days => ${q.days})
    group by c.name
    having count(distinct c.doc_id) >= ${q.min}
  ),
  previous as (
    select c.name, count(distinct c.doc_id)::int as count
    from doc_candidates c join docs d on d.id = c.doc_id
    where d.published_at < now() - make_interval(days => ${q.days})
      and d.published_at >= now() - make_interval(days => 2 * ${q.days})
    group by c.name
  )
  select r.name, r.count, r.sources, coalesce(p.count, 0)::int as previous
  from recent r left join previous p using (name)
  order by r.count desc, r.name
  limit ${q.limit}`

const candidateSamplesQuery = (names: string[], days: number) => sql`
  select name, id, source, text from (
    select c.name, d.id, d.source, d.text,
      row_number() over (partition by c.name order by d.published_at desc, d.id desc) as rn
    from doc_candidates c join docs d on d.id = c.doc_id
    where c.name = any(${names}::text[]) and d.published_at >= now() - make_interval(days => ${days})
  ) s
  where rn <= 3
  order by name, rn`

export const candidatesFor = async (q: CandidatesQuery): Promise<{ days: number; candidates: Candidate[] }> => {
  const { rows } = await run<CandidateRow>(candidatesQuery(q))
  const samples = rows.length ? (await run<CandidateSampleRow>(candidateSamplesQuery(rows.map((r) => r.name), q.days))).rows : []
  const byName = new Map<string, Candidate['samples']>()
  samples.forEach(({ name, ...doc }) => byName.set(name, [...(byName.get(name) ?? []), doc]))
  return { days: q.days, candidates: rows.map((r) => ({ ...r, samples: byName.get(r.name) ?? [] })) }
}

export const risingFor = async (person: Person, q: RisingQuery) => {
  const { outlets } = resolveScope(q.domain, q.lean)
  const { rows } = await run<RisingRow>(risingQuery(person, q))
  return { days: q.days, baseline: q.baseline, terms: rows, outlets }
}

// links stays a second statement: its `any(ids)` term list is the output of the first one,
// so folding it in would mean recomputing the ranking to feed itself.
export const graphFor = async (person: Person, q: GraphQuery) => {
  const { outlets } = resolveScope(q.domain, q.lean)
  const { rows } = await run<GraphAggregates>(graphQuery(person, q))
  const { docs, about, nodes, signature } = rows[0]
  const ids = nodes.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await run<LinkRow>(linksQuery(person, q, ids)) : { rows: [] }
  const testimony = q.method ? (await run<TermTestimonyRow>(termTestimonyQuery(person, q, q.method, ids))).rows[0] : null
  const perTerm = new Map(testimony?.terms.map((t) => [t.id, { score: t.score, n: t.n }]) ?? [])
  return {
    person,
    stats: testimony ? { docs, about, testimony: { method: q.method, ...testimony.overall } } : { docs, about },
    nodes: nodes.map((t) => ({ id: `${t.kind}:${t.term}`, ...t, ...(testimony ? { testimony: perTerm.get(`${t.kind}:${t.term}`) ?? null } : {}) })),
    links: [
      ...nodes.map((t) => ({ source: `person:${person.id}`, target: `${t.kind}:${t.term}`, count: t.count })),
      ...links.rows.map((l) => ({ source: l.s, target: l.t, count: l.count })),
    ],
    signature,
    outlets,
  }
}

// Cross-person: scope/tracked carry no single person_id; both sides share them so the shared
// PMI universe (n, term_all) is computed once rather than once per side.
const compareScopeCte = (q: CompareQuery) => {
  const { domain } = resolveScope(q.domain, q.lean)
  return sql`
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => ${q.days})
      and (${q.source} = 'all' or d.source = any(string_to_array(${q.source}, ',')))
      and (${domain} = 'all' or d.domain = any(string_to_array(${domain}, ',')))
  ),
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`
}

// Per-person CTEs: a term can be A's own name and valid vocabulary for B, so these cannot be
// shared. Not capped by `limit`: every term gets an exact figure; limit only governs which keys
// enter the union. Both top_count and top_pmi are always computed to avoid silently excluding
// "loud but not sticky" or "rare but sticky" words from either side.
const compareSideCte = (side: 'a' | 'b', person: Person, q: CompareQuery) => {
  const names = nameTokens(person)
  const about = sql.raw(`about_${side}`)
  const np = sql.raw(`np_${side}`)
  const termP = sql.raw(`term_p_${side}`)
  const scored = sql.raw(`scored_${side}`)
  const top = sql.raw(`${side}_top`)
  return sql`
  ${about} as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = ${person.id}
  ),
  ${np} as materialized (select count(*)::float8 as total from ${about}),
  ${termP} as materialized (
    select t.term, t.kind, count(*)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join ${about} x on x.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any(${names}::text[])) and not ${namePhrase(names)}
    group by 1, 2
  ),
  ${scored} as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (${np}.total * a.c_t)) / ln(2) as pmi
    from ${termP} p join term_all a using (term, kind), n, ${np}
    where ${q.kind} = 'all' or p.kind = any(string_to_array(${q.kind}, ','))
  ),
  ${top}_count as (
    select term, kind from ${scored} order by count desc, term, kind limit ${q.limit}
  ),
  ${top}_pmi as (
    select term, kind from ${scored} order by pmi * ln(1 + count) desc, term, kind limit ${q.limit}
  )`
}

// `keys` dedupes the union; `unioned` looks up the exact figure via left join so a key absent
// from one side comes back null rather than dropped — a null is a measured absence, not a gap.
// is_name_a/is_name_b are computed on the key text: a term excluded from term_p must still read
// "name" on the response.
const compareQuery = (a: Person, b: Person, q: CompareQuery) => sql`
  with ${compareScopeCte(q)},
  n as materialized (select count(*)::float8 as total from tracked),
  term_all as materialized (
    select t.term, t.kind, count(*)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  ${compareSideCte('a', a, q)},
  ${compareSideCte('b', b, q)},
  keys as (
    select term, kind from a_top_count
    union select term, kind from a_top_pmi
    union select term, kind from b_top_count
    union select term, kind from b_top_pmi
  ),
  unioned as (
    select k.term, k.kind,
      ${isName(sql.raw('k.term'), nameTokens(a))} as is_name_a,
      ${isName(sql.raw('k.term'), nameTokens(b))} as is_name_b,
      sa.count as a_count, round(sa.pmi::numeric, 2)::float8 as a_pmi, round(sa.tone::numeric, 2)::float8 as a_tone,
      sb.count as b_count, round(sb.pmi::numeric, 2)::float8 as b_pmi, round(sb.tone::numeric, 2)::float8 as b_tone
    from keys k
    left join scored_a sa using (term, kind)
    left join scored_b sb using (term, kind)
  )
  select
    (select count(*) from about_a)::int as about_a,
    (select count(*) from about_b)::int as about_b,
    coalesce((
      select json_agg(json_build_object(
        'term', term, 'kind', kind, 'is_name_a', is_name_a, 'is_name_b', is_name_b,
        'a_count', a_count, 'a_pmi', a_pmi, 'a_tone', a_tone,
        'b_count', b_count, 'b_pmi', b_pmi, 'b_tone', b_tone
      ) order by term, kind)
      from unioned
    ), '[]'::json) as terms`

// Not nested under /people/:id: spans two specific people, neither of which is "the" resource.
export const compareFor = async (a: Person, b: Person, q: CompareQuery) => {
  const { rows } = await run<CompareAggregates>(compareQuery(a, b, q))
  const { about_a, about_b, terms } = rows[0]
  return {
    days: q.days,
    a: { person: a, about: about_a },
    b: { person: b, about: about_b },
    terms: terms.map((t) => ({
      term: t.term,
      kind: t.kind,
      a: t.is_name_a ? ('name' as const) : t.a_count !== null ? { count: t.a_count, pmi: t.a_pmi!, tone: t.a_tone } : null,
      b: t.is_name_b ? ('name' as const) : t.b_count !== null ? { count: t.b_count, pmi: t.b_pmi!, tone: t.b_tone } : null,
    })),
  }
}

// The exact builders the routes run, exported so `pnpm bench` can put each one through
// EXPLAIN (ANALYZE, BUFFERS).
export const queries = {
  graph: graphQuery,
  links: linksQuery,
  sources: sourcesQuery,
  docs: docsQuery,
  docsCount: docsCountQuery,
  timeline: timelineQuery,
  rising: risingQuery,
  tone: toneQuery,
  testimonySummary: testimonySummaryQuery,
  termTestimony: termTestimonyQuery,
  candidates: candidatesQuery,
  compare: compareQuery,
} as const

// The text each builder emits. Numbering follows statement shape, not values, so what a
// sample call renders is byte-for-byte what the handler sends (test/graph.test.ts pins it).
const samplePerson: Person = { id: 'sample', name: 'Sample', aliases: ['Sample'] }
const sampleScope = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all' }
const sampleDocs = { ...sampleScope, term: 'sample', kind: 'word', limit: 50, offset: 0 }
const sampleGraph: GraphQuery = { ...sampleScope, limit: 40, min: 2, sort: 'count' }

export const statements = {
  graph: queries.graph(samplePerson, sampleGraph).text,
  links: queries.links(samplePerson, sampleScope, ['word:sample']).text,
  sources: queries.sources(samplePerson, sampleScope).text,
  docs: queries.docs(samplePerson, sampleDocs).text,
  docsCount: queries.docsCount(samplePerson, sampleDocs).text,
  timeline: queries.timeline(samplePerson, { ...sampleDocs, days: 90, bucket: 'day' }).text,
  rising: queries.rising(samplePerson, { ...sampleScope, days: 7, baseline: 30, min: 3, limit: 20 }).text,
  tone: queries.tone({ days: 30, min: 3 }).text,
  testimonySummary: queries.testimonySummary(samplePerson, { days: 30, source: 'all', method: 'stub', min: 3 }).text,
  termTestimony: queries.termTestimony(samplePerson, sampleScope, 'stub', ['word:sample']).text,
  candidates: queries.candidates({ days: 7, min: 5, limit: 50 }).text,
  compare: queries.compare(samplePerson, { ...samplePerson, id: 'other' }, { ...sampleScope, limit: 40 }).text,
} as const
