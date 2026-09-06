import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { graphFor, type GraphQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import { nameTokens } from '../src/extract.js'

const base: GraphQuery = { days: 30, source: 'all', domain: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula] = persons
const nobody = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }
const pmi = (cPt: number, cT: number, n: number, np: number) => Math.round(Math.log2((cPt * n) / (np * cT)) * 100) / 100

describe('signature (issue #6)', () => {
  before(seed)

  it('AC1: default 30-day scope for lula yields exactly the reforma signature', async () => {
    const g = await graphFor(lula, base)
    assert.deepEqual(g.signature, [{ term: 'reforma', kind: 'word', count: 3, pmi: pmi(3, 3, 6, 4) }])
  })

  it('AC2: signature never contains one of the person own name tokens', async () => {
    const excluded = new Set(nameTokens(lula))
    const g = await graphFor(lula, { ...base, days: 2000 })
    assert.ok(g.signature.length > 0, 'sanity: this scope should surface signature terms')
    assert.ok(!g.signature.some((s) => excluded.has(s.term)))
  })

  it('AC3: signature is unaffected by kind, min, limit and sort', async () => {
    const a = await graphFor(lula, base)
    const varied = await graphFor(lula, { ...base, kind: 'hashtag', min: 10, limit: 1, sort: 'pmi' })
    assert.deepEqual(varied.signature, a.signature)
    assert.ok(a.signature.length > 0, 'sanity: variance check is only meaningful with a non-empty signature')
  })

  it('AC4: signature never exceeds 5 entries and is not padded when more terms qualify', async () => {
    const g = await graphFor(lula, { ...base, days: 2000 })
    assert.ok(g.signature.length <= 5)
    const expectedPmi = pmi(3, 3, 16, 14)
    assert.deepEqual(g.signature, [
      { term: 'desemprego', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'educacao', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'inflacao', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'reforma', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'saude', kind: 'word', count: 3, pmi: expectedPmi },
    ])
    assert.ok(
      !g.signature.some((s) => s.term === 'seguranca'),
      'a 6th equally-qualifying term must be dropped by the fixed limit 5, not silently kept',
    )
  })

  it('AC5: signature is empty for a person with stats.about === 0', async () => {
    const g = await graphFor(nobody, base)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.signature, [])
  })

  it('AC6: signature orders by pmi desc, ties broken by term ascending', async () => {
    const g = await graphFor(lula, { ...base, days: 1000 })
    const tie = pmi(3, 3, 13, 11)
    assert.deepEqual(g.signature, [
      { term: 'desemprego', kind: 'word', count: 3, pmi: tie },
      { term: 'inflacao', kind: 'word', count: 3, pmi: tie },
      { term: 'reforma', kind: 'word', count: 3, pmi: tie },
    ])
  })

  it('signature rows expose exactly term, kind, count and pmi, never tone', async () => {
    const g = await graphFor(lula, base)
    assert.ok(g.signature.length > 0)
    for (const row of g.signature) assert.deepEqual(Object.keys(row).sort(), ['count', 'kind', 'pmi', 'term'])
  })
})
