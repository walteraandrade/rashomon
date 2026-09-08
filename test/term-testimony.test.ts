import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { parseQuery } from '../src/query.js'
import { seed } from './fixture.js'

// `testimony=1` on GET /api/people/:id/graph: the per-term kikori mean (docs in `about` that
// carry the term) plus the person's own mean over the same scope, both under the same label
// /testimony would answer with. Off by default, so the existing response shape is untouched.

const graph = async (qs: string) => {
  const res = await app.request(`/api/people/tarcisio/graph?${qs}`)
  assert.equal(res.status, 200)
  return res.json()
}

describe('GET /graph?testimony=1', () => {
  before(() => seed())

  it('is off by default: no node and no stats carries a testimony field', async () => {
    const g = await graph('days=30')
    assert.ok(g.nodes.length > 0)
    for (const n of g.nodes) assert.equal('testimony' in n, false)
    assert.equal('testimony' in g.stats, false)
  })

  it('parseQuery leaves method null unless testimony=1, then resolves the label like /testimony does', () => {
    assert.equal(parseQuery({}).method, null)
    assert.equal(parseQuery({ testimony: '1', method: 'stub' }).method, 'stub')
    assert.equal(parseQuery({ testimony: '1', method: 'bad label!' }).method, parseQuery({ testimony: '1' }).method)
    assert.equal(parseQuery({ testimony: 'yes', method: 'stub' }).method, null)
  })

  it('averages the stub scores of the docs behind each term and the person over the same scope', async () => {
    const g = await graph('days=30&testimony=1&method=stub&limit=200&min=1')
    // Tarcísio's scored docs in the window: 30 (4), 31 (6), 32 (2), 33 (5), 34 (-1), 35 (-8); 36 is null.
    assert.deepEqual(g.stats.testimony, { method: 'stub', score: 1.33, n: 6 })
    const by = (term: string) => g.nodes.find((n: { term: string }) => n.term === term)
    assert.deepEqual(by('geopolitica').testimony, { score: 4, n: 3 }, 'docs 30, 31, 32')
    assert.deepEqual(by('commodities').testimony, { score: 2, n: 2 }, 'docs 33, 34')
    assert.deepEqual(by('portuaria').testimony, { score: -8, n: 1 }, 'doc 35')
    const embaixadores = by('embaixadores')
    assert.ok(embaixadores, 'doc 36 is in the recorte')
    assert.equal(embaixadores.testimony, null, 'its only doc has a null score, so the term has no testimony')
  })

  it('an unscored label answers nulls, not an error', async () => {
    const g = await graph('days=30&testimony=1&method=nobody:ever')
    assert.deepEqual(g.stats.testimony, { method: 'nobody:ever', score: null, n: 0 })
    for (const n of g.nodes) assert.equal(n.testimony, null)
  })

  it('the person mean follows the domain filter, unlike /testimony', async () => {
    const g = await graph('days=30&testimony=1&method=stub&domain=estadao.com.br')
    assert.deepEqual(g.stats.testimony, { method: 'stub', score: 4, n: 3 })
  })
})
