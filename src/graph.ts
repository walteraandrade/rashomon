import { db } from './db.js'
import { nameTokens } from './extract.js'
import { labelFor, resolveScope } from './outlets.js'
import type { Person } from './types.js'

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
// always run, see compareSql.
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

// $3 must already be normalized by parseSourceList; unlike kind, an unknown or empty
// source is not rescued here and would scope to zero docs. $4 must already be the
// effective domain scope from resolveScope (a comma-joined list, 'all', or '' for an
// empty domain+lean intersection). string_to_array('', ',') yields an *empty* array
// (verified against PGlite), so d.domain = any(...) matches nothing and the empty
// intersection correctly scopes to zero rows.
const scopeCte = `
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($3 = 'all' or d.source = any(string_to_array($3, ',')))
      and ($4 = 'all' or d.domain = any(string_to_array($4, ',')))
  ),
  about as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = $1
  )`

// PMI's universe. doc_terms only exists for docs naming at least one tracked person, so the
// numerator's universe is that set; n.total and term_all must be restricted to it too, or the
// denominator would count docs that can never contribute a term.
const trackedCte = `
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
// A person's own name words are already dropped as single terms by `t.term = any($6)`, whose
// array is nameTokens(person). A phrase carrying one of them has to go for the same reason:
// "lula da silva" and "jair bolsonaro" are not things said *about* the person, they are the
// person. The overlap operator asks it of the phrase's words, so "flavio bolsonaro" leaves
// Jair's map without ever being spelled out anywhere.
//
// `position(' ' in ...)` guards the split: the overwhelming majority of doc_terms rows are
// single words, and they are already handled by the equality above, so they never pay for a
// string_to_array. It is not merely an optimization -- without it this expression would
// duplicate the equality check on every row of the largest table in the database.
const namePhraseSql = (names: string) => `(position(' ' in t.term) > 0 and string_to_array(t.term, ' ') && ${names}::text[])`

// compareSql's flag for "this (term, kind) key is (or contains) that side's own name word":
// the equality half namePhraseSql leaves to its caller's own where clause, plus the phrase
// half, both against an arbitrary column (compareSql evaluates this on the unioned key, not
// on doc_terms.term), so it cannot reuse namePhraseSql's hardcoded `t.term`.
const isNameSql = (col: string, names: string) => `(${col} = any(${names}::text[]) or (position(' ' in ${col}) > 0 and string_to_array(${col}, ' ') && ${names}::text[]))`

const graphSql = `
  with ${scopeCte}, ${trackedCte},
  n as materialized (select count(*)::float8 as total from tracked),
  np as materialized (select count(*)::float8 as total from about),
  term_p as materialized (
    select t.term, t.kind, count(*)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any($6::text[])) and not ${namePhraseSql('$6')}
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
    where p.c_pt >= $7 and ($5 = 'all' or p.kind = any(string_to_array($5, ',')))
  ),
  nodes_top as (
    select term, kind, count,
      round(pmi::numeric, 2)::float8 as pmi_rounded,
      round(tone::numeric, 2)::float8 as tone_rounded,
      (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) as sort_key
    from nodes_scored
    order by (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) desc, term, kind
    limit $9
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

// count(*) rather than count(distinct a.doc_id) (issue #47): a row here is a (doc_id, a, b)
// triple, and `kind || ':' || term` is injective over the three kinds Term allows
// (hashtag/word/theme -- none is a prefix of another up to a colon), so a group key (s, t)
// pins exactly one doc_terms row for a and one for b per doc. doc_terms' PK makes each of
// those unique, and `about` contributes one row per doc (doc_persons PK with person_id fixed).
//
// The order by is new. Nothing ever specified this statement's order: the distinct forced a
// GroupAggregate that happened to emit (s, t) ascending, and count(*) lets the planner hash
// instead. Spelling the sort out is what keeps the response identical rather than merely
// equivalent, and it still wins -- 26.6 ms -> 22.0 ms on the benchmark corpus, since it now
// sorts the 443 output rows instead of the 3744 input ones.
const linksSql = `
  with ${scopeCte}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(*)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any($5::text[]) and (b.kind || ':' || b.term) = any($5::text[])
  group by 1, 2 having count(*) >= 2
  order by 1, 2`

// Testimony per term, for the mask that colours the map (option a of the avaliação work): the
// mean kikori score of the docs in `about` that carry this term, next to the person's own
// mean over the same `about`, so the client can colour each word by its distance from the
// person rather than from zero -- the name bias moves every text of one person the same
// way, and centring on the person's mean cancels it. Its own statement, like linksSql, and
// for the same reason: the term list is the output of graphSql, and it only runs when asked.
// count(*) is one row per doc per term by doc_terms' PK, same argument as term_p's.
const termTestimonySql = `
  with ${scopeCte},
  scored as (
    select a.doc_id, dt.score
    from about a join doc_testimony dt on dt.doc_id = a.doc_id and dt.person_id = $1 and dt.method = $5
    where dt.score is not null
  )
  select
    (select json_build_object('score', round(avg(score)::numeric, 2)::float8, 'n', count(*)::int) from scored) as overall,
    coalesce((
      select json_agg(json_build_object('id', id, 'score', score, 'n', n) order by id) from (
        select t.kind || ':' || t.term as id, round(avg(s.score)::numeric, 2)::float8 as score, count(*)::int as n
        from doc_terms t join scored s on s.doc_id = t.doc_id
        where (t.kind || ':' || t.term) = any($6::text[])
        group by 1
      ) x
    ), '[]'::json) as terms`

type TermTestimonyRow = { overall: { score: number | null; n: number }; terms: { id: string; score: number; n: number }[] }

const sourcesSql = `
  with ${scopeCte}
  select d.domain, d.source, count(*)::int as docs,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as tone_n
  from docs d join about a on a.doc_id = d.id
  group by 1, 2 order by docs desc, domain limit 80`

// Previously hardcoded 'all' here regardless of q.domain, silently ignoring a caller's
// domain filter — fixed as a prerequisite for lean to have any effect on this route.
// lean/basis are annotated per row from outlets.json regardless of whether q.lean
// narrowed the scope: cheap, static, always-available metadata.
export const sourcesFor = async (person: Person, q: GraphQuery) => {
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<SourceRow>(sourcesSql, [person.id, q.days, q.source, domain])
  return rows.map((r) => ({ ...r, ...labelFor(r.domain) }))
}

// term/kind reuse the doc_terms (kind, term) index via exists, so a doc carrying the term
// under two kinds (only possible with kind = 'all' or an unknown kind) is still counted/returned once.
// An unrecognized kind falls back to 'all' here too, so callers that bypass parseDocsQuery still get that fallback.
const docsWhereSql = `(
    $5 = '' or exists (
      select 1 from doc_terms t where t.doc_id = d.id and t.term = $5
        and ($6 = 'all' or t.kind = any(string_to_array($6, ',')) or not (string_to_array($6, ',') <@ array['hashtag', 'word', 'theme', 'phrase']))
    )
  )`

const docsSql = `
  with ${scopeCte}
  select d.id, d.source, d.domain, d.published_at, d.text, d.uri, d.tone
  from docs d join about a on a.doc_id = d.id
  where ${docsWhereSql}
  order by d.published_at desc, d.id desc
  limit $7 offset $8`

const docsCountSql = `
  with ${scopeCte}
  select count(*)::int as total
  from docs d join about a on a.doc_id = d.id
  where ${docsWhereSql}`

export const docsFor = async (person: Person, q: DocsQuery) => {
  const { domain, outlets } = resolveScope(q.domain, q.lean)
  const params = [person.id, q.days, q.source, domain, q.term, q.kind]
  const [docs, count] = await Promise.all([
    db.query<DocRow>(docsSql, [...params, q.limit, q.offset]),
    db.query<{ total: number }>(docsCountSql, params),
  ])
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
const timelineSql = `
  with ${scopeCte},
  bounds as (
    select $2::int as days, $7::int as bucket_days,
      ceil($2::float8 / $7::float8)::int - 1 as last_i
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
    where ${docsWhereSql}
    group by 1
  )
  select b.bucket_start, coalesce(h.count, 0)::int as count
  from buckets b
  left join hits h on h.i = b.i
  order by b.bucket_start asc`

// Stays a bare array on purpose: lean narrows which docs count toward each bucket
// (via the same resolveScope as every other route), but outlets/basis are not
// surfaced here, since that would require wrapping this array in an object.
export const timelineFor = async (person: Person, q: TimelineQuery) => {
  const bucketDays = q.bucket === 'day' ? 1 : 7
  const { domain } = resolveScope(q.domain, q.lean)
  const params = [person.id, q.days, q.source, domain, q.term, q.kind, bucketDays]
  return (await db.query<TimelineRow>(timelineSql, params)).rows
}

// Cross-person on purpose: scopeCte's `about` scopes to a single person_id via $1, which
// does not fit a matrix spanning every tracked person, so this joins doc_persons/persons
// directly instead. avg()/count() ignore SQL null automatically, so untoned (non-GDELT)
// docs contribute nothing to either aggregate without a source/kind check.
//
// `tone is not null` is therefore free rather than a behaviour change (issue #47): it only
// removes rows both aggregates already ignore, so avg and n are untouched, and a group can
// only survive `count(d.tone) >= $2` when $2 >= 1 (parseToneQuery's floor) if it still holds
// at least one toned row. It cuts the rows joined and hashed from 3847 to 1748 on the
// benchmark corpus, 22.5 ms -> 14.3 ms, with the same buffer count.
const toneSql = `
  select p.id as person_id, d.domain as domain,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as n
  from docs d
  join doc_persons dp on dp.doc_id = d.id
  join persons p on p.id = dp.person_id
  where d.published_at >= now() - make_interval(days => $1)
    and d.domain is not null
    and d.tone is not null
  group by p.id, d.domain
  having count(d.tone) >= $2
  order by p.id, d.domain`

const tonePersonsSql = `select id, name from persons order by name`

export const toneFor = async (q: ToneQuery) => {
  const [cells, people] = await Promise.all([
    db.query<ToneCellRow>(toneSql, [q.days, q.min]),
    db.query<ToneListRow>(tonePersonsSql),
  ])
  const domains = [...new Set(cells.rows.map((c) => c.domain))].sort()
  return { persons: people.rows, domains, cells: cells.rows }
}

// Scoped to one person via $1, unlike toneSql (cross-person by construction): testimony's
// PK already carries person_id, so an inner join on (doc_id, person_id, method) can never
// leak another person's score for a shared doc into this scope. The inner join to
// doc_testimony (not left join) is what makes an unscored pair contribute nothing anywhere,
// including no zero-n placeholder row, per the spec.
const testimonyScopeCte = `
  scope as (
    select d.source, d.domain, dt.score
    from doc_persons dp
    join docs d on d.id = dp.doc_id
    join doc_testimony dt on dt.doc_id = dp.doc_id and dt.person_id = dp.person_id and dt.method = $4
    where dp.person_id = $1
      and d.published_at >= now() - make_interval(days => $2)
      and ($3 = 'all' or d.source = any(string_to_array($3, ',')))
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
// row), and only by_domain sees the caller's $5 and drops null domains.
//
// json_agg carries its own order by, so the arrays come back in the order the split
// statements' `order by` produced; the driver parses the json into the same row objects.
const testimonySummarySql = `
  with ${testimonyScopeCte},
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
      from summary where g_domain = 0 and domain is not null and n >= $5
    ), '[]'::json) as by_domain`

type TestimonyOverallRow = { score: number | null; n: number }
type TestimonyBySourceRow = { source: string; score: number; n: number }
type TestimonyByDomainRow = { domain: string; source: string; score: number; n: number }
// One row: overall as a json object, the two lists as json the driver already parses.
type TestimonySummary = { overall: TestimonyOverallRow | null; by_source: TestimonyBySourceRow[]; by_domain: TestimonyByDomainRow[] }

export const testimonyFor = async (person: Person, q: TestimonyQuery) => {
  const { rows } = await db.query<TestimonySummary>(testimonySummarySql, [person.id, q.days, q.source, q.method, q.min])
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
// c_recent/c_baseline are count(*) (issue #47): same argument as graphSql's term_p, with
// recent_about/baseline_about in place of `about` -- doc_persons' PK with person_id fixed to
// $1, joined to a scope of docs.id, is one row per doc, and doc_terms' PK is one row per
// (doc, term, kind). 13.5 ms -> 11.2 ms on the benchmark corpus. `kind` closes the order by
// for the same reason it closes graphSql's: (lift, term) does not separate two kinds of one
// term text, and count(*) lets the planner pick a different arbitrary order than distinct did.
const risingSql = `
  with
  recent_scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = any(string_to_array($5, ',')))
  ),
  recent_about as (
    select dp.doc_id from doc_persons dp join recent_scope s on s.id = dp.doc_id where dp.person_id = $1
  ),
  baseline_scope as (
    select d.id from docs d
    where d.published_at < now() - make_interval(days => $2)
      and d.published_at >= now() - make_interval(days => $2 + $3)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = any(string_to_array($5, ',')))
  ),
  baseline_about as (
    select dp.doc_id from doc_persons dp join baseline_scope s on s.id = dp.doc_id where dp.person_id = $1
  ),
  recent_terms as (
    select t.term, t.kind, count(*)::float8 as c_recent
    from doc_terms t join recent_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = any(string_to_array($6, ','))) and not (t.term = any($7::text[])) and not ${namePhraseSql('$7')}
    group by 1, 2
  ),
  baseline_terms as (
    select t.term, t.kind, count(*)::float8 as c_baseline
    from doc_terms t join baseline_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = any(string_to_array($6, ','))) and not (t.term = any($7::text[])) and not ${namePhraseSql('$7')}
    group by 1, 2
  )
  select r.term, r.kind,
    round((r.c_recent / $2)::numeric, 2)::float8 as count_recent,
    round((coalesce(b.c_baseline, 0) / $3)::numeric, 2)::float8 as count_baseline,
    round(((r.c_recent / $2) / ((coalesce(b.c_baseline, 0) + 1) / $3))::numeric, 2)::float8 as lift
  from recent_terms r left join baseline_terms b using (term, kind)
  where r.c_recent >= $8
  order by lift desc, term, kind
  limit $9`

export type CandidatesQuery = { days: number; min: number; limit: number }
type CandidateRow = { name: string; count: number; sources: number; previous: number }
type CandidateSampleRow = { name: string; id: number; source: string; text: string }
export type Candidate = CandidateRow & { samples: Omit<CandidateSampleRow, 'name'>[] }

// Cross-person by construction: candidates are names nobody tracks yet, so there is no
// person_id to scope by. `previous` is the window of the same length right before this
// one, so a caller can see what is rising without a second request.
const candidatesSql = `
  with recent as (
    select c.name, count(distinct c.doc_id)::int as count, count(distinct d.source)::int as sources
    from doc_candidates c join docs d on d.id = c.doc_id
    where d.published_at >= now() - make_interval(days => $1)
    group by c.name
    having count(distinct c.doc_id) >= $2
  ),
  previous as (
    select c.name, count(distinct c.doc_id)::int as count
    from doc_candidates c join docs d on d.id = c.doc_id
    where d.published_at < now() - make_interval(days => $1)
      and d.published_at >= now() - make_interval(days => 2 * $1)
    group by c.name
  )
  select r.name, r.count, r.sources, coalesce(p.count, 0)::int as previous
  from recent r left join previous p using (name)
  order by r.count desc, r.name
  limit $3`

const candidateSamplesSql = `
  select name, id, source, text from (
    select c.name, d.id, d.source, d.text,
      row_number() over (partition by c.name order by d.published_at desc, d.id desc) as rn
    from doc_candidates c join docs d on d.id = c.doc_id
    where c.name = any($1::text[]) and d.published_at >= now() - make_interval(days => $2)
  ) s
  where rn <= 3
  order by name, rn`

export const candidatesFor = async (q: CandidatesQuery): Promise<{ days: number; candidates: Candidate[] }> => {
  const { rows } = await db.query<CandidateRow>(candidatesSql, [q.days, q.min, q.limit])
  const samples = rows.length ? (await db.query<CandidateSampleRow>(candidateSamplesSql, [rows.map((r) => r.name), q.days])).rows : []
  const byName = new Map<string, Candidate['samples']>()
  samples.forEach(({ name, ...doc }) => byName.set(name, [...(byName.get(name) ?? []), doc]))
  return { days: q.days, candidates: rows.map((r) => ({ ...r, samples: byName.get(r.name) ?? [] })) }
}

export const risingFor = async (person: Person, q: RisingQuery) => {
  const exclude = nameTokens(person)
  const { domain, outlets } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<RisingRow>(risingSql, [
    person.id,
    q.days,
    q.baseline,
    q.source,
    domain,
    q.kind,
    exclude,
    q.min,
    q.limit,
  ])
  return { days: q.days, baseline: q.baseline, terms: rows, outlets }
}

// links stays a second statement on purpose: its `any($5)` term list is the output of the
// first one, so folding it in would mean recomputing the ranking to feed itself. It is also
// the cheap half of the route (see docs/perf-baseline.md) and is skipped entirely when the
// graph has no nodes.
export const graphFor = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain, outlets } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<GraphAggregates>(graphSql, [person.id, q.days, q.source, domain, q.kind, exclude, q.min, q.sort, q.limit])
  const { docs, about, nodes, signature } = rows[0]
  const ids = nodes.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await db.query<LinkRow>(linksSql, [person.id, q.days, q.source, domain, ids]) : { rows: [] }
  const testimony = q.method ? (await db.query<TermTestimonyRow>(termTestimonySql, [person.id, q.days, q.source, domain, q.method, ids])).rows[0] : null
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
const compareScopeCte = `
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $3)
      and ($4 = 'all' or d.source = any(string_to_array($4, ',')))
      and ($5 = 'all' or d.domain = any(string_to_array($5, ',')))
  ),
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`

// One side's about/term_p/scored/top-N CTEs, parameterized by the person id param ($1 or $2)
// and that person's own nameTokens array param ($8 or $9) -- inherently per-person, since a
// term can be A's own name and legitimate vocabulary for B (spec §3), so these cannot be
// shared the way scope/tracked/n/term_all are.
//
// Deliberately not capped by $7 (limit) here: every term the person's docs carry in scope
// gets an exact count/pmi/tone, with only the name-word exclusion applied, same as graphSql's
// term_p. `limit` only governs top_count/top_pmi, i.e. which keys enter the union below --
// the exact figure for a unioned key is always looked up uncapped, in `scored_<side>`.
//
// Both top_count and top_pmi are computed for every call, per spec: dropping either would
// silently exclude "loud but not sticky" or "rare but sticky" words from one side. pmi *
// ln(1 + count) is sort=pmi's pinned formula (graphSql), reused unchanged.
const compareSideCte = (side: 'a' | 'b', personParam: string, namesParam: string) => `
  about_${side} as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = ${personParam}
  ),
  np_${side} as materialized (select count(*)::float8 as total from about_${side}),
  term_p_${side} as materialized (
    select t.term, t.kind, count(*)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about_${side} x on x.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any(${namesParam}::text[])) and not ${namePhraseSql(namesParam)}
    group by 1, 2
  ),
  scored_${side} as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np_${side}.total * a.c_t)) / ln(2) as pmi
    from term_p_${side} p join term_all a using (term, kind), n, np_${side}
    where $6 = 'all' or p.kind = any(string_to_array($6, ','))
  ),
  ${side}_top_count as (
    select term, kind from scored_${side} order by count desc, term, kind limit $7
  ),
  ${side}_top_pmi as (
    select term, kind from scored_${side} order by pmi * ln(1 + count) desc, term, kind limit $7
  )`

// $1 a's person id, $2 b's, $3 days, $4 source, $5 domain (already resolved via resolveScope),
// $6 kind, $7 limit, $8 a's nameTokens, $9 b's nameTokens.
//
// `keys` is the union of up to four (term, kind) lists across both sides -- UNION (not UNION
// ALL) dedupes on its own. `unioned` then looks up the exact, uncapped figure for every key on
// each side via a left join, so a key selected only from the other side's lists comes back
// null on this one, not a dropped row -- the whole point of the union (spec §3): a null must
// be measured, never "outside the top list".
//
// is_name_a/is_name_b are computed against the key text directly (isNameSql), not against
// scored_a/scored_b: a term can be one side's own name word and therefore entirely absent
// from that side's term_p (excluded there by construction), yet still need to read "name"
// rather than null on this response.
const compareSql = `
  with ${compareScopeCte},
  n as materialized (select count(*)::float8 as total from tracked),
  term_all as materialized (
    select t.term, t.kind, count(*)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  ${compareSideCte('a', '$1', '$8')},
  ${compareSideCte('b', '$2', '$9')},
  keys as (
    select term, kind from a_top_count
    union select term, kind from a_top_pmi
    union select term, kind from b_top_count
    union select term, kind from b_top_pmi
  ),
  unioned as (
    select k.term, k.kind,
      ${isNameSql('k.term', '$8')} as is_name_a,
      ${isNameSql('k.term', '$9')} as is_name_b,
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
  const namesA = nameTokens(a)
  const namesB = nameTokens(b)
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<CompareAggregates>(compareSql, [a.id, b.id, q.days, q.source, domain, q.kind, q.limit, namesA, namesB])
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

// The exact statements the routes run, exported read-only so `pnpm bench` can put each one
// through EXPLAIN (ANALYZE, BUFFERS) with representative parameters. Nothing here changes
// what a route executes; it is the same string object the handlers above use.
export const statements = {
  graph: graphSql,
  links: linksSql,
  sources: sourcesSql,
  docs: docsSql,
  docsCount: docsCountSql,
  timeline: timelineSql,
  rising: risingSql,
  tone: toneSql,
  testimonySummary: testimonySummarySql,
  termTestimony: termTestimonySql,
  candidates: candidatesSql,
  compare: compareSql,
} as const
