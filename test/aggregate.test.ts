import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { buildGraphAggregates, hasGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { graphFor, precomputable, queries } from '../src/graph.js'
import { DAYS, parseQuery, SOURCES } from '../src/query.js'
import { insertDoc } from '../src/store.js'
import { persons, seed, untrackedPerson } from './fixture.js'
import './close.js'

// src/aggregate.ts builds graph_scopes / graph_terms_all / graph_terms; graphFor answers
// from them when the recorte fits and from the live query otherwise. The contract is
// equality: for every recorte the tables can hold, both paths render the same response.

const lula = persons.find((p) => p.id === 'lula')!
const q = (over: Record<string, string>) => parseQuery({ days: '30', ...over })
const live = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graph(person, query).text, queries.graph(person, query).values)).rows[0]
const fast = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graphFast(person, query).text, queries.graphFast(person, query).values)).rows[0]

describe('precomputable', () => {
  it('holds a built window, one source or all, no domain, no lean', () => {
    const base = { days: 30, domain: 'all', lean: 'all', source: 'all' }
    assert.equal(precomputable(base), true)
    assert.equal(precomputable({ ...base, source: 'rss' }), true)
    assert.equal(precomputable({ ...base, source: 'rss,gkg' }), false)
    assert.equal(precomputable({ ...base, domain: 'folha.uol.com.br' }), false)
    assert.equal(precomputable({ ...base, lean: 'left' }), false)
    for (const days of DAYS) assert.equal(precomputable({ ...base, days }), true)
    assert.equal(precomputable({ ...base, days: 14 }), false, 'a window the build never writes is never probed')
  })
})

describe('before a build', () => {
  before(seed)

  it('the fast query yields no row and graphFor still answers from the live query', async () => {
    await db.query(`delete from graph_scopes`)
    assert.equal(await hasGraphAggregates(), false)
    assert.equal(await fast(lula, q({})), undefined)
    const result = await graphFor(lula, q({}))
    assert.ok(result.stats.about > 0)
  })
})

describe('a build for part of the people', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons.filter((p) => p.id !== 'lula'))
  })

  it('writes no scope row for the person left out, so graphFor falls back to the live query for her', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes where person_id = 'lula'`)
    assert.equal(rows[0].n, 0)
    assert.equal(await fast(lula, q({})), undefined)
    const expected = (await live(lula, q({}))) as { about: number; nodes: { term: string; count: number }[] }
    const result = await graphFor(lula, q({}))
    assert.ok(expected.about > 0 && expected.nodes.length > 0)
    const bare = (nodes: { term: string; count: number }[]) => nodes.map(({ term, count }) => ({ term, count }))
    assert.deepEqual({ about: result.stats.about, nodes: bare(result.nodes) }, { about: expected.about, nodes: bare(expected.nodes) })
  })

  it('a person in the list but not in the table gets no row either, and the build does not fail', async () => {
    await buildGraphAggregates([...persons, untrackedPerson()])
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes where person_id = 'nao-cadastrado'`)
    assert.equal(rows[0].n, 0)
  })

  it('a scope row always comes with its terms: every person with about > 0 has graph_terms rows', async () => {
    const { rows } = await db.query<{ person_id: string }>(
      `select s.person_id from graph_scopes s where s.about > 0
         and not exists (select 1 from graph_terms t where t.days = s.days and t.source = s.source and t.person_id = s.person_id)`,
    )
    assert.deepEqual(rows, [])
  })
})

describe('buildGraphAggregates', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('writes one scope row per window, source and person, zero-doc sources included', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes`)
    assert.equal(rows[0].n, DAYS.length * (SOURCES.length + 1) * persons.length)
    assert.equal(await hasGraphAggregates(), true)
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
    assert.deepEqual(report.windows, [...DAYS])
    assert.ok(report.scopes > 0 && report.terms > 0 && report.ms >= 0)
  })

  // The one semantic difference: the tables cut the window when the build ran, the live
  // statement when the request arrives. A document written after the build is invisible to
  // the fast path until the next build, and only then do the two agree again.
  it('cuts the window at build time: a doc inserted after the build shows only on the live path until a rebuild', async () => {
    await buildGraphAggregates(persons)
    const before = await fast(lula, q({ min: '1' }))
    await insertDoc({ source: 'rss', uri: 'https://example.org/after-build', text: 'Lula visita a fábrica de aeronaves', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
    const liveAfter = await live(lula, q({ min: '1' }))
    assert.deepEqual(await fast(lula, q({ min: '1' })), before, 'the fast path still renders the previous build')
    assert.notDeepEqual(liveAfter, before, 'the live path already counts the new doc')
    assert.equal((liveAfter as { about: number }).about, (before as { about: number }).about + 1)
    await buildGraphAggregates(persons)
    assert.deepEqual(await fast(lula, q({ min: '1' })), liveAfter)
    await db.query(`delete from docs where uri = 'https://example.org/after-build'`)
    await buildGraphAggregates(persons)
  })
})
