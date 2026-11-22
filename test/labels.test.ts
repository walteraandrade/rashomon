import { strict as assert } from 'node:assert'
import { before, describe, it } from 'node:test'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { buildTermLabels, labelsFor } from '../src/labels.js'
import { app } from '../src/server.js'
import { insertOrphanDoc, persons, seed } from './fixture.js'
import './close.js'

describe('term labels: the reader spelling of a stored term', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('puts the accents back on a served word the corpus writes with them', async () => {
    const labels = await labelsFor()
    assert.equal(labels.tributaria, 'tributária')
  })

  it('stores only words whose spelling differs from the key', async () => {
    const labels = await labelsFor()
    for (const [term, label] of Object.entries(labels)) if (!term.includes(' ')) assert.notEqual(term, label)
    assert.equal(labels.reforma, undefined)
  })

  it('labels only words some served term uses', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from term_labels l
       where not exists (select 1 from graph_terms g where l.term = any(string_to_array(g.term, ' ')))
         and not exists (select 1 from term_weeks w where l.term = any(string_to_array(w.term, ' ')))`,
    )
    assert.equal(rows[0].n, 0)
  })

  it('GET /api/labels serves the same map', async () => {
    const res = await app.request('/api/labels')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), await labelsFor())
  })
})

describe('term labels: the voting rules', () => {
  const texts = [
    'O STF decide. STF e Flávio em São Paulo, diz o Ministério Público.',
    'O STF julga, Flávio fala, São Paulo vota e o Ministério Público recorre.',
    'Stf mantém prisão; Flávio Bolsonaro viaja a São Paulo.',
    'Eles são bons e são muitos; o órgão é público. Veja https://exemplo.com/sao-paulo-flavio @flavio_x',
    'Flávio diz que a CPI ouve Flávio; a cpi segue em São Paulo.',
    'A CPI vota hoje e a CPI chama o STF.',
    'Erdoğan fala do golpe de Estado; Erdoğan recua.',
  ]
  const served = ['stf', 'flavio', 'cpi', 'sao', 'paulo', 'publico', 'sao paulo', 'ministerio publico', 'erdogan', 'golpe estado']

  before(async () => {
    await seed()
    for (const [i, text] of texts.entries())
      await insertOrphanDoc({ source: 'rss', uri: `https://example.org/labels/${i}`, text, publishedAt: new Date().toISOString(), domain: 'example.org' })
    for (const term of served)
      await db.query(`insert into term_weeks (person_id, term, kind, week, count, c_t) values ('lula', $1, $2, current_date, 2, 2) on conflict do nothing`, [term, term.includes(' ') ? 'phrase' : 'word'])
    await buildTermLabels()
  })

  it('writes a short word in capitals when most of its capitalised uses are capitals, never "Stf"', async () => {
    assert.equal((await labelsFor()).stf, 'STF')
  })

  it('capitalises a word written so nearly always, and not one below that bar', async () => {
    const labels = await labelsFor()
    assert.equal(labels.flavio, 'Flávio')
    assert.equal(labels.cpi, undefined, 'CPI in 3 of 4 uses is below both bars')
  })

  it('spells a phrase whole, so "São Paulo" keeps its capital beside the verb "são"', async () => {
    const labels = await labelsFor()
    assert.equal(labels.sao, 'são')
    assert.equal(labels['sao paulo'], 'São Paulo')
    assert.equal(labels['ministerio publico'], 'Ministério Público')
    assert.equal(labels.publico, 'público')
  })

  it('ignores URLs and handles when voting', async () => {
    assert.equal((await labelsFor()).paulo, 'Paulo')
  })

  it('keys a word by its combining marks stripped, not only Portuguese ones', async () => {
    assert.equal((await labelsFor()).erdogan, 'Erdoğan')
  })

  it('leaves a collocation that skips a stopword to the word-by-word fallback', async () => {
    assert.equal((await labelsFor())['golpe estado'], undefined)
  })
})

describe('term labels: a failed build', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('is logged, never fails the aggregate build, and rolls back to the previous labels', async () => {
    const previous = await labelsFor()
    assert.ok(Object.keys(previous).some((k) => !k.includes(' ')), 'the words were rebuilt before the failure')
    // The phrase insert fails after the delete and the word insert have run.
    await db.exec(`alter table term_labels add constraint no_phrase check (position(' ' in term) = 0) not valid`)
    const warn = console.warn
    const warned: unknown[] = []
    console.warn = (...args: unknown[]) => void warned.push(args[0])
    try {
      await buildGraphAggregates(persons)
    } finally {
      console.warn = warn
      await db.exec('alter table term_labels drop constraint no_phrase')
    }
    assert.ok(warned.some((w) => String(w).includes('[labels] build failed')))
    assert.deepEqual(await labelsFor(), previous)
  })
})
