import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { parseTestimonyQuery } from '../src/query.js'
import { methods } from '../src/scorers/index.js'
import { withEnv } from './env.js'
import { insertTestimony, seed } from './fixture.js'

// Issue #35: the route's default method must resolve through the same `methods` map
// pnpm score uses, not the retired `onnx` placeholder literal.

// TESTIMONY_REVISION is cleared too: once set it appends a third segment to the label
// (issue #67), and every expectation here is about the unversioned one.
const withDtype = (value: string | undefined, run: () => void | Promise<void>) =>
  withEnv({ TESTIMONY_DTYPE: value, TESTIMONY_REVISION: undefined }, run)

describe('testimony default method (issue #35)', () => {
  before(async () => {
    await seed()
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'kikori:q8', 1)
    await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'kikori:q8', 3)
    await insertTestimony('https://estadao.com.br/32', 'tarcisio', 'kikori:fp32', 8)
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'onnx', -9)
  })

  it('with no ?method and no TESTIMONY_DTYPE, the route resolves to kikori:q8, the same label pnpm score writes by default', async () =>
    withDtype(undefined, async () => {
      assert.equal(methods.onnx(), 'kikori:q8', 'sanity: the methods map itself must default to kikori:q8')
      const res = await app.request('/api/people/tarcisio/testimony')
      const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
      assert.equal(body.method, 'kikori:q8')
      assert.deepEqual(body.overall, { score: 2, n: 2 }, 'reads the kikori:q8 rows, not the placeholder onnx ones')
    }))

  it('TESTIMONY_DTYPE=fp32 moves the default to kikori:fp32, matching what pnpm score would write under the same env', async () =>
    withDtype('fp32', async () => {
      assert.equal(methods.onnx(), 'kikori:fp32')
      const res = await app.request('/api/people/tarcisio/testimony')
      const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
      assert.equal(body.method, 'kikori:fp32')
      assert.deepEqual(body.overall, { score: 8, n: 1 })
    }))

  it('an explicit ?method still wins over the resolved default, in any env', async () =>
    withDtype('fp32', async () => {
      const stub = await app.request('/api/people/tarcisio/testimony?method=stub')
      const stubBody = (await stub.json()) as { method: string }
      assert.equal(stubBody.method, 'stub')

      const onnx = await app.request('/api/people/tarcisio/testimony?method=onnx')
      const onnxBody = (await onnx.json()) as { method: string; overall: { score: number | null; n: number } }
      assert.equal(onnxBody.method, 'onnx')
      assert.deepEqual(onnxBody.overall, { score: -9, n: 1 }, 'the retired placeholder rows are kept and stay reachable by name')
    }))

  it('parseTestimonyQuery resolves the same default directly, without going through HTTP', async () => {
    await withDtype(undefined, () => assert.equal(parseTestimonyQuery({}).method, 'kikori:q8'))
    await withDtype('fp32', () => assert.equal(parseTestimonyQuery({}).method, 'kikori:fp32'))
  })
})
