import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { insertTestimony, seed } from './fixture.js'

// Regression for the kikori method label: `kikori:<dtype>` contains a `:`, which the
// method parser used to reject, silently answering with the placeholder `onnx` rows.
describe('GET /api/people/:id/testimony with a kikori method label', () => {
  before(async () => {
    await seed()
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'kikori:q8', 1)
    await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'kikori:q8', 3)
    await insertTestimony('https://estadao.com.br/32', 'tarcisio', 'kikori:fp32', 8)
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'onnx', -9)
  })

  it('keeps kikori:q8 and answers from its rows only', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?method=kikori:q8')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
    assert.equal(body.method, 'kikori:q8')
    assert.deepEqual(body.overall, { score: 2, n: 2 })
  })

  it('keeps kikori:fp32 and never mixes it with the q8 or onnx rows', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?method=kikori:fp32')
    const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
    assert.equal(body.method, 'kikori:fp32')
    assert.deepEqual(body.overall, { score: 8, n: 1 })
  })

  it('still answers the placeholder onnx rows when onnx is requested', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?method=onnx')
    const body = (await res.json()) as { method: string; overall: { score: number | null; n: number } }
    assert.equal(body.method, 'onnx')
    assert.deepEqual(body.overall, { score: -9, n: 1 })
  })

  it('falls back to onnx for a method outside the charset', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?method=kikori%20q8!')
    const body = (await res.json()) as { method: string }
    assert.equal(body.method, 'onnx')
  })
})
