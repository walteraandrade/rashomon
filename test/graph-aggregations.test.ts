import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import { graphFor, statements, type GraphQuery } from '../src/graph.js'
import { resolveScope } from '../src/outlets.js'
import { persons, seed } from './fixture.js'
import type { Person } from '../src/types.js'

// Issue #45 merged the three statements that produced stats, nodes and signature into one.
// The three originals are kept here verbatim as a reference implementation, so every case
// below asserts the merged statement returns the same thing field by field, for the same
// parameters, instead of re-pinning literals that could be recomputed to match a regression.

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

const statsSql = `
  with ${scopeCte}
  select (select count(*) from scope)::int as docs, (select count(*) from about)::int as about`

const splitGraph = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain } = resolveScope(q.domain, q.lean)
  const [terms, stats, signature] = await Promise.all([
    db.query<Record<string, unknown>>(termsSql, [person.id, q.days, q.source, domain, q.kind, exclude, q.min, q.sort, q.limit]),
    db.query<Record<string, unknown>>(statsSql, [person.id, q.days, q.source, domain]),
    db.query<Record<string, unknown>>(signatureSql, [person.id, q.days, q.source, domain, exclude]),
  ])
  return { stats: stats.rows[0], nodes: terms.rows, signature: signature.rows }
}

const base: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula, tarcisio, bolsonaro] = persons
const nobody: Person = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }

const cases: [string, Person, GraphQuery][] = [
  ['default window', lula, base],
  ['sort=pmi over a wide window', lula, { ...base, days: 365, sort: 'pmi', limit: 10 }],
  ['sort=pmi with the same limit as the tie set', lula, { ...base, days: 2000, sort: 'pmi', limit: 200, min: 1 }],
  ['kind=hashtag', lula, { ...base, kind: 'hashtag' }],
  ['kind=word with a min floor and a tight limit', lula, { ...base, kind: 'word', min: 2, limit: 3 }],
  ['kind=theme, a kind this fixture never stores', lula, { ...base, kind: 'theme' }],
  ['min above every count, so no node survives', lula, { ...base, min: 999 }],
  ['a comma-separated source list', lula, { ...base, source: 'gnews,rss,gkg' }],
  ['a single source', lula, { ...base, source: 'bluesky' }],
  ['a source the person has no docs in', lula, { ...base, source: 'senado' }],
  ['a domain filter', lula, { ...base, domain: 'g1.globo.com' }],
  ['toned gdelt docs', tarcisio, base],
  ['toned and untoned docs mixed in one window', tarcisio, { ...base, days: 365, min: 1, limit: 200 }],
  ['a lean filter', bolsonaro, { ...base, days: 2210, lean: 'left' }],
  ['a domain and lean intersection that is empty', bolsonaro, { ...base, days: 2210, domain: 'g1.globo.com', lean: 'left' }],
  ['signature ties at 1000 days', lula, { ...base, days: 1000 }],
  ['signature ties at 2000 days', lula, { ...base, days: 2000 }],
  ['a person with no docs at all', nobody, base],
  ['a window with no docs at all', lula, { ...base, days: 1, source: 'camara' }],
]

describe('shared graph aggregations (issue #45)', () => {
  before(seed)

  for (const [name, person, q] of cases) {
    it(`matches the split statements field by field: ${name}`, async () => {
      const merged = await graphFor(person, q)
      const split = await splitGraph(person, q)
      assert.deepEqual(merged.stats, split.stats)
      assert.deepEqual(
        merged.nodes.map(({ id, ...node }) => node),
        split.nodes,
      )
      assert.deepEqual(merged.signature, split.signature)
      assert.deepEqual(
        merged.nodes.map((n) => n.id),
        split.nodes.map((n) => `${n.kind}:${n.term}`),
      )
    })
  }

  it('keeps the whole response shape, not only the parts the merge touched', async () => {
    const g = await graphFor(lula, base)
    assert.deepEqual(Object.keys(g).sort(), ['links', 'nodes', 'outlets', 'person', 'signature', 'stats'])
    assert.deepEqual(Object.keys(g.stats).sort(), ['about', 'docs'])
    for (const node of g.nodes) assert.deepEqual(Object.keys(node).sort(), ['count', 'id', 'kind', 'pmi', 'term', 'tone'])
    for (const row of g.signature) assert.deepEqual(Object.keys(row).sort(), ['count', 'kind', 'pmi', 'term'])
    for (const link of g.links) assert.deepEqual(Object.keys(link).sort(), ['count', 'source', 'target'])
  })

  it('returns numbers and nulls, never json strings', async () => {
    const g = await graphFor(tarcisio, base)
    const rodovia = g.nodes.find((n) => n.id === 'word:rodovia')
    assert.equal(typeof rodovia?.count, 'number')
    assert.equal(typeof rodovia?.pmi, 'number')
    assert.equal(rodovia?.tone, -1.5)
    assert.equal(g.nodes.find((n) => n.id === 'word:eleicao')?.tone, null)
  })

  it('leaves links out of the merged statement and skips it when there is no node', async () => {
    assert.ok(!statements.graph.includes('doc_terms b'), 'links must not have been folded into the aggregate statement')
    const empty = await graphFor(lula, { ...base, min: 999 })
    assert.deepEqual(empty.nodes, [])
    assert.deepEqual(empty.links, [])
  })
})

// The point of the merge is the statement count, so it is asserted rather than described.
// The instrumentation in src/perf.ts is off in tests (PERF unset), so this counts through a
// temporary own property on the handle and restores the prototype method afterwards.
const countStatements = async (fn: () => Promise<unknown>) => {
  const original = db.query.bind(db)
  const descriptor = Object.getOwnPropertyDescriptor(db, 'query')
  let n = 0
  Object.defineProperty(db, 'query', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      n += 1
      return (original as (...a: unknown[]) => Promise<unknown>)(...args)
    },
  })
  try {
    await fn()
  } finally {
    if (descriptor) Object.defineProperty(db, 'query', descriptor)
    else delete (db as unknown as { query?: unknown }).query
  }
  return n
}

describe('graph statement count (issue #45)', () => {
  before(seed)

  it('runs one statement for stats, nodes and signature, plus links', async () => {
    assert.equal(await countStatements(() => graphFor(lula, base)), 2)
  })

  it('runs a single statement when the graph has no node to link', async () => {
    assert.equal(await countStatements(() => graphFor(nobody, base)), 1)
  })
})
