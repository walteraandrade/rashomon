import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { ANALYZED_TABLES, db } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import { graphFor, type GraphQuery } from '../src/graph.js'
import { reindexAll } from '../src/reindex.js'
import { MAX_DOC_CHARS, insertDocP, truncateText } from '../src/store.js'
import { derivedRows, insertDocTerm, insertOrphanDoc, lastAnalyzed, orphanDocCount, orphanTermCount, planRowEstimate, termsOf, persons, reseed, seed } from './fixture.js'
import './close.js'

// Reindex is destructive (it clears doc_terms/doc_persons/doc_candidates and rebuilds them),
// so it lives in its own file: node:test runs one process per file, hence its own database.

const lula = persons[0]
const wide: GraphQuery = { days: 2210, source: 'all', domain: 'all', lean: 'all', country: 'all', kind: 'all', limit: 200, min: 1, sort: 'count', method: null, communities: false }
const termsOfKind = (nodes: { term: string; kind: string }[], kind: string) => nodes.filter((n) => n.kind === kind).map((n) => n.term)

describe('reindex skips terms of docs naming nobody tracked (issue #52)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  before(seed)
  after(reseed)

  it('leaves no doc_terms row for a doc without a doc_persons row', async () => {
    const { docs } = await reindexAll(persons)
    assert.ok(docs > 0, 'sanity: the fixture must have docs to reindex')
    assert.equal(await orphanTermCount(), 0)
  })

  it('keeps the terms of docs that do name a tracked person', async () => {
    await reindexAll(persons)
    assert.ok((await termsOf('https://g1.globo.com/1')).includes('reforma'))
    assert.deepEqual(await termsOf('https://example.org/4'), [])
  })

  const senado = { source: 'senado' as const, uri: 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/999999', text: 'Davi Alcolumbre: pronunciamento sobre soberania nacional e infraestrutura portuária', publishedAt: new Date().toISOString(), domain: 'senado.leg.br' }
  const orphan = { ...senado, uri: 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/orphan-313' }
  const taggedOf = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)
  const stored = async (uri: string) => (await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [uri])).rows[0].n

  it('does not recover a doc the writer dropped: reindex reads stored docs only (issue #313)', async () => {
    assert.equal(await stored(senado.uri), 0, 'seed() drops the Alcolumbre-only doc')
    await reindexAll([...persons, alcolumbre])
    assert.equal(await stored(senado.uri), 0)
    assert.deepEqual(await termsOf(senado.uri), [])
  })

  it('tags a stored orphan that starts matching after a person is added', async () => {
    await insertOrphanDoc(orphan)
    await reindexAll(persons)
    assert.deepEqual(await taggedOf(orphan.uri), [])
    assert.deepEqual(await termsOf(orphan.uri), [])
    await reindexAll([...persons, alcolumbre])
    assert.deepEqual(await taggedOf(orphan.uri), ['alcolumbre'])
    assert.ok((await termsOf(orphan.uri)).includes('soberania'))
    assert.equal(await orphanTermCount(), 0)
  })

  it('keeps a stored doc that stopped matching anyone, with zero doc_persons rows (reindex deletes nothing)', async () => {
    await reindexAll([...persons, alcolumbre])
    assert.deepEqual(await taggedOf(orphan.uri), ['alcolumbre'])
    const before = await orphanDocCount()
    await reindexAll(persons)
    assert.equal(await stored(orphan.uri), 1)
    assert.deepEqual(await taggedOf(orphan.uri), [])
    assert.deepEqual(await termsOf(orphan.uri), [])
    assert.equal(await orphanDocCount(), before + 1)
  })

  it('leaves no unreferenced terms row after reindex (issue #252) (AC8)', async () => {
    await reindexAll(persons)
    const before = await derivedRows()
    await db.query(`insert into terms (term, kind) values ('vocabulario-morto', 'word'), ('hashtag-morta', 'hashtag')`)
    await reindexAll(persons)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from terms v where not exists (select 1 from doc_terms t where t.term_id = v.id)`)
    assert.equal(rows[0].n, 0)
    assert.deepEqual(await derivedRows(), before)
  })

  it('purge orphan-terms deletes exactly the rows reindex would not write', async () => {
    await reindexAll(persons)
    await insertOrphanDoc({ source: 'rss', uri: 'https://example.org/orphan-terms', text: 'Congresso discute a pauta', publishedAt: new Date().toISOString() })
    const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, ['https://example.org/orphan-terms'])
    await insertDocTerm(rows[0].id, 'congresso', 'word')
    assert.equal(await orphanTermCount(), 1)
    await db.query(`delete from doc_terms t where not exists (select 1 from doc_persons p where p.doc_id = t.doc_id)`)
    assert.equal(await orphanTermCount(), 0)
    assert.ok((await termsOf('https://g1.globo.com/1')).includes('reforma'))
  })
})

// A reindex empties and refills every derived table, so the planner's estimates are stale by
// construction when it returns; refreshing them there is the only maintenance the app runs
// besides a large ingest, and it happens in the process that already owns DATA_DIR.
describe('reindex refreshes planner statistics (issue #44)', () => {
  before(seed)

  it('analyzes every derived table once the rebuild is done', async () => {
    const { analyzed } = await reindexAll(persons)
    assert.deepEqual([...analyzed], [...ANALYZED_TABLES])
    for (const t of ANALYZED_TABLES) {
      assert.ok((await lastAnalyzed(t)) !== null, `${t} was never analyzed`)
      assert.ok((await planRowEstimate(t)) >= 0, `${t} still has no row estimate`)
    }
  })
})

describe('reindex reads documents in bounded pages (issue #50)', () => {
  before(seed)

  it('produces the same derived rows one document at a time as in a single page', async () => {
    await reindexAll(persons, 1)
    const paged = await derivedRows()
    await reindexAll(persons, 10_000)
    assert.deepEqual(await derivedRows(), paged)
    assert.ok(paged.persons.length > 0, 'sanity: the fixture must produce derived rows')
  })

  it('reports the same document count whatever the page size', async () => {
    const small = await reindexAll(persons, 2)
    const large = await reindexAll(persons, 10_000)
    assert.equal(small.docs, large.docs)
    assert.ok(small.docs > 2, 'sanity: the fixture must span more than one page')
  })
})

describe('reindex recovers from an interrupted run (issue #50)', () => {
  before(seed)

  it('rebuilds a database whose later pages never committed', async () => {
    await reindexAll(persons)
    const full = await derivedRows()
    const { rows } = await db.query<{ id: number }>(`select id from docs order by id offset 2 limit 1`)
    const cut = rows[0].id
    // What an interruption leaves behind: whole pages committed, the rest missing. Never a
    // document with some of its derived rows, since each page is one transaction.
    for (const t of ['doc_terms', 'doc_persons', 'doc_candidates']) await db.query(`delete from ${t} where doc_id > $1`, [cut])
    const partial = await derivedRows()
    assert.ok(partial.persons.length < full.persons.length, 'sanity: the interruption must remove rows')
    await reindexAll(persons)
    assert.deepEqual(await derivedRows(), full)
    assert.equal(await orphanTermCount(), 0)
  })

  it('is idempotent: running it twice more changes nothing', async () => {
    await reindexAll(persons)
    const once = await derivedRows()
    await reindexAll(persons)
    assert.deepEqual(await derivedRows(), once)
  })
})

describe('reindex caps the text of rows stored before the cap (issue #128)', () => {
  before(seed)
  const uri = 'https://example.org/stored-long'
  const filler = 'lula fala sobre a reforma tributaria no congresso '
  const text = `${filler.repeat(Math.ceil((MAX_DOC_CHARS + 500) / filler.length))}zumbificacao`

  it('rewrites the text with truncateText and derives terms from what stays', async () => {
    await db.query(`insert into docs (source, uri, text, published_at) values ('rss', $1, $2, now())`, [uri, text])
    const { capped } = await reindexAll(persons)
    assert.equal(capped, 1)
    const { rows } = await db.query<{ text: string }>(`select text from docs where uri = $1`, [uri])
    assert.equal(rows[0].text, truncateText(text))
    assert.ok(rows[0].text.length <= MAX_DOC_CHARS)
    // The repeated filler makes `reforma tributaria` a phrase on this corpus, which is why the
    // word is looked for as either; the tail word past the cap must be absent either way.
    const terms = await termsOf(uri)
    assert.ok(terms.some((t) => t.startsWith('reforma')))
    assert.ok(!terms.includes('zumbificacao'))
  })

  it('reports zero on a second run, since nothing is over the cap any more', async () => {
    const { capped } = await reindexAll(persons)
    assert.equal(capped, 0)
  })
})

// issue #204
describe('reindex backfills country from domain', () => {
  before(seed)
  after(reseed)
  const ptUri = 'https://sapo.pt/backfill'
  const brUri = 'https://folha.uol.com.br/backfill'
  const noDomainUri = 'https://example.org/backfill-no-domain'
  const countryOf = async (uri: string) => (await db.query<{ country: string | null }>(`select country from docs where uri = $1`, [uri])).rows[0]?.country

  it('sets country on rows with a domain and null country, leaves domain-less rows alone', async () => {
    await db.query(`insert into docs (source, uri, text, published_at, domain) values ('rss', $1, 'Lula em Lisboa', now(), 'sapo.pt')`, [ptUri])
    await db.query(`insert into docs (source, uri, text, published_at, domain) values ('rss', $1, 'Lula em Brasilia', now(), 'folha.uol.com.br')`, [brUri])
    await db.query(`insert into docs (source, uri, text, published_at) values ('rss', $1, 'Lula em algum lugar', now())`, [noDomainUri])

    const { countriesBackfilled } = await reindexAll(persons)
    assert.equal(countriesBackfilled, 2)
    assert.equal(await countryOf(ptUri), 'pt')
    assert.equal(await countryOf(brUri), 'br')
    assert.equal(await countryOf(noDomainUri), null)
  })

  it('reports zero on a second run', async () => {
    const { countriesBackfilled } = await reindexAll(persons)
    assert.equal(countriesBackfilled, 0)
  })
})

describe('reindex builds the lexicon and tags the corpus with it', () => {
  before(async () => {
    await seed()
    process.env.MIN_PHRASE_COUNT = '2'
    process.env.MIN_PHRASE_PERCENT = '35'
    await reindexAll(persons)
  })

  it('reports how many phrases it kept and writes doc_terms rows of kind phrase', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms t join terms v on v.id = t.term_id where v.kind = 'phrase'`)
    assert.ok(rows[0].n > 0, 'the fixture must yield at least one phrase row')
  })

  it('surfaces a real collocation from the fixture as one term on the map', async () => {
    const graph = await graphFor(lula, wide)
    assert.ok(termsOfKind(graph.nodes, 'phrase').includes('reforma tributaria'))
  })

  it('no longer carries "tributaria" on its own: every occurrence of it was inside the phrase', async () => {
    const graph = await graphFor(lula, wide)
    assert.ok(!termsOfKind(graph.nodes, 'word').includes('tributaria'))
  })

  it('keeps a tracked name out of the collocation lexicon, so no word is deleted with nothing put in its place', async () => {
    // "Lula defende" is frequent and perfectly sticky in the fixture, and would be a phrase but
    // for this rule. graph.ts would then hide it from Lula's own map — and, since a phrase
    // replaces its words, "defende" would vanish from that map along with it.
    const { rows } = await db.query<{ term: string }>(`select term from phrases`)
    const tracked = new Set(persons.flatMap(nameTokens))
    for (const { term } of rows) for (const word of term.split(' ')) assert.ok(!tracked.has(word), `${term} names a tracked person`)
    const graph = await graphFor(lula, wide)
    assert.ok(termsOfKind(graph.nodes, 'word').includes('defende'))
  })

  it("drops a phrase carrying one of the person's own name words from that person's own map", async () => {
    // Capitalized runs still produce them: seed.json cannot stop anyone from writing the name
    // mid-sentence, so the query-time filter is the one that has to hold.
    await insertDocP({ source: 'rss', uri: 'https://example.org/phrase-name', text: 'O deputado Jair Bolsonaro discursou', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms t join terms v on v.id = t.term_id where v.kind = 'phrase' and v.term = 'jair bolsonaro'`)
    assert.equal(rows[0].n, 1, 'sanity: the run this filter has to hide must exist')
    const graph = await graphFor(persons[2], wide)
    for (const term of termsOfKind(graph.nodes, 'phrase')) assert.ok(!term.split(' ').includes('bolsonaro'), `${term} names the person, it is not said about them`)
  })
})

// Issue #313 acceptance criteria, quoted by number.
describe('reindex over a tracked-only store (issue #313 acceptance)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  const uri = (n: string) => `https://ac313-reindex.example/${n}`
  const text = 'Davi Alcolumbre defende a soberania nacional e a infraestrutura portuária'
  const sourceDoc = { source: 'rss' as const, text, publishedAt: new Date().toISOString(), domain: 'ac313-reindex.example' }
  const docCount = async () => (await db.query<{ n: number }>(`select count(*)::int as n from docs`)).rows[0].n
  const storedCount = async (u: string) => (await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [u])).rows[0].n
  const taggedOf = async (u: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [u])).rows.map((r) => r.person_id)

  before(seed)
  after(reseed)

  it('reindexAll with a new person does not store the doc the writer dropped (AC13)', async () => {
    const dropped = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/999999'
    assert.equal(await storedCount(dropped), 0)
    await reindexAll([...persons, alcolumbre])
    assert.equal(await storedCount(dropped), 0)
    assert.deepEqual(await taggedOf(dropped), [])
    assert.equal(await orphanDocCount(), 0)
  })

  it('a raw-stored orphan that starts matching after a person is added is tagged (AC13)', async () => {
    await insertOrphanDoc({ ...sourceDoc, uri: uri('starts-matching') })
    await reindexAll(persons)
    assert.deepEqual(await taggedOf(uri('starts-matching')), [])
    await reindexAll([...persons, alcolumbre])
    assert.deepEqual(await taggedOf(uri('starts-matching')), ['alcolumbre'])
    assert.ok((await termsOf(uri('starts-matching'))).includes('soberania'))
  })

  it('a stored doc that stops matching anyone stays stored with zero doc_persons rows, and reindex deletes nothing (AC13)', async () => {
    await reindexAll([...persons, alcolumbre])
    assert.deepEqual(await taggedOf(uri('starts-matching')), ['alcolumbre'])
    const before = await docCount()
    await reindexAll(persons)
    assert.equal(await docCount(), before)
    assert.equal(await storedCount(uri('starts-matching')), 1)
    assert.deepEqual(await taggedOf(uri('starts-matching')), [])
    assert.deepEqual(await termsOf(uri('starts-matching')), [])
  })
})
