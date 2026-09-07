import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db, migrate } from '../src/db.js'
import { docsFor, type DocsQuery } from '../src/graph.js'
import { insertDoc, upsertPersons } from '../src/store.js'
import { collidingUri, persons, seed } from './fixture.js'

const [, tarcisio] = persons
const base: DocsQuery = { term: '', kind: 'all', days: 3100, source: 'all', domain: 'all', limit: 50, offset: 0 }
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

describe('insertDoc senado (issue #25)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  const family = [...persons, alcolumbre]
  before(async () => (await seed(), upsertPersons([alcolumbre])))
  const tagged = async (uri: string) =>
    (await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.person_id)
  const termsOf = async (uri: string) =>
    (await db.query<{ term: string }>(`select t.term from doc_terms t join docs d on d.id = t.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.term)

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
