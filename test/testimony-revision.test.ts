import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { parseTestimonyQuery } from '../src/query.js'
import { resolveRun, scoreAll } from '../src/score.js'
import { methods, scorers } from '../src/scorers/index.js'
import { modelRevision } from '../src/scorers/method.js'
import { app } from '../src/server.js'
import { withEnv } from './env.js'
import { insertTestimony, seed } from './fixture.js'
import './close.js'

// Issue #67: the method label carried the dtype only, so a retrain republished under the same
// name left every existing row alone and scored only the pairs added since — two models under
// one label, with nothing recording the split.

const REV = '8f3c1d2'
const OTHER = 'deadbee'
const unversioned = { TESTIMONY_DTYPE: undefined, TESTIMONY_REVISION: undefined }

describe('kikori method label carries the model revision', () => {
  it('is kikori:<dtype>:<revision> when TESTIMONY_REVISION is set', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () => {
      assert.equal(modelRevision(), REV)
      assert.equal(methods.onnx(), `kikori:q8:${REV}`)
    })
    await withEnv({ TESTIMONY_DTYPE: 'fp32', TESTIMONY_REVISION: REV }, () =>
      assert.equal(methods.onnx(), `kikori:fp32:${REV}`),
    )
  })

  it('stays kikori:<dtype> when unset, so rows scored before this existed keep matching', async () => {
    await withEnv(unversioned, () => {
      assert.equal(modelRevision(), '')
      assert.equal(methods.onnx(), 'kikori:q8')
    })
  })

  it('treats a revision outside the charset as unset, never as part of the label', async () => {
    const bad = ['a b', 'a:b', 'a/b', '', 'x'.repeat(65), 'rev#1']
    await Promise.all(
      bad.map((v) =>
        withEnv({ ...unversioned, TESTIMONY_REVISION: v }, () => {
          assert.equal(modelRevision(), '', `${JSON.stringify(v)} must not reach the label`)
          assert.equal(methods.onnx(), 'kikori:q8')
        }),
      ),
    )
  })

  it('leaves the stub label alone: it is a pure function with no model behind it', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () => assert.equal(methods.stub(), 'stub'))
  })
})

describe('a versioned label survives the method parser whole', () => {
  it('resolves as the route default, with no silent fallback to kikori:q8', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () =>
      assert.equal(parseTestimonyQuery({}).method, `kikori:q8:${REV}`),
    )
  })

  it('keeps an explicit ?method pinned to another revision than the server default', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: OTHER }, () =>
      assert.equal(parseTestimonyQuery({ method: `kikori:q8:${REV}` }).method, `kikori:q8:${REV}`),
    )
  })
})

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

const countRows = async (method: string) =>
  Number((await db.query<{ n: string }>(`select count(*) as n from doc_testimony where method = $1`, [method])).rows[0].n)

const overall = async (method: string) => {
  const res = await app.request(`/api/people/tarcisio/testimony?method=${encodeURIComponent(method)}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
  assert.equal(body.method, method)
  return body.overall
}

describe('a revision change re-scores every pair and leaves the old rows readable', () => {
  before(async () => {
    await seed()
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

    assert.equal(await countRows(first), pairs)
    assert.equal(await countRows(second), pairs)
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
