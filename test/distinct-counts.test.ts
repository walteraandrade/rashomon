import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import { graphFor, risingFor, statements, toneFor, type GraphQuery, type RisingQuery, type ToneQuery } from '../src/graph.js'
import { resolveScope } from '../src/outlets.js'
import { persons, seed } from './fixture.js'
import type { Person } from '../src/types.js'
import './close.js'

// Issue #47 replaced count(distinct doc_id) with count(*) in the term, signature, rising and
// link paths, and added `tone is not null` to the tone matrix. The pre-#47 statements are kept
// here as a reference implementation, so every case below asserts the shipped statements return
// the same rows, in the same order, with the same rounding — instead of re-pinning literals that
// could be recomputed to match a regression.
//
// They carry the one deliberate ordering change with them: `kind` now closes the order by of
// nodes, signature and rising. Two kinds of one term text tying on (count/pmi/lift, term) were
// previously ranked by nothing at all, so the reference statements would otherwise differ from
// the shipped ones purely by plan. The tie itself is pinned separately below.

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

const trackedCte = `
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`

const referenceGraphSql = `
  with ${scopeCte}, ${trackedCte},
  n as materialized (select count(*)::float8 as total from tracked),
  np as materialized (select count(*)::float8 as total from about),
  term_p as materialized (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any($6::text[]))
    group by 1, 2
  ),
  term_all as materialized (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  nodes_scored as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= $7 and ($5 = 'all' or p.kind = $5)
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

// No order by, exactly as before #47: its row order was whatever the plan emitted.
const referenceLinksSql = `
  with ${scopeCte}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(distinct a.doc_id)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any($5::text[]) and (b.kind || ':' || b.term) = any($5::text[])
  group by 1, 2 having count(distinct a.doc_id) >= 2`

const referenceRisingSql = `
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
  order by lift desc, term, kind
  limit $9`

// No `tone is not null`, exactly as before #47.
const referenceToneSql = `
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

type Row = Record<string, unknown>

const referenceGraph = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<{ docs: number; about: number; nodes: Row[]; signature: Row[] }>(referenceGraphSql, [
    person.id,
    q.days,
    q.source,
    domain,
    q.kind,
    exclude,
    q.min,
    q.sort,
    q.limit,
  ])
  const { docs, about, nodes, signature } = rows[0]
  const ids = nodes.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await db.query<{ s: string; t: string; count: number }>(referenceLinksSql, [person.id, q.days, q.source, domain, ids]) : { rows: [] }
  return {
    stats: { docs, about },
    signature,
    nodes: nodes.map((t): Row => ({ id: `${t.kind}:${t.term}`, ...t })),
    spokes: nodes.map((t) => ({ source: `person:${person.id}`, target: `${t.kind}:${t.term}`, count: t.count })),
    pairs: links.rows.map((l) => ({ source: l.s, target: l.t, count: l.count })),
  }
}

const referenceRising = async (person: Person, q: RisingQuery) => {
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<Row>(referenceRisingSql, [
    person.id,
    q.days,
    q.baseline,
    q.source,
    domain,
    q.kind,
    nameTokens(person),
    q.min,
    q.limit,
  ])
  return rows
}

const referenceTone = async (q: ToneQuery) => (await db.query<Row>(referenceToneSql, [q.days, q.min])).rows

const byId = (a: { source: string; target: string }, b: { source: string; target: string }) =>
  a.source === b.source ? (a.target < b.target ? -1 : 1) : a.source < b.source ? -1 : 1

const graphBase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula, tarcisio, bolsonaro] = persons
const nobody: Person = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }
// Docs 43-45 ("coalizao" under three kinds, doc 43 shared by lula and bolsonaro) sit past 3400 days.
const wide: GraphQuery = { ...graphBase, days: 3500, min: 1, limit: 200 }

const graphCases: [string, Person, GraphQuery][] = [
  ['default window', lula, graphBase],
  ['one term text under two kinds in the default window (#reforma and reforma)', lula, { ...graphBase, kind: 'all', min: 1 }],
  ['a doc shared by two persons, one term text under three kinds', lula, wide],
  ['the same shared doc seen from the other person', bolsonaro, wide],
  ['the shared window sorted by pmi', lula, { ...wide, sort: 'pmi', limit: 10 }],
  ['kind=theme, which only docs 43-44 store', lula, { ...wide, kind: 'theme' }],
  ['kind=hashtag over the shared window', lula, { ...wide, kind: 'hashtag' }],
  ['kind=word over the shared window', bolsonaro, { ...wide, kind: 'word' }],
  ['toned and untoned docs mixed in one window', tarcisio, { ...graphBase, days: 365, limit: 200 }],
  ['a window whose only doc names two persons', bolsonaro, { ...graphBase, days: 365, limit: 200 }],
  ['a min floor above the shared-doc counts', lula, { ...wide, min: 3 }],
  ['a source list over the shared window', lula, { ...wide, source: 'rss,gnews' }],
  ['a domain filter over the shared window', lula, { ...wide, domain: 'example.org' }],
  ['a person with no docs at all', nobody, wide],
]

describe('count(*) matches count(distinct doc_id) in the graph path (issue #47)', () => {
  before(seed)

  for (const [name, person, q] of graphCases) {
    it(`matches the reference statement field by field: ${name}`, async () => {
      const shipped = await graphFor(person, q)
      const reference = await referenceGraph(person, q)
      assert.deepEqual(shipped.stats, reference.stats)
      assert.deepEqual(shipped.nodes, reference.nodes)
      assert.deepEqual(shipped.signature, reference.signature)
      const spokes = shipped.links.filter((l) => l.source.startsWith('person:'))
      const pairs = shipped.links.filter((l) => !l.source.startsWith('person:'))
      assert.deepEqual(spokes, reference.spokes)
      assert.deepEqual([...pairs].sort(byId), [...reference.pairs].sort(byId))
    })
  }

  it('counts a doc naming two persons once per person, and once in the shared denominator', async () => {
    // docs 43 (lula + bolsonaro), 44 (lula) and 45 (bolsonaro) all carry word:coalizao
    const l = await graphFor(lula, wide)
    const b = await graphFor(bolsonaro, wide)
    assert.equal(l.nodes.find((n) => n.id === 'word:coalizao')?.count, 2)
    assert.equal(b.nodes.find((n) => n.id === 'word:coalizao')?.count, 2)
    // c_t is 3, not 4: the shared doc must not enter `tracked` twice
    const { rows } = await db.query<{ c_t: number }>(
      `select count(*)::int as c_t from doc_terms t
       where t.term = 'coalizao' and t.kind = 'word'
         and exists (select 1 from doc_persons dp where dp.doc_id = t.doc_id)`,
    )
    assert.equal(rows[0].c_t, 3)
    // and the pmi the reference computes from count(distinct) is the one shipped
    const ref = await referenceGraph(lula, wide)
    assert.equal(l.nodes.find((n) => n.id === 'word:coalizao')?.pmi, ref.nodes.find((n) => n.id === 'word:coalizao')?.pmi as number)
  })

  it('keeps one term text under three kinds as three nodes with their own counts', async () => {
    const g = await graphFor(lula, wide)
    const nodes = g.nodes.filter((n) => n.term === 'coalizao')
    assert.deepEqual(nodes.map((n) => n.kind).sort(), ['hashtag', 'theme', 'word'])
    // docs 43 and 44 carry all three for lula; doc 45 is bolsonaro-only
    for (const n of nodes) assert.equal(n.count, 2, `${n.id} must count 2 docs`)
    const b = await graphFor(bolsonaro, wide)
    assert.equal(b.nodes.find((n) => n.id === 'theme:coalizao')?.count, 1, 'doc 45 stores no theme term')
    assert.equal(b.nodes.find((n) => n.id === 'hashtag:coalizao')?.count, 2)
  })

  it('links the same term text across kinds without collapsing or double-counting', async () => {
    const g = await graphFor(lula, wide)
    const pair = (s: string, t: string) => g.links.find((l) => l.source === s && l.target === t)
    // docs 43 and 44 both carry all three, so every pair is exactly 2 — never 4 from the shared doc
    assert.equal(pair('hashtag:coalizao', 'theme:coalizao')?.count, 2)
    assert.equal(pair('hashtag:coalizao', 'word:coalizao')?.count, 2)
    assert.equal(pair('theme:coalizao', 'word:coalizao')?.count, 2)
  })

  it('breaks a (count, term) tie across kinds by kind, deterministically', async () => {
    // hashtag/theme/word:coalizao all count 2 for lula in this window, so nothing but `kind`
    // separates them; before #47 the order was whatever the plan emitted
    const g = await graphFor(lula, wide)
    const tied = g.nodes.filter((n) => n.term === 'coalizao')
    assert.deepEqual(tied.map((n) => n.kind), ['hashtag', 'theme', 'word'])
    for (let i = 0; i < 5; i++) {
      assert.deepEqual((await graphFor(lula, wide)).nodes.map((n) => n.id), g.nodes.map((n) => n.id))
    }
  })

  it('applies the same tiebreak to the limit, not only to the surviving order', async () => {
    // limit 1 over a window where the three coalizao kinds are the whole tie set
    const only = await graphFor(lula, { ...wide, kind: 'all', min: 2, limit: 1 })
    const all = await graphFor(lula, { ...wide, kind: 'all', min: 2, limit: 200 })
    assert.deepEqual(only.nodes.map((n) => n.id), all.nodes.slice(0, 1).map((n) => n.id))
  })

  it('emits the co-occurrence links ordered by (source, target), as the pre-#47 plan did', async () => {
    const pairs = (await graphFor(lula, wide)).links.filter((l) => !l.source.startsWith('person:'))
    assert.ok(pairs.length > 1, 'expected several co-occurrence links in this window')
    assert.deepEqual(pairs, [...pairs].sort(byId))
    assert.ok(statements.links.includes('order by 1, 2'), 'links must pin its own order now that count(*) lets the planner hash')
  })
})

const risingBase: RisingQuery = { days: 7, baseline: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 20, min: 1 }

// risingFor's parser clamps days and baseline to 365 each, so docs 43-45 are out of reach here;
// the multi-kind case in this window is doc 1's #reforma alongside the word reforma.
const risingCases: [string, Person, RisingQuery][] = [
  ['default split', lula, risingBase],
  ['one term text under two kinds', lula, { ...risingBase, days: 30, baseline: 30, limit: 100 }],
  ['the widest split the parser allows', lula, { ...risingBase, days: 365, baseline: 365, limit: 100 }],
  ['a window whose only doc names two persons', bolsonaro, { ...risingBase, days: 40, baseline: 365, limit: 100 }],
  ['the other person of that shared doc', tarcisio, { ...risingBase, days: 40, baseline: 365, limit: 100 }],
  ['kind=hashtag', lula, { ...risingBase, days: 30, baseline: 30, kind: 'hashtag', limit: 100 }],
  ['a min floor', lula, { ...risingBase, days: 30, baseline: 30, min: 2, limit: 100 }],
  ['a domain filter', lula, { ...risingBase, days: 365, baseline: 365, domain: 'example.org', limit: 100 }],
  ['a person with no docs at all', nobody, risingBase],
]

describe('count(*) matches count(distinct doc_id) in the rising path (issue #47)', () => {
  before(seed)

  for (const [name, person, q] of risingCases) {
    it(`matches the reference statement row for row: ${name}`, async () => {
      const shipped = await risingFor(person, q)
      assert.deepEqual(shipped.terms, await referenceRising(person, q))
    })
  }

  it('keeps a term text present under two kinds as two rows', async () => {
    const q: RisingQuery = { ...risingBase, days: 30, baseline: 30, limit: 100 }
    const rows = (await risingFor(lula, q)).terms.filter((r) => r.term === 'reforma')
    assert.deepEqual(rows.map((r) => r.kind).sort(), ['hashtag', 'word'])
  })

  it('counts a shared doc once for each person it names', async () => {
    // doc 37 (day 35) names tarcisio and bolsonaro; it is the only bolsonaro doc under 365 days
    const q: RisingQuery = { ...risingBase, days: 40, baseline: 365, limit: 100 }
    const b = (await risingFor(bolsonaro, q)).terms.find((r) => r.term === 'alianca')
    const t = (await risingFor(tarcisio, q)).terms.find((r) => r.term === 'alianca')
    assert.equal(b?.count_recent, t?.count_recent)
    assert.equal(b?.count_recent, Number((1 / 40).toFixed(2)))
  })
})

const toneCases: [string, ToneQuery][] = [
  ['the default window and min', { days: 30, min: 3 }],
  ['min lowered to the parser floor', { days: 30, min: 1 }],
  ['a window reaching the shared toned doc', { days: 90, min: 1 }],
  ['the widest window the parser allows', { days: 365, min: 1 }],
  ['a min no group reaches', { days: 365, min: 1000 }],
  ['a window with no toned doc at all', { days: 1, min: 1 }],
]

describe('tone is not null changes nothing in the tone matrix (issue #47)', () => {
  before(seed)

  for (const [name, q] of toneCases) {
    it(`matches the reference statement row for row: ${name}`, async () => {
      assert.deepEqual((await toneFor(q)).cells, await referenceTone(q))
    })
  }

  it('keeps an untoned doc out of a group it never contributed to', async () => {
    // doc 36 is an untoned rss doc on estadao.com.br about tarcisio, alongside the three toned
    // docs 30-32 (-2, -1, 0): the filter drops the row avg/count already ignored
    const cells = (await toneFor({ days: 30, min: 3 })).cells
    assert.deepEqual(cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br'), {
      person_id: 'tarcisio',
      domain: 'estadao.com.br',
      tone: -1,
      n: 3,
    })
  })

  it('still drops a group whose docs are all untoned', async () => {
    // lula has no toned doc on g1.globo.com in any window
    const cells = (await toneFor({ days: 365, min: 1 })).cells
    assert.ok(!cells.some((c) => c.person_id === 'lula' && c.domain === 'g1.globo.com'))
    assert.ok(cells.some((c) => c.person_id === 'lula' && c.domain === 'gdeltproject.org'), 'lula keeps its one toned domain')
  })

  it('keeps a toned doc naming two persons in both groups', async () => {
    const cells = (await toneFor({ days: 90, min: 1 })).cells
    for (const id of ['tarcisio', 'bolsonaro']) {
      assert.deepEqual(cells.find((c) => c.person_id === id && c.domain === 'poder360.com.br'), {
        person_id: id,
        domain: 'poder360.com.br',
        tone: 0.4,
        n: 1,
      })
    }
  })

  it('leaves the domains list and the persons list untouched', async () => {
    const shipped = await toneFor({ days: 365, min: 1 })
    const reference = await referenceTone({ days: 365, min: 1 })
    assert.deepEqual(shipped.domains, [...new Set(reference.map((c) => c.domain as string))].sort())
    assert.equal(shipped.persons.length, 3)
  })
})
