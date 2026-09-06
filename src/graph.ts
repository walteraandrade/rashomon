import { db } from './db.js'
import { nameTokens } from './extract.js'
import type { Person } from './types.js'

export type GraphQuery = {
  days: number
  source: string
  domain: string
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
  limit: number
  offset: number
}

export type RisingQuery = {
  days: number
  baseline: number
  source: string
  domain: string
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
  bucket: 'day' | 'week'
}

export type ToneQuery = {
  days: number
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

const scopeCte = `
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($3 = 'all' or d.source = $3)
      and ($4 = 'all' or d.domain = $4)
  ),
  about as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = $1
  )`

const termsSql = `
  with ${scopeCte},
  n as (select count(*)::float8 as total from scope),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join scope s on s.id = t.doc_id group by 1, 2
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
  with ${scopeCte},
  n as (select count(*)::float8 as total from scope),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join scope s on s.id = t.doc_id group by 1, 2
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

export const sourcesFor = async (person: Person, q: GraphQuery) =>
  (await db.query<SourceRow>(sourcesSql, [person.id, q.days, q.source, 'all'])).rows

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
  const params = [person.id, q.days, q.source, q.domain, q.term, q.kind]
  const [docs, count] = await Promise.all([
    db.query<DocRow>(docsSql, [...params, q.limit, q.offset]),
    db.query<{ total: number }>(docsCountSql, params),
  ])
  return { total: count.rows[0].total, docs: docs.rows }
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

export const timelineFor = async (person: Person, q: TimelineQuery) => {
  const bucketDays = q.bucket === 'day' ? 1 : 7
  const params = [person.id, q.days, q.source, q.domain, q.term, q.kind, bucketDays]
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

// Two disjoint windows (recent, then baseline immediately before it), instead of
// reusing scopeCte twice, so a doc is never double-counted into both windows.
const risingSql = `
  with
  recent_scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = $5)
  ),
  recent_about as (
    select dp.doc_id from doc_persons dp join recent_scope s on s.id = dp.doc_id where dp.person_id = $1
  ),
  baseline_scope as (
    select d.id from docs d
    where d.published_at < now() - make_interval(days => $2)
      and d.published_at >= now() - make_interval(days => $2 + $3)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = $5)
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

export const risingFor = async (person: Person, q: RisingQuery) => {
  const exclude = nameTokens(person)
  const { rows } = await db.query<RisingRow>(risingSql, [
    person.id,
    q.days,
    q.baseline,
    q.source,
    q.domain,
    q.kind,
    exclude,
    q.min,
    q.limit,
  ])
  return { days: q.days, baseline: q.baseline, terms: rows }
}

export const graphFor = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const [terms, stats, signature] = await Promise.all([
    db.query<TermRow>(termsSql, [person.id, q.days, q.source, q.domain, q.kind, exclude, q.min, q.sort, q.limit]),
    db.query<Stats>(statsSql, [person.id, q.days, q.source, q.domain]),
    db.query<SignatureRow>(signatureSql, [person.id, q.days, q.source, q.domain, exclude]),
  ])
  const ids = terms.rows.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await db.query<LinkRow>(linksSql, [person.id, q.days, q.source, q.domain, ids]) : { rows: [] }
  return {
    person,
    stats: stats.rows[0],
    nodes: terms.rows.map((t) => ({ id: `${t.kind}:${t.term}`, ...t })),
    links: [
      ...terms.rows.map((t) => ({ source: `person:${person.id}`, target: `${t.kind}:${t.term}`, count: t.count })),
      ...links.rows.map((l) => ({ source: l.s, target: l.t, count: l.count })),
    ],
    signature: signature.rows,
  }
}
