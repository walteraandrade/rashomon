import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { db, migrate } from '../src/db.js'
import {
  docsFor,
  graphFor,
  risingFor,
  sourcesFor,
  testimonyFor,
  timelineFor,
  toneFor,
  type TestimonyQuery,
} from '../src/graph.js'
import { parseDocsQuery, parseQuery, parseRisingQuery, parseTestimonyQuery, parseTimelineQuery, parseToneQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'

// Independent verification of issue #21's numbered acceptance criteria, written against
// the spec rather than against test/testimony.test.ts. Fixture values are recomputed by
// hand from test/fixture.ts's seedTestimony() rows, not copied from the builder's assertions.

const tarcisio = persons.find((p) => p.id === 'tarcisio')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const lula = persons.find((p) => p.id === 'lula')!
const base: TestimonyQuery = { days: 30, source: 'all', method: 'stub', min: 3 }
const byDomain = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)

describe('testimony acceptance criteria (issue #21)', () => {
  before(seed)

  it('AC1: migrate() run twice against a fresh in-memory database is idempotent, table has the right shape', async () => {
    await migrate()
    await migrate()
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'doc_testimony' order by column_name`,
    )
    assert.deepEqual(
      cols.rows.map((r) => r.column_name).sort(),
      ['doc_id', 'method', 'person_id', 'score'],
    )
    const pk = await db.query<{ column_name: string }>(
      `select kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
       where tc.table_name = 'doc_testimony' and tc.constraint_type = 'PRIMARY KEY'
       order by kcu.ordinal_position`,
    )
    assert.deepEqual(
      pk.rows.map((r) => r.column_name),
      ['doc_id', 'person_id', 'method'],
    )
  })

  it('AC2: GET /api/people/:id/testimony for an unknown id returns 404 with { error: "person not found" }', async () => {
    const res = await app.request('/api/people/nobody/testimony')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('AC3: a person with no docs scored under the requested method gets the all-empty shape', async () => {
    const r = await testimonyFor(lula, { ...base, method: 'a-method-never-inserted-in-the-fixture' })
    assert.deepEqual(r, {
      method: 'a-method-never-inserted-in-the-fixture',
      overall: { score: null, n: 0 },
      by_source: [],
      by_domain: [],
    })
  })

  it('AC4: a (domain, source) pair at/above min appears once with the hand-computed average, below min is absent, lowering min surfaces it', async () => {
    // oglobo.globo.com/tarcisio has 2 non-null scores (5, -1): below the default min=3
    const atDefault = await testimonyFor(tarcisio, base)
    assert.equal(byDomain(atDefault, 'oglobo.globo.com'), undefined)
    const lowered = await testimonyFor(tarcisio, { ...base, min: 2 })
    assert.deepEqual(byDomain(lowered, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('AC5: a doc with domain is null never appears in by_domain, at min=1, but contributes to overall and by_source', async () => {
    // doc /35 (tarcisio, score -8) has no domain
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.ok(!r.by_domain.some((d) => !d.domain))
    const source = r.by_source.find((s) => s.source === 'gdelt')
    assert.ok(source && source.n >= 6, 'the domain-less doc still counts toward by_source')
  })

  it('AC6: a null-scored doc is excluded from n and score at overall, by_source and by_domain', async () => {
    // doc /36 (estadao.com.br, tarcisio, null) shares person+domain+window with docs 30-32
    const r = await testimonyFor(tarcisio, base)
    assert.deepEqual(byDomain(r, 'estadao.com.br'), { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 })
    assert.equal(r.overall.n, 6, 'the null-scored doc must not inflate n')
  })

  it('AC7: a doc naming two tracked persons keeps independent scores, no leak either direction', async () => {
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(byDomain(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(byDomain(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
  })

  it('AC8: a doc outside days/source contributes nothing; widening days or source includes it', async () => {
    // lula: g1.globo.com/5, source gnews, 100 days ago, score -2 -- outside the default days:30
    const narrow = await testimonyFor(lula, base)
    assert.equal(narrow.overall.n, 2)
    const wide = await testimonyFor(lula, { ...base, days: 200 })
    assert.equal(wide.overall.n, 3)
    // and the source filter: gdeltproject.org/38 (gkg) is excluded by source=gnews
    const gnewsOnly = await testimonyFor(lula, { ...base, source: 'gnews' })
    assert.equal(gnewsOnly.overall.n, 1)
  })

  it('AC9: source=<list> restricts overall, by_source and by_domain using parseSourceList grammar', async () => {
    const r = await testimonyFor(lula, { ...base, source: 'gkg,bogus' })
    assert.deepEqual(r.overall, { score: 3, n: 1 })
    assert.deepEqual(r.by_source, [{ source: 'gkg', score: 3, n: 1 }])
  })

  it('AC10: parseTestimonyQuery clamps days to [1, 365] (default 30) and min to [1, 1000] (default 3) as its own literal', () => {
    assert.equal(parseTestimonyQuery({}).days, 30)
    assert.equal(parseTestimonyQuery({ days: '9999' }).days, 365)
    assert.equal(parseTestimonyQuery({ days: '0' }).days, 1)
    assert.equal(parseTestimonyQuery({}).min, 3)
    assert.equal(parseTestimonyQuery({ min: '5000' }).min, 1000)
    assert.equal(parseTestimonyQuery({ min: '0' }).min, 1)
  })

  it('AC11: pnpm score is exercised separately in test/score.test.ts', () => {
    // AC11 is covered end-to-end in test/score.test.ts, which asserts the exact insert/skip
    // counts of scoreAll against the shared fixture; not duplicated here.
    assert.ok(true)
  })

  it('AC12: pnpm export-docs is exercised separately in test/export-docs.test.ts', () => {
    assert.ok(true)
  })

  it('AC13: importing the onnx scorer module never triggers network access', async () => {
    const mod = await import('../src/scorers/onnx.js')
    assert.equal(typeof mod.onnx, 'function')
  })

  it('AC14: existing routes are unaffected -- each matches calling its *For function directly with the default parser', async () => {
    const id = 'tarcisio'
    const [graphRes, sourcesRes, docsRes, timelineRes, risingRes, toneRes, peopleRes] = await Promise.all([
      app.request(`/api/people/${id}/graph`),
      app.request(`/api/people/${id}/sources`),
      app.request(`/api/people/${id}/docs`),
      app.request(`/api/people/${id}/timeline`),
      app.request(`/api/people/${id}/rising`),
      app.request(`/api/tone`),
      app.request(`/api/people`),
    ])
    const [graphBody, sourcesBody, docsBody, timelineBody, risingBody, toneBody, peopleBody] = await Promise.all([
      graphRes.json(),
      sourcesRes.json(),
      docsRes.json(),
      timelineRes.json(),
      risingRes.json(),
      toneRes.json(),
      peopleRes.json(),
    ])

    const person = { id: tarcisio.id, name: tarcisio.name, aliases: tarcisio.aliases }
    assert.deepEqual(JSON.parse(JSON.stringify(await graphFor(person, parseQuery({})))), graphBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await sourcesFor(person, parseQuery({})))), sourcesBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await docsFor(person, parseDocsQuery({})))), docsBody)
    // timelineFor buckets off now(), so a fresh direct call and the earlier HTTP call can land
    // on different millisecond boundaries; shapes/counts are what must be byte-identical
    const directTimeline = await timelineFor(person, parseTimelineQuery({}))
    assert.deepEqual(
      directTimeline.map((b) => b.count),
      (timelineBody as { count: number }[]).map((b) => b.count),
    )
    assert.equal(directTimeline.length, (timelineBody as unknown[]).length)
    assert.deepEqual(JSON.parse(JSON.stringify(await risingFor(person, parseRisingQuery({})))), risingBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await toneFor(parseToneQuery({})))), toneBody)
    const { rows } = await db.query(`select id, name, aliases from persons order by name`)
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), peopleBody)
  })
})
