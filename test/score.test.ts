import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { scoreAll } from '../src/score.js'
import { scorers } from '../src/scorers/index.js'
import { insertDoc } from '../src/store.js'
import { persons, seed } from './fixture.js'
import './close.js'

const countRows = async (method: string) =>
  (await db.query<{ n: string }>(`select count(*) as n from doc_testimony where method = $1`, [method])).rows[0].n

describe('scoreAll', () => {
  before(seed)

  it('scores every previously-unscored (doc, person) pair under a new method, then scores zero more on a second call', async () => {
    const before = Number(await countRows('stub-fresh'))
    assert.equal(before, 0)
    const pairsTotal = (await db.query<{ n: string }>(`select count(*) as n from doc_persons`)).rows[0].n
    const scored = await scoreAll('stub-fresh', scorers.stub)
    assert.equal(scored, Number(pairsTotal))
    assert.equal(Number(await countRows('stub-fresh')), Number(pairsTotal))

    const again = await scoreAll('stub-fresh', scorers.stub)
    assert.equal(again, 0, 'a second call with no new docs/persons must score zero additional pairs')
    assert.equal(Number(await countRows('stub-fresh')), Number(pairsTotal))
  })

  it('is deterministic: the same (text, person) always yields the same score', async () => {
    const score = await scorers.stub('Tarcísio discute geopolítica durante evento internacional', persons[1])
    const scoreAgain = await scorers.stub('Tarcísio discute geopolítica durante evento internacional', persons[1])
    assert.equal(score, scoreAgain)
  })

  it('inserts a null row (not a missing one) for empty/whitespace text, and never re-attempts it', async () => {
    const uri = 'https://example.org/empty-text-doc'
    await insertDoc({ source: 'rss', uri, text: '   ', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
    // insertDoc only links doc_persons for docs that mention a tracked person's alias, so link
    // it directly to exercise scoreAll's null-score path deterministically
    const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [uri])
    await db.query(`insert into doc_persons values ($1, $2) on conflict do nothing`, [rows[0].id, persons[0].id])

    const scored = await scoreAll('stub-empty', scorers.stub)
    assert.ok(scored >= 1)
    const row = await db.query<{ score: number | null }>(
      `select score from doc_testimony where doc_id = $1 and person_id = $2 and method = 'stub-empty'`,
      [rows[0].id, persons[0].id],
    )
    assert.equal(row.rows[0].score, null)

    const again = await scoreAll('stub-empty', scorers.stub)
    assert.equal(again, 0, 'the null-scored pair must not be retried')
  })
})

describe('scoreAll across methods', () => {
  before(seed)

  it('re-scores pairs whose only row is from another method (placeholder `onnx` never satisfies `kikori:q8`)', async () => {
    const pairsTotal = Number((await db.query<{ n: string }>(`select count(*) as n from doc_persons`)).rows[0].n)
    await scoreAll('onnx', scorers.stub)
    assert.equal(Number(await countRows('onnx')), pairsTotal)
    const scored = await scoreAll('kikori:q8', scorers.stub)
    assert.equal(scored, pairsTotal)
    assert.equal(Number(await countRows('onnx')), pairsTotal, 'the old rows stay untouched')
    assert.equal(Number(await countRows('kikori:q8')), pairsTotal)
  })
})
