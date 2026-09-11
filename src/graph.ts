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
  // The doc_testimony label to average per term, or null when the caller did not ask
  // (`testimony=1`): the default response shape carries no testimony at all. Optional so the
  // literals the tests and benchmarks build stay valid.
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

// No `min`, unlike GraphQuery/RisingQuery: a term present for one side and absent for the
// other is exactly what /compare must keep as a measured null, so a floor tied to one side's
// count cannot apply symmetrically (issue #93). No `sort` either -- both selection criteria
// always run, see compareQuery.
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
// One row: the two counts as columns, the two lists as json the driver already parses.
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
// One row: the two `about` counts as columns, the unioned term list as json the driver already parses.
type CompareAggregates = { about_a: number; about_b: number; terms: CompareTermRow[] }

// `source` must already be normalized by parseSourceList; unlike kind, an unknown or empty
// source is not rescued here and would scope to zero docs. domain+lean are resolved here into
// the effective domain scope (a comma-joined list, 'all', or '' for an empty intersection).
// string_to_array('', ',') yields an *empty* array (verified against PGlite), so
// d.domain = any(...) matches nothing and the empty intersection correctly scopes to zero rows.
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

// PMI's universe. doc_terms only exists for docs naming at least one tracked person, so the
// numerator's universe is that set; n.total and term_all must be restricted to it too, or the
// denominator would count docs that can never contribute a term.
const trackedCte = sql`
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`

// One statement for what nodes, signature and stats used to take three. All three rebuilt the
// same scope, about and tracked sets, and both term statements rebuilt the same global term
// frequencies -- which docs/perf-baseline.md shows is the whole cost of the route, paid twice.
// `materialized` is spelled out instead of left to the planner's single-reference inlining,
// since computing each of these exactly once is the point of merging them.
//
// term_p is deliberately not kind-filtered: signature ignores kind by construction, and the
// nodes filter is on a group key, so applying it after the aggregate selects the same rows.
// The tone average is computed once and simply not projected into signature, which never had it.
//
// term_all stays unrestricted even though it only ever feeds an inner join on (term, kind)
// against term_p: narrowing it to those candidates was measured and is slower here (issue #45).
// It cuts the rows to aggregate from 70642 to 58519 on the benchmark corpus, but the planner
// then reaches doc_terms through doc_terms_term_idx and merge-joins, trading an 883-buffer seq
// scan for a 113524-buffer index scan, and the CTE goes from 247 ms to 379 ms. The person's
// terms are the head of the distribution, so there is little to skip.
//
// sort_key carries the ordering expression as a column so json_agg reproduces exactly the order
// the limit selected. Inside it, `pmi` is the unrounded value, as before: an output column name
// stands alone in an order by, never inside an expression -- which is also why signature, whose
// order by names `pmi` bare, still ranks on the rounded value.
//
// `kind` closes both order by clauses (issue #47). The group key is (term, kind), so one term
// text can appear under several kinds -- and until now nothing ranked those against each other
// when their count/pmi tied: the order was whatever the plan emitted, and which of them the
// limit kept was arbitrary with it. Dropping the distinct below changes the plan, so the
// tiebreak is spelled out rather than left to it.
//
// c_pt and c_t are count(*), not count(distinct doc_id) (issue #47). doc_terms' primary key
// (doc_id, term, kind) already makes doc_id unique inside each (term, kind) group, and every
// join below it preserves that: `about` is doc_persons filtered to one person_id, whose PK
// (doc_id, person_id) leaves doc_id unique, joined to `scope` (docs.id, a primary key);
// `tracked` is `scope` again; `docs d` joins on its own primary key. So no row can duplicate a
// doc inside a group, and the distinct sort/hash was pure cost -- 270 ms to 152 ms on the
// benchmark corpus, almost all of it term_all's, which drops a 3.9 MB quicksort by turning a
// GroupAggregate into a HashAggregate (see docs/perf-baseline.md).
// A person's own name words are already dropped as single terms by `t.term = any(exclude)`,
// whose array is nameTokens(person). A phrase carrying one of them has to go for the same reason:
// "lula da silva" and "jair bolsonaro" are not things said *about* the person, they are the
// person. The overlap operator asks it of the phrase's words, so "flavio bolsonaro" leaves
// Jair's map without ever being spelled out anywhere.
//
// `position(' ' in ...)` guards the split: the overwhelming majority of doc_terms rows are
// single words, and they are already handled by the equality above, so they never pay for a
// string_to_array. It is not merely an optimization -- without it this expression would
// duplicate the equality check on every row of the largest table in the database.
const namePhrase = (names: string[]) => sql`(position(' ' in t.term) > 0 and string_to_array(t.term, ' ') && ${names}::text[])`

// compareQuery's flag for "this (term, kind) key is (or contains) that side's own name word":
// the equality half namePhrase leaves to its caller's own where clause, plus the phrase
// half, both against an arbitrary column (compareQuery evaluates this on the unioned key, not
// on doc_terms.term), so it cannot reuse namePhrase's hardcoded `t.term`.
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

// count(*) rather than count(distinct a.doc_id) (issue #47): a row here is a (doc_id, a, b)
// triple, and `kind || ':' || term` is injective over the three kinds Term allows
// (hashtag/word/phrase -- none is a prefix of another up to a colon), so a group key (s, t)
// pins exactly one doc_terms row for a and one for b per doc. doc_terms' PK makes each of
// those unique, and `about` contributes one row per doc (doc_persons PK with person_id fixed).
//
// The order by is new. Nothing ever specified this statement's order: the distinct forced a
// GroupAggregate that happened to emit (s, t) ascending, and count(*) lets the planner hash
// instead. Spelling the sort out is what keeps the response identical rather than merely
// equivalent, and it still wins -- 26.6 ms -> 22.0 ms on the benchmark corpus, since it now
// sorts the 443 output rows instead of the 3744 input ones.
const linksQuery = (person: Person, q: Scope, ids: string[]) => sql`
  with ${scopeCte(person, q)}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(*)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any(${ids}::text[]) and (b.kind || ':' || b.term) = any(${ids}::text[])
  group by 1, 2 having count(*) >= 2
  order by 1, 2`

// Testimony per term, for the mask that colours the map (option a of the avaliação work): the
// mean kikori score of the docs in `about` that carry this term, next to the person's own
// mean over the same `about`, so the client can colour each word by its distance from the
// person rather than from zero -- the name bias moves every text of one person the same
// way, and centring on the person's mean cancels it. Its own statement, like linksQuery, and
// for the same reason: the term list is the output of graphQuery, and it only runs when asked.
// count(*) is one row per doc per term by doc_terms' PK, same argument as term_p's.
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

// Previously hardcoded 'all' here regardless of q.domain, silently ignoring a caller's
// domain filter — fixed as a prerequisite for lean to have any effect on this route.
// lean/basis are annotated per row from outlets.json regardless of whether q.lean
// narrowed the scope: cheap, static, always-available metadata.
export const sourcesFor = async (person: Person, q: GraphQuery) => {
  const { rows } = await run<SourceRow>(sourcesQuery(person, q))
  return rows.map((r) => ({ ...r, ...labelFor(r.domain) }))
}

// term/kind reuse the doc_terms (kind, term) index via exists, so a doc carrying the term
// under two kinds (only possible with kind = 'all' or an unknown kind) is still counted/returned once.
// An unrecognized kind falls back to 'all' here too, so callers that bypass parseDocsQuery still get that fallback.
// Exported so a test can read the literal kind array back out of it and compare against
// query.ts's KINDS, instead of re-typing a third copy that could silently drift from both
// (issue #108's own postmortem on how 'theme' almost stayed out of sync here).
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

// Buckets count backward from now() in fixed bucket_days steps (i = 0 is the most
// recent bucket, open-ended at 'infinity' rather than now(), so this never needs
// date_trunc and sidesteps the ISO-week-vs-rolling-week ambiguity; bucket=week is a
// rolling 7-day window, not a Monday-aligned one. The newest bucket has no upper
// bound because scopeCte likewise has none on published_at: a future-dated doc
// (source clock skew) still counts in docsFor's total, so it must land somewhere
// here too, or the sum-of-buckets invariant breaks. The oldest bucket is clamped to
// the window edge, so buckets exactly partition the same window docsFor uses for
// the same params.
//
// The matching docs are counted once and then joined to the bucket series, instead of
// joining the series to `about` and testing each doc against every bucket's range: that
// cross join is |about| x |buckets| rows before the range filter cuts them, up to 365
// buckets wide (issue #46).
//
// Each doc's bucket is therefore computed arithmetically, and the expression has to
// reproduce the ranges above exactly. Bucket i is [now() - (i+1)*bucket_days,
// now() - i*bucket_days), so a doc of age `a` days belongs to ceil(a / bucket_days) - 1:
// a timestamp landing exactly on a boundary falls in the newer bucket, as the half-open
// interval did. greatest(0, ...) puts future-dated docs (age <= 0) in the newest bucket,
// which is what the open upper bound did. least(last_i, ...) is the oldest-edge clamp:
// scopeCte already bounds age at `days`, so it only matters at the last bucket's exact
// edge, where it keeps the doc inside the series rather than off the end of it.
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

// Stays a bare array on purpose: lean narrows which docs count toward each bucket
// (via the same resolveScope as every other route), but outlets/basis are not
// surfaced here, since that would require wrapping this array in an object.
export const timelineFor = async (person: Person, q: TimelineQuery) => (await run<TimelineRow>(timelineQuery(person, q))).rows

// Cross-person on purpose: scopeCte's `about` scopes to a single person_id, which
// does not fit a matrix spanning every tracked person, so this joins doc_persons/persons
// directly instead. avg()/count() ignore SQL null automatically, so untoned (non-GDELT)
// docs contribute nothing to either aggregate without a source/kind check.
//
// `tone is not null` is therefore free rather than a behaviour change (issue #47): it only
// removes rows both aggregates already ignore, so avg and n are untouched, and a group can
// only survive `count(d.tone) >= min` when min >= 1 (parseToneQuery's floor) if it still holds
// at least one toned row. It cuts the rows joined and hashed from 3847 to 1748 on the
// benchmark corpus, 22.5 ms -> 14.3 ms, with the same buffer count.
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

// Scoped to one person, unlike toneQuery (cross-person by construction): testimony's
// PK already carries person_id, so an inner join on (doc_id, person_id, method) can never
// leak another person's score for a shared doc into this scope. The inner join to
// doc_testimony (not left join) is what makes an unscored pair contribute nothing anywhere,
// including no zero-n placeholder row, per the spec.
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

// One statement for what overall, by_source and by_domain used to take three. All three
// rebuilt the same scope join (doc_persons -> docs -> doc_testimony) and aggregated it at a
// different level; GROUPING SETS walks that scope once and emits all three levels from a
// single aggregate node. `materialized` is spelled out because the outer select reads the
// result three times and computing it exactly once is the point.
//
// grouping(source)/grouping(domain) are what keep a subtotal apart from a genuine null: the
// by_source subtotal carries domain = null, and so does a real (domain is null, source) group
// -- the fixture has one. Selecting by `domain is null` alone would merge the two.
//
// The three level filters are deliberately asymmetric and stay exactly as they were: overall
// has no count floor, by_source floors at 1 (a group whose scores are all null contributes no
// row), and only by_domain sees the caller's min and drops null domains.
//
// json_agg carries its own order by, so the arrays come back in the order the split
// statements' `order by` produced; the driver parses the json into the same row objects.
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
// One row: overall as a json object, the two lists as json the driver already parses.
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

// Two disjoint windows (recent, then baseline immediately before it), instead of
// reusing scopeCte twice, so a doc is never double-counted into both windows.
//
// c_recent/c_baseline are count(*) (issue #47): same argument as graphQuery's term_p, with
// recent_about/baseline_about in place of `about` -- doc_persons' PK with person_id fixed,
// joined to a scope of docs.id, is one row per doc, and doc_terms' PK is one row per
// (doc, term, kind). 13.5 ms -> 11.2 ms on the benchmark corpus. `kind` closes the order by
// for the same reason it closes graphQuery's: (lift, term) does not separate two kinds of one
// term text, and count(*) lets the planner pick a different arbitrary order than distinct did.
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

// Cross-person by construction: candidates are names nobody tracks yet, so there is no
// person_id to scope by. `previous` is the window of the same length right before this
// one, so a caller can see what is rising without a second request.
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

// links stays a second statement on purpose: its `any(ids)` term list is the output of the
// first one, so folding it in would mean recomputing the ranking to feed itself. It is also
// the cheap half of the route (see docs/perf-baseline.md) and is skipped entirely when the
// graph has no nodes.
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

// Cross-person by construction, like toneSql: unlike scopeCte, `scope`/`tracked` here carry no
// single person_id, since both sides share them (issue #93's cost-saving rationale -- the shared
// PMI universe n/term_all is computed once, not once per side).
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

// One side's about/term_p/scored/top-N CTEs, parameterized by the person and that person's
// own nameTokens array -- inherently per-person, since a term can be A's own name and
// legitimate vocabulary for B (spec §3), so these cannot be shared the way
// scope/tracked/n/term_all are.
//
// Deliberately not capped by `limit` here: every term the person's docs carry in scope
// gets an exact count/pmi/tone, with only the name-word exclusion applied, same as graphQuery's
// term_p. `limit` only governs top_count/top_pmi, i.e. which keys enter the union below --
// the exact figure for a unioned key is always looked up uncapped, in `scored_<side>`.
//
// Both top_count and top_pmi are computed for every call, per spec: dropping either would
// silently exclude "loud but not sticky" or "rare but sticky" words from one side. pmi *
// ln(1 + count) is sort=pmi's pinned formula (graphQuery), reused unchanged.
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

// `keys` is the union of up to four (term, kind) lists across both sides -- UNION (not UNION
// ALL) dedupes on its own. `unioned` then looks up the exact, uncapped figure for every key on
// each side via a left join, so a key selected only from the other side's lists comes back
// null on this one, not a dropped row -- the whole point of the union (spec §3): a null must
// be measured, never "outside the top list".
//
// is_name_a/is_name_b are computed against the key text directly (isName), not against
// scored_a/scored_b: a term can be one side's own name word and therefore entirely absent
// from that side's term_p (excluded there by construction), yet still need to read "name"
// rather than null on this response.
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

// Not nested under /people/:id, like toneFor: it spans two specific people, neither of which
// is "the" resource. Own function, not two graphFor calls: the shared PMI universe (n,
// term_all) would otherwise be recomputed once per side, exactly the cost issue #93 avoids.
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

// The exact builders the routes run, exported read-only so `pnpm bench` can put each one
// through EXPLAIN (ANALYZE, BUFFERS) with representative parameters. Nothing here changes
// what a route executes; it is the same function the handlers above call.
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

// The text each builder emits. A builder numbers its placeholders by the statement's shape
// alone, never by the values bound, so what a sample call renders is byte-for-byte what the
// handler sends (test/graph.test.ts pins it), and a test can still read the SQL.
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
