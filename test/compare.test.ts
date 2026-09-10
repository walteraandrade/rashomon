import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { compareFor, graphFor, type CompareQuery } from '../src/graph.js'
import { parseCompareQuery, parseQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'
import './close.js'

const lula = persons.find((p) => p.id === 'lula')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const tarcisio = persons.find((p) => p.id === 'tarcisio')!

const base: CompareQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40 }
const term = (r: Awaited<ReturnType<typeof compareFor>>, t: string, kind = 'word') => r.terms.find((x) => x.term === t && x.kind === kind)

describe('compareFor', () => {
  before(seed)

  it('returns an exact figure for a term only one side has', async () => {
    // bolsonaro has zero docs in the default 30-day window (its docs sit 2100+ days out),
    // so "reforma" (lula-only in that window) must carry a real object on a
    const r = await compareFor(lula, bolsonaro, base)
    assert.equal(r.b.about, 0)
    assert.deepEqual(term(r, 'reforma'), { term: 'reforma', kind: 'word', a: { count: 3, pmi: 1.38, tone: null }, b: null })
  })

  it('returns null, not a zero object, for a term absent on one side', async () => {
    const r = await compareFor(lula, bolsonaro, base)
    const row = term(r, 'reforma')!
    assert.equal(row.b, null)
    assert.notDeepEqual(row.b, { count: 0, pmi: 0, tone: null })
  })

  it("marks a side's own name word as \"name\" while the other side may still have a real figure", async () => {
    // doc /2 ("Lula e Tarcísio disputam a eleição") gives lula's own docs the word "tarcisio"
    // as ordinary vocabulary, while it is tarcisio's own name word
    const r = await compareFor(tarcisio, lula, base)
    const row = term(r, 'tarcisio')!
    assert.equal(row.a, 'name')
    assert.deepEqual(row.b, { count: 1, pmi: -1.79, tone: null })
  })

  it("matches graphFor's about for the same query", async () => {
    const g = await graphFor(lula, parseQuery({}))
    const r = await compareFor(lula, bolsonaro, base)
    assert.equal(r.a.about, g.stats.about)
  })

  it("matches graphFor's count/pmi/tone for an overlapping term", async () => {
    const g = await graphFor(lula, parseQuery({}))
    const node = g.nodes.find((n) => n.term === 'reforma' && n.kind === 'word')!
    const r = await compareFor(lula, bolsonaro, base)
    assert.deepEqual(term(r, 'reforma')!.a, { count: node.count, pmi: node.pmi, tone: node.tone })
  })

  it('returns identical a/b values when a === b', async () => {
    const r = await compareFor(lula, lula, { ...base, days: 365 })
    assert.ok(r.terms.length > 0)
    for (const t of r.terms) assert.deepEqual(t.a, t.b)
  })

  it('applies both the count-ranked and pmi-ranked selection per side', async () => {
    // at limit=1, tarcisio's own top-count term ("geopolitica") differs from bolsonaro's
    // top-pmi term ("alianca", shared doc /37), so the union must carry both
    const r = await compareFor(tarcisio, bolsonaro, { ...base, days: 365, limit: 1 })
    assert.ok(r.terms.length > 1, 'both selection criteria must contribute distinct keys')
    assert.ok(r.terms.some((t) => t.term === 'geopolitica'))
    assert.ok(r.terms.some((t) => t.term === 'alianca'))
  })

  it('orders terms by term asc then kind asc', async () => {
    // "reforma" is both a hashtag and a word for lula in the default window
    const r = await compareFor(lula, bolsonaro, base)
    const idx = r.terms.map((t) => `${t.term}:${t.kind}`)
    const sorted = [...idx].sort((x, y) => {
      const [xt, xk] = x.split(':')
      const [yt, yk] = y.split(':')
      return xt === yt ? (xk < yk ? -1 : xk > yk ? 1 : 0) : xt < yt ? -1 : 1
    })
    assert.deepEqual(idx, sorted)
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'hashtag'))
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'word'))
  })

  it('returns an empty terms list and about: 0 outside any docs window', async () => {
    const r = await compareFor(lula, bolsonaro, { ...base, domain: 'doesnotexist.example' })
    assert.deepEqual(r.terms, [])
    assert.equal(r.a.about, 0)
    assert.equal(r.b.about, 0)
  })
})

describe('parseCompareQuery', () => {
  it('days defaults to 30 and clamps to [1, 365]', () => {
    assert.equal(parseCompareQuery({}).days, 30)
    assert.equal(parseCompareQuery({ days: 'nope' }).days, 30)
    assert.equal(parseCompareQuery({ days: '0' }).days, 7)
    assert.equal(parseCompareQuery({ days: '9999' }).days, 365)
  })

  it('limit defaults to 40 and clamps to [1, 100]', () => {
    assert.equal(parseCompareQuery({}).limit, 40)
    assert.equal(parseCompareQuery({ limit: '0' }).limit, 1)
    assert.equal(parseCompareQuery({ limit: '9999' }).limit, 100)
  })

  it('delegates source/domain/lean/kind to the shared list parsers', () => {
    assert.equal(parseCompareQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseCompareQuery({ source: 'bogus' }).source, 'all')
    assert.equal(parseCompareQuery({ domain: 'g1.globo.com,bogus host' }).domain, 'g1.globo.com')
    assert.equal(parseCompareQuery({ lean: 'left,bogus' }).lean, 'left')
    assert.equal(parseCompareQuery({ kind: 'word,bogus' }).kind, 'word')
  })
})
