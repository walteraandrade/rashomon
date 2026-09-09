import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { compareFor, graphFor, type CompareQuery, type GraphQuery } from '../src/graph.js'
import { parseCompareQuery, parseQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'
import './close.js'

// Verifier suite for issue #93's numbered acceptance criteria (spec §5), written from the
// spec, independently of test/compare.test.ts and test/compare-api-acceptance.test.ts. Every
// expected figure below is either derived at runtime from graphFor (the formula compareFor
// must reuse, per spec §3) or asserted structurally, rather than pinned to a hand-computed
// literal, so this suite fails if compareFor's numbers ever drift from graphFor's.

const lula = persons.find((p) => p.id === 'lula')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const tarcisio = persons.find((p) => p.id === 'tarcisio')!

const base: CompareQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40 }
const gbase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 200, min: 1, sort: 'count' }
const row = (r: Awaited<ReturnType<typeof compareFor>>, term: string, kind = 'word') => r.terms.find((t) => t.term === term && t.kind === kind)

describe('compareFor: issue #93 acceptance criteria', () => {
  before(seed)

  it('AC5: a.about matches graphFor(a, sameQuery).stats.about, unfiltered by term/kind', async () => {
    const gLula = await graphFor(lula, parseQuery({}))
    const gBolsonaro = await graphFor(bolsonaro, parseQuery({}))
    const r = await compareFor(lula, bolsonaro, base)
    assert.equal(r.a.about, gLula.stats.about)
    assert.equal(r.b.about, gBolsonaro.stats.about)
    // sanity: about really is not zero for lula and really is zero for bolsonaro at these
    // defaults, or the equality above would hold trivially
    assert.ok(r.a.about > 0)
    assert.equal(r.b.about, 0)
  })

  it('AC6: a term present in the fixture only for lula gets a real figure under a and null under b', async () => {
    const gLula = await graphFor(lula, { ...gbase, min: 1 })
    const node = gLula.nodes.find((n) => n.term === 'reforma' && n.kind === 'word')!
    assert.ok(node, 'fixture assumption: lula has a "reforma" word node')
    const r = await compareFor(lula, bolsonaro, base)
    const term = row(r, 'reforma')!
    assert.deepEqual(term.a, { count: node.count, pmi: node.pmi, tone: node.tone })
    assert.equal(term.b, null)
    assert.notDeepEqual(term.b, { count: 0, pmi: 0, tone: null })
  })

  it('AC7: symmetrically, a term only tarcisio\'s docs carry reads real for a and null for b', async () => {
    const gTarcisio = await graphFor(tarcisio, { ...gbase, min: 1 })
    const node = gTarcisio.nodes.find((n) => n.term === 'geopolitica' && n.kind === 'word')!
    assert.ok(node, 'fixture assumption: tarcisio has a "geopolitica" word node lula never mentions')
    const r = await compareFor(tarcisio, lula, base)
    const term = row(r, 'geopolitica')!
    assert.deepEqual(term.a, { count: node.count, pmi: node.pmi, tone: node.tone })
    assert.equal(term.b, null)
  })

  it('AC8: a side\'s own name word reads "name" while the same term may be real vocabulary for the other side', async () => {
    // doc /2 ("Lula e Tarcísio disputam a eleição") makes "tarcisio" ordinary vocabulary in
    // lula's docs, while it is tarcisio's own name word
    const r = await compareFor(tarcisio, lula, base)
    const term = row(r, 'tarcisio')!
    assert.equal(term.a, 'name')
    const gLula = await graphFor(lula, { ...gbase, min: 1 })
    const node = gLula.nodes.find((n) => n.term === 'tarcisio' && n.kind === 'word')!
    assert.ok(node, 'fixture assumption: lula has a "tarcisio" word node')
    assert.deepEqual(term.b, { count: node.count, pmi: node.pmi, tone: node.tone })
  })

  it('AC9: an overlapping term\'s a figure matches graphFor(a, ...) exactly (count, pmi, tone)', async () => {
    const g = await graphFor(lula, parseQuery({}))
    const node = g.nodes.find((n) => n.term === 'reforma' && n.kind === 'word')!
    const r = await compareFor(lula, bolsonaro, base)
    assert.deepEqual(row(r, 'reforma')!.a, { count: node.count, pmi: node.pmi, tone: node.tone })
  })

  it('AC10: a === b returns an identical value under a and b for every term', async () => {
    // "name" entries never actually surface here: a person's own name words are excluded from
    // term_p before the top-count/top-pmi selection runs (compareSideCte), so when a and b are
    // the same person, both sides' four selection lists are built from the same name-excluded
    // pool and can never select that person's own name word into the union in the first place.
    // The deep-equal invariant the spec asserts (a === b) still holds vacuously for that case.
    const r = await compareFor(lula, lula, { ...base, days: 365 })
    assert.ok(r.terms.length > 0)
    for (const t of r.terms) assert.deepEqual(t.a, t.b)
  })

  it('AC11: limit=1 unions both the count-ranked and pmi-ranked top-1 per side, not just one', async () => {
    // scoped to a domain used by no other fixture doc: bolsonaro's own top-count term
    // ("termdiluido", count 3, diluted pmi because lula also uses it) genuinely differs from
    // bolsonaro's own top-pmi term ("cita", count 1, exclusive) -- proving the union is not
    // merely "each side's single best term" but both selection criteria per side
    const q: CompareQuery = { days: 3650, source: 'all', domain: 'testcorp.example', lean: 'all', kind: 'all', limit: 1 }
    const gCount = await graphFor(bolsonaro, { days: 3650, source: 'all', domain: 'testcorp.example', lean: 'all', kind: 'all', limit: 1, min: 1, sort: 'count' })
    const gPmi = await graphFor(bolsonaro, { days: 3650, source: 'all', domain: 'testcorp.example', lean: 'all', kind: 'all', limit: 1, min: 1, sort: 'pmi' })
    assert.notEqual(gCount.nodes[0]?.term, gPmi.nodes[0]?.term, 'fixture assumption: bolsonaro\'s own top-count and top-pmi terms differ at this scope')
    const r = await compareFor(bolsonaro, lula, q)
    assert.ok(r.terms.length > 1, 'both selection criteria must contribute distinct keys')
    assert.ok(r.terms.some((t) => t.term === gCount.nodes[0]!.term), 'the count-ranked top-1 must survive the union')
    assert.ok(r.terms.some((t) => t.term === gPmi.nodes[0]!.term), 'the pmi-ranked top-1 must survive the union')
  })

  it('AC12: terms is ordered by term asc, then kind asc', async () => {
    // "reforma" is both a hashtag and a word for lula in the default window
    const r = await compareFor(lula, bolsonaro, base)
    const keys = r.terms.map((t) => `${t.term}:${t.kind}`)
    const sorted = [...keys].sort((x, y) => {
      const [xt, xk] = x.split(':')
      const [yt, yk] = y.split(':')
      return xt === yt ? (xk < yk ? -1 : xk > yk ? 1 : 0) : xt < yt ? -1 : 1
    })
    assert.deepEqual(keys, sorted)
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'hashtag'))
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'word'))
  })

  it('AC13: an out-of-window query returns terms: [] and about: 0 on both sides, not an error', async () => {
    const r = await compareFor(lula, bolsonaro, { ...base, domain: 'doesnotexist.example' })
    assert.deepEqual(r.terms, [])
    assert.equal(r.a.about, 0)
    assert.equal(r.b.about, 0)
  })
})

describe('parseCompareQuery: issue #93 acceptance criteria', () => {
  it('days defaults to 30 and clamps to [1, 365], per the spec\'s param table', () => {
    assert.equal(parseCompareQuery({}).days, 30)
    assert.equal(parseCompareQuery({ days: '0' }).days, 1)
    assert.equal(parseCompareQuery({ days: '9999' }).days, 365)
  })

  it('limit defaults to 40 and clamps to [1, 100], narrower than /graph\'s [1, 200]', () => {
    assert.equal(parseCompareQuery({}).limit, 40)
    assert.equal(parseCompareQuery({ limit: '0' }).limit, 1)
    assert.equal(parseCompareQuery({ limit: '9999' }).limit, 100)
  })

  it('has no min field, unlike GraphQuery/RisingQuery', () => {
    assert.ok(!('min' in parseCompareQuery({})))
  })

  it('source/domain/lean/kind delegate to the shared list parsers', () => {
    assert.equal(parseCompareQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseCompareQuery({ domain: 'g1.globo.com,bogus host' }).domain, 'g1.globo.com')
    assert.equal(parseCompareQuery({ lean: 'left,bogus' }).lean, 'left')
    assert.equal(parseCompareQuery({ kind: 'word,bogus' }).kind, 'word')
  })
})
