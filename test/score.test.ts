import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { testimonyFor } from '../src/graph.js'
import { resolveRun, scoreAll } from '../src/score.js'
import { scorers } from '../src/scorers/index.js'
import { insertDoc } from '../src/store.js'
import { withEnv } from './env.js'
import { insertTestimony, persons, reseed, seed } from './fixture.js'
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

// Issue #67: the method label carried the dtype only, so a retrain republished under the same
// name left every existing row alone and scored only the pairs added since.
const REV = '8f3c1d2'
const OTHER = 'deadbee'
const unversioned = { TESTIMONY_DTYPE: undefined, TESTIMONY_REVISION: undefined }

describe('pnpm score refuses to write unversioned kikori rows', () => {
  it('throws for the onnx scorer when TESTIMONY_REVISION is unset or malformed', async () => {
    await withEnv(unversioned, () => assert.throws(() => resolveRun('onnx'), /TESTIMONY_REVISION/))
    await withEnv({ ...unversioned, TESTIMONY_REVISION: 'a b' }, () =>
      assert.throws(() => resolveRun('onnx'), /TESTIMONY_REVISION/),
    )
  })

  it('resolves the versioned label once the revision is set', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () =>
      assert.equal(resolveRun('onnx').method, `kikori:q8:${REV}`),
    )
  })

  it('never blocks the stub scorer, and still rejects an unknown one', async () => {
    await withEnv(unversioned, () => {
      assert.equal(resolveRun('stub').method, 'stub')
      assert.throws(() => resolveRun('nope'), /unknown scorer/)
    })
  })
})

// The label a `pnpm score` run under that revision would actually resolve, not a hand-written
// string: what the acceptance criterion is about is a revision change producing a new label.
const labelFor = async (revision: string) => {
  let label = ''
  await withEnv({ TESTIMONY_DTYPE: undefined, TESTIMONY_REVISION: revision }, () => {
    label = resolveRun('onnx').method
  })
  return label
}

const overall = async (method: string) => {
  const r = await testimonyFor(persons[1], { days: 30, source: 'all', method, min: 3 })
  assert.equal(r.method, method)
  return r.overall
}

describe('a revision change re-scores every pair and leaves the old rows readable', () => {
  before(async () => {
    // The suite above already wrote kikori:q8 rows for every pair; start from the fixture again.
    await reseed()
    // What a store scored before this issue looks like: rows under the bare dtype label.
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'kikori:q8', 1)
    await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'kikori:q8', 3)
  })

  it('scores every pair under the first revision, then every pair again under the second', async () => {
    const pairs = Number((await db.query<{ n: string }>(`select count(*) as n from doc_persons`)).rows[0].n)
    const [first, second] = [await labelFor(REV), await labelFor(OTHER)]
    assert.notEqual(first, second, 'a revision change must produce a distinct method label')

    assert.equal(await scoreAll(first, scorers.stub), pairs)
    assert.equal(
      await scoreAll(second, scorers.stub),
      pairs,
      'the second revision must re-score every pair, not just the ones added since the first run',
    )

    assert.equal(Number(await countRows(first)), pairs)
    assert.equal(Number(await countRows(second)), pairs)
  })

  it('answers each revision from its own rows and keeps the pre-issue rows intact', async () => {
    const legacy = await overall('kikori:q8')
    assert.deepEqual(legacy, { score: 2, n: 2 }, 'the two unversioned rows survive both runs untouched')

    const a = await overall(await labelFor(REV))
    const b = await overall(await labelFor(OTHER))
    assert.ok(a.n > 0 && b.n > 0)
    assert.deepEqual(a, b, 'the same scorer under two revisions must give the same numbers, from separate rows')
    assert.notDeepEqual(a, legacy, 'and neither may be answered from the unversioned rows')

    assert.deepEqual(await overall('kikori:q8:never-scored'), { score: null, n: 0 })
  })
})
