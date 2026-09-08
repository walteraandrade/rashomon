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

type TermRow = { term: string; kind: string; count: number; pmi: number; tone: number | null }
type SignatureRow = { term: string; kind: string; count: number; pmi: number }
type SourceRow = { domain: string | null; source: string; docs: number; tone: number | null; tone_n: number }
type LinkRow = { s: string; t: string; count: number }
type Stats = { docs: number; about: number }
type DocRow = { id: number; source: string; domain: string | null; published_at: Date; text: string; uri: string; tone: number | null }
type RisingRow = { term: string; kind: string; count_recent: number; count_baseline: number; lift: number }
type TimelineRow = { bucket_start: Date; count: number }
type ToneCellRow = { person_id: string; domain: string; tone: number; n: number }
type ToneListRow = { id: string; name: string }

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

const termsSql = `
  with ${scopeCte}, ${trackedCte},
  n as (select count(*)::float8 as total from tracked),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  term_p as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where ($5 = 'all' or t.kind = $5) and not (t.term = any($6::text[]))
    group by 1, 2
  ),
  scored as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= $7
  )
  select term, kind, count, round(pmi::numeric, 2)::float8 as pmi, round(tone::numeric, 2)::float8 as tone from scored
  order by (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) desc, term
  limit $9`

// signature: same scope as termsSql but ignores kind/min/limit/sort and applies its own
// floor (count >= max(3, 5% of about)), so it stays a stable "what sticks" facet rather
// than a projection of the toolbar's current filters.
const signatureSql = `
  with ${scopeCte}, ${trackedCte},
  n as (select count(*)::float8 as total from tracked),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  term_p as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt
    from doc_terms t join about a on a.doc_id = t.doc_id
    where not (t.term = any($5::text[]))
    group by 1, 2
  ),
  scored as (
    select p.term, p.kind, p.c_pt::int as count,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= greatest(3, np.total * 0.05)
  )
  select term, kind, count, round(pmi::numeric, 2)::float8 as pmi from scored
  order by pmi desc, term
  limit 5`

const linksSql = `
  with ${scopeCte}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(distinct a.doc_id)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any($5::text[]) and (b.kind || ':' || b.term) = any($5::text[])
  group by 1, 2 having count(distinct a.doc_id) >= 2`

const statsSql = `
  with ${scopeCte}
  select (select count(*) from scope)::int as docs, (select count(*) from about)::int as about`

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
        and (t.kind = $6 or $6 not in ('hashtag', 'word', 'theme'))
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
const timelineSql = `
  with ${scopeCte},
  bounds as (select $2::int as days, $7::int as bucket_days),
  buckets as (
    select i,
      greatest(
        now() - make_interval(days => b.days),
        now() - make_interval(days => (i + 1) * b.bucket_days)
      ) as bucket_start,
      case when i = 0 then 'infinity'::timestamptz
        else now() - make_interval(days => i * b.bucket_days) end as bucket_end
    from bounds b, generate_series(0, ceil(b.days::float8 / b.bucket_days::float8)::int - 1) as i
  )
  select b.bucket_start,
    count(d.id)::int as count
  from buckets b
  left join about a on true
  left join docs d on d.id = a.doc_id
    and d.published_at >= b.bucket_start and d.published_at < b.bucket_end
    and ${docsWhereSql}
  group by b.bucket_start
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
const toneSql = `
  select p.id as person_id, d.domain as domain,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as n
  from docs d
  join doc_persons dp on dp.doc_id = d.id
  join persons p on p.id = dp.person_id
  where d.published_at >= now() - make_interval(days => $1)
    and d.domain is not null
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

const testimonyOverallSql = `
  with ${testimonyScopeCte}
  select round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n from scope`

// No $5 (min) here on purpose: by_source has an implicit floor of 1 (having count(score) >= 1),
// never gated by the caller's min, per the spec.
const testimonyBySourceSql = `
  with ${testimonyScopeCte}
  select source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  group by source
  having count(score) >= 1
  order by source`

const testimonyByDomainSql = `
  with ${testimonyScopeCte}
  select domain, source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  where domain is not null
  group by domain, source
  having count(score) >= $5
  order by domain, source`

type TestimonyOverallRow = { score: number | null; n: number }
type TestimonyBySourceRow = { source: string; score: number; n: number }
type TestimonyByDomainRow = { domain: string; source: string; score: number; n: number }

export const testimonyFor = async (person: Person, q: TestimonyQuery) => {
  const params = [person.id, q.days, q.source, q.method]
  const [overall, bySource, byDomain] = await Promise.all([
    db.query<TestimonyOverallRow>(testimonyOverallSql, params),
    db.query<TestimonyBySourceRow>(testimonyBySourceSql, params),
    db.query<TestimonyByDomainRow>(testimonyByDomainSql, [...params, q.min]),
  ])
  return {
    method: q.method,
    overall: overall.rows[0] ?? { score: null, n: 0 },
    by_source: bySource.rows,
    by_domain: byDomain.rows,
  }
}

// Two disjoint windows (recent, then baseline immediately before it), instead of
// reusing scopeCte twice, so a doc is never double-counted into both windows.
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
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_recent
    from doc_terms t join recent_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = $6) and not (t.term = any($7::text[]))
    group by 1, 2
  ),
  baseline_terms as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_baseline
    from doc_terms t join baseline_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = $6) and not (t.term = any($7::text[]))
    group by 1, 2
  )
  select r.term, r.kind,
    round((r.c_recent / $2)::numeric, 2)::float8 as count_recent,
    round((coalesce(b.c_baseline, 0) / $3)::numeric, 2)::float8 as count_baseline,
    round(((r.c_recent / $2) / ((coalesce(b.c_baseline, 0) + 1) / $3))::numeric, 2)::float8 as lift
  from recent_terms r left join baseline_terms b using (term, kind)
  where r.c_recent >= $8
  order by lift desc, term
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

export const graphFor = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain, outlets } = resolveScope(q.domain, q.lean)
  const [terms, stats, signature] = await Promise.all([
    db.query<TermRow>(termsSql, [person.id, q.days, q.source, domain, q.kind, exclude, q.min, q.sort, q.limit]),
    db.query<Stats>(statsSql, [person.id, q.days, q.source, domain]),
    db.query<SignatureRow>(signatureSql, [person.id, q.days, q.source, domain, exclude]),
  ])
  const ids = terms.rows.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await db.query<LinkRow>(linksSql, [person.id, q.days, q.source, domain, ids]) : { rows: [] }
  return {
    person,
    stats: stats.rows[0],
    nodes: terms.rows.map((t) => ({ id: `${t.kind}:${t.term}`, ...t })),
    links: [
      ...terms.rows.map((t) => ({ source: `person:${person.id}`, target: `${t.kind}:${t.term}`, count: t.count })),
      ...links.rows.map((l) => ({ source: l.s, target: l.t, count: l.count })),
    ],
    signature: signature.rows,
    outlets,
  }
}
