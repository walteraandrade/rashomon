import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { graphFor, type GraphQuery } from '../src/graph.js'
import { nameTokens } from '../src/extract.js'
import { persons, seed } from './fixture.js'

// Independent verification of issue #6's numbered acceptance criteria. Deliberately uses
// a query shape (kind/min/limit/sort) that differs from graph.test.ts's `base`, so a
// passing AC3 here means real variance was exercised, not an accidental match on shared
// defaults.
const scope: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'word', limit: 5, min: 5, sort: 'pmi' }
const [lula] = persons
const nobody = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }

const isSortedByPmiDescTermAsc = (rows: { term: string; pmi: number }[]) =>
  rows.every((r, i) => i === 0 || rows[i - 1].pmi > r.pmi || (rows[i - 1].pmi === r.pmi && rows[i - 1].term < r.term))

describe('signature acceptance criteria (issue #6)', () => {
  before(seed)

  it('AC1: default 30-day scope for lula returns exactly the spec-pinned reforma row', async () => {
    const g = await graphFor(lula, scope)
    // issue #6's spec-pinned 0.58 becomes 1.49: doc /36 (issue #5's untoned tone fixture; doc /37
    // sits at day 35, just outside this window) widens the person-agnostic n.total to 13, and doc
    // /38 (gkg, about lula, issue #8's press-vs-network fixture) widens it further to 14 and np to
    // 5, shifting pmi = log2(3*14/(5*3)).
    assert.deepEqual(g.signature, [{ term: 'reforma', kind: 'word', count: 3, pmi: 1.49 }])
  })

  it('AC2: signature never contains one of the person own name tokens', async () => {
    const excluded = new Set(nameTokens(lula))
    const g = await graphFor(lula, { ...scope, days: 2000 })
    assert.ok(g.signature.length > 0, 'sanity: this window must yield a non-empty signature to make the check meaningful')
    for (const row of g.signature) assert.ok(!excluded.has(row.term), `${row.term} is a name token and must be excluded`)
  })

  it('AC3: signature is identical regardless of kind, min, limit and sort', async () => {
    const a = await graphFor(lula, scope)
    const b = await graphFor(lula, { ...scope, kind: 'hashtag', min: 999, limit: 1, sort: 'count' })
    const c = await graphFor(lula, { ...scope, kind: 'theme', min: 1, limit: 200, sort: 'pmi' })
    assert.ok(a.signature.length > 0, 'sanity: variance check needs a non-empty signature')
    assert.deepEqual(b.signature, a.signature)
    assert.deepEqual(c.signature, a.signature)
  })

  it('AC4: signature never exceeds 5 entries and drops extra ties instead of padding', async () => {
    const small = await graphFor(lula, scope)
    assert.ok(small.signature.length <= 5)

    const wide = await graphFor(lula, { ...scope, days: 2000 })
    assert.equal(wide.signature.length, 5, 'exactly 5 of the 6 equally-qualifying terms must survive the fixed cap')
    const terms = wide.signature.map((s) => s.term)
    assert.equal(new Set(terms).size, terms.length, 'no duplicate/padded rows')
    assert.ok(!terms.includes('seguranca'), 'the alphabetically-last tied term must be the one dropped by the cap')
  })

  it('AC5: signature deep-equals [] for a person with stats.about === 0', async () => {
    const g = await graphFor(nobody, scope)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.signature, [])
  })

  it('AC6: signature is ordered by pmi desc, ties broken by term asc', async () => {
    const g = await graphFor(lula, { ...scope, days: 1000 })
    assert.ok(g.signature.length > 1, 'sanity: need at least two rows to prove the ordering, not just accept a trivial single-row array')
    assert.ok(isSortedByPmiDescTermAsc(g.signature), `rows are not sorted per spec: ${JSON.stringify(g.signature)}`)
    const pmis = new Set(g.signature.map((s) => s.pmi))
    assert.ok(pmis.size < g.signature.length, 'sanity: this window must actually contain a pmi tie to exercise the term-ascending tiebreak')
  })
})
