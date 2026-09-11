import assert from 'node:assert/strict'
import { after, describe, it, before } from 'node:test'
import { db, migrate } from '../src/db.js'
import { docsFor, sourcesFor, type DocsQuery, type GraphQuery } from '../src/graph.js'
import { MAX_DOC_CHARS, batches, insertDoc, insertDocs, tonedSources, truncateText, upsertPersons, writeBatchDocs, writeBatchRows } from '../src/store.js'
import { collidingUri, derivedCounts, enrichmentDocs, orphanTermCount, persons, rowVersion, seed, seedCandidates, termsOf, untrackedPerson } from './fixture.js'
import './close.js'

// The write path in src/store.ts. Every suite here layers its own docs on the shared fixture;
// none reads a count the fixture alone would give, so no reseed is needed between them. The
// statement-count suite lives in test/batch-writes.test.ts, because PERF has to be set before
// src/db.ts loads.

const [, tarcisio] = persons
const base: DocsQuery = { term: '', kind: 'all', days: 3100, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0, day: '' }
const now = () => new Date().toISOString()
const stored = async (uri: string) =>
  (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
const textOf = async (uri: string) => (await db.query<{ text: string }>(`select text from docs where uri = $1`, [uri])).rows[0]?.text ?? null

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

  it('tonedSources never gains senado: tone stays null even if a senado doc supplies a tone field', () => {
    assert.ok(!tonedSources.includes('senado'), 'senado must remain an untoned source')
  })

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

describe('insertDoc for the untoned collectors (issues #22, #24, #25)', () => {
  before(seed)
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)

  it('tonedSources stays exactly [gdelt, gkg]', () => {
    assert.deepEqual(tonedSources, ['gdelt', 'gkg'])
  })

  for (const source of ['camara', 'juridico', 'oficial', 'nicho'] as const) {
    it(`a ${source} doc lands with tone = null even if a buggy RawDoc sets a numeric tone`, async () => {
      const uri = `https://example.org/press-tone-${source}`
      await insertDoc({ source, uri, text: `Fulano: teste de tone indevido em ${source}`, publishedAt: now(), tone: 42 }, persons)
      assert.deepEqual(await stored(uri), { source, tone: null })
    })
  }

  for (const [uri, source, person] of [
    ['https://noticias.stf.jus.br/46', 'juridico', 'bolsonaro'],
    ['https://agenciabrasil.ebc.com.br/47', 'oficial', 'lula'],
    ['https://cartacapital.com.br/48', 'nicho', 'bolsonaro'],
  ] as const) {
    it(`the ${source} fixture doc tags exactly ${person}, tone null`, async () => {
      assert.deepEqual(await tagged(uri), [person])
      assert.deepEqual(await stored(uri), { source, tone: null })
    })
  }
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

describe('the longer text wins on a known uri, and its terms are re-derived', () => {
  before(seed)
  const uri = 'https://example.org/syndicated-1'
  const headline = { source: 'gnews' as const, uri, text: 'Lula fala sobre a pauta tributária', publishedAt: now(), domain: 'example.org' }
  const article = {
    source: 'rss' as const,
    uri,
    text: 'Lula fala sobre a pauta tributária. O presidente detalhou a proposta de isenção durante entrevista, citando a arrecadação prevista e o calendário de votação no Congresso.',
    publishedAt: now(),
    domain: 'example.org',
  }

  it('lands the headline first, with the headline terms', async () => {
    assert.equal(await insertDoc(headline, persons), true)
    assert.ok((await termsOf(uri)).includes('tributaria'))
    assert.ok(!(await termsOf(uri)).includes('arrecadacao'))
  })

  it('replaces the stored text when the same uri arrives with the whole article', async () => {
    const before = await rowVersion(uri)
    // Not counted as new: the uri was already known, so `written` stays 0.
    assert.equal(await insertDoc(article, persons), false)
    assert.equal(await textOf(uri), article.text)
    assert.notEqual(await rowVersion(uri), before)
  })

  it('derives the article terms and drops nothing but the stale ones', async () => {
    const stored = await termsOf(uri)
    assert.ok(stored.includes('arrecadacao'), 'a word only the article has must be there')
    assert.ok(stored.includes('tributaria'), 'a word both have must survive')
    assert.deepEqual(stored, [...new Set(stored)].sort(), 'no term may be stored twice')
  })

  it('keeps the person the headline named', async () => {
    assert.equal((await derivedCounts(uri))?.persons, 1)
  })

  it('refuses a shorter text: a truncating feed cannot undo an enrichment', async () => {
    const before = await rowVersion(uri)
    assert.equal(await insertDoc(headline, persons), false)
    assert.equal(await textOf(uri), article.text)
    assert.equal(await rowVersion(uri), before, 'nothing changed, so no row version is written')
  })
})

// Postgres counts characters and JavaScript counts UTF-16 code units, so any non-BMP character
// makes the two disagree. An enrichment measured by comparing them would read as 'unchanged' and
// leave the article's text stored beside the headline's terms.
describe('a document carrying non-BMP characters is still recognised as enriched', () => {
  before(seed)
  const uri = 'https://example.org/syndicated-emoji'
  const headline = { source: 'gnews' as const, uri, text: 'Lula 🇧🇷 fala hoje 😀', publishedAt: now(), domain: 'example.org' }
  const article = {
    source: 'rss' as const,
    uri,
    text: 'Lula 🇧🇷 fala hoje 😀. O presidente tratou da desoneração da folha e prometeu enviar o texto ao Congresso 🇧🇷 ainda neste semestre.',
    publishedAt: now(),
    domain: 'example.org',
  }

  it('disagrees on length, which is why the outcome cannot be measured that way', async () => {
    const { rows } = await db.query<{ len: number }>(`select length($1::text) as len`, [headline.text])
    assert.notEqual(rows[0]?.len, headline.text.length)
  })

  it('replaces the text and rewrites the derived terms', async () => {
    assert.deepEqual(await insertDocs([headline], persons), { written: 1, enriched: 0, failed: 0 })
    assert.ok(!(await termsOf(uri)).includes('desoneracao'))
    assert.deepEqual(await insertDocs([article], persons), { written: 0, enriched: 1, failed: 0 })
    assert.equal(await textOf(uri), article.text)
    assert.ok((await termsOf(uri)).includes('desoneracao'), 'the article terms must reach doc_terms without a reindex')
  })
})

describe('insertDocs counts enrichment apart from new documents', () => {
  before(seed)
  const uri = 'https://example.org/syndicated-2'
  const short = { source: 'gnews' as const, uri, text: 'Bolsonaro comenta o julgamento', publishedAt: now(), domain: 'example.org' }
  const long = {
    source: 'rss' as const,
    uri,
    text: 'Bolsonaro comenta o julgamento. O ex-presidente afirmou que recorrerá da decisão e criticou o relatório apresentado pela acusação na sessão desta semana.',
    publishedAt: now(),
    domain: 'example.org',
  }
  const other = { source: 'rss' as const, uri: 'https://example.org/syndicated-3', text: 'Tarcísio anuncia investimento em Santos', publishedAt: now(), domain: 'example.org' }

  it('reports written for the new one and enriched for the replaced one', async () => {
    assert.deepEqual(await insertDocs([short], persons), { written: 1, enriched: 0, failed: 0 })
    assert.deepEqual(await insertDocs([long, other], persons), { written: 1, enriched: 1, failed: 0 })
  })

  it('counts a replay as neither: the same documents change nothing', async () => {
    assert.deepEqual(await insertDocs([long, other], persons), { written: 0, enriched: 0, failed: 0 })
  })
})

describe('doc_candidates written by insertDoc (issue #32)', () => {
  before(seedCandidates)
  const candidatesOf = async (uri: string) =>
    (await db.query<{ name: string }>(`select c.name from doc_candidates c join docs d on d.id = c.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.name)

  it('AC4: stores the discovered names of a heuristic doc', async () => {
    assert.deepEqual(await candidatesOf('at://did:plc:x/post/c3'), ['hugo motta', 'renan calheiros'])
  })

  it('AC4: stores the column names of a gkg doc, overlay applied, text ignored', async () => {
    assert.deepEqual(await candidatesOf('https://folha.uol.com.br/c4'), ['hugo motta'])
  })

  it('AC4: does not rewrite candidates when the same uri arrives again', async () => {
    const again = await insertDoc({ source: 'rss', uri: 'https://example.org/c1', text: 'Outro texto com Renan Calheiros', publishedAt: now() }, persons)
    assert.equal(again, false)
    assert.deepEqual(await candidatesOf('https://example.org/c1'), ['hugo motta'])
  })

  it('AC4: keeps the existing fixture docs free of candidates that match a tracked alias', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_candidates where name in ('lula', 'tarcisio', 'bolsonaro', 'jair bolsonaro', 'luiz inacio')`)
    assert.equal(rows[0].n, 0)
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
