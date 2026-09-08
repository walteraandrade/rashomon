import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { testimonyFor, type TestimonyQuery } from '../src/graph.js'
import { parseTestimonyQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'

const tarcisio = persons.find((p) => p.id === 'tarcisio')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const lula = persons.find((p) => p.id === 'lula')!

const base: TestimonyQuery = { days: 30, source: 'all', method: 'stub', min: 3 }
const byDomain = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)
const bySource = (r: Awaited<ReturnType<typeof testimonyFor>>, source: string) => r.by_source.find((s) => s.source === source)

describe('testimonyFor', () => {
  before(seed)

  it('computes overall/by_source/by_domain within the default window', async () => {
    // docs 30-35 about tarcisio, all gdelt: scores 4, 6, 2, 5, -1, -8 (doc 36 is null, doc 37 is
    // outside days:30) -> n=6, avg = 8/6 = 1.33
    const r = await testimonyFor(tarcisio, base)
    assert.equal(r.method, 'stub')
    assert.deepEqual(r.overall, { score: 1.33, n: 6 })
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    assert.deepEqual(r.by_domain, [{ domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 }])
  })

  it('excludes a null-scored doc from n and the average at every level', async () => {
    // doc /36 shares tarcisio+estadao.com.br+the default window with docs 30-32, but is
    // scored null; if count(score)/avg(score) were swapped for count(*)/coalesce(score,0)
    // the estadao.com.br cell would silently become { score: 3, n: 4 }
    const r = await testimonyFor(tarcisio, base)
    assert.deepEqual(byDomain(r, 'estadao.com.br'), { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 })
  })

  it('drops a domain below min from by_domain but keeps it in overall/by_source', async () => {
    // oglobo.globo.com has 2 non-null tarcisio scores (5, -1): below the default min=3
    const r = await testimonyFor(tarcisio, base)
    assert.equal(byDomain(r, 'oglobo.globo.com'), undefined)
    assert.equal(r.overall.n, 6, 'oglobo.globo.com docs still count toward overall')
  })

  it('surfaces a below-min domain once min is lowered', async () => {
    const r = await testimonyFor(tarcisio, { ...base, min: 2 })
    assert.deepEqual(byDomain(r, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('never groups a domain-less doc into by_domain, at any min, but keeps it in overall/by_source', async () => {
    // doc /35 (example.org, tarcisio, score -8) has no domain
    const r = await testimonyFor(tarcisio, { ...base, min: 1 })
    assert.ok(!r.by_domain.some((d) => !d.domain))
    assert.ok(bySource(r, 'gdelt'))
  })

  it('keeps a shared doc independent per person: no cross-leak', async () => {
    // doc /37 (poder360.com.br) scores tarcisio +7, bolsonaro -7; sits at day 35, so days:90 is needed
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(byDomain(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(byDomain(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
    assert.deepEqual(b.overall, { score: -7, n: 1 })
    // tarcisio's own 7 scores (4, 6, 2, 5, -1, -8, 7) sum to 15, avg 15/7 = 2.14 -- bolsonaro's
    // -7 for the same doc never enters this average
    assert.deepEqual(t.overall, { score: 2.14, n: 7 })
  })

  it('excludes docs outside the days window; widening includes them', async () => {
    const narrow = await testimonyFor(tarcisio, base)
    assert.equal(byDomain(narrow, 'poder360.com.br'), undefined)
    const wide = await testimonyFor(tarcisio, { ...base, days: 90, min: 1 })
    assert.ok(byDomain(wide, 'poder360.com.br'))
  })

  it('excludes docs outside the source filter; widening includes them', async () => {
    // lula: g1.globo.com/1 (gnews, score 6) and gdeltproject.org/38 (gkg, score 3), both day1
    const onlyGkg = await testimonyFor(lula, { ...base, source: 'gkg' })
    assert.deepEqual(onlyGkg.overall, { score: 3, n: 1 })
    assert.deepEqual(onlyGkg.by_source, [{ source: 'gkg', score: 3, n: 1 }])
    const all = await testimonyFor(lula, { ...base, source: 'all' })
    assert.deepEqual(all.overall, { score: 4.5, n: 2 })
  })

  it('returns the all-empty shape for an unknown/never-scored method', async () => {
    const r = await testimonyFor(tarcisio, { ...base, method: 'never-inserted-method' })
    assert.deepEqual(r, { method: 'never-inserted-method', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
  })
})

describe('parseTestimonyQuery', () => {
  it('days defaults to 30 and clamps to [1, 365]', () => {
    assert.equal(parseTestimonyQuery({}).days, 30)
    assert.equal(parseTestimonyQuery({ days: 'nope' }).days, 30)
    assert.equal(parseTestimonyQuery({ days: '0' }).days, 1)
    assert.equal(parseTestimonyQuery({ days: '9999' }).days, 365)
  })

  it('min defaults to 3 and clamps to [1, 1000], as its own literal', () => {
    assert.equal(parseTestimonyQuery({}).min, 3)
    assert.equal(parseTestimonyQuery({ min: 'nope' }).min, 3)
    assert.equal(parseTestimonyQuery({ min: '0' }).min, 1)
    assert.equal(parseTestimonyQuery({ min: '5000' }).min, 1000)
  })

  it('method defaults to "onnx" and validates its charset', () => {
    assert.equal(parseTestimonyQuery({}).method, 'onnx')
    assert.equal(parseTestimonyQuery({ method: 'stub' }).method, 'stub')
    assert.equal(parseTestimonyQuery({ method: 'v2.1/model-x' }).method, 'v2.1/model-x')
    assert.equal(parseTestimonyQuery({ method: 'kikori:q8' }).method, 'kikori:q8')
    assert.equal(parseTestimonyQuery({ method: 'kikori:fp32' }).method, 'kikori:fp32')
    assert.equal(parseTestimonyQuery({ method: 'x'.repeat(129) }).method, 'onnx')
    assert.equal(parseTestimonyQuery({ method: 'bad method!' }).method, 'onnx')
    assert.equal(parseTestimonyQuery({ method: '' }).method, 'onnx')
  })

  it('source reuses parseSourceList', () => {
    assert.equal(parseTestimonyQuery({}).source, 'all')
    assert.equal(parseTestimonyQuery({ source: 'gnews,bogus' }).source, 'gnews')
  })
})
