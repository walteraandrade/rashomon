import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { AGGREGATE_TABLES, buildGraphAggregates, hasGraphAggregates, queries as aggregateQueries, TOP } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { graphFor, precomputable, queries, sourcesFor } from '../src/graph.js'
import { DAYS, LIMITS, MINS, parseQuery, SOURCES } from '../src/query.js'
import { inTransaction, insertDocP } from '../src/store.js'
import { persons, reseed, seed, untrackedPerson } from './fixture.js'
import './close.js'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// src/aggregate.ts builds graph_scopes / graph_terms (graph_terms_all is a session-temp table,
// never persisted); graphFor answers
// from them when the recorte fits and from the live query otherwise. The contract is
// equality: for every recorte the tables can hold, both paths render the same response.

const lula = persons.find((p) => p.id === 'lula')!
const q = (over: Record<string, string>) => parseQuery({ days: '30', ...over })
const live = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graph(person, query).text, queries.graph(person, query).values)).rows[0]
const fast = async (person: typeof lula, query: ReturnType<typeof parseQuery>) => (await db.query(queries.graphFast(person, query).text, queries.graphFast(person, query).values)).rows[0]

describe('graph_terms_all as a session-temp table (issue #203)', () => {
  it('AGGREGATE_TABLES is exactly graph_scopes and graph_terms, no graph_terms_all entry', () => {
    assert.deepEqual([...AGGREGATE_TABLES], ['graph_scopes', 'graph_terms'])
  })

  it('a window creates the universe as a keyed temp table and never deletes from it', () => {
    const texts = aggregateQueries.window(30, persons).map((s) => s.text)
    assert.equal(texts.filter((t) => /graph_terms_all/.test(t) && /\bdelete\b/i.test(t)).length, 0)
    const create = texts.findIndex((t) => /create temp table graph_terms_all on commit drop as/.test(t))
    const key = texts.findIndex((t) => /alter table graph_terms_all add primary key \(days, source, term, kind\)/.test(t))
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

  for (const person of persons)
    for (const over of recortes)
      it(`renders the same response as the live query for ${person.id} ${JSON.stringify(over)}`, async () => {
        const query = q(over)
        assert.equal(precomputable(query), true)
        assert.deepEqual(await fast(person, query), await live(person, query))
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
