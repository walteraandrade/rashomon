import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { reindexAll } from '../src/reindex.js'
import { ANALYZED_TABLES } from '../src/db.js'
import { lastAnalyzed, orphanTermCount, planRowEstimate, termsOf, persons, seed } from './fixture.js'

// Reindex is destructive (it clears doc_terms/doc_persons/doc_candidates and rebuilds them),
// so it lives in its own file: node:test runs one process per file, hence its own database.
describe('reindex skips terms of docs naming nobody tracked (issue #52)', () => {
  const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
  before(seed)

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

  it('indexes the terms of a doc that only matches after a person is added', async () => {
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/999999'
    await reindexAll(persons)
    assert.deepEqual(await termsOf(uri), [])
    await reindexAll([...persons, alcolumbre])
    assert.ok((await termsOf(uri)).includes('soberania'))
    assert.equal(await orphanTermCount(), 0)
  })

  it('purge orphan-terms deletes exactly the rows reindex would not write', async () => {
    await reindexAll(persons)
    const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, ['https://example.org/4'])
    await db.query(`insert into doc_terms values ($1, 'congresso', 'word')`, [rows[0].id])
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
