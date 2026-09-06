import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { toneFor, type ToneQuery } from '../src/graph.js'
import { parseToneQuery } from '../src/query.js'
import { seed } from './fixture.js'

// Independent verification of issue #5's numbered acceptance criteria, written against
// the spec rather than against test/tone.test.ts. Fixture values are recomputed by hand
// from test/fixture.ts's docs 30-35, not copied from the builder's assertions.
const base: ToneQuery = { days: 30, min: 3 }
const cell = (r: Awaited<ReturnType<typeof toneFor>>, personId: string, domain: string) =>
  r.cells.find((c) => c.person_id === personId && c.domain === domain)

describe('tone acceptance criteria (issue #5)', () => {
  before(seed)

  it('AC1: no query params returns exactly the keys persons, domains, cells', async () => {
    const r = await toneFor(parseToneQuery({}))
    assert.deepEqual(Object.keys(r).sort(), ['cells', 'domains', 'persons'])
  })

  it('AC2: days missing or non-numeric defaults to 30, clamped to [1, 365]', () => {
    assert.equal(parseToneQuery({}).days, 30)
    assert.equal(parseToneQuery({ days: 'abc' }).days, 30)
    assert.equal(parseToneQuery({ days: '-5' }).days, 1)
    assert.equal(parseToneQuery({ days: '10000' }).days, 365)
  })

  it("AC3: min missing or non-numeric defaults to 3 and clamps to [1, 1000], distinct from GraphQuery.min's own default of 2", () => {
    assert.equal(parseToneQuery({}).min, 3)
    assert.equal(parseToneQuery({ min: 'nan' }).min, 3)
    assert.notEqual(parseToneQuery({}).min, 2, 'must not silently copy GraphQuery.min default of 2')
    assert.equal(parseToneQuery({ min: '-1' }).min, 1)
    assert.equal(parseToneQuery({ min: '999999' }).min, 1000)
  })

  it('AC4: persons has every tracked person, ordered by name, shaped { id, name } with no aliases', async () => {
    const r = await toneFor(base)
    assert.equal(r.persons.length, 3)
    assert.deepEqual(
      r.persons.map((p) => p.id).sort(),
      ['bolsonaro', 'lula', 'tarcisio'],
    )
    for (const p of r.persons) {
      assert.deepEqual(Object.keys(p).sort(), ['id', 'name'])
      assert.ok(!('aliases' in p))
    }
    const names = r.persons.map((p) => p.name)
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b))
    assert.deepEqual(names, sortedNames)
  })

  it('AC5: a (person, domain) pair below min in the window produces no entry, not one with n < min', async () => {
    const r = await toneFor(base)
    // folha.uol.com.br has exactly 1 toned tarcisio doc (doc /3, tone -1.5); default min is 3
    assert.equal(cell(r, 'tarcisio', 'folha.uol.com.br'), undefined)
    // oglobo.globo.com has exactly 2 toned tarcisio docs (docs /33, /34); still below default min 3
    assert.equal(cell(r, 'tarcisio', 'oglobo.globo.com'), undefined)
    assert.ok(!r.cells.some((c) => c.n < base.min), 'no surfaced cell may carry n below the threshold')
  })

  it('AC6: a pair at or above min produces one cell whose tone and n match a hand-computed average', async () => {
    const r = await toneFor(base)
    // estadao.com.br has three toned tarcisio docs (-2, -1, 0) -> avg -1, n=3
    const c = cell(r, 'tarcisio', 'estadao.com.br')
    assert.ok(c, 'expected an estadao.com.br cell for tarcisio')
    assert.equal(c!.n, 3)
    assert.equal(c!.tone, -1)
  })

  it('AC7: a person with zero toned docs appears in persons but has zero cells', async () => {
    const r = await toneFor(base)
    assert.ok(r.persons.some((p) => p.id === 'lula'))
    assert.ok(r.persons.some((p) => p.id === 'bolsonaro'))
    assert.ok(!r.cells.some((c) => c.person_id === 'lula'))
    assert.ok(!r.cells.some((c) => c.person_id === 'bolsonaro'))
  })

  it('AC8: a doc with no domain never surfaces a null/empty entry in domains, even when it alone clears min', async () => {
    // doc /35 has no domain, tone -3, mentions tarcisio; at min=1 it alone would clear the threshold
    const r = await toneFor({ days: 30, min: 1 })
    assert.ok(!r.domains.includes(null as unknown as string))
    assert.ok(!r.domains.includes(''))
    assert.ok(!r.cells.some((c) => !c.domain))
  })

  it('AC9: lowering min to 2 surfaces a pair absent at the default min of 3', async () => {
    const atDefault = await toneFor(base)
    assert.equal(cell(atDefault, 'tarcisio', 'oglobo.globo.com'), undefined)
    const lowered = await toneFor({ days: 30, min: 2 })
    const c = cell(lowered, 'tarcisio', 'oglobo.globo.com')
    assert.ok(c, 'oglobo.globo.com should surface once min drops to 2')
    assert.equal(c!.n, 2)
    assert.equal(c!.tone, 0.75)
  })
})
