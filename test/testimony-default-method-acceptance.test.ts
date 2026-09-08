import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { parseTestimonyQuery } from '../src/query.js'
import { methods } from '../src/scorers/index.js'
import { insertTestimony, seed } from './fixture.js'

// Independent verification of issue #35, written from the issue's acceptance criteria. The
// point of the issue is that two values must never drift apart: the label `pnpm score` writes
// and the label the route reads by default. So the assertions compare the route against the
// `methods` map itself, not against a hardcoded string, except where the issue names the
// literal (`kikori:q8` with no env, `kikori:fp32` under TESTIMONY_DTYPE=fp32).

type Body = { method: string; overall: { score: number | null; n: number }; by_source: unknown[]; by_domain: unknown[] }

const testimony = async (query = '') => (await (await app.request(`/api/people/tarcisio/testimony${query}`)).json()) as Body

const withDtype = async <T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> => {
  const previous = process.env.TESTIMONY_DTYPE
  if (value === undefined) delete process.env.TESTIMONY_DTYPE
  else process.env.TESTIMONY_DTYPE = value
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.TESTIMONY_DTYPE
    else process.env.TESTIMONY_DTYPE = previous
  }
}

describe('testimony default method, independently verified (issue #35)', () => {
  before(async () => {
    await seed()
    // Three coexisting label sets on the same person: the retired placeholder and both kikori
    // dtypes. Distinct scores make any cross-label leak visible in `overall`.
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'onnx', -9)
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'kikori:q8', 1)
    await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'kikori:q8', 3)
    await insertTestimony('https://estadao.com.br/32', 'tarcisio', 'kikori:fp32', 8)
  })

  it('AC1: with no ?method and no env, the route answers under kikori:q8 — the same label pnpm score writes', async () => {
    await withDtype(undefined, async () => {
      assert.equal(methods.onnx(), 'kikori:q8', 'the scorer map itself must default to kikori:q8')
      const body = await testimony()
      assert.equal(body.method, 'kikori:q8')
      assert.equal(body.method, methods.onnx(), 'route default and scorer label must be the same value, not two literals')
      assert.deepEqual(body.overall, { score: 2, n: 2 }, 'the default must read the kikori:q8 rows, not the placeholder ones')
    })
  })

  it('AC1: TESTIMONY_DTYPE moves the default with the scorer, in the same request', async () => {
    await withDtype('fp32', async () => {
      const body = await testimony()
      assert.equal(body.method, 'kikori:fp32')
      assert.equal(body.method, methods.onnx())
      assert.deepEqual(body.overall, { score: 8, n: 1 })
    })
    // Resolution is per call, not frozen at import: flipping back must flip the answer back.
    await withDtype(undefined, async () => assert.equal((await testimony()).method, 'kikori:q8'))
  })

  it('AC2: an explicit ?method still wins over the resolved default, for any label', async () => {
    await withDtype('fp32', async () => {
      assert.equal((await testimony('?method=stub')).method, 'stub')
      assert.equal((await testimony('?method=kikori:q8')).method, 'kikori:q8')
    })
    const stub = await testimony('?method=stub')
    assert.equal(stub.method, 'stub')
    assert.ok(stub.overall.n > 0, 'stub is the fixture scorer; its rows must still be reachable')
  })

  it('AC2: the response keeps the { method, overall, by_source, by_domain } shape', async () => {
    const body = await testimony()
    assert.deepEqual(Object.keys(body).sort(), ['by_domain', 'by_source', 'method', 'overall'])
    assert.deepEqual(Object.keys(body.overall).sort(), ['n', 'score'])
  })

  it('AC5: the retired placeholder rows are kept and stay reachable with ?method=onnx, never mixed into kikori', async () => {
    const placeholder = await testimony('?method=onnx')
    assert.equal(placeholder.method, 'onnx')
    assert.deepEqual(placeholder.overall, { score: -9, n: 1 }, 'the old onnx rows must still answer, unchanged')
    await withDtype(undefined, async () => {
      const q8 = await testimony()
      assert.notEqual(q8.overall.score, placeholder.overall.score, 'kikori:q8 must not absorb the placeholder row')
      assert.deepEqual(q8.overall, { score: 2, n: 2 })
    })
  })

  it('AC2: an unscored label answers the empty shape, not a 404', async () => {
    const body = await testimony('?method=never-scored-under-this-label')
    assert.equal(body.method, 'never-scored-under-this-label')
    assert.deepEqual(body.overall, { score: null, n: 0 })
    assert.deepEqual(body.by_source, [])
    assert.deepEqual(body.by_domain, [])
  })

  it('AC1: a ?method outside the charset or over 128 chars falls back to the resolved default, never to a stale literal', async () => {
    await withDtype(undefined, () => {
      assert.equal(parseTestimonyQuery({ method: 'x'.repeat(129) }).method, 'kikori:q8')
      assert.equal(parseTestimonyQuery({ method: 'bad method!' }).method, 'kikori:q8')
      assert.equal(parseTestimonyQuery({ method: '' }).method, 'kikori:q8')
      assert.equal(parseTestimonyQuery({ method: 'x'.repeat(128) }).method, 'x'.repeat(128), '128 chars is still inside the charset')
    })
    await withDtype('fp32', () => assert.equal(parseTestimonyQuery({ method: 'bad method!' }).method, 'kikori:fp32'))
  })
})
