import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { toneFor, type ToneQuery } from '../src/graph.js'
import { parseToneQuery } from '../src/server.js'
import { seed } from './fixture.js'

const base: ToneQuery = { days: 30, min: 3 }
const cell = (r: Awaited<ReturnType<typeof toneFor>>, personId: string, domain: string) =>
  r.cells.find((c) => c.person_id === personId && c.domain === domain)

describe('toneFor', () => {
  before(seed)

  it('lists every tracked person regardless of toned docs', async () => {
    const r = await toneFor(base)
    assert.deepEqual(
      r.persons.map((p) => p.id).sort(),
      ['bolsonaro', 'lula', 'tarcisio'],
    )
    for (const p of r.persons) assert.deepEqual(Object.keys(p).sort(), ['id', 'name'])
    for (let i = 1; i < r.persons.length; i++) assert.ok(r.persons[i - 1].name <= r.persons[i].name, 'persons must be ordered by name')
  })

  it('drops person/domain pairs below min', async () => {
    const r = await toneFor(base)
    // folha.uol.com.br has exactly 1 toned tarcisio doc, oglobo.globo.com has 2: both below the default min=3
    assert.equal(cell(r, 'tarcisio', 'folha.uol.com.br'), undefined)
    assert.equal(cell(r, 'tarcisio', 'oglobo.globo.com'), undefined)
  })

  it('includes pairs at or above min with the correct average and count', async () => {
    const r = await toneFor(base)
    // estadao.com.br has 3 toned tarcisio docs (-2, -1, 0), averaging to -1
    assert.deepEqual(cell(r, 'tarcisio', 'estadao.com.br'), { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
  })

  it('has no cells for a person without toned docs', async () => {
    const r = await toneFor(base)
    assert.ok(!r.cells.some((c) => c.person_id === 'lula'))
    assert.ok(r.persons.some((p) => p.id === 'lula'), 'lula still appears in persons')
  })

  it('excludes domains that never appear in any surfaced cell', async () => {
    const r = await toneFor(base)
    assert.ok(r.domains.includes('estadao.com.br'))
    assert.ok(!r.domains.includes('oglobo.globo.com'), 'below-min pair must not leak its domain')
    assert.ok(!r.domains.includes('folha.uol.com.br'), 'below-min pair must not leak its domain')
    assert.deepEqual([...r.domains].sort(), r.domains, 'domains must be sorted')
  })

  it('lowers the threshold when min is set explicitly', async () => {
    const atDefault = await toneFor(base)
    assert.equal(cell(atDefault, 'tarcisio', 'oglobo.globo.com'), undefined)
    const lowered = await toneFor({ ...base, min: 2 })
    assert.deepEqual(cell(lowered, 'tarcisio', 'oglobo.globo.com'), {
      person_id: 'tarcisio',
      domain: 'oglobo.globo.com',
      tone: 0.75,
      n: 2,
    })
  })

  it('ignores docs without a domain', async () => {
    // doc /35 has no domain but a tone of -3 about tarcisio; it must never surface a
    // null/empty domain even at a min low enough to admit a lone toned doc
    const r = await toneFor({ ...base, min: 1 })
    assert.ok(!r.domains.some((d) => !d))
    assert.ok(!r.cells.some((c) => !c.domain))
  })

  it('returns an empty matrix outside any docs window', async () => {
    // every new toned doc is at least 6 days old
    const r = await toneFor({ days: 1, min: 1 })
    assert.deepEqual(r.cells, [])
    assert.deepEqual(r.domains, [])
    assert.equal(r.persons.length, 3)
  })
})

describe('parseToneQuery', () => {
  it("AC3: min defaults to 3 and clamps to [1, 1000], independent of GraphQuery.min's default of 2", () => {
    assert.equal(parseToneQuery({}).min, 3)
    assert.equal(parseToneQuery({ min: 'nope' }).min, 3)
    assert.equal(parseToneQuery({ min: '0' }).min, 1)
    assert.equal(parseToneQuery({ min: '5000' }).min, 1000)
    assert.equal(parseToneQuery({ min: '7' }).min, 7)
  })

  it('AC2: days defaults to 30 and clamps to [1, 365]', () => {
    assert.equal(parseToneQuery({}).days, 30)
    assert.equal(parseToneQuery({ days: 'nope' }).days, 30)
    assert.equal(parseToneQuery({ days: '0' }).days, 1)
    assert.equal(parseToneQuery({ days: '9999' }).days, 365)
  })
})
