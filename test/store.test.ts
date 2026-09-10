import assert from 'node:assert/strict'
import { after, describe, it, before } from 'node:test'
import { db, migrate } from '../src/db.js'
import { docsFor, sourcesFor, type DocsQuery, type GraphQuery } from '../src/graph.js'
import { MAX_DOC_CHARS, batches, insertDoc, insertDocs, truncateText, upsertPersons, writeBatchDocs, writeBatchRows } from '../src/store.js'
import { collidingUri, derivedCounts, enrichmentDocs, orphanTermCount, persons, rowVersion, seed, termsOf, untrackedPerson } from './fixture.js'
import './close.js'

const [, tarcisio] = persons
const base: DocsQuery = { term: '', kind: 'all', days: 3100, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0 }
const stored = async (uri: string) =>
  (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]

describe('insertDoc persons', () => {
  const flavio = { id: 'flavio-bolsonaro', name: 'Flávio Bolsonaro', aliases: ['Flávio Bolsonaro'] }
  const family = [...persons, flavio]
  before(async () => (await seed(), upsertPersons([flavio])))
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)

  it('tags a Flávio Bolsonaro doc with Flávio only', async () => {
    const uri = 'https://example.org/flavio'
    await insertDoc({ source: 'rss', uri, text: 'Flávio Bolsonaro critica o governo', publishedAt: new Date().toISOString() }, family)
    assert.deepEqual(await tagged(uri), ['flavio-bolsonaro'])
  })
})

describe('insertDoc camara', () => {
  before(seed)
  const uri = 'https://www.camara.leg.br/discursos/74847/2018-01-01T10:00'
  const [, , bolsonaro] = persons
  const tagged = async (u: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [u])).rows.map((r) => r.person_id)

  it('tags the camara doc with exactly its own person', async () => {
    assert.deepEqual(await tagged(uri), ['bolsonaro'])
  })

  it('stores tone as null for a camara doc', async () => {
    assert.deepEqual(await stored(uri), { source: 'camara', tone: null })
  })

  it('surfaces in /sources with domain camara.leg.br and null tone', async () => {
    const wideGraph: GraphQuery = { days: 3100, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
    const rows = await sourcesFor(bolsonaro, wideGraph)
    const row = rows.find((r) => r.domain === 'camara.leg.br')
    assert.equal(row?.source, 'camara')
    assert.equal(row?.tone, null)
  })
})

describe('insertDoc term storage (issue #52)', () => {
  before(seed)

  it('stores no doc_terms row for any fixture doc naming nobody tracked', async () => {
    assert.equal(await orphanTermCount(), 0)
    // doc /4 is the fixture's untagged doc: it has a docs row but no terms
    assert.deepEqual(await termsOf('https://example.org/4'), [])
  })

  it('keeps storing the terms of a doc that names a tracked person', async () => {
    assert.ok((await termsOf('https://g1.globo.com/1')).includes('reforma'))
  })

  it('stores docs and doc_candidates for an untagged doc while skipping its terms', async () => {
    const uri = 'https://example.org/untagged'
    await insertDoc({ source: 'rss', uri, text: 'Reunião ouve Hugo Motta sobre a pauta', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
    const { rows } = await db.query<{ persons: number; terms: number; candidates: number }>(
      `select
         (select count(*) from doc_persons p where p.doc_id = d.id)::int as persons,
         (select count(*) from doc_terms t where t.doc_id = d.id)::int as terms,
         (select count(*) from doc_candidates c where c.doc_id = d.id)::int as candidates
       from docs d where d.uri = $1`,
      [uri],
    )
    assert.deepEqual(rows[0], { persons: 0, terms: 0, candidates: 1 })
  })
})

describe('insertDoc senado (issue #25)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  const family = [...persons, alcolumbre]
  before(async () => (await seed(), upsertPersons([alcolumbre])))
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)

  it('tags the speaking senator via the name-prefix, stores terms, and leaves tone null', async () => {
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/111111'
    await insertDoc(
      { source: 'senado', uri, text: 'Davi Alcolumbre: pronunciamento sobre soberania nacional e infraestrutura portuária', publishedAt: new Date().toISOString(), domain: 'senado.leg.br' },
      family,
    )
    assert.deepEqual(await tagged(uri), ['alcolumbre'])
    assert.ok((await termsOf(uri)).includes('soberania'))
    assert.deepEqual(await stored(uri), { source: 'senado', tone: null })
  })
})

describe('insertDoc tone', () => {
  before(seed)

  it('keeps an rss doc without tone after a gkg upsert of the same uri', async () => {
    assert.deepEqual(await stored(collidingUri), { source: 'rss', tone: null })
    const { docs } = await docsFor(tarcisio, base)
    const doc = docs.find((d) => d.uri === collidingUri)
    assert.equal(doc?.source, 'rss')
    assert.equal(doc?.tone, null)
  })

  it('keeps the tone of a gkg doc when a later rss row shares the uri', async () => {
    const uri = 'https://example.org/gkg-first'
    await insertDoc({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: new Date().toISOString(), tone: 2.5 }, persons)
    await insertDoc({ source: 'rss', uri, text: 'Lula visita fábrica', publishedAt: new Date().toISOString() }, persons)
    assert.deepEqual(await stored(uri), { source: 'gkg', tone: 2.5 })
  })

  it('drops a tone handed in for a non-GDELT source', async () => {
    const uri = 'https://example.org/gnews-with-tone'
    await insertDoc({ source: 'gnews', uri, text: 'Lula sanciona lei', publishedAt: new Date().toISOString(), tone: 1 }, persons)
    assert.deepEqual(await stored(uri), { source: 'gnews', tone: null })
  })

  it('migrate clears tones already stored on non-GDELT docs', async () => {
    const uri = 'https://example.org/legacy'
    await db.query(`insert into docs (source, uri, text, published_at, tone) values ('rss', $1, 'x', now(), -1.02)`, [uri])
    await migrate()
    assert.deepEqual(await stored(uri), { source: 'rss', tone: null })
  })
})

describe('insertDoc upsert writes only when metadata changes (issue #50)', () => {
  before(seed)
  const [first, enriched] = enrichmentDocs

  it('fills a missing domain when the same uri arrives with one', async () => {
    assert.equal(await insertDoc(first, persons), true)
    const before = await rowVersion(first.uri)
    assert.equal(await insertDoc(enriched, persons), false)
    const { rows } = await db.query<{ domain: string | null }>(`select domain from docs where uri = $1`, [first.uri])
    assert.equal(rows[0].domain, 'example.org')
    assert.notEqual(await rowVersion(first.uri), before)
  })

  it('writes no new row version when the duplicate would change nothing', async () => {
    const before = await rowVersion(enriched.uri)
    assert.equal(await insertDoc(enriched, persons), false)
    assert.equal(await rowVersion(enriched.uri), before)
  })

  it('leaves the derived rows of the first arrival untouched', async () => {
    const counts = await derivedCounts(first.uri)
    assert.equal(counts?.persons, 1)
    assert.ok((counts?.terms ?? 0) > 0)
    await insertDoc(enriched, persons)
    assert.deepEqual(await derivedCounts(first.uri), counts)
  })

  it('still refuses to write a new row version for the colliding gkg/rss pair', async () => {
    const before = await rowVersion(collidingUri)
    assert.equal(await insertDoc({ source: 'gkg', uri: collidingUri, text: 'Tarcísio anuncia obra em Santos', publishedAt: new Date().toISOString(), domain: 'example.org', tone: -3.2 }, persons), false)
    assert.equal(await rowVersion(collidingUri), before)
    assert.deepEqual(await stored(collidingUri), { source: 'rss', tone: null })
  })
})

describe('insertDoc rolls back a document it cannot fully index (issue #50)', () => {
  before(seed)
  const uri = 'https://example.org/rollback'
  const phantom = untrackedPerson()
  const doc = { source: 'rss' as const, uri, text: 'Ciro Gomes critica a reforma tributária', publishedAt: new Date().toISOString(), domain: 'example.org' }

  it('leaves neither the docs row nor any derived row behind', async () => {
    await assert.rejects(() => insertDoc(doc, [...persons, phantom]))
    assert.equal(await derivedCounts(uri), null)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [uri])
    assert.equal(rows[0].n, 0)
  })

  it('leaves the connection usable, and the same doc lands once its person exists', async () => {
    await upsertPersons([phantom])
    assert.equal(await insertDoc(doc, [...persons, phantom]), true)
    const counts = await derivedCounts(uri)
    assert.equal(counts?.persons, 1)
    assert.ok((counts?.terms ?? 0) > 0)
  })
})

describe('insertDocs groups documents into bounded transactions (issue #50)', () => {
  before(seed)
  const uris = ['https://example.org/g1', 'https://example.org/g2', 'https://example.org/g3']
  const group = uris.map((uri, i) => ({ source: 'rss' as const, uri, text: i === 1 ? 'Ciro Gomes fala sobre a reforma' : `Lula fala sobre a pauta ${i}`, publishedAt: new Date().toISOString(), domain: 'example.org' }))

  it('keeps every writable document of a failing group and charges only the bad one', async () => {
    const family = [...persons, untrackedPerson('ainda-nao-cadastrado')]
    assert.deepEqual(await insertDocs(group, family, 3), { written: 2, enriched: 0, failed: 1 })
    assert.equal((await derivedCounts(uris[0]))?.persons, 1)
    assert.equal(await derivedCounts(uris[1]), null)
    assert.equal((await derivedCounts(uris[2]))?.persons, 1)
  })

  it('counts a replayed group as nothing new and duplicates no derived row', async () => {
    const counts = await derivedCounts(uris[0])
    assert.deepEqual(await insertDocs([group[0], group[2]], persons, 2), { written: 0, enriched: 0, failed: 0 })
    assert.deepEqual(await derivedCounts(uris[0]), counts)
  })
})

describe('write batch bounds (issue #50)', () => {
  const original = { rows: process.env.WRITE_BATCH_ROWS, docs: process.env.WRITE_BATCH_DOCS }
  after(() => {
    for (const [key, value] of [['WRITE_BATCH_ROWS', original.rows], ['WRITE_BATCH_DOCS', original.docs]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const withEnv = (key: 'WRITE_BATCH_ROWS' | 'WRITE_BATCH_DOCS', v: string | undefined, read: () => number) => {
    if (v === undefined) delete process.env[key]
    else process.env[key] = v
    return read()
  }

  it('defaults to 500 rows and 200 docs, and falls back to them on garbage', () => {
    assert.equal(withEnv('WRITE_BATCH_ROWS', undefined, writeBatchRows), 500)
    assert.equal(withEnv('WRITE_BATCH_ROWS', 'nao-e-numero', writeBatchRows), 500)
    assert.equal(withEnv('WRITE_BATCH_DOCS', undefined, writeBatchDocs), 200)
    assert.equal(withEnv('WRITE_BATCH_DOCS', '', writeBatchDocs), 200)
  })

  it('clamps both to their floor and their ceiling', () => {
    assert.equal(withEnv('WRITE_BATCH_ROWS', '0', writeBatchRows), 1)
    assert.equal(withEnv('WRITE_BATCH_ROWS', '99999999', writeBatchRows), 10_000)
    assert.equal(withEnv('WRITE_BATCH_ROWS', '750', writeBatchRows), 750)
    assert.equal(withEnv('WRITE_BATCH_DOCS', '-5', writeBatchDocs), 1)
    assert.equal(withEnv('WRITE_BATCH_DOCS', '99999999', writeBatchDocs), 5_000)
  })

  it('never yields a chunk larger than the bound, and loses nothing', () => {
    const xs = Array.from({ length: 17 }, (_, i) => i)
    for (const size of [1, 2, 5, 17, 40]) {
      const chunks = batches(xs, size)
      assert.equal(chunks.length, Math.ceil(xs.length / size))
      assert.ok(chunks.every((c) => c.length <= size && c.length > 0))
      assert.deepEqual(chunks.flat(), xs)
    }
    assert.deepEqual(batches([], 10), [])
  })
})

describe('docs.text is capped at write time (issue #128)', () => {
  before(seed)
  const textOf = async (uri: string) => (await db.query<{ text: string }>(`select text from docs where uri = $1`, [uri])).rows[0]?.text
  // A doc naming a tracked person, whose tail past the cap carries a word that appears nowhere else.
  const filler = 'lula fala sobre a reforma tributaria no congresso '
  const long = (tail: string) => `${filler.repeat(Math.ceil((MAX_DOC_CHARS + 500) / filler.length))}${tail}`

  it('truncateText cuts at the last whitespace before the limit and never mid-word', () => {
    assert.equal(truncateText('abc def ghi', 7), 'abc def')
    assert.equal(truncateText('abc def ghi', 8), 'abc def')
    assert.equal(truncateText('abc def ghi', 9), 'abc def')
    assert.equal(truncateText('abc def ghi', 11), 'abc def ghi')
    assert.equal(truncateText('abc def ghi', 100), 'abc def ghi')
    assert.equal(truncateText('abcdefghij', 4), 'abcd')
  })

  it('stores exactly the truncated text for a doc over the cap, on a word boundary', async () => {
    const uri = 'https://example.org/over-cap'
    const text = long('zumbificacao')
    assert.ok(text.length > MAX_DOC_CHARS, 'sanity: the fixture must exceed the cap')
    await insertDoc({ source: 'rss', uri, text, publishedAt: new Date().toISOString() }, persons)
    const stored = await textOf(uri)
    assert.equal(stored, truncateText(text))
    assert.ok(stored.length <= MAX_DOC_CHARS)
    assert.ok(text.startsWith(stored))
    assert.match(text[stored.length], /\s/, 'the cut lands right before whitespace')
    assert.ok(!stored.includes('zumbificacao'))
  })

  it('leaves a doc under the cap untouched', async () => {
    const uri = 'https://example.org/under-cap'
    const text = filler.repeat(20)
    await insertDoc({ source: 'rss', uri, text, publishedAt: new Date().toISOString() }, persons)
    assert.equal(await textOf(uri), text)
  })

  it('derives terms from the truncated text, not the original', async () => {
    const uri = 'https://example.org/over-cap-terms'
    await insertDoc({ source: 'rss', uri, text: long('zumbificacao'), publishedAt: new Date().toISOString() }, persons)
    const terms = await termsOf(uri)
    assert.ok(terms.includes('reforma'))
    assert.ok(!terms.includes('zumbificacao'))
  })

  it('applies the same cap through insertDocs', async () => {
    const uri = 'https://example.org/over-cap-bulk'
    const text = long('zumbificacao')
    await insertDocs([{ source: 'rss', uri, text, publishedAt: new Date().toISOString() }], persons)
    assert.equal(await textOf(uri), truncateText(text))
  })
})
