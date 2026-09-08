import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { statements, testimonyFor, type TestimonyQuery } from '../src/graph.js'
import { insertTestimony, persons, seed } from './fixture.js'
import type { Person } from '../src/types.js'

// Issue #48 merged the three statements that produced overall, by_source and by_domain into
// one GROUPING SETS pass. The three originals are kept here verbatim as a reference
// implementation, so every case below asserts the merged statement returns the same thing
// field by field, for the same parameters, instead of re-pinning literals that could be
// recomputed to match a regression.

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

const overallSql = `
  with ${testimonyScopeCte}
  select round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n from scope`

const bySourceSql = `
  with ${testimonyScopeCte}
  select source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  group by source
  having count(score) >= 1
  order by source`

const byDomainSql = `
  with ${testimonyScopeCte}
  select domain, source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  where domain is not null
  group by domain, source
  having count(score) >= $5
  order by domain, source`

const splitTestimony = async (person: Person, q: TestimonyQuery) => {
  const params = [person.id, q.days, q.source, q.method]
  const [overall, bySourceRows, byDomainRows] = await Promise.all([
    db.query<Record<string, unknown>>(overallSql, params),
    db.query<Record<string, unknown>>(bySourceSql, params),
    db.query<Record<string, unknown>>(byDomainSql, [...params, q.min]),
  ])
  return {
    method: q.method,
    overall: overall.rows[0] ?? { score: null, n: 0 },
    by_source: bySourceRows.rows,
    by_domain: byDomainRows.rows,
  }
}

const [lula, tarcisio, bolsonaro] = persons
const nobody: Person = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }
const base: TestimonyQuery = { days: 30, source: 'all', method: 'stub', min: 3 }
const domainOf = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)
const sourceOf = (r: Awaited<ReturnType<typeof testimonyFor>>, source: string) => r.by_source.find((s) => s.source === source)

// Layered on the shared fixture: a second method over the same docs, so method isolation is
// asserted against rows that would otherwise land in exactly the same groups.
// Memoized like fixture.ts's own seed(), since both suites below run in one process and the
// extra rows would violate doc_testimony's primary key on a second insert.
let seeded: Promise<void> | null = null
const seedAll = () =>
  (seeded ??= (async () => {
    await seed()
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'other', -10)
    await insertTestimony('https://example.org/35', 'tarcisio', 'other', -10)
    await insertTestimony('https://poder360.com.br/37', 'bolsonaro', 'other', 9)
  })())

const cases: [string, Person, TestimonyQuery][] = [
  ['default window', tarcisio, base],
  ['min lowered to 1', tarcisio, { ...base, min: 1 }],
  ['min lowered to 2', tarcisio, { ...base, min: 2 }],
  ['min above every group', tarcisio, { ...base, min: 1000 }],
  ['a wide window with a shared doc', tarcisio, { days: 90, source: 'all', method: 'stub', min: 1 }],
  ['the other person of the shared doc', bolsonaro, { days: 90, source: 'all', method: 'stub', min: 1 }],
  ['a single source', lula, { ...base, source: 'gkg' }],
  ['a comma-separated source list', lula, { ...base, source: 'gkg,gnews' }],
  ['a source the person has no docs in', lula, { ...base, source: 'bluesky' }],
  ['a window wide enough to add an older doc', lula, { ...base, days: 200 }],
  ['a window too narrow for any doc', lula, { ...base, days: 1, source: 'camara' }],
  ['a second method over the same docs', tarcisio, { ...base, method: 'other', min: 1 }],
  ['a method never inserted', tarcisio, { ...base, method: 'never-inserted-method' }],
  ['a person with no testimony at all', nobody, base],
  ['a person with no testimony at all, min 1', nobody, { ...base, min: 1 }],
]

describe('shared testimony aggregations (issue #48)', () => {
  before(seedAll)

  for (const [name, person, q] of cases) {
    it(`matches the split statements field by field: ${name}`, async () => {
      assert.deepEqual(await testimonyFor(person, q), await splitTestimony(person, q))
    })
  }

  it('runs one statement for overall, by_source and by_domain', async () => {
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
      await testimonyFor(tarcisio, base)
    } finally {
      if (descriptor) Object.defineProperty(db, 'query', descriptor)
      else delete (db as unknown as { query?: unknown }).query
    }
    assert.equal(n, 1)
  })

  it('keeps the response shape and the key set of every row', async () => {
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.deepEqual(Object.keys(r).sort(), ['by_domain', 'by_source', 'method', 'overall'])
    assert.deepEqual(Object.keys(r.overall).sort(), ['n', 'score'])
    for (const row of r.by_source) assert.deepEqual(Object.keys(row).sort(), ['n', 'score', 'source'])
    for (const row of r.by_domain) assert.deepEqual(Object.keys(row).sort(), ['domain', 'n', 'score', 'source'])
  })

  it('returns numbers and nulls through json, never strings', async () => {
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.equal(typeof r.overall.score, 'number')
    assert.equal(typeof r.overall.n, 'number')
    assert.equal(typeof r.by_source[0].score, 'number')
    assert.equal(typeof r.by_source[0].n, 'number')
    assert.equal(typeof r.by_domain[0].domain, 'string')
    const empty = await testimonyFor(lula, { ...base, method: 'never-inserted-method' })
    assert.equal(empty.overall.score, null)
  })
})

// The asymmetries a single-statement rewrite is most likely to flatten by accident.
describe('testimony level asymmetries survive the merge (issue #48)', () => {
  before(seedAll)

  it('overall has no count floor: a single score is reported even at min 1000', async () => {
    const r = await testimonyFor(bolsonaro, { days: 90, source: 'all', method: 'stub', min: 1000 })
    assert.deepEqual(r.overall, { score: -7, n: 1 })
    assert.deepEqual(r.by_domain, [], 'min 1000 empties by_domain, and only by_domain')
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: -7, n: 1 }])
  })

  it('by_source keeps its floor of 1 and never sees the caller min', async () => {
    // oglobo.globo.com/33-34 and example.org/35 sit below the default min=3 per domain;
    // the gdelt source group still carries all six scores.
    const r = await testimonyFor(tarcisio, base)
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    const high = await testimonyFor(tarcisio, { ...base, min: 1000 })
    assert.deepEqual(high.by_source, r.by_source, 'min moves by_domain only')
  })

  it('by_source drops a group whose scores are all null, which is the floor of 1', async () => {
    // estadao.com.br/36 is the only rss doc scored for tarcisio, and its score is null
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.equal(sourceOf(r, 'rss'), undefined)
    assert.equal(domainOf(r, 'estadao.com.br')?.n, 3, 'the null score is out of n at every level')
    assert.equal(r.overall.n, 6)
  })

  it('only by_domain uses min, and it moves nothing else', async () => {
    const atThree = await testimonyFor(tarcisio, base)
    const atTwo = await testimonyFor(tarcisio, { ...base, min: 2 })
    assert.deepEqual(atTwo.overall, atThree.overall)
    assert.deepEqual(atTwo.by_source, atThree.by_source)
    assert.equal(domainOf(atThree, 'oglobo.globo.com'), undefined)
    assert.deepEqual(domainOf(atTwo, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('never emits a null domain in by_domain, at any min, while the doc still counts elsewhere', async () => {
    // example.org/35 is stored with no domain
    for (const min of [1, 2, 3]) {
      const r = await testimonyFor(tarcisio, { ...base, min })
      assert.ok(!r.by_domain.some((d) => d.domain === null || d.domain === undefined))
    }
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.equal(sourceOf(r, 'gdelt')?.n, 6, 'the domain-less score is inside the source subtotal')
  })

  it('keeps a real null-domain group and the source subtotal apart, never collapsing one into the other', async () => {
    // Both rows carry domain = null in a GROUPING SETS result: the gdelt subtotal (n=6) and the
    // genuine (domain is null, gdelt) group (n=1, the -8 of example.org/35). grouping() is the
    // only thing that tells them apart.
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.deepEqual(
      r.by_source.filter((s) => s.source === 'gdelt'),
      [{ source: 'gdelt', score: 1.33, n: 6 }],
      'exactly one gdelt row, and it is the subtotal, not the null-domain group',
    )
    const raw = await db.query<{ g_source: number; g_domain: number; source: string | null; domain: string | null; n: number }>(
      `with ${testimonyScopeCte}
       select grouping(source) as g_source, grouping(domain) as g_domain, source, domain, count(score)::int as n
       from scope group by grouping sets ((), (source), (domain, source))
       order by g_source, g_domain, source, domain`,
      [tarcisio.id, 30, 'all', 'stub'],
    )
    const nullDomain = raw.rows.filter((row) => row.domain === null)
    assert.ok(nullDomain.length >= 3, 'overall, the source subtotals and a real null-domain group all carry domain null')
    assert.deepEqual(
      nullDomain.filter((row) => row.g_domain === 0),
      [{ g_source: 0, g_domain: 0, source: 'gdelt', domain: null, n: 1 }],
    )
  })

  it('keeps methods isolated: another method over the same docs never leaks in', async () => {
    const stub = await testimonyFor(tarcisio, { ...base, min: 1 })
    const other = await testimonyFor(tarcisio, { ...base, method: 'other', min: 1 })
    assert.deepEqual(stub.overall, { score: 1.33, n: 6 })
    assert.deepEqual(other.overall, { score: -10, n: 2 })
    assert.deepEqual(other.by_source, [{ source: 'gdelt', score: -10, n: 2 }])
    assert.deepEqual(other.by_domain, [{ domain: 'estadao.com.br', source: 'gdelt', score: -10, n: 1 }])
  })

  it('keeps persons isolated for a doc shared by two of them', async () => {
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(domainOf(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(domainOf(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
    assert.deepEqual(t.overall, { score: 2.14, n: 7 })
    assert.deepEqual(b.overall, { score: -7, n: 1 })
  })

  it('rounds the average to two decimals at every level and never touches the count', async () => {
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.equal(r.overall.score, 1.33)
    assert.equal(sourceOf(r, 'gdelt')?.score, 1.33)
    assert.equal(domainOf(r, 'oglobo.globo.com')?.score, 2)
    assert.ok(Number.isInteger(r.overall.n))
  })

  it('orders by_source by source and by_domain by (domain, source)', async () => {
    const r = await testimonyFor(tarcisio, { days: 90, source: 'all', method: 'stub', min: 1 })
    assert.deepEqual(
      r.by_source.map((s) => s.source),
      [...r.by_source.map((s) => s.source)].sort(),
    )
    const keys = r.by_domain.map((d) => `${d.domain} ${d.source}`)
    assert.deepEqual(keys, [...keys].sort())
    assert.ok(keys.length >= 3, 'more than one domain must be in play for the ordering to mean anything')
  })

  it('keeps the empty shape for a method nobody was scored under', async () => {
    const r = await testimonyFor(tarcisio, { ...base, method: 'never-inserted-method' })
    assert.deepEqual(r, { method: 'never-inserted-method', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
  })

  it('keeps the empty shape for a person with no scored doc at all', async () => {
    const r = await testimonyFor(nobody, base)
    assert.deepEqual(r, { method: 'stub', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
  })

  it('answers whatever method label it is handed, without resolving or validating it', async () => {
    // The route's default method is decided outside this function (issue #35); testimonyFor
    // stays agnostic and filters doc_testimony.method on the string it is given.
    for (const method of ['stub', 'other', 'kikori:q8', 'onnx']) {
      const r = await testimonyFor(tarcisio, { ...base, method, min: 1 })
      assert.equal(r.method, method)
    }
  })

  it('exports the merged statement, and only it, for the benchmark', () => {
    assert.equal(typeof statements.testimonySummary, 'string')
    assert.ok(statements.testimonySummary.includes('grouping sets'))
    assert.ok(!Object.keys(statements).some((k) => k.startsWith('testimony') && k !== 'testimonySummary'))
  })
})
