import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import assert from 'node:assert/strict'
import { after, describe, it, before } from 'node:test'
import { db, runSql } from '../src/db.js'
import { docsFor, sourcesFor, type DocsQuery, type GraphQuery } from '../src/graph.js'
import {
  MAX_DOC_CHARS,
  batches,
  derive,
  insertDoc,
  insertDocP,
  insertDocs,
  insertDocsP,
  inTransaction,
  pruneRemovedP,
  tonedSources,
  truncateText,
  upsertAttentionP,
  upsertPersonsP,
  uriLayers,
  writeBatchDocs,
  writeBatchRows,
  writeDerivedP,
  type Derived,
} from '../src/store.js'
import type { RawDoc } from '../src/types.js'
import { candidateDocs, collidingUri, derivedCounts, derivedRows, docs, enrichmentDocs, orphanDocCount, orphanTermCount, persons, reseed, rowVersion, seed, seedCandidates, termsOf, untrackedDocs, untrackedPerson } from './fixture.js'
import { recordingSql } from './effect.js'
import './close.js'

// The write path in src/store.ts. Every suite here layers its own docs on the shared fixture;
// none reads a count the fixture alone would give, so no reseed is needed between them. The
// statement-count suite lives in test/batch-writes.test.ts, because PERF has to be set before
// src/db.ts loads.

const [, tarcisio] = persons
const base: DocsQuery = { term: '', kind: 'all', days: 3100, source: 'all', domain: 'all', lean: 'all', country: 'all', limit: 50, offset: 0, day: '', with: '' }
const now = () => new Date().toISOString()
const stored = async (uri: string) =>
  (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
const textOf = async (uri: string) => (await db.query<{ text: string }>(`select text from docs where uri = $1`, [uri])).rows[0]?.text ?? null
const TABLES = ['docs', 'doc_persons', 'doc_terms', 'doc_candidates', 'doc_tone', 'doc_testimony'] as const
const tableCounts = async () =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n] as const)))

// issue #204
describe('insertDoc country', () => {
  before(seed)
  const countryOf = async (uri: string) => (await db.query<{ country: string | null }>(`select country from docs where uri = $1`, [uri])).rows[0]?.country

  it('sets country from domain with no separate write', async () => {
    await insertDocP({ source: 'rss', uri: 'https://sapo.pt/country', text: 'Lula visita Lisboa', publishedAt: now(), domain: 'sapo.pt' }, persons)
    assert.equal(await countryOf('https://sapo.pt/country'), 'pt')

    await insertDocP({ source: 'rss', uri: 'https://folha.uol.com.br/country', text: 'Lula fala sobre reformas', publishedAt: now(), domain: 'folha.uol.com.br' }, persons)
    assert.equal(await countryOf('https://folha.uol.com.br/country'), 'br')

    await insertDocP({ source: 'rss', uri: 'https://example.org/country-null', text: 'Lula fala sobre economia', publishedAt: now(), domain: 'example.org' }, persons)
    assert.equal(await countryOf('https://example.org/country-null'), null)

    await insertDocP({ source: 'rss', uri: 'https://example.org/country-none', text: 'Lula fala sobre saude', publishedAt: now() }, persons)
    assert.equal(await countryOf('https://example.org/country-none'), null)
  })
})

describe('insertDoc persons', () => {
  const flavio = { id: 'flavio-bolsonaro', name: 'Flávio Bolsonaro', aliases: ['Flávio Bolsonaro'] }
  const family = [...persons, flavio]
  before(async () => (await seed(), upsertPersonsP([flavio])))
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)

  it('tags a Flávio Bolsonaro doc with Flávio only', async () => {
    const uri = 'https://example.org/flavio'
    await insertDocP({ source: 'rss', uri, text: 'Flávio Bolsonaro critica o governo', publishedAt: new Date().toISOString() }, family)
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
    const wideGraph: GraphQuery = { days: 3100, source: 'all', domain: 'all', lean: 'all', country: 'all', kind: 'all', limit: 40, min: 1, sort: 'count', communities: false }
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
    assert.deepEqual(await termsOf('https://example.org/4'), [])
  })

  it('keeps storing the terms of a doc that names a tracked person', async () => {
    assert.ok((await termsOf('https://g1.globo.com/1')).includes('reforma'))
  })

  it('stores nothing for a doc naming no tracked person', async () => {
    const uri = 'https://example.org/untagged'
    const before = await tableCounts()
    assert.equal(await insertDocP({ source: 'rss', uri, text: 'Reunião ouve Hugo Motta sobre a pauta', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons), false)
    assert.equal(await derivedCounts(uri), null)
    assert.deepEqual(await tableCounts(), before)
  })
})

describe('insertDoc senado (issue #25)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  const family = [...persons, alcolumbre]
  before(async () => (await seed(), upsertPersonsP([alcolumbre])))
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)

  it('tonedSources never gains senado: tone stays null even if a senado doc supplies a tone field', () => {
    assert.ok(!tonedSources.includes('senado'), 'senado must remain an untoned source')
  })

  it('tags the speaking senator via the name-prefix, stores terms, and leaves tone null', async () => {
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/111111'
    await insertDocP(
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
      await insertDocP({ source, uri, text: `Lula: teste de tone indevido em ${source}`, publishedAt: now(), tone: 42 }, persons)
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
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: new Date().toISOString(), tone: 2.5 }, persons)
    await insertDocP({ source: 'rss', uri, text: 'Lula visita fábrica', publishedAt: new Date().toISOString() }, persons)
    assert.deepEqual(await stored(uri), { source: 'gkg', tone: 2.5 })
  })

  it('drops a tone handed in for a non-GDELT source', async () => {
    const uri = 'https://example.org/gnews-with-tone'
    await insertDocP({ source: 'gnews', uri, text: 'Lula sanciona lei', publishedAt: new Date().toISOString(), tone: 1 }, persons)
    assert.deepEqual(await stored(uri), { source: 'gnews', tone: null })
  })
})

describe('insertDoc upsert writes only when metadata changes (issue #50)', () => {
  before(seed)
  const [first, enriched] = enrichmentDocs

  it('fills a missing domain when the same uri arrives with one', async () => {
    assert.equal(await insertDocP(first, persons), true)
    const before = await rowVersion(first.uri)
    assert.equal(await insertDocP(enriched, persons), false)
    const { rows } = await db.query<{ domain: string | null }>(`select domain from docs where uri = $1`, [first.uri])
    assert.equal(rows[0].domain, 'example.org')
    assert.notEqual(await rowVersion(first.uri), before)
  })

  it('writes no new row version when the duplicate would change nothing', async () => {
    const before = await rowVersion(enriched.uri)
    assert.equal(await insertDocP(enriched, persons), false)
    assert.equal(await rowVersion(enriched.uri), before)
  })

  it('leaves the derived rows of the first arrival untouched', async () => {
    const counts = await derivedCounts(first.uri)
    assert.equal(counts?.persons, 1)
    assert.ok((counts?.terms ?? 0) > 0)
    await insertDocP(enriched, persons)
    assert.deepEqual(await derivedCounts(first.uri), counts)
  })

  it('still refuses to write a new row version for the colliding gkg/rss pair', async () => {
    const before = await rowVersion(collidingUri)
    assert.equal(await insertDocP({ source: 'gkg', uri: collidingUri, text: 'Tarcísio anuncia obra em Santos', publishedAt: new Date().toISOString(), domain: 'example.org', tone: -3.2 }, persons), false)
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
    await assert.rejects(() => insertDocP(doc, [...persons, phantom]))
    assert.equal(await derivedCounts(uri), null)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [uri])
    assert.equal(rows[0].n, 0)
  })

  it('leaves the connection usable, and the same doc lands once its person exists', async () => {
    await upsertPersonsP([phantom])
    assert.equal(await insertDocP(doc, [...persons, phantom]), true)
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
    assert.deepEqual(await insertDocsP(group, family, 3), { written: 2, enriched: 0, dropped: 0, failed: 1 })
    assert.equal((await derivedCounts(uris[0]))?.persons, 1)
    assert.equal(await derivedCounts(uris[1]), null)
    assert.equal((await derivedCounts(uris[2]))?.persons, 1)
  })

  it('counts a replayed group as nothing new and duplicates no derived row', async () => {
    const counts = await derivedCounts(uris[0])
    assert.deepEqual(await insertDocsP([group[0], group[2]], persons, 2), { written: 0, enriched: 0, dropped: 0, failed: 0 })
    assert.deepEqual(await derivedCounts(uris[0]), counts)
  })

  // A lone UTF-16 surrogate (no partner to pair with) survives as a JS string, but
  // JSON.stringify escapes it as \ud800 and jsonb rejects that escape with 22P02 -- unlike a
  // well-formed string, which round-trips through jsonb unchanged. The per-doc replay isolates
  // it exactly like the foreign-key failure above: the doc itself fails, its group-mate lands.
  it('isolates a doc whose text holds a lone UTF-16 surrogate: it fails, its group-mate lands', async () => {
    const surrogateGroup = [
      { source: 'rss' as const, uri: 'https://example.org/surrogate/a', text: 'lula fala \ud800 sobre a pauta', publishedAt: now(), domain: 'example.org' },
      { source: 'rss' as const, uri: 'https://example.org/surrogate/b', text: 'lula fala sobre a pauta normal', publishedAt: now(), domain: 'example.org' },
    ]
    assert.deepEqual(await insertDocsP(surrogateGroup, persons, 2), { written: 1, enriched: 0, dropped: 0, failed: 1 })
    assert.equal(await derivedCounts(surrogateGroup[0].uri), null)
    assert.equal((await derivedCounts(surrogateGroup[1].uri))?.persons, 1)
  })
})

describe('uriLayers splits duplicate uris into separate, uri-unique layers', () => {
  it('keeps a single layer when every uri is unique', () => {
    const xs = [{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }]
    assert.deepEqual(uriLayers(xs), [xs])
  })

  it('pushes a repeated uri into its own later layer, in order of appearance', () => {
    const a1 = { uri: 'a', n: 1 }
    const b1 = { uri: 'b', n: 2 }
    const a2 = { uri: 'a', n: 3 }
    const a3 = { uri: 'a', n: 4 }
    assert.deepEqual(uriLayers([a1, b1, a2, a3]), [[a1, b1], [a2], [a3]])
  })

  it('returns no layers for an empty list', () => {
    assert.deepEqual(uriLayers([]), [])
  })
})

// A multi-row upsert cannot affect the same uri twice in one statement (uriLayers); the
// batched writer must still land the same outcome as separate insertDocP calls would.
describe('insertDocs replays a duplicate uri within one batch like sequential upserts', () => {
  before(seed)
  const uri = 'https://example.org/dup-in-batch'
  const other = 'https://example.org/dup-in-batch-other'
  const short = { source: 'rss' as const, uri, text: 'Lula fala sobre a reforma', publishedAt: now(), domain: 'example.org' }
  const long = {
    source: 'rss' as const,
    uri,
    text: 'Lula fala sobre a reforma tributaria e detalha o texto enviado ao Congresso nesta semana',
    publishedAt: now(),
    domain: 'example.org',
  }
  const sibling = { source: 'rss' as const, uri: other, text: 'Lula anuncia investimento em Santos', publishedAt: now(), domain: 'example.org' }

  it('counts the first occurrence as written and the later, longer one as enriched', async () => {
    const totals = await insertDocsP([short, sibling, long], persons, 10)
    assert.deepEqual(totals, { written: 2, enriched: 1, dropped: 0, failed: 0 })
    assert.equal(await textOf(uri), long.text)
    assert.ok((await termsOf(uri)).includes('tributaria'))
  })

  it('matches what applying the two docs one insertDocP call at a time would give', async () => {
    const uriB = 'https://example.org/dup-in-batch-sequential'
    const seqA = { source: 'rss' as const, uri: uriB, text: 'Lula fala sobre a reforma', publishedAt: now(), domain: 'example.org' }
    const seqB = {
      source: 'rss' as const,
      uri: uriB,
      text: 'Lula fala sobre a reforma tributaria e detalha o texto enviado ao Congresso nesta semana',
      publishedAt: now(),
      domain: 'example.org',
    }
    const wA = await insertDocP(seqA, persons)
    const wB = await insertDocP(seqB, persons)
    const batchUri = 'https://example.org/dup-in-batch-comparable'
    const batchA = { ...seqA, uri: batchUri }
    const batchB = { ...seqB, uri: batchUri }
    const totals = await insertDocsP([batchA, batchB], persons, 10)
    assert.deepEqual(totals, { written: wA ? 1 : 0, enriched: wB ? 0 : 1, dropped: 0, failed: 0 })
    assert.equal(await textOf(batchUri), await textOf(uriB))
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
    assert.equal(await insertDocP(headline, persons), true)
    assert.ok((await termsOf(uri)).includes('tributaria'))
    assert.ok(!(await termsOf(uri)).includes('arrecadacao'))
  })

  it('replaces the stored text when the same uri arrives with the whole article', async () => {
    const before = await rowVersion(uri)
    // Not counted as new: the uri was already known, so `written` stays 0.
    assert.equal(await insertDocP(article, persons), false)
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
    assert.equal(await insertDocP(headline, persons), false)
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
    assert.deepEqual(await insertDocsP([headline], persons), { written: 1, enriched: 0, dropped: 0, failed: 0 })
    assert.ok(!(await termsOf(uri)).includes('desoneracao'))
    assert.deepEqual(await insertDocsP([article], persons), { written: 0, enriched: 1, dropped: 0, failed: 0 })
    assert.equal(await textOf(uri), article.text)
    assert.ok((await termsOf(uri)).includes('desoneracao'), 'the article terms must reach doc_terms without a reindex')
  })
})

// issue #209: docs.extra_terms is untouched by the upsert's on-conflict clause, so a gkg doc's
// org terms must survive an enrichment even though the incoming rss doc carries no extraTerms
// of its own -- derive must run on the stored row, not the incoming one, or doc_terms drifts
// from what pnpm reindex would recompute.
describe('insertDoc keeps a gkg doc\'s org terms through a later enrichment (issue #209)', () => {
  before(seed)
  const uri = 'https://example.org/org-enrich'
  const gkg = {
    source: 'gkg' as const,
    uri,
    text: 'Lula assina convenio em cerimonia oficial',
    publishedAt: now(),
    domain: 'example.org',
    tone: 0.3,
    extraTerms: [{ term: 'petrobras', kind: 'org' as const }],
  }
  const rss = {
    source: 'rss' as const,
    uri,
    text: 'Lula assina convenio em cerimonia oficial. O presidente detalhou o acordo firmado com o setor produtivo durante a cerimonia realizada na capital.',
    publishedAt: now(),
    domain: 'example.org',
  }

  it('stores the org term from the gkg arrival', async () => {
    assert.equal(await insertDocP(gkg, persons), true)
    assert.ok((await termsOf(uri)).includes('petrobras'))
  })

  it('keeps the org term after a longer rss text enriches the same uri', async () => {
    assert.equal(await insertDocP(rss, persons), false)
    assert.equal(await textOf(uri), rss.text)
    assert.ok((await termsOf(uri)).includes('petrobras'), 'doc_terms must keep the org row docs.extra_terms still holds')
    assert.ok((await termsOf(uri)).includes('acordo'), 'the enriched text\'s own words must still be derived')
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
    assert.deepEqual(await insertDocsP([short], persons), { written: 1, enriched: 0, dropped: 0, failed: 0 })
    assert.deepEqual(await insertDocsP([long, other], persons), { written: 1, enriched: 1, dropped: 0, failed: 0 })
  })

  it('counts a replay as neither: the same documents change nothing', async () => {
    assert.deepEqual(await insertDocsP([long, other], persons), { written: 0, enriched: 0, dropped: 0, failed: 0 })
  })
})

describe('doc_candidates written by insertDoc (issue #32)', () => {
  before(seedCandidates)
  const candidatesOf = async (uri: string) =>
    (await db.query<{ name: string }>(`select c.name from doc_candidates c join docs d on d.id = c.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.name)

  it('stores the discovered names of a heuristic doc', async () => {
    assert.deepEqual(await candidatesOf('at://did:plc:x/post/c3'), ['hugo motta', 'renan calheiros'])
  })

  it('stores the column names of a gkg doc, overlay applied, text ignored', async () => {
    assert.deepEqual(await candidatesOf('https://folha.uol.com.br/c4'), ['hugo motta'])
  })

  it('does not rewrite candidates when the same uri arrives again', async () => {
    const again = await insertDocP({ source: 'rss', uri: 'https://example.org/c1', text: 'Outro texto com Renan Calheiros', publishedAt: now() }, persons)
    assert.equal(again, false)
    assert.deepEqual(await candidatesOf('https://example.org/c1'), ['hugo motta'])
  })

  it('keeps the existing fixture docs free of candidates that match a tracked alias', async () => {
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
    await insertDocP({ source: 'rss', uri, text, publishedAt: new Date().toISOString() }, persons)
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
    await insertDocP({ source: 'rss', uri, text, publishedAt: new Date().toISOString() }, persons)
    assert.equal(await textOf(uri), text)
  })

  it('derives terms from the truncated text, not the original', async () => {
    const uri = 'https://example.org/over-cap-terms'
    await insertDocP({ source: 'rss', uri, text: long('zumbificacao'), publishedAt: new Date().toISOString() }, persons)
    const terms = await termsOf(uri)
    assert.ok(terms.includes('reforma'))
    assert.ok(!terms.includes('zumbificacao'))
  })

  it('applies the same cap through insertDocs', async () => {
    const uri = 'https://example.org/over-cap-bulk'
    const text = long('zumbificacao')
    await insertDocsP([{ source: 'rss', uri, text, publishedAt: new Date().toISOString() }], persons)
    assert.equal(await textOf(uri), truncateText(text))
  })
})

// db.ts's real transaction (sql.withTransaction) and the savepoint nesting it gives inTransaction.
describe('inTransaction nesting: savepoints, not a second begin', () => {
  before(seed)

  const uriOf = (name: string) => `https://example.org/tx-${name}`
  const docNamed = (name: string) => ({ source: 'rss' as const, uri: uriOf(name), text: 'Lula fala sobre a reforma', publishedAt: new Date().toISOString() })
  const exists = async (name: string) => (await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [uriOf(name)])).rows[0].n > 0

  it('inTransaction keeps its <T>(fn: () => Promise<T>) => Promise<T> signature', async () => {
    const result = await inTransaction(async () => 42)
    assert.equal(result, 42)
  })

  it('a nested transaction that throws and is caught rolls back only its own writes', async () => {
    const sentinel = new Error('inner rollback')
    await inTransaction(async () => {
      await insertDocP(docNamed('outer-before'), persons)
      await inTransaction(async () => {
        await insertDocP(docNamed('inner'), persons)
        throw sentinel
      }).catch((e) => {
        if (e !== sentinel) throw e
      })
      await insertDocP(docNamed('outer-after'), persons)
    })
    assert.equal(await exists('outer-before'), true)
    assert.equal(await exists('outer-after'), true)
    assert.equal(await exists('inner'), false)
  })

  it('an outer transaction that throws rolls back both its own and a committed inner\'s writes', async () => {
    const sentinel = new Error('outer rollback')
    await inTransaction(async () => {
      await inTransaction(async () => {
        await insertDocP(docNamed('inner-committed'), persons)
      })
      await insertDocP(docNamed('outer-own'), persons)
      throw sentinel
    }).catch((e) => {
      if (e !== sentinel) throw e
    })
    assert.equal(await exists('inner-committed'), false)
    assert.equal(await exists('outer-own'), false)
  })

  it('a bare db.query call inside the callback sees the transaction\'s own uncommitted rows', async () => {
    let seenInside = false
    const sentinel = new Error('rollback')
    await inTransaction(async () => {
      await insertDocP(docNamed('bare-query'), persons)
      seenInside = await exists('bare-query')
      throw sentinel
    }).catch((e) => {
      if (e !== sentinel) throw e
    })
    assert.equal(seenInside, true, "the transaction's own connection must see its own uncommitted insert")
    assert.equal(await exists('bare-query'), false, 'and it must be rolled back once the callback throws')
  })
})

describe('the write-path behaviours store.ts pins for its single implementation', () => {
  before(seed)

  it('upsertPersons writes a person row', async () => {
    const person = { id: 'lone-person', name: 'Lone', aliases: ['Lone'] }
    await upsertPersonsP([person])
    const rows = (await db.query<{ id: string; name: string; aliases: string[] }>(`select id, name, aliases from persons where id = $1`, [person.id])).rows
    assert.deepEqual(rows, [{ id: person.id, name: person.name, aliases: person.aliases }])
  })

  it('pruneRemoved removes the rows missing from the current list, returning their ids', async () => {
    const kept = { id: 'kept-alongside', name: 'Kept', aliases: ['Kept'] }
    const doomed = { id: 'doomed', name: 'Doomed', aliases: ['Doomed'] }
    await upsertPersonsP([kept, doomed])
    // pruneRemoved wipes every id outside the list it is given, so this checks only that `doomed`
    // is among the removed ids and `kept` isn't -- other describe blocks in this file leave their
    // own orphan rows behind, and this test must not depend on their order.
    const removed = await pruneRemovedP([...persons, kept])
    assert.ok(removed.includes(doomed.id))
    assert.ok(!removed.includes(kept.id))
    const remaining = (await db.query<{ id: string }>(`select id from persons where id = any($1::text[])`, [[kept.id, doomed.id]])).rows.map((r) => r.id)
    assert.deepEqual(remaining, [kept.id])
  })

  it('writeDerived writes doc_persons/doc_terms/doc_candidates rows for a derived doc', async () => {
    const docId = (await db.query<{ id: number }>(`insert into docs (source, uri, text, published_at) values ('rss', 'https://example.org/derived', 'x', now()) returning id`)).rows[0].id
    const derived: Derived = { docId, persons: [persons[0].id], terms: [{ term: 'exemplo', kind: 'word' }], names: ['Fulano De Tal'] }
    await writeDerivedP([derived])
    const rowsFor = async () => ({
      persons: (await db.query<{ person_id: string }>(`select person_id from doc_persons where doc_id = $1 order by 1`, [docId])).rows.map((r) => r.person_id),
      terms: (await db.query<{ term: string; kind: string }>(`select v.term, v.kind from doc_terms t join terms v on v.id = t.term_id where t.doc_id = $1 order by 1, 2`, [docId])).rows,
      names: (await db.query<{ name: string }>(`select name from doc_candidates where doc_id = $1 order by 1`, [docId])).rows.map((r) => r.name),
    })
    assert.deepEqual(await rowsFor(), { persons: [persons[0].id], terms: [{ term: 'exemplo', kind: 'word' }], names: ['Fulano De Tal'] })
  })
})

describe('#211: upsertAttention', () => {
  before(seed)

  it('re-inserting the same (person_id, day) with a different views value updates it in place, never a second row (AC6)', async () => {
    const [lula] = persons
    const day = '2026-01-15'
    await upsertAttentionP([{ person_id: lula.id, day, views: 100 }])
    await upsertAttentionP([{ person_id: lula.id, day, views: 250 }])
    const rows = (await db.query<{ views: number }>(`select views from person_attention where person_id = $1 and day = $2`, [lula.id, day])).rows
    assert.deepEqual(rows, [{ views: 250 }])
  })

  it('removing a person via pruneRemoved deletes her person_attention rows through the FK cascade (AC7)', async () => {
    const doomed = { id: 'doomed-attention', name: 'Doomed', aliases: ['Doomed'] }
    await upsertPersonsP([doomed])
    await upsertAttentionP([{ person_id: doomed.id, day: '2026-01-15', views: 10 }])
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from person_attention where person_id = $1`, [doomed.id])).rows[0].n
    assert.equal(before, 1)
    await pruneRemovedP(persons)
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from person_attention where person_id = $1`, [doomed.id])).rows[0].n
    assert.equal(after, 0)
  })
})

describe('an Effect writer fails with a catchable SqlError, not a flattened rejected Promise', () => {
  before(seed)

  it('insertDoc on a genuine SQL failure (a foreign-key violation) can be caught with Effect.catchTag("SqlError", ...)', async () => {
    const phantom = untrackedPerson('sql-error-catchtag')
    const doc = { source: 'rss' as const, uri: 'https://example.org/sql-error-catchtag', text: `${phantom.name} fala sobre a reforma`, publishedAt: now() }
    const result = await runSql(Effect.catchTag(insertDoc(doc, [phantom]), 'SqlError', () => Effect.succeed('caught' as const)))
    assert.equal(result, 'caught')
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = $1`, [doc.uri])
    assert.equal(rows[0].n, 0, 'the failed transaction must not leave the docs row behind')
  })
})

// One Effect implementation per writer, Promise adapters through runSql (issue 191).
describe('store.ts exposes one Effect implementation per writer, plus its runSql adapter', () => {
  it('pruneRemoved/upsertPersons/writeDerived/insertDoc/insertDocs are Effects, each with a P-suffixed Promise adapter, and no *Effect-suffixed export remains', async () => {
    for (const fn of [pruneRemovedP, upsertPersonsP, writeDerivedP, insertDocP, insertDocsP]) assert.equal(typeof fn, 'function')
    assert.ok(Effect.isEffect(insertDoc({ source: 'rss', uri: 'x', text: 'x', publishedAt: now() }, [])))
    const storeModule = (await import('../src/store.js')) as Record<string, unknown>
    for (const name of ['pruneRemovedEffect', 'upsertPersonsEffect', 'writeDerivedEffect', 'insertDocEffect', 'insertDocsEffect']) {
      assert.ok(!(name in storeModule), `${name} must not be exported`)
    }
  })
})

describe('the fixture through the term dictionary (issue #252)', () => {
  before(seed)
  after(reseed)

  it('seeding the fixture yields the (doc_id, kind, term) set the extractor derives (AC5)', async () => {
    const { rows } = await db.query<{ id: number; uri: string }>(`select id, uri from docs`)
    const stored = docs.filter((d) => rows.some((r) => r.uri === d.uri))
    const fixtureIds = new Set(stored.map((d) => rows.find((r) => r.uri === d.uri)!.id))
    const expected = stored.flatMap((d) => {
      const id = rows.find((r) => r.uri === d.uri)!.id
      return derive(id, d, persons).terms.map((t) => `${id}:${t.kind}:${t.term}`)
    })
    assert.ok(expected.length > 20)
    const actual = (await derivedRows()).terms.filter((k) => fixtureIds.has(Number(k.split(':')[0])))
    assert.deepEqual(new Set(actual), new Set(expected))
    assert.equal(actual.length, new Set(expected).size)
  })
})

// issue #252: the vocabulary is written by the same statement as the rows, so it has no round-trip of its own.
describe('the terms vocabulary (issue #252)', () => {
  before(seed)
  after(reseed)

  const doc = (n: number, text: string) => ({ source: 'rss' as const, uri: `https://example.org/vocab-${n}`, text, publishedAt: new Date().toISOString(), domain: 'example.org' })
  const vocabulary = async (term: string, kind: string) =>
    (await db.query<{ id: number; docs: number }>(
      `select v.id, (select count(*) from doc_terms t where t.term_id = v.id)::int as docs from terms v where v.term = $1 and v.kind = $2`,
      [term, kind],
    )).rows

  it('shares one terms row between docs carrying the same pair (issue #252) (AC7)', async () => {
    await insertDocsP([doc(1, 'Lula visita o unicornioazul'), doc(2, 'Lula elogia o unicornioazul')], persons)
    const first = await vocabulary('unicornioazul', 'word')
    assert.equal(first.length, 1)
    assert.equal(first[0].docs, 2)
    await insertDocP(doc(3, 'Lula cita o unicornioazul de novo'), persons)
    const later = await vocabulary('unicornioazul', 'word')
    assert.deepEqual(later.map((r) => r.id), first.map((r) => r.id), 'a later write reuses the id')
    assert.equal(later[0].docs, 3)
  })

  it('edge 3.6: keeps one text under two kinds as two terms rows (issue #252)', async () => {
    await insertDocP(doc(4, 'Lula fala de #zebraroxa e de zebraroxa'), persons)
    const word = await vocabulary('zebraroxa', 'word')
    const tag = await vocabulary('zebraroxa', 'hashtag')
    assert.equal(word.length, 1)
    assert.equal(tag.length, 1)
    assert.notEqual(word[0].id, tag[0].id)
  })

  it('writes nothing to terms for a doc that names nobody tracked', async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from terms`)).rows[0].n
    await insertDocP(doc(5, 'Ninguem citado aqui, apenas pinguimlaranja'), persons)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from terms`)).rows[0].n, before)
    assert.deepEqual(await vocabulary('pinguimlaranja', 'word'), [])
  })
})

describe('doc_tone follows the writer (issue #272)', () => {
  before(seed)
  after(reseed)
  const toneRow = async (uri: string) =>
    (await db.query<{ tone: number }>(`select dt.tone from doc_tone dt join docs d on d.id = dt.doc_id where d.uri = $1`, [uri])).rows[0]?.tone ?? null

  it('insertDoc writes doc_tone when a later row fills tone', async () => {
    const uri = 'https://example.org/tone-later'
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: now() }, persons)
    assert.equal(await toneRow(uri), null)
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: now(), tone: 2.5 }, persons)
    assert.equal(await toneRow(uri), 2.5)
    assert.equal((await stored(uri)).tone, 2.5)
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: now(), tone: -4 }, persons)
    assert.equal(await toneRow(uri), 2.5, 'the first tone stays in both tables')
    assert.equal((await stored(uri)).tone, 2.5)
  })

  it('a toned gkg doc followed by an rss row with the same uri keeps its row', async () => {
    const uri = 'https://example.org/tone-then-rss'
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: now(), tone: 1.25 }, persons)
    await insertDocP({ source: 'rss', uri, text: 'Lula visita fábrica', publishedAt: now() }, persons)
    assert.equal(await toneRow(uri), 1.25)
  })

  it('insertDoc keeps doc_tone in step when the conflict branch nulls tone', async () => {
    const uri = 'https://example.org/tone-legacy'
    await insertDocP({ source: 'rss', uri, text: 'Lula visita fábrica', publishedAt: now() }, persons)
    await db.query(`update docs set tone = 3 where uri = $1`, [uri])
    await db.query(`insert into doc_tone (doc_id, tone) select id, tone from docs where uri = $1`, [uri])
    assert.equal(await toneRow(uri), 3)
    await insertDocP({ source: 'rss', uri, text: 'Lula visita fábrica em Brasília', publishedAt: now() }, persons)
    assert.equal((await stored(uri)).tone, null)
    assert.equal(await toneRow(uri), null)
  })

  it('a non-toned source never gets a doc_tone row', async () => {
    const uri = 'https://example.org/tone-gnews'
    await insertDocP({ source: 'gnews', uri, text: 'Lula sanciona lei', publishedAt: now(), tone: 1 }, persons)
    assert.equal(await toneRow(uri), null)
    assert.equal(await toneRow(collidingUri), null)
  })

  it('a batch of toned docs writes one row each, in order, duplicates replayed', async () => {
    const uri = 'https://example.org/tone-batch'
    await insertDocsP(
      [
        { source: 'gdelt', uri, text: 'Lula fala', publishedAt: now() },
        { source: 'gdelt', uri, text: 'Lula fala', publishedAt: now(), tone: 0.75 },
      ],
      persons,
    )
    assert.equal(await toneRow(uri), 0.75)
  })
})

describe('insertDoc reach (issue #210)', () => {
  before(seed)

  const reachOf = async (uri: string) =>
    (await db.query<{ reach_likes: number | null; reach_reposts: number | null; reach_replies: number | null; reach_quotes: number | null }>(
      `select reach_likes, reach_reposts, reach_replies, reach_quotes from docs where uri = $1`,
      [uri],
    )).rows[0]
  const post = (uri: string, reach: RawDoc['reach'], extra: Partial<RawDoc> = {}): RawDoc => ({
    source: 'bluesky',
    uri,
    text: 'Lula comenta a pesquisa',
    publishedAt: now(),
    domain: 'ana.bsky.social',
    reach,
    ...extra,
  })

  it('upsertDoc stores the four reach counts', async () => {
    const uri = 'at://did:plc:x/post/reach-1'
    await insertDocP(post(uri, { likes: 3, reposts: 5, replies: 1, quotes: 0 }), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: 3, reach_reposts: 5, reach_replies: 1, reach_quotes: 0 })
  })

  it('upsertDoc keeps the larger reach count per field', async () => {
    const uri = 'at://did:plc:x/post/reach-2'
    await insertDocP(post(uri, { likes: 3, reposts: 5, replies: 1, quotes: 2 }), persons)
    await insertDocP(post(uri, { likes: 1, reposts: 4, replies: 0, quotes: 1 }), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: 3, reach_reposts: 5, reach_replies: 1, reach_quotes: 2 })
    await insertDocP(post(uri, { likes: 1, reposts: 9 }), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: 3, reach_reposts: 9, reach_replies: 1, reach_quotes: 2 })
  })

  it('re-collecting a post with larger reposts updates reach without enriching or touching doc_terms', async () => {
    const uri = 'at://did:plc:x/post/reach-3'
    assert.deepEqual(await insertDocsP([post(uri, { reposts: 1 })], persons), { written: 1, enriched: 0, dropped: 0, failed: 0 })
    const before = await termsOf(uri)
    assert.ok(before.length > 0)
    assert.deepEqual(await insertDocsP([post(uri, { reposts: 50 })], persons), { written: 0, enriched: 0, dropped: 0, failed: 0 })
    assert.equal((await reachOf(uri)).reach_reposts, 50)
    assert.deepEqual(await termsOf(uri), before)
  })

  it('upsertDoc never stores reach for a non-Bluesky doc', async () => {
    const uri = 'https://example.org/reach-gnews'
    await insertDocP(post(uri, { likes: 1, reposts: 2, replies: 3, quotes: 4 }, { source: 'gnews', domain: 'example.org' }), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: null, reach_reposts: null, reach_replies: null, reach_quotes: null })
  })

  it('upsertDoc never adds reach to a uri another source stored first', async () => {
    const uri = 'https://example.org/reach-collision'
    await insertDocP(post(uri, undefined, { source: 'gnews', domain: 'example.org' }), persons)
    await insertDocP(post(uri, { likes: 9, reposts: 9, replies: 9, quotes: 9 }), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: null, reach_reposts: null, reach_replies: null, reach_quotes: null })
  })

  it('upsertDoc stores null for a fractional or negative count', async () => {
    const uri = 'at://did:plc:x/post/reach-4'
    const neighbour = 'at://did:plc:x/post/reach-5'
    const totals = await insertDocsP([post(uri, { likes: 2.5, reposts: -1, replies: 3, quotes: 2 ** 31 }), post(neighbour, { reposts: 8 })], persons)
    assert.deepEqual(totals, { written: 2, enriched: 0, dropped: 0, failed: 0 })
    assert.deepEqual(await reachOf(uri), { reach_likes: null, reach_reposts: null, reach_replies: 3, reach_quotes: null })
    assert.equal((await reachOf(neighbour)).reach_reposts, 8)
  })

  it('a Bluesky post with no counts stays null, not zero', async () => {
    const uri = 'at://did:plc:x/post/reach-6'
    await insertDocP(post(uri, undefined), persons)
    assert.deepEqual(await reachOf(uri), { reach_likes: null, reach_reposts: null, reach_replies: null, reach_quotes: null })
  })
})

describe('the writer keeps only docs naming a tracked person (issue #313)', () => {
  before(seed)
  after(reseed)
  const untracked = (name: string) => untrackedDocs.find((d) => d.uri.endsWith(`/${name}`))!
  const tracked = (n: number, text = `Lula fala sobre a pauta ${n}`): RawDoc => ({ source: 'rss', uri: `https://example.org/tracked-${text.slice(0, 4)}-${n}`, text, publishedAt: now(), domain: 'example.org' })

  it('stores no row for a seeded fixture doc naming nobody, and none lacks a doc_persons row', async () => {
    assert.equal(await textOf('https://example.org/4'), null)
    assert.equal(await textOf('https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/999999'), null)
    assert.equal(await orphanDocCount(), 0)
  })

  it('returns false from insertDoc for a dropped doc and leaves every table as it was', async () => {
    const before = await tableCounts()
    for (const doc of untrackedDocs) assert.equal(await insertDocP(doc, persons), false, doc.uri)
    assert.deepEqual(await tableCounts(), before)
    assert.equal(await derivedCounts(untrackedDocs[0].uri), null)
  })

  it('counts dropped docs apart from written', async () => {
    const batch = [tracked(1), untracked('plain'), tracked(2), untracked('hugo'), tracked(3)]
    assert.deepEqual(await insertDocsP(batch, persons), { written: 3, enriched: 0, dropped: 2, failed: 0 })
    assert.equal(await textOf(untracked('plain').uri), null)
  })

  it('reports a batch of only untracked docs as dropped, with no table touched', async () => {
    const before = await tableCounts()
    assert.deepEqual(await insertDocsP(untrackedDocs, persons), { written: 0, enriched: 0, dropped: untrackedDocs.length, failed: 0 })
    assert.deepEqual(await tableCounts(), before)
  })

  it('judges a doc on its truncated text', async () => {
    const doc = untracked('past-cap')
    assert.ok(doc.text.includes('Lula') && doc.text.length > MAX_DOC_CHARS)
    assert.ok(!truncateText(doc.text).includes('Lula'))
    assert.equal(await insertDocP(doc, persons), false)
    assert.equal(await textOf(doc.uri), null)
  })

  it('judges empty and whitespace text as naming nobody', async () => {
    assert.deepEqual(await insertDocsP([untracked('blank'), { ...untracked('blank'), uri: 'https://untracked.example/empty', text: '' }], persons), { written: 0, enriched: 0, dropped: 2, failed: 0 })
  })

  it('ignores extraNames and extraTerms: only the text makes a doc tracked', async () => {
    const gkg = untracked('gkg-names')
    assert.deepEqual(gkg.extraNames, ['Luiz Inacio'])
    const org = untracked('org')
    assert.ok(org.extraTerms?.length)
    assert.deepEqual(await insertDocsP([gkg, org], persons), { written: 0, enriched: 0, dropped: 2, failed: 0 })
  })

  it('leaves a stored doc untouched when a re-fetch names nobody', async () => {
    const uri = 'https://example.org/refetch-names-nobody'
    await insertDocP({ source: 'gkg', uri, text: 'Lula visita fábrica', publishedAt: now() }, persons)
    const before = { version: await rowVersion(uri), text: await textOf(uri), row: await stored(uri), counts: await derivedCounts(uri) }
    const refetch: RawDoc = { source: 'gkg', uri, text: 'Governo anuncia pacote de obras no litoral e novas medidas para o setor', publishedAt: now(), domain: 'novo.example', tone: 3 }
    assert.deepEqual(await insertDocsP([refetch], persons), { written: 0, enriched: 0, dropped: 1, failed: 0 })
    assert.equal(await rowVersion(uri), before.version)
    assert.equal(await textOf(uri), before.text)
    assert.deepEqual(await stored(uri), before.row)
    assert.deepEqual(await derivedCounts(uri), before.counts)
    const { rows } = await db.query<{ domain: string | null }>(`select domain from docs where uri = $1`, [uri])
    assert.equal(rows[0].domain, null)
  })

  it('judges each occurrence of a repeated uri alone', async () => {
    const uri = 'https://example.org/repeated-uri'
    const nobody: RawDoc = { source: 'rss', uri, text: 'Congresso discute a pauta da semana', publishedAt: now() }
    const somebody: RawDoc = { source: 'rss', uri, text: 'Lula discute a pauta da semana', publishedAt: now() }
    assert.deepEqual(await insertDocsP([nobody, somebody], persons), { written: 1, enriched: 0, dropped: 1, failed: 0 })
    assert.equal(await textOf(uri), somebody.text)
    assert.deepEqual(await insertDocsP([{ ...somebody, uri: `${uri}-b` }, { ...nobody, uri: `${uri}-b` }], persons), { written: 1, enriched: 0, dropped: 1, failed: 0 })
  })

  it('counts a dropped doc once when its group is replayed, and the failing doc as failed', async () => {
    const family = [...persons, untrackedPerson('replay-dropped-count')]
    const group: RawDoc[] = [
      { source: 'rss', uri: 'https://example.org/replay-a', text: 'Congresso discute a pauta da semana', publishedAt: now() },
      { source: 'rss', uri: 'https://example.org/replay-b', text: 'Ciro Gomes fala sobre a reforma', publishedAt: now() },
      { source: 'rss', uri: 'https://example.org/replay-c', text: 'Lula fala sobre a reforma', publishedAt: now() },
    ]
    assert.deepEqual(await insertDocsP(group, family, 3), { written: 1, enriched: 0, dropped: 1, failed: 1 })
  })

  it('sends no document statement for a batch of only untracked docs', async () => {
    const real = await runSql(SqlClient.SqlClient)
    const only = recordingSql(real)
    const totals = await Effect.runPromise(insertDocs(untrackedDocs, persons).pipe(Effect.provideService(SqlClient.SqlClient, only.client)))
    assert.equal(totals.dropped, untrackedDocs.length)
    assert.deepEqual(only.statements, [])

    const mixed = recordingSql(real)
    await Effect.runPromise(insertDocs([untracked('plain'), tracked(9, 'Lula fala sobre o orçamento')], persons).pipe(Effect.provideService(SqlClient.SqlClient, mixed.client)))
    assert.ok(mixed.statements.some((text) => /insert into docs/.test(text)))
  })

  it('judges a Bluesky post with reach on its text, so a dropped post leaves no reach behind', async () => {
    const doc = untrackedDocs.find((d) => d.source === 'bluesky')!
    assert.ok(doc.reach)
    const real = await runSql(SqlClient.SqlClient)
    const only = recordingSql(real)
    await Effect.runPromise(insertDocs([doc], persons).pipe(Effect.provideService(SqlClient.SqlClient, only.client)))
    assert.deepEqual(only.statements, [])
    assert.equal(await textOf(doc.uri), null)
  })

  it('tags a stored tracked doc exactly as derive does, from one match', async () => {
    const doc = tracked(7, 'Lula e Tarcísio disputam a eleição')
    assert.equal(await insertDocP(doc, persons), true)
    const { rows } = await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [doc.uri])
    assert.deepEqual(rows.map((r) => r.person_id), ['lula', 'tarcisio'])
  })
})

describe('the candidate fixture stores whole (issue #313)', () => {
  before(seedCandidates)
  after(reseed)

  it('keeps every candidate doc, since each names a tracked person', async () => {
    assert.equal(await orphanDocCount(), 0)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = any($1::text[])`, [candidateDocs.map((d) => d.uri)])
    assert.equal(rows[0].n, candidateDocs.length)
  })
})
