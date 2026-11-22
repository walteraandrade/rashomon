import { strict as assert } from 'node:assert'
import { before, describe, it } from 'node:test'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { labelsFor } from '../src/labels.js'
import { app } from '../src/server.js'
import { persons, seed } from './fixture.js'
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
    for (const [term, label] of Object.entries(labels)) assert.notEqual(term, label)
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
