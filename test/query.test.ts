import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  BASELINES,
  DAYS,
  KINDS,
  LIMITS,
  MINS,
  OFFSETS,
  SMALL_LIMITS,
  SOURCES,
  parseCandidatesQuery,
  parseCompareQuery,
  parseDocsQuery,
  parseDomainList,
  parseLeanList,
  parseQuery,
  parseRisingQuery,
  parseSourceList,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
  snapDays,
  snapTo,
} from '../src/query.js'
import { candidatesQuery, compareParams, docsParams, params } from '../src/ui/api.js'
import { withEnv } from './env.js'

// Every parser in src/query.ts, with no database: what each field defaults to, what it snaps
// onto, and which tokens the list parsers keep.

describe('parseSourceList (issue #8)', () => {
  it('AC6: falls back to "all" for undefined, empty, "all" and an unknown token', () => {
    assert.equal(parseSourceList(undefined), 'all')
    assert.equal(parseSourceList(''), 'all')
    assert.equal(parseSourceList('all'), 'all')
    assert.equal(parseSourceList('bogus'), 'all')
    assert.equal(parseSourceList('bogus1,bogus2'), 'all')
  })

  it('AC6: keeps a single valid token as-is, unknown tokens dropped silently', () => {
    assert.equal(parseSourceList('gnews'), 'gnews')
    assert.equal(parseSourceList('gnews,bogus'), 'gnews')
  })

  it('AC6: joins and dedupes valid tokens', () => {
    assert.equal(parseSourceList('gnews,rss'), 'gnews,rss')
    assert.equal(parseSourceList('gnews,rss,gnews'), 'gnews,rss')
  })

  it('AC6: matches the enum case-sensitively and trims whitespace around each token', () => {
    assert.equal(parseSourceList('GNEWS'), 'all', 'uppercase must not match the lowercase enum')
    assert.equal(parseSourceList('gnews, rss'), 'gnews,rss')
    assert.equal(parseSourceList(' gnews , rss '), 'gnews,rss')
  })

  it('accepts camara and senado, alone or in a comma list (issues #24, #25)', () => {
    assert.ok(SOURCES.includes('senado'))
    assert.equal(parseSourceList('camara'), 'camara')
    assert.equal(parseSourceList('camara,gdelt'), 'camara,gdelt')
    assert.equal(parseSourceList('senado'), 'senado')
    assert.equal(parseSourceList('senado,gnews'), 'senado,gnews')
  })
})

// issues #24/#25: the two independent inline literals in parseRisingQuery/parseTimelineQuery
// must accept 'camara' and 'senado' too, so they cannot silently drift from SOURCES again.
describe('parseRisingQuery/parseTimelineQuery source', () => {
  it('resolves source: camara and senado to themselves, not all', () => {
    assert.equal(parseRisingQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseTimelineQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseRisingQuery({ source: 'senado' }).source, 'senado')
    assert.equal(parseTimelineQuery({ source: 'senado' }).source, 'senado')
  })

  it('still falls back to all on a bogus token, so the check was widened, not loosened', () => {
    assert.equal(parseRisingQuery({ source: 'not-a-real-source' }).source, 'all')
    assert.equal(parseTimelineQuery({ source: 'not-a-real-source' }).source, 'all')
  })
})

describe('parseLeanList / parseDomainList (issue #26)', () => {
  it('AC4: parseLeanList accepts comma-separated left/right/center, drops unknown tokens, falls back to all', () => {
    assert.equal(parseLeanList('left'), 'left')
    assert.equal(parseLeanList('left,right'), 'left,right')
    assert.equal(parseLeanList('right,center'), 'right,center')
    assert.equal(parseLeanList('left,bogus'), 'left')
    assert.equal(parseLeanList('bogus1,bogus2'), 'all')
    assert.equal(parseLeanList(''), 'all')
    assert.equal(parseLeanList(undefined), 'all')
    assert.equal(parseLeanList('left,left'), 'left')
  })

  it('AC2/AC3: parseDomainList keeps a single host, joins a list, dedupes, falls back to all', () => {
    assert.equal(parseDomainList('a.com'), 'a.com')
    assert.equal(parseDomainList('a.com,b.com'), 'a.com,b.com')
    assert.equal(parseDomainList('a.com,a.com,a.com'), 'a.com')
    assert.equal(parseDomainList(''), 'all')
    assert.equal(parseDomainList(undefined), 'all')
    assert.equal(parseDomainList('BAD SPACE!'), 'all')
    assert.equal(parseDomainList('not valid!,also bad!'), 'all')
    assert.equal(parseDomainList('a.com,BAD SPACE!'), 'a.com')
  })

  it('AC11: parseQuery/parseDocsQuery/parseRisingQuery/parseTimelineQuery all thread domain-list and lean through', () => {
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).domain, 'a.com,b.com')
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).lean, 'left,right')
    assert.equal(parseDocsQuery({ lean: 'center' }).lean, 'center')
    assert.equal(parseRisingQuery({ lean: 'left' }).lean, 'left')
    assert.equal(parseTimelineQuery({ lean: 'right' }).lean, 'right')
  })
})

describe('parseToneQuery (issue #5)', () => {
  it("AC3: min defaults to 3 and snaps to MINS, independent of GraphQuery.min's default of 2", () => {
    assert.equal(parseToneQuery({}).min, 3)
    assert.equal(parseToneQuery({ min: 'nope' }).min, 3)
    assert.notEqual(parseToneQuery({}).min, 2, 'must not silently copy GraphQuery.min default of 2')
    assert.equal(parseToneQuery({ min: '0' }).min, 1)
    assert.equal(parseToneQuery({ min: '-1' }).min, 1)
    assert.equal(parseToneQuery({ min: '5000' }).min, 5)
    assert.equal(parseToneQuery({ min: '7' }).min, 5)
  })

  it('AC2: days defaults to 30 and snaps to an allowed window', () => {
    assert.equal(parseToneQuery({}).days, 30)
    assert.equal(parseToneQuery({ days: 'nope' }).days, 30)
    assert.equal(parseToneQuery({ days: '0' }).days, 7)
    assert.equal(parseToneQuery({ days: '-5' }).days, 7)
    assert.equal(parseToneQuery({ days: '9999' }).days, 365)
  })
})

describe('parseTestimonyQuery (issue #21)', () => {
  it('AC10: days defaults to 30 and snaps to an allowed window', () => {
    assert.equal(parseTestimonyQuery({}).days, 30)
    assert.equal(parseTestimonyQuery({ days: 'nope' }).days, 30)
    assert.equal(parseTestimonyQuery({ days: '0' }).days, 7)
    assert.equal(parseTestimonyQuery({ days: '366' }).days, 365)
    assert.equal(parseTestimonyQuery({ days: '9999' }).days, 365)
  })

  it('AC10: min defaults to 3 and snaps to MINS, as its own literal', () => {
    assert.equal(parseTestimonyQuery({}).min, 3)
    assert.equal(parseTestimonyQuery({ min: 'nope' }).min, 3)
    assert.equal(parseTestimonyQuery({ min: '0' }).min, 1)
    assert.equal(parseTestimonyQuery({ min: '5000' }).min, 5)
    // pinned distinctly from GraphQuery's min default (2): this only guards the testimony
    // parser's own value, not equality to either sibling parser
    assert.notEqual(parseTestimonyQuery({}).min, 2)
  })

  it('method defaults to the kikori scorer label and validates its charset', () => {
    assert.equal(parseTestimonyQuery({}).method, 'kikori:q8')
    assert.equal(parseTestimonyQuery({ method: 'stub' }).method, 'stub')
    assert.equal(parseTestimonyQuery({ method: 'v2.1/model-x' }).method, 'v2.1/model-x')
    assert.equal(parseTestimonyQuery({ method: 'kikori:q8' }).method, 'kikori:q8')
    assert.equal(parseTestimonyQuery({ method: 'kikori:fp32' }).method, 'kikori:fp32')
    assert.equal(parseTestimonyQuery({ method: 'onnx' }).method, 'onnx')
    assert.equal(parseTestimonyQuery({ method: 'x'.repeat(129) }).method, 'kikori:q8')
    assert.equal(parseTestimonyQuery({ method: 'bad method!' }).method, 'kikori:q8')
    assert.equal(parseTestimonyQuery({ method: '' }).method, 'kikori:q8')
  })

  it('the default tracks TESTIMONY_DTYPE, the same way pnpm score picks its row label', () =>
    withEnv({ TESTIMONY_DTYPE: 'fp32' }, () => {
      assert.equal(parseTestimonyQuery({}).method, 'kikori:fp32')
      assert.equal(parseTestimonyQuery({ method: 'bad!' }).method, 'kikori:fp32')
    }))

  it('AC9: source reuses parseSourceList', () => {
    assert.equal(parseTestimonyQuery({}).source, 'all')
    assert.equal(parseTestimonyQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseTestimonyQuery({ source: 'not-a-real-source' }).source, 'all')
  })
})

describe('parseCompareQuery (issue #93)', () => {
  it('days defaults to 30 and snaps to the nearest allowed window', () => {
    assert.equal(parseCompareQuery({}).days, 30)
    assert.equal(parseCompareQuery({ days: 'nope' }).days, 30)
    assert.equal(parseCompareQuery({ days: '0' }).days, 7)
    assert.equal(parseCompareQuery({ days: '9999' }).days, 365)
  })

  it("limit defaults to 40 and snaps to SMALL_LIMITS, ceiling 100 where /graph's is 200", () => {
    assert.equal(parseCompareQuery({}).limit, 40)
    assert.equal(parseCompareQuery({ limit: '0' }).limit, 1)
    assert.equal(parseCompareQuery({ limit: '9999' }).limit, 100)
  })

  it('has no min field, unlike GraphQuery/RisingQuery', () => {
    assert.ok(!('min' in parseCompareQuery({})))
  })

  it('delegates source/domain/lean/kind to the shared list parsers', () => {
    assert.equal(parseCompareQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseCompareQuery({ source: 'bogus' }).source, 'all')
    assert.equal(parseCompareQuery({ domain: 'g1.globo.com,bogus host' }).domain, 'g1.globo.com')
    assert.equal(parseCompareQuery({ lean: 'left,bogus' }).lean, 'left')
    assert.equal(parseCompareQuery({ kind: 'word,bogus' }).kind, 'word')
  })
})

describe('parseCandidatesQuery (issue #32)', () => {
  it('AC6: uses 7 / 5 / 50 as defaults', () => {
    assert.deepEqual(parseCandidatesQuery({}), { days: 7, min: 5, limit: 50 })
  })

  it('AC6: snaps out-of-range values to the nearest allowed one and falls back on garbage', () => {
    assert.deepEqual(parseCandidatesQuery({ days: '9999', min: '0', limit: '-3' }), { days: 365, min: 1, limit: 1 })
    assert.deepEqual(parseCandidatesQuery({ days: '0', min: '0', limit: '-3' }), { days: 7, min: 1, limit: 1 })
    assert.deepEqual(parseCandidatesQuery({ days: 'abc', min: '2000', limit: '999' }), { days: 7, min: 5, limit: 200 })
  })
})

describe('KINDS (issue #108)', () => {
  it('no longer accepts the token theme', () => {
    assert.ok(!KINDS.includes('theme'))
    assert.deepEqual(KINDS, ['hashtag', 'word', 'phrase'])
  })
})

// Issue #111, step 3: `days` used to clamp to [1, 365], so every value in that range was its own
// CDN key and its own cold invocation. These criteria are written against the issue, not against
// the implementation: what matters is that the reachable surface is the handful of windows the
// page offers, that a stray value lands on the nearest of them, and that no default moves.

// Every parser that reads `days`, with the default it must keep when `days` is absent.
const dayParsers: [string, (q: Record<string, string | undefined>) => { days: number }, number][] = [
  ['parseQuery', parseQuery, 30],
  ['parseDocsQuery', parseDocsQuery, 30],
  ['parseRisingQuery', parseRisingQuery, 7],
  ['parseTimelineQuery', parseTimelineQuery, 30],
  ['parseToneQuery', parseToneQuery, 30],
  ['parseTestimonyQuery', parseTestimonyQuery, 30],
  ['parseCandidatesQuery', parseCandidatesQuery, 7],
  ['parseCompareQuery', parseCompareQuery, 30],
]

describe('days enumeration acceptance criteria (issue #111)', () => {
  it('AC1: the allowed windows are exactly the ones every <select> in design-5.html offers', () => {
    const page = readFileSync(new URL('../public/design-5.html', import.meta.url), 'utf8')
    const selects = [...page.matchAll(/<select id="(days|testimonyDays|compareDays)"[\s\S]*?<\/select>/g)]
    assert.equal(selects.length, 3, 'design-5.html should carry one days select per figure')
    for (const [markup] of selects) {
      const offered = [...markup.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1]))
      assert.deepEqual(offered, DAYS)
    }
  })

  it('AC2: every parser that reads days keeps its own default when days is absent or non-numeric', () => {
    for (const [name, parse, fallback] of dayParsers) {
      assert.equal(parse({}).days, fallback, name)
      assert.equal(parse({ days: 'abc' }).days, fallback, name)
      assert.equal(parse({ days: '' }).days, fallback, name)
      assert.ok(DAYS.includes(fallback), `${name}'s default must itself be an allowed window`)
    }
  })

  it('AC3: an allowed window travels through every parser unchanged', () => {
    for (const [name, parse] of dayParsers) {
      for (const d of DAYS) assert.equal(parse({ days: String(d) }).days, d, `${name} days=${d}`)
    }
  })

  it('AC4: any other value snaps to the nearest allowed window, ties to the shorter one', () => {
    // 18.5 is the midpoint of 7 and 30; 197.5 the midpoint of 30 and 365.
    const cases: [string, number][] = [
      ['1', 7],
      ['0', 7],
      ['-5', 7],
      ['18', 7],
      ['19', 30],
      ['45', 30],
      ['197', 30],
      ['198', 365],
      ['364', 365],
      ['9999', 365],
    ]
    for (const [name, parse] of dayParsers) {
      for (const [given, expected] of cases) assert.equal(parse({ days: given }).days, expected, `${name} days=${given}`)
    }
  })

  it('AC5: the whole reachable surface is DAYS, so days cannot bust the cache', () => {
    const reached = new Set<number>()
    for (let n = -1000; n <= 1000; n++) reached.add(snapDays(String(n), 30))
    assert.deepEqual([...reached].sort((a, b) => a - b), DAYS)
  })

  it('AC6: snapDays never returns a value outside DAYS for a numeric input', () => {
    for (const v of ['3', '12', '90', '180', '366', '1e6', '30.9', '  45  ']) assert.ok(DAYS.includes(snapDays(v, 30)))
  })

  it('AC7: docs/api.md documents the enumeration and every window in it', () => {
    const api = readFileSync(new URL('../docs/api.md', import.meta.url), 'utf8')
    const section = api.slice(api.indexOf('## The window (`days`)'), api.indexOf('## Shared filters'))
    assert.ok(section.length, 'docs/api.md has no section about the window')
    for (const d of DAYS) assert.match(section, new RegExp(`\\*\\*${d}\\*\\*`), `docs/api.md never names the ${d}-day window`)
  })
})

// Issue #127: `limit`, `min`, `offset` and `baseline` used to clamp, so every integer inside the
// clamp was its own CDN key and its own cold invocation, exactly what #111 fixed for `days`. As
// above, the criteria are about the surface: what the page sends is in the set, every default is
// in the set, nothing outside the set is reachable.

type Q = Record<string, string | undefined>
const intParsers: [string, (q: Q) => Record<string, unknown>, Record<string, [number, readonly number[]]>][] = [
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
    const options = compare.match(/\$\('compareLimit'\)\.innerHTML = html`\$\{\[([^\]]+)\]/)?.[1]
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
    for (const [name, parse, fields] of intParsers) {
      for (const [field, [fallback, set]] of Object.entries(fields)) {
        assert.equal(parse({})[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: 'abc' })[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: '' })[field], fallback, `${name}.${field}`)
        assert.ok(set.includes(fallback), `${name}'s default ${field}=${fallback} must itself be allowed`)
      }
    }
  })

  it('AC3: an allowed value travels through every parser unchanged', () => {
    for (const [name, parse, fields] of intParsers) {
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
    for (const [name, parse, fields] of intParsers) {
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
