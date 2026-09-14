import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { buildGraphAggregates, SOURCES, WINDOWS } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { graphFor, precomputable, queries } from '../src/graph.js'
import { parseQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'
import './close.js'

// src/aggregate.ts builds graph_scopes / graph_terms_all / graph_terms; graphFor answers
// from them when the recorte fits and from the live query otherwise. The contract is
// equality: for every recorte the tables can hold, both paths render the same response.

const lula = persons.find((p) => p.id === 'lula')!
const q = (over: Record<string, string>) => parseQuery({ days: '30', ...over })
const live = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graph(person, query).text, queries.graph(person, query).values)).rows[0]
const fast = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graphFast(person, query).text, queries.graphFast(person, query).values)).rows[0]

describe('precomputable', () => {
  it('holds one source or all, no domain, no lean', () => {
    assert.equal(precomputable({ domain: 'all', lean: 'all', source: 'all' }), true)
    assert.equal(precomputable({ domain: 'all', lean: 'all', source: 'rss' }), true)
    assert.equal(precomputable({ domain: 'all', lean: 'all', source: 'rss,gkg' }), false)
    assert.equal(precomputable({ domain: 'folha.uol.com.br', lean: 'all', source: 'all' }), false)
    assert.equal(precomputable({ domain: 'all', lean: 'left', source: 'all' }), false)
  })
})

describe('before a build', () => {
  before(seed)

  it('the fast query yields no row and graphFor still answers from the live query', async () => {
    await db.query(`delete from graph_scopes`)
    assert.equal(await fast(lula, q({})), undefined)
    const result = await graphFor(lula, q({}))
    assert.ok(result.stats.about > 0)
  })
})

describe('buildGraphAggregates', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('writes one scope row per window, source and person, zero-doc sources included', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes`)
    assert.equal(rows[0].n, WINDOWS.length * (SOURCES.length + 1) * persons.length)
    const { rows: empty } = await db.query<{ docs: number; about: number }>(`select docs, about from graph_scopes where days = 7 and source = 'senado' and person_id = 'lula'`)
    assert.deepEqual(empty[0], { docs: 0, about: 0 })
  })

  it('is idempotent: a second build leaves the same rows', async () => {
    const before = (await db.query(`select * from graph_terms order by days, source, person_id, term, kind`)).rows
    await buildGraphAggregates(persons)
    const after = (await db.query(`select * from graph_terms order by days, source, person_id, term, kind`)).rows
    assert.deepEqual(after, before)
  })

  const recortes: Record<string, string>[] = [
    {},
    { days: '7' },
    { days: '365' },
    { sort: 'pmi' },
    { sort: 'pmi', limit: '5' },
    { min: '1' },
    { min: '3' },
    { kind: 'word' },
    { kind: 'phrase,hashtag' },
    { source: 'rss' },
    { source: 'gkg', days: '7' },
    { source: 'bluesky', sort: 'pmi', min: '1' },
    { source: 'senado' },
  ]

  for (const person of persons)
    for (const over of recortes)
      it(`renders the same response as the live query for ${person.id} ${JSON.stringify(over)}`, async () => {
        const query = q(over)
        assert.equal(precomputable(query), true)
        assert.deepEqual(await fast(person, query), await live(person, query))
      })

  it('falls back to the live query for a domain, a lean or a source list', async () => {
    const outside: Record<string, string>[] = [{ domain: 'example.org' }, { lean: 'left' }, { source: 'rss,gkg' }]
    for (const over of outside) {
      const query = q(over)
      assert.equal(precomputable(query), false)
      const expected = (await live(lula, query)) as { docs: number; about: number }
      const result = await graphFor(lula, query)
      assert.deepEqual({ docs: result.stats.docs, about: result.stats.about }, { docs: expected.docs, about: expected.about })
    }
  })

  it('drops the person\'s own name words, like the live query does', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_terms where person_id = 'lula' and term = 'lula'`)
    assert.equal(rows[0].n, 0)
  })

  it('reports counts and a duration', async () => {
    const report = await buildGraphAggregates(persons)
    assert.deepEqual(report.windows, [...WINDOWS])
    assert.ok(report.scopes > 0 && report.terms > 0 && report.ms >= 0)
  })
})
