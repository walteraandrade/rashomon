import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { AGGREGATE_TABLES, buildGraphAggregates, hasGraphAggregates, queries as aggregateQueries, TOP } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { compareFor, graphFor, lensesFastEligible, lensesFor, precomputable, queries, sourcesFor } from '../src/graph.js'
import type { CompareQuery, GraphQuery, LensesQuery, LensSide } from '../src/graph.js'
import { DAYS, LIMITS, MINS, parseQuery, SMALL_LIMITS, SOURCES } from '../src/query.js'
import { inTransaction, insertDocP } from '../src/store.js'
import type { Person } from '../src/types.js'
import { ATLAS_KINDS } from '../src/ui/api.js'
import { persons, reseed, seed, untrackedPerson } from './fixture.js'
import './close.js'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// src/aggregate.ts builds graph_scopes / graph_terms (graph_terms_all is a session-temp table,
// never persisted); graphFor answers
// from them when the recorte fits and from the live query otherwise. The contract is
// equality: for every recorte the tables can hold, both paths render the same response.

const lula = persons.find((p) => p.id === 'lula')!
const tarcisio = persons.find((p) => p.id === 'tarcisio')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const q = (over: Record<string, string>) => parseQuery({ days: '30', ...over })
const live = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graph(person, query).text, queries.graph(person, query).values)).rows[0]
const fast = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graphFast(person, query).text, queries.graphFast(person, query).values)).rows[0]

// The recortes both the node parity loop and the term_links parity tests (issue #251) share.
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
  { kind: 'org' }, // issue #209: org flows through the same top-K build/PMI/signature path, no branch
  { kind: 'org,word' },
  { source: 'rss' },
  { source: 'gkg', days: '7' },
  { source: 'bluesky', sort: 'pmi', min: '1' },
  { source: 'senado' },
  { country: 'br' },
]

// The term-term portion of graphFor's links, dropping the person->node edges every node
// already contributes, so a links comparison never trips on those.
const termLinks = (result: Awaited<ReturnType<typeof graphFor>>) => result.links.filter((l) => !l.source.startsWith('person:'))
const sortLinks = <T extends { source: string; target: string }>(links: T[]) =>
  [...links].sort((a, b) => a.source.localeCompare(b.source) || b.target.localeCompare(a.target))
const liveTermLinks = async (person: Person, query: ReturnType<typeof parseQuery>, ids: string[]) => {
  if (!ids.length) return []
  const lq = queries.links(person, query, ids)
  const { rows } = await db.query<{ s: string; t: string; count: number }>(lq.text, lq.values)
  return rows.map((r) => ({ source: r.s, target: r.t, count: r.count }))
}

describe('graph_terms_all as a session-temp table (issue #203)', () => {
  it('AGGREGATE_TABLES is exactly graph_scopes and graph_terms, no graph_terms_all entry', () => {
    assert.deepEqual([...AGGREGATE_TABLES], ['graph_scopes', 'graph_terms'])
  })

  it('a window creates the universe as a keyed temp table and never deletes from it', () => {
    const texts = aggregateQueries.window(30, persons).map((s) => s.text)
    assert.equal(texts.filter((t) => /graph_terms_all/.test(t) && /\bdelete\b/i.test(t)).length, 0)
    const create = texts.findIndex((t) => /create temp table graph_terms_all on commit drop as/.test(t))
    const key = texts.findIndex((t) => /alter table graph_terms_all add primary key \(days, source, term_id\)/.test(t))
    const firstTerms = texts.findIndex((t) => /insert into graph_terms \(/.test(t))
    assert.ok(create >= 0 && create < key && key < firstTerms)
  })

  it('the universe carries its primary key inside the window and is gone after commit', async () => {
    await seed()
    const window = aggregateQueries.window(30, persons)
    const [universe, key] = ['create temp table', 'add primary key'].map((m) => window.find((q) => q.text.includes(m))!)
    const pk = await inTransaction(async () => {
      await db.query(universe.text, universe.values)
      await db.query(key.text, key.values)
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from pg_index where indrelid = 'graph_terms_all'::regclass and indisprimary`,
      )
      return rows[0].n
    })
    assert.equal(pk, 1)
    await buildGraphAggregates(persons)
    const { rows } = await db.query<{ r: string | null }>(`select to_regclass('graph_terms_all') as r`)
    assert.equal(rows[0].r, null)
  })

  it('a window raises work_mem first and analyzes the universe and graph_terms before reading them (issue #250)', () => {
    const texts = aggregateQueries.window(30, persons).map((s) => s.text.trim())
    const at = (re: RegExp) => texts.findIndex((t) => re.test(t))
    const lastAt = (re: RegExp) => texts.length - 1 - [...texts].reverse().findIndex((t) => re.test(t))
    assert.equal(texts[0], `set local work_mem = '128MB'`)
    const key = at(/add primary key/)
    const analyzeUniverse = texts.indexOf('analyze graph_terms_all')
    const analyzeTerms = texts.indexOf('analyze graph_terms')
    assert.ok(key < analyzeUniverse && analyzeUniverse < at(/insert into graph_terms \(/))
    assert.ok(lastAt(/insert into graph_terms \(/) < analyzeTerms)
    assert.equal(analyzeTerms, texts.length - 1)
  })

  it('work_mem is back to its session value after a build', async () => {
    await seed()
    const show = async () => (await db.query<{ work_mem: string }>(`show work_mem`)).rows[0].work_mem
    const before = await show()
    await buildGraphAggregates(persons)
    assert.equal(await show(), before)
    assert.notEqual(before, '128MB')
  })

  it('buildGraphAggregates runs twice back-to-back with no thrown "relation already exists" error', async () => {
    await seed()
    await buildGraphAggregates(persons)
    await assert.doesNotReject(buildGraphAggregates(persons))
  })
})

describe('precomputable', () => {
  it('holds a built window, one source or all, no domain, no lean, the default country scope', () => {
    const base = { days: 30, domain: 'all', lean: 'all', source: 'all', country: 'br' as const }
    assert.equal(precomputable(base), true)
    assert.equal(precomputable({ ...base, source: 'rss' }), true)
    assert.equal(precomputable({ ...base, source: 'rss,gkg' }), false)
    assert.equal(precomputable({ ...base, domain: 'folha.uol.com.br' }), false)
    assert.equal(precomputable({ ...base, lean: 'left' }), false)
    assert.equal(precomputable({ ...base, country: 'pt' }), false)
    assert.equal(precomputable({ ...base, country: 'all' }), false)
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

describe('graph_terms emptied under a full graph_scopes', () => {
  const bare = (nodes: { term: string; count: number }[]) => nodes.map(({ term, count }) => ({ term, count }))

  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
    await db.query(`delete from graph_terms`)
  })

  it('the scope row survives, so a bare scope check would call the build done', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes where person_id = 'lula' and about > 0`)
    assert.ok(rows[0].n > 0)
  })

  it('hasGraphAggregates says false, so --if-missing rebuilds instead of skipping', async () => {
    assert.equal(await hasGraphAggregates(), false)
  })

  it('the fast query yields no row and graphFor answers from the live query, never an empty graph', async () => {
    assert.equal(await fast(lula, q({})), undefined)
    const expected = (await live(lula, q({}))) as { about: number; nodes: { term: string; count: number }[] }
    const result = await graphFor(lula, q({}))
    assert.ok(expected.nodes.length > 0)
    assert.deepEqual({ about: result.stats.about, nodes: bare(result.nodes) }, { about: expected.about, nodes: bare(expected.nodes) })
  })

  it('a scope with about = 0 still answers fast: no terms to miss', async () => {
    const row = await fast(lula, q({ source: 'senado' }))
    assert.deepEqual(row && { about: row.about, nodes: row.nodes }, { about: 0, nodes: [] })
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

  for (const person of persons)
    for (const over of recortes)
      it(`renders the same response as the live query for ${person.id} ${JSON.stringify(over)}`, async () => {
        const query = q(over)
        assert.equal(precomputable(query), true)
        assert.deepEqual(await fast(person, query), await live(person, query))
        // issue #251: the same recorte's links, through graphFor, must match the live linksQuery too.
        const result = await graphFor(person, query)
        const expectedLinks = await liveTermLinks(person, query, result.nodes.map((n) => n.id))
        assert.deepEqual(termLinks(result), expectedLinks, 'same edges in the same order')
      })

  it('falls back to the live query for a domain, a lean, a source list, or an explicit country', async () => {
    const outside: Record<string, string>[] = [
      { domain: 'example.org' },
      { lean: 'left' },
      { source: 'rss,gkg' },
      { country: 'pt' },
      { country: 'all' },
    ]
    for (const over of outside) {
      const query = q(over)
      assert.equal(precomputable(query), false)
      const expected = (await live(lula, query)) as { docs: number; about: number }
      const result = await graphFor(lula, query)
      assert.deepEqual({ docs: result.stats.docs, about: result.stats.about }, { docs: expected.docs, about: expected.about })
      // issue #251: an unprecomputable scope runs links live too, never against term_links.
      const expectedLinks = await liveTermLinks(lula, query, result.nodes.map((n) => n.id))
      assert.deepEqual(sortLinks(termLinks(result)), sortLinks(expectedLinks))
    }
  })

  // issue #204: windowScope's baked-in exclusion must match scopeCte's. The build must be
  // strictly narrower than live country=all, which proves the in-window .pt doc (58) was
  // excluded, not merely outside the window.
  it('builds the default country scope only, narrower than country=all', async () => {
    const built = (await fast(lula, q({ country: 'br' }))) as { docs: number; about: number }
    const liveAll = (await live(lula, q({ country: 'all' }))) as { docs: number; about: number }
    assert.ok(liveAll.docs > built.docs)
    assert.ok(liveAll.about >= built.about)
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
    await insertDocP({ source: 'rss', uri: 'https://example.org/after-build', text: 'Lula visita a fábrica de aeronaves', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
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

// graph_terms is not the person's whole term list: per (source, kind) the build keeps the top
// TOP rows of each ordering the route can ask for, so a request under that ceiling reads what
// the live statement would, and the table stops growing with the corpus (it reached 544 MB,
// five times doc_terms, and filled the production disk). A lower ceiling shows the cut.
describe('the ceiling on graph_terms', () => {
  const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from graph_terms`)).rows[0].n

  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('TOP is the largest limit the route accepts', () => {
    assert.equal(TOP, Math.max(...LIMITS))
  })

  it('a lower ceiling keeps fewer rows and still renders the live response for every recorte under it', async () => {
    const full = await count()
    const top = 5
    await buildGraphAggregates(persons, DAYS, top)
    assert.ok((await count()) < full, 'the ceiling cut rows')
    const limits = LIMITS.filter((l) => l <= top)
    for (const person of persons)
      for (const days of DAYS)
        for (const sort of ['count', 'pmi'])
          for (const min of MINS)
            for (const kind of ['all', 'word', 'phrase,hashtag', 'org'])
              for (const limit of limits) {
                const query = q({ days: String(days), sort, min: String(min), kind, limit: String(limit) })
                assert.deepEqual(await fast(person, query), await live(person, query), `${person.id} ${JSON.stringify({ days, sort, min, kind, limit })}`)
              }
    await buildGraphAggregates(persons)
    assert.equal(await count(), full)
  })
})

// Issue #247: compareFor/lensesFor over graph_terms/graph_scopes instead of a live scan.
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
type CompareRow = { about_a: number; about_b: number; terms: CompareTermRow[] }
type LensTermRow = { term: string; kind: string; is_name: boolean; a_count: number | null; a_pmi: number | null; a_tone: number | null; b_count: number | null; b_pmi: number | null; b_tone: number | null }
type LensesRow = { about_a: number; about_b: number; terms: LensTermRow[] }

// The {count,pmi,tone} | null | "name" mapping compareFor/lensesFor apply to a raw side, so a
// "live == fast" assertion on the public shape can deepEqual actual term values, not just counts.
const sideValue = (isName: boolean, count: number | null, pmi: number | null, tone: number | null) =>
  isName ? ('name' as const) : count !== null ? { count, pmi: pmi!, tone } : null
const expectedCompareTerms = (rows: CompareTermRow[]) =>
  rows.map((t) => ({
    term: t.term,
    kind: t.kind,
    a: sideValue(t.is_name_a, t.a_count, t.a_pmi, t.a_tone),
    b: sideValue(t.is_name_b, t.b_count, t.b_pmi, t.b_tone),
  }))
const expectedLensTerms = (rows: LensTermRow[]) =>
  rows.map((t) => ({
    term: t.term,
    kind: t.kind,
    a: sideValue(t.is_name, t.a_count, t.a_pmi, t.a_tone),
    b: sideValue(t.is_name, t.b_count, t.b_pmi, t.b_tone),
  }))
const compareBase: CompareQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', country: 'br', kind: 'all', limit: 40, bridges: false }
const cq = (over: Partial<CompareQuery>): CompareQuery => ({ ...compareBase, ...over })
const liveCompareRow = async (a: Person, b: Person, query: CompareQuery) => {
  const built = queries.compare(a, b, query)
  return (await db.query<CompareRow>(built.text, built.values)).rows[0]
}
const fastCompareRow = async (a: Person, b: Person, query: CompareQuery) => {
  const built = queries.compareFast(a, b, query)
  return (await db.query<CompareRow>(built.text, built.values)).rows[0]
}

// AC5's own-selection half, read off the live statement so it never checks graph_terms against
// itself: the live /graph statement at min=1 ranks one person's terms exactly like compareQuery's
// own top_count/top_pmi CTEs (same scope, same own-name exclusion, same "order by X desc, term,
// kind limit"), without touching graph_terms.
const liveOwnTop = async (person: Person, query: CompareQuery, sort: 'count' | 'pmi') => {
  const gq: GraphQuery = { days: query.days, source: query.source, domain: 'all', lean: 'all', country: 'br', kind: query.kind, limit: query.limit, min: 1, sort, communities: false }
  const built = queries.graph(person, gq)
  const row = (await db.query<{ nodes: { term: string; kind: string }[] }>(built.text, built.values)).rows[0]
  return row.nodes.map((n) => `${n.kind}:${n.term}`)
}

const allLens: LensSide = { lens: 'all', domain: 'all', lean: 'all', source: 'all' }
const rssLens: LensSide = { lens: 'source:rss', domain: 'all', lean: 'all', source: 'rss' }
const gkgLens: LensSide = { lens: 'source:gkg', domain: 'all', lean: 'all', source: 'gkg' }
const senadoLens: LensSide = { lens: 'source:senado', domain: 'all', lean: 'all', source: 'senado' }
const blueskyLens: LensSide = { lens: 'source:bluesky', domain: 'all', lean: 'all', source: 'bluesky' }
const lensesBase: LensesQuery = { days: 30, kind: 'all', limit: 40, a: allLens, b: allLens, bridges: false }
const lensQ = (over: Partial<LensesQuery>): LensesQuery => ({ ...lensesBase, ...over })
const liveLensesRow = async (person: Person, query: LensesQuery) => {
  const built = queries.lenses(person, query)
  return (await db.query<LensesRow>(built.text, built.values)).rows[0]
}
const fastLensesRow = async (person: Person, query: LensesQuery) => {
  const built = queries.lensesFast(person, query)
  return (await db.query<LensesRow>(built.text, built.values)).rows[0]
}

describe('compare fast path (issue #247)', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  const compareRecortes: Partial<CompareQuery>[] = [
    {},
    { days: 7 },
    { days: 365 },
    { kind: 'word' },
    { kind: 'phrase,hashtag' },
    { kind: 'org' },
    { kind: 'org,word' },
    { source: 'rss' },
    { source: 'gkg', days: 7 },
    { source: 'bluesky' },
    { source: 'senado' },
    { limit: 5 },
  ]

  it('renders the same response as the live query for every recorte and every person pair (AC1)', async () => {
    for (const over of compareRecortes)
      for (const a of persons)
        for (const b of persons) {
          const query = cq(over)
          assert.equal(precomputable(query), true)
          assert.deepEqual(await fastCompareRow(a, b, query), await liveCompareRow(a, b, query), `${a.id}/${b.id} ${JSON.stringify(over)}`)
        }
  })

  it('falls back to live for a domain, a lean, a source list, or an explicit country (AC3)', async () => {
    const outside: Partial<CompareQuery>[] = [
      { domain: 'example.org' },
      { lean: 'left' },
      { source: 'rss,gkg' },
      { country: 'pt' },
      { country: 'all' },
    ]
    for (const over of outside) {
      const query = cq(over)
      assert.equal(precomputable(query), false)
      const expected = await liveCompareRow(lula, bolsonaro, query)
      const result = await compareFor(lula, bolsonaro, query)
      assert.equal(result.a.about, expected.about_a)
      assert.equal(result.b.about, expected.about_b)
      assert.equal(result.terms.length, expected.terms.length)
      assert.deepEqual(result.terms.map(({ term, kind, a, b }) => ({ term, kind, a, b })), expectedCompareTerms(expected.terms))
    }
  })

  it('a scope with about = 0 on one or both sides still answers fast (AC6)', async () => {
    const query = cq({ source: 'senado' })
    assert.equal(precomputable(query), true)
    const row = await fastCompareRow(lula, bolsonaro, query)
    assert.deepEqual(row && { about_a: row.about_a, about_b: row.about_b, terms: row.terms }, { about_a: 0, about_b: 0, terms: [] })
  })

  it('a lower ceiling produces a genuine cross-side null, and every figure it does return is exact (AC5)', async () => {
    try {
      await buildGraphAggregates(persons, DAYS, 2)
      let sawGenuineNull = false
      const pairs: [Person, Person][] = [[lula, bolsonaro], [tarcisio, lula], [bolsonaro, tarcisio]]
      for (const limit of SMALL_LIMITS)
        for (const [a, b] of pairs) {
          const query = cq({ limit })
          const fastRow = await fastCompareRow(a, b, query)
          if (!fastRow) continue
          const liveRow = await liveCompareRow(a, b, query)
          for (const ft of fastRow.terms) {
            const lt = liveRow.terms.find((t) => t.term === ft.term && t.kind === ft.kind)
            if (!lt) continue
            if (ft.a_count !== null)
              assert.deepEqual({ count: ft.a_count, pmi: ft.a_pmi, tone: ft.a_tone }, { count: lt.a_count, pmi: lt.a_pmi, tone: lt.a_tone }, `${a.id}/${b.id} ${ft.term}:${ft.kind} a @ ${limit}`)
            if (ft.b_count !== null)
              assert.deepEqual({ count: ft.b_count, pmi: ft.b_pmi, tone: ft.b_tone }, { count: lt.b_count, pmi: lt.b_pmi, tone: lt.b_tone }, `${a.id}/${b.id} ${ft.term}:${ft.kind} b @ ${limit}`)
            if ((ft.a_count === null && lt.a_count !== null) || (ft.b_count === null && lt.b_count !== null)) sawGenuineNull = true
          }
        }
      assert.ok(sawGenuineNull, 'expected at least one cross-side null under the shrunk ceiling')
    } finally {
      await buildGraphAggregates(persons)
    }
  })

  // A per-kind ceiling T keeps, for every kind, that kind's top T by count and by weighted pmi at
  // min=1, so any limit <= T finds the live global top-limit inside it: at production TOP (200)
  // that covers every limit the route accepts (SMALL_LIMITS tops out at 100).
  it("each side's own live top-limit selection survives any ceiling at or above limit, with its live figure (AC5)", async () => {
    try {
      for (const top of [1, 2, 5]) {
        await buildGraphAggregates(persons, DAYS, top)
        const pairs: [Person, Person][] = [[lula, bolsonaro], [tarcisio, lula], [bolsonaro, tarcisio]]
        for (const limit of SMALL_LIMITS.filter((l) => l <= top))
          for (const kind of ['all', 'word', 'phrase,hashtag'])
            for (const [a, b] of pairs) {
              const query = cq({ limit, kind })
              const fastRow = await fastCompareRow(a, b, query)
              if (!fastRow) continue
              const liveRow = await liveCompareRow(a, b, query)
              for (const [side, person] of [['a', a], ['b', b]] as const) {
                const ids = new Set([...(await liveOwnTop(person, query, 'count')), ...(await liveOwnTop(person, query, 'pmi'))])
                for (const id of ids) {
                  const [k, term] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
                  const ft = fastRow.terms.find((t) => t.term === term && t.kind === k)
                  const lt = liveRow.terms.find((t) => t.term === term && t.kind === k)!
                  const figure = (t: CompareTermRow) => (side === 'a' ? { count: t.a_count, pmi: t.a_pmi, tone: t.a_tone } : { count: t.b_count, pmi: t.b_pmi, tone: t.b_tone })
                  assert.ok(ft, `${a.id}/${b.id} ${side}'s live top ${id} missing @ top=${top} limit=${limit} kind=${kind}`)
                  assert.deepEqual(figure(ft!), figure(lt), `${a.id}/${b.id} ${side} ${id} @ top=${top} limit=${limit} kind=${kind}`)
                }
              }
            }
      }
    } finally {
      await buildGraphAggregates(persons)
    }
  })

  // Routing, not just the raw SQL: compareFor itself must pick the fast path (and keep its
  // cutoff null) when precomputable(q) holds, and the live path once it does not.
  it('compareFor routes to the fast path and its cutoff null, then to the live figure once country stops it being precomputable (routing)', async () => {
    try {
      await buildGraphAggregates(persons, DAYS, 2)
      const pairs: [Person, Person][] = [[lula, bolsonaro], [tarcisio, lula], [bolsonaro, tarcisio]]
      let found: { a: Person; b: Person; query: CompareQuery; term: string; kind: string; side: 'a' | 'b' } | null = null
      for (const limit of SMALL_LIMITS) {
        if (found) break
        for (const [a, b] of pairs) {
          const query = cq({ limit })
          const fastRow = await fastCompareRow(a, b, query)
          if (!fastRow) continue
          const liveRow = await liveCompareRow(a, b, query)
          for (const ft of fastRow.terms) {
            const lt = liveRow.terms.find((t) => t.term === ft.term && t.kind === ft.kind)
            if (!lt) continue
            if (ft.a_count === null && lt.a_count !== null) { found = { a, b, query, term: ft.term, kind: ft.kind, side: 'a' }; break }
            if (ft.b_count === null && lt.b_count !== null) { found = { a, b, query, term: ft.term, kind: ft.kind, side: 'b' }; break }
          }
          if (found) break
        }
      }
      assert.ok(found, 'expected a genuine cross-side null under the shrunk ceiling')
      const { a, b, query, term: termName, kind, side } = found!

      assert.equal(precomputable(query), true)
      const fastResult = await compareFor(a, b, query)
      const fastTerm = fastResult.terms.find((t) => t.term === termName && t.kind === kind)
      assert.ok(fastTerm, 'compareFor must still carry this key on the fast path')
      assert.equal(fastTerm![side], null, 'compareFor must route through the fast path and keep the cutoff null')

      // country=all adds no docs here: the fixture's only non-br docs (issue #204) are 3800+ days
      // old, outside this 30-day recorte, so this flips precomputable(q) to false without moving
      // the scope compareFor actually reads -- the null this key carried above was purely an
      // artifact of the shrunk build's own persisted cutoff, not of the underlying documents.
      const liveQuery: CompareQuery = { ...query, country: 'all' }
      assert.equal(precomputable(liveQuery), false)
      const liveResult = await compareFor(a, b, liveQuery)
      const liveTerm = liveResult.terms.find((t) => t.term === termName && t.kind === kind)
      assert.ok(liveTerm, 'the live path recomputes its own top selection and must still carry this key')
      assert.notEqual(liveTerm![side], null, 'the live path has no persisted cutoff, so the same key reads a real figure there')
    } finally {
      await buildGraphAggregates(persons)
    }
  })
})

describe('lenses fast path (issue #247)', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  const lensesRecortes: Partial<LensesQuery>[] = [
    {},
    { days: 7 },
    { days: 365 },
    { kind: 'word' },
    { kind: 'phrase,hashtag' },
    { kind: 'org' },
    { limit: 5 },
  ]
  const lensPairs: [LensSide, LensSide][] = [
    [allLens, allLens],
    [rssLens, gkgLens],
    [allLens, rssLens],
    [senadoLens, allLens],
    [blueskyLens, allLens],
  ]

  // Non-name keys only: graph_terms never carries a person's own name words (personTermsQuery's
  // own exclusion, no graph_name_terms table to fill the gap since issue #247's spec dropped it),
  // so the fast lenses union can never surface one the way the live names_a/names_b union does
  // (docs/api.md's /lenses paragraph); a name key is asserted absent separately below.
  it('renders the same response as the live query when both sides are all or a source: lens, every recorte (AC2)', async () => {
    for (const over of lensesRecortes)
      for (const person of persons)
        for (const [a, b] of lensPairs) {
          const query = lensQ({ ...over, a, b })
          assert.equal(lensesFastEligible(query), true)
          const fastRow = await fastLensesRow(person, query)
          const liveRow = await liveLensesRow(person, query)
          const label = `${person.id} ${a.lens}/${b.lens} ${JSON.stringify(over)}`
          assert.equal(fastRow.about_a, liveRow.about_a, `${label} about_a`)
          assert.equal(fastRow.about_b, liveRow.about_b, `${label} about_b`)
          assert.deepEqual(
            fastRow.terms,
            liveRow.terms.filter((t) => !t.is_name),
            label,
          )
        }
  })

  it('a lens with about = 0 on one or both sides still answers fast', async () => {
    const bothZero = lensQ({ a: senadoLens, b: senadoLens })
    assert.equal(lensesFastEligible(bothZero), true)
    const row = await fastLensesRow(lula, bothZero)
    assert.deepEqual(row && { about_a: row.about_a, about_b: row.about_b, terms: row.terms }, { about_a: 0, about_b: 0, terms: [] })

    const oneZero = lensQ({ a: senadoLens, b: allLens })
    const mixed = await fastLensesRow(lula, oneZero)
    assert.equal(mixed.about_a, 0)
    assert.ok(mixed.about_b > 0)
  })

  // Spec-approved option (b): no separate name-words table, so a person's own name word never
  // enters graph_terms (personTermsQuery's own exclusion) and cannot rank on the fast lenses
  // ruler at all, unlike the live query's own names_a/names_b union (docs/api.md).
  it("a person's own name word is absent from the fast lenses ruler, unlike live (issue #247)", async () => {
    const query = lensQ({ days: 365, limit: 100 })
    const liveRow = await liveLensesRow(lula, query)
    const fastRow = await fastLensesRow(lula, query)
    const liveName = liveRow.terms.find((t) => t.is_name)
    assert.ok(liveName, "fixture assumption: lula's own name word appears in the live union")
    const fastName = fastRow.terms.find((t) => t.term === liveName!.term && t.kind === liveName!.kind)
    assert.equal(fastName, undefined, 'graph_terms never holds a name word, so the fast path cannot surface one')
  })

  it('stays live end to end when either side is a domain: or lean: lens', async () => {
    const domainLens: LensSide = { lens: 'domain:example.org', domain: 'example.org', lean: 'all', source: 'all' }
    const leanLens: LensSide = { lens: 'lean:left', domain: 'all', lean: 'left', source: 'all' }
    for (const [a, b] of [[domainLens, allLens], [allLens, leanLens]] as [LensSide, LensSide][]) {
      const query = lensQ({ a, b })
      assert.equal(lensesFastEligible(query), false)
      const liveRow = await liveLensesRow(lula, query)
      const result = await lensesFor(lula, query)
      assert.equal(result.a.about, liveRow.about_a)
      assert.equal(result.b.about, liveRow.about_b)
      assert.equal(result.terms.length, liveRow.terms.length)
      assert.deepEqual(result.terms.map(({ term, kind, a, b }) => ({ term, kind, a, b })), expectedLensTerms(liveRow.terms))
    }
  })

  it('stays live end to end when days is outside DAYS', async () => {
    const query = lensQ({ days: 14 })
    assert.equal(lensesFastEligible(query), false)
    const liveRow = await liveLensesRow(lula, query)
    const result = await lensesFor(lula, query)
    assert.equal(result.a.about, liveRow.about_a)
    assert.equal(result.b.about, liveRow.about_b)
    assert.deepEqual(result.terms.map(({ term, kind, a, b }) => ({ term, kind, a, b })), expectedLensTerms(liveRow.terms))
  })

  // Routing, not just the raw SQL: lensesFor itself must pick the fast path (and keep its
  // cutoff null) when lensesFastEligible(q) holds, and the live path once it does not.
  it('lensesFor routes to the fast path and its cutoff null, then to the live figure once days stops it being eligible (routing)', async () => {
    try {
      await buildGraphAggregates(persons, DAYS, 2)
      let found: { person: Person; query: LensesQuery; term: string; kind: string; side: 'a' | 'b' } | null = null
      for (const limit of SMALL_LIMITS) {
        if (found) break
        for (const person of persons) {
          if (found) break
          for (const [a, b] of lensPairs) {
            const query = lensQ({ limit, a, b })
            const fastRow = await fastLensesRow(person, query)
            if (!fastRow) continue
            const liveRow = await liveLensesRow(person, query)
            for (const ft of fastRow.terms) {
              const lt = liveRow.terms.find((t) => t.term === ft.term && t.kind === ft.kind)
              if (!lt) continue
              if (ft.a_count === null && lt.a_count !== null) { found = { person, query, term: ft.term, kind: ft.kind, side: 'a' }; break }
              if (ft.b_count === null && lt.b_count !== null) { found = { person, query, term: ft.term, kind: ft.kind, side: 'b' }; break }
            }
            if (found) break
          }
        }
      }
      assert.ok(found, 'expected a genuine cross-side null under the shrunk ceiling')
      const { person, query, term: termName, kind, side } = found!

      assert.equal(lensesFastEligible(query), true)
      const fastResult = await lensesFor(person, query)
      const fastTerm = fastResult.terms.find((t) => t.term === termName && t.kind === kind)
      assert.ok(fastTerm, 'lensesFor must still carry this key on the fast path')
      assert.equal(fastTerm![side], null, 'lensesFor must route through the fast path and keep the cutoff null')

      // days=29 is not one of the three built windows, so this flips lensesFastEligible to false;
      // no fixture doc falls between 29 and 30 days old, so the underlying scope is unchanged.
      const liveQuery: LensesQuery = { ...query, days: 29 }
      assert.equal(lensesFastEligible(liveQuery), false)
      const liveResult = await lensesFor(person, liveQuery)
      const liveTerm = liveResult.terms.find((t) => t.term === termName && t.kind === kind)
      assert.ok(liveTerm, 'the live path recomputes its own top selection and must still carry this key')
      assert.notEqual(liveTerm![side], null, 'the live path has no persisted cutoff, so the same key reads a real figure there')
    } finally {
      await buildGraphAggregates(persons)
    }
  })
})

// Issue #214: one Louvain pass per (days, source, person) graph_terms holds rows for.
describe('term_communities (issue #214)', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('AGGREGATE_TABLES stays exactly graph_scopes and graph_terms; term_communities never gates it', () => {
    assert.deepEqual([...AGGREGATE_TABLES], ['graph_scopes', 'graph_terms'])
  })

  it('hasGraphAggregates only names graph_scopes and graph_terms', async () => {
    assert.equal(await hasGraphAggregates(), true)
    await db.query(`delete from term_communities`)
    assert.equal(await hasGraphAggregates(), true, 'an emptied term_communities must not read as a missing build')
    await buildGraphAggregates(persons)
  })

  it('buildGraphAggregates writes a term_communities row for every graph_terms row it built', async () => {
    const { rows: missing } = await db.query<{ n: number }>(`
      select count(*)::int as n from graph_terms g
      where not exists (
        select 1 from term_communities c
        where c.days = g.days and c.source = g.source and c.person_id = g.person_id and c.term = g.term and c.kind = g.kind
      )`)
    assert.equal(missing[0].n, 0)
  })

  it('a term unique to one document (no surviving co-occurrence edge) still gets its own community', async () => {
    const { rows } = await db.query<{ community: number | null }>(
      `select community from term_communities where days = 30 and source = 'all' and person_id = 'lula' and term = 'eleicao' and kind = 'word'`,
    )
    assert.equal(rows.length, 1)
    assert.equal(typeof rows[0].community, 'number')
  })

  it('a term never kept by graph_terms stays absent from term_communities too', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from term_communities where days = 30 and source = 'all' and person_id = 'lula' and term = 'congresso'`,
    )
    assert.equal(rows[0].n, 0)
  })

  it('reforma and tributaria co-occur (docs /1 and /6) and land in the same community', async () => {
    const { rows } = await db.query<{ term: string; community: number }>(
      `select term, community from term_communities where days = 30 and source = 'all' and person_id = 'lula' and term in ('reforma', 'tributaria') and kind = 'word'`,
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0].community, rows[1].community)
  })

  it('community edges are exactly the pairs two of the person\'s own docs share, sorted', async () => {
    const edges = async (person: string) => {
      const q = aggregateQueries.communityEdges(30, 'all', person)
      return (await db.query(q.text, q.values)).rows
    }
    assert.deepEqual(await edges('lula'), [
      { a: 'word:lisboa', b: 'word:tarcisio', count: 2 },
      { a: 'word:reforma', b: 'word:tributaria', count: 2 },
    ])
    assert.deepEqual(await edges('tarcisio'), [{ a: 'word:lisboa', b: 'word:lula', count: 2 }])
  })

  it('a deleted term_communities window still answers /graph?communities=1 with community: null on every node, and the rest of the response is unaffected', async () => {
    const withCommunities = await graphFor(lula, q({ communities: '1' }))
    assert.ok(withCommunities.nodes.length > 0, 'sanity: the default window must have nodes')
    assert.ok(withCommunities.nodes.some((n) => typeof n.community === 'number'), 'sanity: a built window must tag at least one node')

    await db.query(`delete from term_communities where days = 30 and source = 'all' and person_id = 'lula'`)

    // Pin that the fast query itself (not a live-query fallback) is what answers with null
    // communities: a mutant adding an `exists (select 1 from term_communities ...)` guard to
    // graphFastQuery would otherwise send this recorte live and still pass the assertions below.
    const fastQuery = queries.graphFast(lula, q({ communities: '1' }))
    const { rows: fastRows } = await db.query<{ nodes: { community: number | null }[] }>(fastQuery.text, fastQuery.values)
    assert.equal(fastRows.length, 1)
    assert.ok(fastRows[0].nodes.length > 0)
    assert.ok(fastRows[0].nodes.every((n) => n.community === null))

    const degraded = await graphFor(lula, q({ communities: '1' }))
    assert.ok(degraded.nodes.length > 0)
    assert.ok(degraded.nodes.every((n) => n.community === null))
    assert.deepEqual(
      { nodes: degraded.nodes.map(({ community, ...rest }) => rest), stats: degraded.stats, signature: degraded.signature },
      { nodes: withCommunities.nodes.map(({ community, ...rest }) => rest), stats: withCommunities.stats, signature: withCommunities.signature },
    )
    await buildGraphAggregates(persons)
  })
})

// Issue #251: term_links persists communityEdgesQuery's edges, capped to the linkable set L,
// so graphFor's links read is a primary-key lookup on a built, full-kind-set, precomputable scope.
describe('term_links (issue #251)', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('AGGREGATE_TABLES stays exactly graph_scopes and graph_terms; term_links never gates it', () => {
    assert.deepEqual([...AGGREGATE_TABLES], ['graph_scopes', 'graph_terms'])
  })

  it('hasGraphAggregates only names graph_scopes and graph_terms', async () => {
    assert.equal(await hasGraphAggregates(), true)
    await db.query(`delete from term_links`)
    assert.equal(await hasGraphAggregates(), true, 'an emptied term_links must not read as a missing build')
    await buildGraphAggregates(persons)
  })

  // Independent of the builder's own linkableTermsQuery: L is rebuilt here from graphFor's own
  // node ids across every sort x min at the build's own top, the full KINDS set, per the spec's own definition.
  const linkableSet = async (person: Person, limit = TOP, days = 30, source = 'all') => {
    const ids = new Set<string>()
    for (const sort of ['count', 'pmi'] as const)
      for (const min of MINS) {
        const query = q({ days: String(days), source, sort, min: String(min), limit: String(limit), kind: 'all' })
        const result = await graphFor(person, query)
        result.nodes.forEach((n) => ids.add(n.id))
      }
    return ids
  }

  it("term_links rows are exactly communityEdgesQuery's edges restricted to the linkable set", async () => {
    for (const person of persons) {
      const L = await linkableSet(person)
      const edgesQ = aggregateQueries.communityEdges(30, 'all', person.id)
      const edges = (await db.query<{ a: string; b: string; count: number }>(edgesQ.text, edgesQ.values)).rows
      const expected = edges.filter((e) => L.has(e.a) && L.has(e.b)).sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
      const stored = (
        await db.query<{ a: string; b: string; count: number }>(
          `select a, b, count from term_links where days = 30 and source = 'all' and person_id = $1 order by a, b`,
          [person.id],
        )
      ).rows
      assert.deepEqual(stored, expected, person.id)
    }
  })

  // The six-doc fixture never reaches the production TOP, so the cap is only exercised by a build
  // with a smaller linkTop over the full kept set; limits up to it are the only ones it can serve fast.
  // Six docs only cut an edge at a cap of 1, which serves no pair; a cap of 5 serves real pairs.
  const cutTop = 1
  const smallTop = 5
  const smallLimits = LIMITS.filter((l) => l <= smallTop)

  it('the linkable cap drops edges outside L, and keeps exactly communityEdges within L x L', async () => {
    await buildGraphAggregates(persons, [30], TOP, cutTop)
    let dropped = 0
    for (const person of persons) {
      const L = await linkableSet(person, cutTop)
      const edgesQ = aggregateQueries.communityEdges(30, 'all', person.id)
      const edges = (await db.query<{ a: string; b: string; count: number }>(edgesQ.text, edgesQ.values)).rows
      const expected = edges.filter((e) => L.has(e.a) && L.has(e.b)).sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
      dropped += edges.length - expected.length
      const stored = (
        await db.query<{ a: string; b: string; count: number }>(
          `select a, b, count from term_links where days = 30 and source = 'all' and person_id = $1 order by a, b`,
          [person.id],
        )
      ).rows
      assert.deepEqual(stored, expected, person.id)
    }
    assert.ok(dropped > 0, 'the small cap must actually drop an edge')
    await buildGraphAggregates(persons)
  })

  it('a capped build still renders the live links for every sort, min and limit it can serve', async () => {
    await buildGraphAggregates(persons, [30], TOP, smallTop)
    let compared = 0
    for (const person of persons)
      for (const sort of ['count', 'pmi'] as const)
        for (const min of MINS)
          for (const limit of smallLimits) {
            const query = q({ sort, min: String(min), limit: String(limit), kind: 'all' })
            const result = await graphFor(person, query)
            const expected = await liveTermLinks(person, query, result.nodes.map((n) => n.id))
            assert.deepEqual(termLinks(result), expected, `${person.id} ${JSON.stringify({ sort, min, limit })}`)
            compared += expected.length
          }
    assert.ok(compared > 0, 'sanity: a capped build must still serve some edge')
    await buildGraphAggregates(persons)
  })

  it('actually reads term_links: a sentinel count survives kind=all, the atlas kind list and a reordered one', async () => {
    const query = q({})
    const before = await graphFor(lula, query)
    const nodeIds = before.nodes.map((n) => n.id)
    assert.ok(nodeIds.length >= 2, 'sanity: needs at least two nodes to sentinel an edge')
    const [a, b] = [nodeIds[0], nodeIds[1]].sort()
    await db.query(
      `insert into term_links (days, source, person_id, a, b, count) values (30, 'all', 'lula', $1, $2, 999)
       on conflict (days, source, person_id, a, b) do update set count = 999`,
      [a, b],
    )
    const kindSets = ['all', ATLAS_KINDS, 'org,phrase,word,hashtag']
    for (const kind of kindSets) {
      const result = await graphFor(lula, q({ kind }))
      const edge = termLinks(result).find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a))
      assert.ok(edge, `expected a sentinel edge for kind=${kind}`)
      assert.equal(edge?.count, 999, `kind=${kind} must have read term_links, not the live query`)
    }
    await buildGraphAggregates(persons)
  })

  it('renders the same links as the live query for every sort, min and limit', async () => {
    const limits = [Math.min(...LIMITS), 40, TOP]
    for (const person of persons)
      for (const sort of ['count', 'pmi'] as const)
        for (const min of MINS)
          for (const limit of limits) {
            const query = q({ sort, min: String(min), limit: String(limit), kind: 'all' })
            assert.equal(precomputable(query), true)
            const result = await graphFor(person, query)
            const expected = await liveTermLinks(person, query, result.nodes.map((n) => n.id))
            assert.deepEqual(sortLinks(termLinks(result)), sortLinks(expected), `${person.id} ${JSON.stringify({ sort, min, limit })}`)
          }
  })

  it('a narrower kind set runs links live', async () => {
    await db.query(`delete from term_links where days = 30 and source = 'all' and person_id = 'lula'`)
    await db.query(
      `insert into term_links (days, source, person_id, a, b, count) values (30, 'all', 'lula', 'word:bogus-a', 'word:bogus-b', 99)`,
    )
    const query = q({ kind: 'word' })
    const result = await graphFor(lula, query)
    const expected = await liveTermLinks(lula, query, result.nodes.map((n) => n.id))
    assert.deepEqual(sortLinks(termLinks(result)), sortLinks(expected))
    assert.ok(!termLinks(result).some((l) => l.target === 'word:bogus-b'), 'must not have read the corrupted fast table')
    await buildGraphAggregates(persons)
  })

  it('falls back to live links when term_links is empty for an otherwise-built scope', async () => {
    const query = q({})
    const before = await graphFor(lula, query)
    assert.ok(termLinks(before).length > 0, 'sanity: the fast table must hold edges to fall back from')
    await db.query(`delete from term_links where days = 30 and source = 'all' and person_id = 'lula'`)
    const after = await graphFor(lula, query)
    assert.deepEqual(sortLinks(termLinks(after)), sortLinks(termLinks(before)), 'live matches what the fast table held')
    await buildGraphAggregates(persons)
  })

  it('falls back to live links when the node path itself is live (an unbuilt window)', async () => {
    const query = q({})
    const nodeIds = (await graphFor(lula, query)).nodes.map((n) => n.id)
    const [a, b] = [nodeIds[0], nodeIds[1]].sort()
    await db.query(
      `insert into term_links (days, source, person_id, a, b, count) values (30, 'all', 'lula', $1, $2, 999)
       on conflict (days, source, person_id, a, b) do update set count = 999`,
      [a, b],
    )
    await db.query(`delete from graph_terms where days = 30 and source = 'all' and person_id = 'lula'`)
    assert.equal(precomputable(query), true)
    const result = await graphFor(lula, query)
    const expected = await liveTermLinks(lula, query, result.nodes.map((n) => n.id))
    assert.deepEqual(sortLinks(termLinks(result)), sortLinks(expected))
    assert.ok(!termLinks(result).some((l) => l.count === 999), 'a live node set must never read term_links')
    await buildGraphAggregates(persons)
  })

  it('a window rebuild is idempotent for term_links', async () => {
    const before = (await db.query(`select * from term_links order by days, source, person_id, a, b`)).rows
    await buildGraphAggregates(persons)
    const after = (await db.query(`select * from term_links order by days, source, person_id, a, b`)).rows
    assert.deepEqual(after, before)
  })
})

// Issue #209: the fixture's own org-kind doc (doc 62 in fixture.ts) is dated daysAgo(4000),
// outside every DAYS window, so graph_terms never gets an 'org' row from the shared seed and
// every recorte above comparing fast against live on kind 'org' does so over two empty results.
// This suite adds gkg docs about lula, inside the 7-day window, that actually carry org terms.
describe('org-kind terms inside a build window (issue #209)', () => {
  before(async () => {
    await seed()
    await insertDocP(
      {
        source: 'gkg',
        uri: 'https://gdeltproject.org/209-org-1',
        text: 'Lula reune ministros para discutir petrobras e o banco central',
        publishedAt: daysAgo(1),
        domain: 'gdeltproject.org',
        tone: 0.2,
        extraTerms: [
          { term: 'petrobras', kind: 'org' },
          { term: 'banco central', kind: 'org' },
          // Same bare word as lula's own alias: must be dropped from her graph like any own-name term.
          { term: 'lula', kind: 'org' },
        ],
      },
      persons,
    )
    await insertDocP(
      {
        source: 'gkg',
        uri: 'https://gdeltproject.org/209-org-2',
        text: 'Lula recebe diretoria da petrobras em reuniao',
        publishedAt: daysAgo(2),
        domain: 'gdeltproject.org',
        tone: -0.1,
        extraTerms: [
          { term: 'petrobras', kind: 'org' },
          { term: 'lula', kind: 'org' },
        ],
      },
      persons,
    )
    await buildGraphAggregates(persons)
  })
  after(async () => {
    await reseed()
    await buildGraphAggregates(persons)
  })

  it('graph_terms holds org rows once a doc inside a build window carries one', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_terms where kind = 'org'`)
    assert.ok(rows[0].n > 0)
  })

  for (const days of DAYS)
    for (const kind of ['org', 'org,word', 'word,hashtag,phrase,org'])
      for (const sort of ['count', 'pmi'])
        it(`fast matches live for lula, kind=${kind}, sort=${sort}, days=${days}`, async () => {
          const query = q({ days: String(days), kind, sort })
          assert.deepEqual(await fast(lula, query), await live(lula, query))
        })

  it("drops the org term that is the person's own name, like the live query does", async () => {
    const row = (await fast(lula, q({ kind: 'org', days: '7' }))) as { nodes: { term: string; kind: string }[] } | undefined
    assert.ok(row, 'the fast path must answer this recorte')
    assert.equal(row!.nodes.some((n) => n.term === 'lula'), false)
  })
})

// Issue #218: outlet fields and neighbours, one per (days, person, domain), built alongside
// term_communities inside the same window transaction. tarcisio is the fixture person these
// docs are about; all dated inside the default 7/30-day windows, undone by after(reseed) so no
// other describe block in this file (or any other test file) ever sees them.
describe('outlet fields and neighbours (issue #218)', () => {
  const tarcisio = persons.find((p) => p.id === 'tarcisio')!

  // Six domains, three docs each, every doc naming tarcisio and carrying "colheita" once: every
  // pair among them has an identical (word:colheita) term set, so every pairwise Jaccard ties
  // at 1 -- the fixture for both "two domains share a term" and the top-5-neighbours cap.
  const colheitaDomains = ['agroinforme.example', 'campovoz.example', 'celeiro.example', 'fazendapress.example', 'ruralnoticias.example', 'sitioinforme.example']

  // A domain sharing nothing with the colheita group: its own singleton field, zero neighbours.
  const portoDocs = [
    { source: 'rss' as const, uri: 'https://portovento.example/1', text: 'Tarcísio inaugura terminal de cabotagem no porto', publishedAt: daysAgo(1), domain: 'portovento.example' },
    { source: 'rss' as const, uri: 'https://portovento.example/2', text: 'Tarcísio detalha plano de cabotagem maritima', publishedAt: daysAgo(2), domain: 'portovento.example' },
    { source: 'rss' as const, uri: 'https://portovento.example/3', text: 'Tarcísio recebe autoridades sobre cabotagem interna', publishedAt: daysAgo(3), domain: 'portovento.example' },
  ]

  // Only two docs -- below the 3-doc/3-count floor, so "colheita" never reaches count 3 here
  // and the domain gets no outlet_fields/outlet_neighbors row at all.
  const belowFloorDocs = [
    { source: 'rss' as const, uri: 'https://riomarginal.example/1', text: 'Tarcísio visita riomarginal para debate sobre colheita', publishedAt: daysAgo(1), domain: 'riomarginal.example' },
    { source: 'rss' as const, uri: 'https://riomarginal.example/2', text: 'Tarcísio reforça riomarginal e colheita em nota', publishedAt: daysAgo(2), domain: 'riomarginal.example' },
  ]

  before(async () => {
    await seed()
    // Same three sentences on every domain, so every one of the six carries the identical
    // (word:*) set -- every pairwise Jaccard ties at exactly 1.
    const colheitaTexts = ['Tarcísio comenta a colheita em relato regional', 'Tarcísio acompanha a colheita em nota recente', 'Tarcísio celebra a colheita em declaração pública']
    for (const domain of colheitaDomains)
      for (let i = 0; i < colheitaTexts.length; i++)
        await insertDocP({ source: 'rss', uri: `https://${domain}/${i}`, text: colheitaTexts[i], publishedAt: daysAgo(i + 1), domain }, persons)
    for (const d of portoDocs) await insertDocP(d, persons)
    for (const d of belowFloorDocs) await insertDocP(d, persons)
    await buildGraphAggregates(persons)
  })
  after(async () => {
    await reseed()
    await buildGraphAggregates(persons)
  })

  const fieldsFor = async (domain: string) =>
    (await db.query<{ field: number }>(`select field from outlet_fields where days = 30 and person_id = 'tarcisio' and domain = $1`, [domain])).rows

  const neighborsFor = async (domain: string) =>
    (
      await db.query<{ neighbor: string; similarity: number }>(
        `select neighbor, similarity from outlet_neighbors where days = 30 and person_id = 'tarcisio' and domain = $1 order by similarity desc, neighbor`,
        [domain],
      )
    ).rows

  it('outlet_fields and outlet_neighbors rebuild idempotently', async () => {
    const fieldsBefore = (await db.query(`select * from outlet_fields order by days, person_id, domain`)).rows
    const neighborsBefore = (await db.query(`select * from outlet_neighbors order by days, person_id, domain, neighbor`)).rows
    await buildGraphAggregates(persons)
    const fieldsAfter = (await db.query(`select * from outlet_fields order by days, person_id, domain`)).rows
    const neighborsAfter = (await db.query(`select * from outlet_neighbors order by days, person_id, domain, neighbor`)).rows
    assert.deepEqual(fieldsAfter, fieldsBefore)
    assert.deepEqual(neighborsAfter, neighborsBefore)
    const { rows: dupFields } = await db.query<{ n: number }>(
      `select count(*)::int as n from (select days, person_id, domain, count(*) c from outlet_fields group by 1,2,3 having count(*) > 1) x`,
    )
    const { rows: dupNeighbors } = await db.query<{ n: number }>(
      `select count(*)::int as n from (select days, person_id, domain, neighbor, count(*) c from outlet_neighbors group by 1,2,3,4 having count(*) > 1) x`,
    )
    assert.equal(dupFields[0].n, 0)
    assert.equal(dupNeighbors[0].n, 0)
  })

  it('a domain below the doc floor gets no field or neighbour row', async () => {
    assert.deepEqual(await fieldsFor('riomarginal.example'), [])
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from outlet_neighbors where days = 30 and person_id = 'tarcisio' and (domain = 'riomarginal.example' or neighbor = 'riomarginal.example')`,
    )
    assert.equal(rows[0].n, 0)
  })

  it('two domains sharing a term get a nonzero similarity; a non-overlapping pair gets none', async () => {
    const rows = await neighborsFor('campovoz.example')
    assert.ok(rows.some((r) => r.neighbor === 'agroinforme.example' && r.similarity > 0))
    assert.ok(!rows.some((r) => r.neighbor === 'portovento.example'), 'a domain sharing no term must not surface as a neighbour')
    const { rows: cross } = await db.query<{ n: number }>(
      `select count(*)::int as n from outlet_neighbors
       where days = 30 and person_id = 'tarcisio'
         and (domain = 'portovento.example' or neighbor = 'portovento.example')`,
    )
    assert.equal(cross[0].n, 0)
  })

  it('a domain with a term set but no surviving edge still gets a field', async () => {
    const rows = await fieldsFor('portovento.example')
    assert.equal(rows.length, 1)
    assert.equal(typeof rows[0].field, 'number')
  })

  it('neighbors are capped at 5 per domain, ordered by similarity desc then domain asc', async () => {
    const rows = await neighborsFor('campovoz.example')
    assert.equal(rows.length, 5, 'six colheita domains means five possible neighbours, all capped at 5')
    assert.ok(rows.every((r) => r.similarity === 1), 'every colheita domain shares the identical single-term set')
    const expected = colheitaDomains.filter((d) => d !== 'campovoz.example').sort()
    assert.deepEqual(rows.map((r) => r.neighbor), expected)
  })

  it('outlet_neighbors binds no array mixing integer and fractional numbers (sql-pg infers one OID per array)', () => {
    const q = aggregateQueries.outletNeighbors(30, 'tarcisio', [
      { domain: 'a.example', neighbor: 'b.example', similarity: 1 },
      { domain: 'a.example', neighbor: 'c.example', similarity: 0.5 },
    ])
    const oid = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v)
    for (const v of q.values.filter(Array.isArray)) assert.equal(new Set(v.map(oid)).size, 1, JSON.stringify(v))
  })

  it('GET-shaped: sourcesFor rides the same build, field/neighbors additive to every existing row', async () => {
    const rows = await sourcesFor(tarcisio, q({}))
    const campo = rows.find((r) => r.domain === 'campovoz.example')
    assert.ok(campo)
    assert.equal(typeof campo!.field, 'number')
    assert.equal(campo!.neighbors.length, 5)
    assert.ok(campo!.neighbors.every((n) => n.similarity === 1))
    const below = rows.find((r) => r.domain === 'riomarginal.example')
    assert.ok(below)
    assert.equal(below!.field, null)
    assert.deepEqual(below!.neighbors, [])
  })

  it('sourcesFor off the build universe (source, country, domain, lean) returns field: null and neighbors: []', async () => {
    const overs: Record<string, string>[] = [{ source: 'gnews' }, { country: 'all' }, { lean: 'right' }, { domain: 'campovoz.example' }]
    for (const over of overs) {
      const rows = await sourcesFor(tarcisio, q(over))
      assert.ok(rows.every((r) => r.field === null && r.neighbors.length === 0), JSON.stringify(over))
    }
  })

  it('buildGraphAggregates run twice back-to-back does not throw and leaves no duplicate rows (AC3)', async () => {
    await assert.doesNotReject(buildGraphAggregates(persons))
    const { rows: dupFields } = await db.query<{ n: number }>(
      `select count(*)::int as n from (select days, person_id, domain, count(*) c from outlet_fields group by 1,2,3 having count(*) > 1) x`,
    )
    const { rows: dupNeighbors } = await db.query<{ n: number }>(
      `select count(*)::int as n from (select days, person_id, domain, neighbor, count(*) c from outlet_neighbors group by 1,2,3,4 having count(*) > 1) x`,
    )
    assert.equal(dupFields[0].n, 0)
    assert.equal(dupNeighbors[0].n, 0)
  })

  it('two domains sharing a term get similarity > 0 in outlet_neighbors; a domain sharing no term with either produces no row against them (AC4)', async () => {
    const rows = await neighborsFor('agroinforme.example')
    const toCampovoz = rows.find((r) => r.neighbor === 'campovoz.example')
    assert.ok(toCampovoz && toCampovoz.similarity > 0)
    assert.ok(!rows.some((r) => r.neighbor === 'portovento.example'))
    const { rows: crossCount } = await db.query<{ n: number }>(
      `select count(*)::int as n from outlet_neighbors where days = 30 and person_id = 'tarcisio'
       and ((domain = 'agroinforme.example' and neighbor = 'portovento.example') or (domain = 'portovento.example' and neighbor = 'agroinforme.example'))`,
    )
    assert.equal(crossCount[0].n, 0)
  })

  it('a domain below the 3-doc floor never appears as domain or neighbor in outlet_fields/outlet_neighbors for that window/person (AC5)', async () => {
    assert.deepEqual(await fieldsFor('riomarginal.example'), [])
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from outlet_neighbors where days = 30 and person_id = 'tarcisio'
       and (domain = 'riomarginal.example' or neighbor = 'riomarginal.example')`,
    )
    assert.equal(rows[0].n, 0)
  })

  it('every domain with a nonempty term set gets exactly one outlet_fields row, including a Louvain singleton with zero surviving edges (AC6)', async () => {
    const singleton = await fieldsFor('portovento.example')
    assert.equal(singleton.length, 1)
    assert.equal(typeof singleton[0].field, 'number')
    const grouped = await fieldsFor('campovoz.example')
    assert.equal(grouped.length, 1)
    assert.equal(typeof grouped[0].field, 'number')
  })

  it('neighbors are ordered similarity desc then domain asc, a tied group pinning the tie-break (AC9)', async () => {
    const rows = await neighborsFor('campovoz.example')
    assert.ok(rows.every((r) => r.similarity === 1), 'every colheita domain ties at similarity 1')
    const expected = colheitaDomains.filter((d) => d !== 'campovoz.example').sort()
    assert.deepEqual(rows.map((r) => r.neighbor), expected, 'tied similarity must fall back to domain ascending')
  })
})

// Issue #247 acceptance criteria, written from the spec independently of the
// 'compare fast path (issue #247)' / 'lenses fast path (issue #247)' describes above (which the
// build itself added). AC1/AC3/AC5/AC6 duplicated those describes' own tests exactly and were
// folded there (their titles now carry the AC number); only AC2/AC4/AC7, which have no earlier
// equivalent, stay here.
describe('compare/lenses fast path acceptance criteria (issue #247)', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })
  after(async () => {
    await reseed()
    await buildGraphAggregates(persons)
  })

  // Non-name keys only, same reason as the 'lenses fast path' describe's own AC2 test: graph_terms
  // never holds a person's own name words, so the fast union can never surface one (docs/api.md).
  it('lensesFast renders byte-identical output to the live lenses query for every fixture person, source: and all lenses, non-name keys (AC2)', async () => {
    for (const person of persons) {
      const query = lensQ({ a: rssLens, b: gkgLens })
      const fastRow = await fastLensesRow(person, query)
      const liveRow = await liveLensesRow(person, query)
      assert.equal(fastRow.about_a, liveRow.about_a, person.id)
      assert.equal(fastRow.about_b, liveRow.about_b, person.id)
      assert.deepEqual(
        fastRow.terms,
        liveRow.terms.filter((t) => !t.is_name),
        person.id,
      )
      const queryAll = lensQ({ a: allLens, b: senadoLens })
      const fastAll = await fastLensesRow(person, queryAll)
      const liveAll = await liveLensesRow(person, queryAll)
      assert.equal(fastAll.about_a, liveAll.about_a, `${person.id} all/senado`)
      assert.equal(fastAll.about_b, liveAll.about_b, `${person.id} all/senado`)
      assert.deepEqual(
        fastAll.terms,
        liveAll.terms.filter((t) => !t.is_name),
        `${person.id} all/senado`,
      )
    }
  })

  it('a domain: or lean: lens on either side, or a days outside DAYS, keeps /api/people/:id/lenses fully live, unchanged output (AC4)', async () => {
    const domainLens: LensSide = { lens: 'domain:example.org', domain: 'example.org', lean: 'all', source: 'all' }
    const leanLens: LensSide = { lens: 'lean:left', domain: 'all', lean: 'left', source: 'all' }
    for (const query of [lensQ({ a: domainLens, b: allLens }), lensQ({ a: allLens, b: leanLens }), lensQ({ days: 14 })]) {
      assert.equal(lensesFastEligible(query), false)
      const liveRow = await liveLensesRow(lula, query)
      const result = await lensesFor(lula, query)
      assert.equal(result.a.about, liveRow.about_a)
      assert.equal(result.b.about, liveRow.about_b)
      assert.equal(result.terms.length, liveRow.terms.length)
      assert.deepEqual(result.terms.map(({ term, kind, a, b }) => ({ term, kind, a, b })), expectedLensTerms(liveRow.terms))
    }
  })

  it('tone is identical, and null wherever no GDELT doc contributed, between the fast and live compare paths (AC7)', async () => {
    const query = cq({ days: 365 })
    const fastRow = await fastCompareRow(tarcisio, lula, query)
    const liveRow = await liveCompareRow(tarcisio, lula, query)
    const tones = (row: typeof fastRow) => row.terms.map((t) => ({ term: t.term, kind: t.kind, a_tone: t.a_tone, b_tone: t.b_tone }))
    assert.deepEqual(tones(fastRow), tones(liveRow))
    assert.ok(fastRow.terms.some((t) => t.a_tone !== null), 'sanity: tarcisio has at least one gdelt-toned term in scope')
    assert.ok(fastRow.terms.some((t) => t.a_tone === null), 'sanity: at least one untoned term also survives in scope')
  })
})
