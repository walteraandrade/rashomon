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

type TermRow = { term: string; kind: string; count: number; pmi: number; tone: number | null }
type SourceRow = { domain: string | null; source: string; docs: number; tone: number | null; tone_n: number }
type LinkRow = { s: string; t: string; count: number }
type Stats = { docs: number; about: number }
type DocRow = { id: number; source: string; domain: string | null; published_at: string; text: string; uri: string; tone: number | null }

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
  order by d.published_at desc
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

export const graphFor = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const [terms, stats] = await Promise.all([
    db.query<TermRow>(termsSql, [person.id, q.days, q.source, q.domain, q.kind, exclude, q.min, q.sort, q.limit]),
    db.query<Stats>(statsSql, [person.id, q.days, q.source, q.domain]),
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
  }
}
