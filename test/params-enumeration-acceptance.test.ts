import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  BASELINES,
  DAYS,
  LIMITS,
  MINS,
  OFFSETS,
  SMALL_LIMITS,
  parseCandidatesQuery,
  parseCompareQuery,
  parseDocsQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseToneQuery,
  snapDays,
  snapTo,
} from '../src/query.js'
import { candidatesQuery, compareParams, docsParams, params } from '../src/ui/api.js'

// Issue #127: `limit`, `min`, `offset` and `baseline` used to clamp, so every integer inside the
// clamp was its own CDN key and its own cold invocation, exactly what #111 fixed for `days`. As
// in test/days-enumeration-acceptance.test.ts, the criteria are about the surface: what the page
// sends is in the set, every default is in the set, nothing outside the set is reachable.

type Q = Record<string, string | undefined>
const parsers: [string, (q: Q) => Record<string, unknown>, Record<string, [number, readonly number[]]>][] = [
  ['parseQuery', parseQuery, { limit: [40, LIMITS], min: [2, MINS] }],
  ['parseDocsQuery', parseDocsQuery, { limit: [50, LIMITS], offset: [0, OFFSETS] }],
  ['parseRisingQuery', parseRisingQuery, { limit: [20, SMALL_LIMITS], min: [3, MINS], baseline: [30, BASELINES] }],
  ['parseToneQuery', parseToneQuery, { min: [3, MINS] }],
  ['parseTestimonyQuery', parseTestimonyQuery, { min: [3, MINS] }],
  ['parseCandidatesQuery', parseCandidatesQuery, { limit: [50, LIMITS], min: [5, MINS] }],
  ['parseCompareQuery', parseCompareQuery, { limit: [40, SMALL_LIMITS] }],
]

const numbers = (markup: string) => [...markup.matchAll(/<option[^>]*>(\d+)<\/option>|value="(\d+)"/g)].map((m) => Number(m[1] ?? m[2]))

describe('parameter enumeration acceptance criteria (issue #127)', () => {
  it('AC1: every limit the page sends is a member of LIMITS', () => {
    const page = readFileSync(new URL('../public/design-5.html', import.meta.url), 'utf8')
    const atlas = page.match(/<select id="limit"[\s\S]*?<\/select>/)?.[0]
    assert.ok(atlas, 'design-5.html should carry the atlas limit select')
    const offered = numbers(atlas)
    assert.ok(offered.length >= 3)
    for (const v of offered) assert.ok(LIMITS.includes(v), `atlas offers limit=${v}`)

    const compare = readFileSync(new URL('../src/ui/figures/compare.ts', import.meta.url), 'utf8')
    const options = compare.match(/\$\('compareLimit'\)\.innerHTML = \[([^\]]+)\]/)?.[1]
    assert.ok(options, 'compare.ts should build the compareLimit options from a literal list')
    const compareOffered = [...options.matchAll(/'(\d+)'/g)].map((m) => Number(m[1]))
    assert.ok(compareOffered.length >= 3)
    for (const v of compareOffered) assert.ok(SMALL_LIMITS.includes(v), `compare offers limit=${v}`)

    const graph = params({ days: '30', sort: 'count', limit: '18', source: 'all' })
    assert.ok(MINS.includes(Number(graph.get('min'))), 'the graph request sends a min in MINS')
    const docs = docsParams({ days: '30', source: 'all' })
    assert.ok(LIMITS.includes(Number(docs.get('limit'))), 'the docs request sends a limit in LIMITS')
    assert.equal(docs.has('offset'), false)
    const candidates = candidatesQuery({ days: '7' })
    assert.ok(LIMITS.includes(Number(candidates.get('limit'))), 'the candidates request sends a limit in LIMITS')
    assert.ok(MINS.includes(Number(candidates.get('min'))), 'the candidates request sends a min in MINS')
    const cmp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '20' })
    assert.ok(SMALL_LIMITS.includes(Number(cmp.get('limit'))))
  })

  it('AC2: every parser keeps its own default when the parameter is absent or non-numeric, and every default is in its set', () => {
    for (const [name, parse, fields] of parsers) {
      for (const [field, [fallback, set]] of Object.entries(fields)) {
        assert.equal(parse({})[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: 'abc' })[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: '' })[field], fallback, `${name}.${field}`)
        assert.ok(set.includes(fallback), `${name}'s default ${field}=${fallback} must itself be allowed`)
      }
    }
  })

  it('AC3: an allowed value travels through every parser unchanged', () => {
    for (const [name, parse, fields] of parsers) {
      for (const [field, [, set]] of Object.entries(fields)) {
        for (const v of set) assert.equal(parse({ [field]: String(v) })[field], v, `${name} ${field}=${v}`)
      }
    }
  })

  it('AC4: any other value snaps to the nearest allowed one, ties to the smaller', () => {
    const cases: [string, readonly number[], string, number][] = [
      ['limit', LIMITS, '0', 1],
      ['limit', LIMITS, '-3', 1],
      ['limit', LIMITS, '3', 1],
      ['limit', LIMITS, '37', 40],
      ['limit', LIMITS, '45', 40],
      ['limit', LIMITS, '46', 50],
      ['limit', LIMITS, '150', 100],
      ['limit', LIMITS, '151', 200],
      ['limit', LIMITS, '999', 200],
      ['limit', SMALL_LIMITS, '999', 100],
      ['min', MINS, '0', 1],
      ['min', MINS, '4', 3],
      ['min', MINS, '2000', 5],
      ['baseline', BASELINES, '1', 30],
      ['baseline', BASELINES, '365', 30],
      ['offset', OFFSETS, '24', 0],
      ['offset', OFFSETS, '25', 0],
      ['offset', OFFSETS, '26', 50],
      ['offset', OFFSETS, '1000000', 1000],
    ]
    for (const [field, set, given, expected] of cases) assert.equal(snapTo(set, given, set[0]), expected, `${field}=${given}`)
    assert.equal(parseQuery({ limit: '37' }).limit, 40)
    assert.equal(parseDocsQuery({ offset: '26' }).offset, 50)
    assert.equal(parseRisingQuery({ baseline: '7' }).baseline, 30)
    assert.equal(parseRisingQuery({ limit: '999' }).limit, 100)
    assert.equal(parseCompareQuery({ limit: '999' }).limit, 100)
    assert.equal(parseCandidatesQuery({ limit: '999' }).limit, 200)
  })

  it('AC5: the whole reachable surface of each parameter is its set, so none can bust the cache', () => {
    const reach = (set: readonly number[]) => {
      const reached = new Set<number>()
      for (let n = -1000; n <= 1000; n++) reached.add(snapTo(set, String(n), set[0]))
      return [...reached].sort((a, b) => a - b)
    }
    assert.deepEqual(reach(LIMITS), LIMITS)
    assert.deepEqual(reach(SMALL_LIMITS), SMALL_LIMITS)
    assert.deepEqual(reach(MINS), MINS)
    assert.deepEqual(reach(BASELINES), BASELINES)
    assert.deepEqual(reach(OFFSETS), OFFSETS)
    for (const [name, parse, fields] of parsers) {
      for (const [field, [, set]] of Object.entries(fields)) {
        const reached = new Set<unknown>()
        for (let n = -1000; n <= 1000; n += 7) reached.add(parse({ [field]: String(n) })[field])
        for (const v of reached) assert.ok(set.includes(v as number), `${name} ${field} reached ${v}`)
      }
    }
  })

  it('AC6: the sets are ascending, and SMALL_LIMITS is LIMITS capped at 100 (rising and compare, issue #93)', () => {
    for (const set of [LIMITS, SMALL_LIMITS, MINS, BASELINES, OFFSETS]) {
      assert.deepEqual([...set], [...set].sort((a, b) => a - b))
      assert.equal(new Set(set).size, set.length)
    }
    assert.deepEqual(SMALL_LIMITS, LIMITS.filter((x) => x <= 100))
    assert.equal(Math.max(...SMALL_LIMITS), 100)
    assert.equal(Math.max(...LIMITS), 200)
    assert.equal(OFFSETS[0], 0)
    assert.equal(OFFSETS[OFFSETS.length - 1], 1000)
    for (const o of OFFSETS) assert.equal(o % 50, 0)
  })

  it('AC7: snapDays is snapTo over DAYS, so the two enumerations cannot drift apart', () => {
    for (const v of ['-5', '0', '18', '19', '197', '198', '9999', 'abc', undefined]) assert.equal(snapDays(v, 30), snapTo(DAYS, v, 30))
  })

  it('AC8: docs/api.md names every value of every set', () => {
    const api = readFileSync(new URL('../docs/api.md', import.meta.url), 'utf8')
    const start = api.indexOf('## Enumerated integers')
    assert.ok(start >= 0, 'docs/api.md has no section about the enumerated integers')
    const section = api.slice(start, api.indexOf('## Shared filters'))
    for (const [label, set] of [['limit', LIMITS], ['min', MINS], ['baseline', BASELINES]] as const) {
      assert.match(section, new RegExp('`' + label + '`'), `docs/api.md never names ${label}`)
      for (const v of set) assert.match(section, new RegExp(`\\*\\*${v}\\*\\*`), `docs/api.md never names ${label}=${v}`)
    }
    assert.match(section, /`offset`/)
    assert.match(section, /multiples? of \*\*50\*\*/)
    assert.match(section, /\*\*1000\*\*/)
    const ops = readFileSync(new URL('../docs/operations.md', import.meta.url), 'utf8')
    assert.doesNotMatch(ops, /still free integers/, 'docs/operations.md still says the other parameters are free integers')
  })
})
