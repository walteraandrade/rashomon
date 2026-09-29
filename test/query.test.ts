import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parse } from 'parse5'
import { pageMarkup } from './pages.js'
import {
  BASELINES,
  BRIDGE_NODES,
  parseBridgeIds,
  DAYS,
  KINDS,
  LIMITS,
  MINS,
  OFFSETS,
  SMALL_LIMITS,
  SOURCES,
  parseAgendaQuery,
  parseCandidatesQuery,
  parseComentionQuery,
  parseCompareQuery,
  parseCountryList,
  parseDocsQuery,
  parseDomainList,
  parseKindList,
  parseLeanList,
  parseLens,
  parseLensesQuery,
  parsePersistenceQuery,
  parseQuery,
  parseRisingQuery,
  parseScope,
  parseSourceList,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
  parseWeekQuery,
  snapDays,
  snapTo,
  addDays,
  brtDate,
  brtMidnightUtc,
  mondayOf,
  calendarDay,
} from '../src/query.js'
import { ATLAS_KINDS, candidatesQuery, compareParams, docsParams, params } from '../src/ui/api.js'
import { withEnv } from './env.js'

// Every parser in src/query.ts, with no database: what each field defaults to, what it snaps
// onto, and which tokens the list parsers keep.

describe('parseSourceList (issue #8)', () => {
  it('falls back to "all" for undefined, empty, "all" and an unknown token', () => {
    assert.equal(parseSourceList(undefined), 'all')
    assert.equal(parseSourceList(''), 'all')
    assert.equal(parseSourceList('all'), 'all')
    assert.equal(parseSourceList('bogus'), 'all')
    assert.equal(parseSourceList('bogus1,bogus2'), 'all')
  })

  it('keeps a single valid token as-is, unknown tokens dropped silently', () => {
    assert.equal(parseSourceList('gnews'), 'gnews')
    assert.equal(parseSourceList('gnews,bogus'), 'gnews')
  })

  it('joins and dedupes valid tokens', () => {
    assert.equal(parseSourceList('gnews,rss'), 'gnews,rss')
    assert.equal(parseSourceList('gnews,rss,gnews'), 'gnews,rss')
  })

  it('matches the enum case-sensitively and trims whitespace around each token', () => {
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

  it('accepts the press families, alone or in a comma list, order kept and deduped (issue #22 AC6)', () => {
    assert.equal(parseSourceList('juridico'), 'juridico')
    assert.equal(parseSourceList('juridico,oficial,nicho'), 'juridico,oficial,nicho')
    assert.equal(parseSourceList('juridico,juridico,oficial'), 'juridico,oficial')
  })
})

// The kind list travels like the source list: a caller can ask for any subset of the four
// kinds, an unknown token is dropped and an all-unknown or missing list falls back to all.
describe('parseBridgeIds', () => {
  it('keeps kind:term pairs with a known kind, deduped and sorted', () => {
    assert.deepEqual(parseBridgeIds('word:stf, hashtag:lula,word:stf,theme:x,:x,word:,plain'), ['hashtag:lula', 'word:stf'])
  })

  it('caps the list at BRIDGE_NODES and reads a missing param as empty', () => {
    const many = Array.from({ length: BRIDGE_NODES + 10 }, (_, i) => `word:t${String(i).padStart(3, '0')}`).join(',')
    assert.equal(parseBridgeIds(many).length, BRIDGE_NODES)
    assert.deepEqual(parseBridgeIds(undefined), [])
  })
})

describe('parseKindList', () => {
  it('parses a comma-separated list, drops unknown tokens and falls back to all', () => {
    assert.equal(parseKindList('word,hashtag,phrase'), 'word,hashtag,phrase')
    assert.equal(parseKindList('word,bogus'), 'word')
    assert.equal(parseKindList('bogus'), 'all')
    assert.equal(parseKindList(undefined), 'all')
    assert.equal(parseKindList('word,word'), 'word', 'duplicates collapse, as in parseSourceList')
    assert.equal(parseQuery({ kind: 'word,phrase' }).kind, 'word,phrase')
  })

  // Issue #209: org (GDELT's V1Organizations) joins hashtag/word/phrase as a fourth accepted kind.
  it('accepts org, alongside or on its own', () => {
    assert.equal(parseKindList('org'), 'org')
    assert.equal(parseKindList('word,org'), 'word,org')
  })
})

// AC4: KINDS gains 'org', parseKindList resolves it (alone and alongside another kind) unchanged,
// and an unrecognized token still falls back to 'all'.
describe('KINDS includes org (issue #209 AC4)', () => {
  it('KINDS includes org', () => {
    assert.ok(KINDS.includes('org'), 'src/query.ts KINDS must include org')
  })

  it("parseKindList('org') and parseKindList('word,org') both resolve to strings containing org unchanged", () => {
    assert.match(parseKindList('org'), /\borg\b/)
    assert.match(parseKindList('word,org'), /\borg\b/)
    assert.equal(parseKindList('org'), 'org')
    assert.equal(parseKindList('word,org'), 'word,org')
  })

  it("parseKindList('bogus') still falls back to 'all'", () => {
    assert.equal(parseKindList('bogus'), 'all')
  })
})

// issues #24/#25: parseRisingQuery/parseTimelineQuery
// must accept 'camara' and 'senado' too, so they cannot silently drift from SOURCES again.
describe('parseRisingQuery/parseTimelineQuery source', () => {
  it('resolves source: camara and senado to themselves, not all', () => {
    assert.equal(parseRisingQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseTimelineQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseRisingQuery({ source: 'senado' }).source, 'senado')
    assert.equal(parseTimelineQuery({ source: 'senado' }).source, 'senado')
  })

  it('resolves the press families to themselves, not all (issue #22 AC7)', () => {
    assert.equal(parseRisingQuery({ source: 'oficial' }).source, 'oficial')
    assert.equal(parseTimelineQuery({ source: 'nicho' }).source, 'nicho')
    assert.equal(parseRisingQuery({ source: 'juridico' }).source, 'juridico')
    assert.equal(parseTimelineQuery({ source: 'juridico' }).source, 'juridico')
  })

  it('still falls back to all on a bogus token, so the check was widened, not loosened', () => {
    assert.equal(parseRisingQuery({ source: 'not-a-real-source' }).source, 'all')
    assert.equal(parseTimelineQuery({ source: 'not-a-real-source' }).source, 'all')
  })

  it('keeps a comma list, like every other route (issue #195)', () => {
    assert.equal(parseRisingQuery({ source: 'gkg,rss' }).source, 'gkg,rss')
    assert.equal(parseTimelineQuery({ source: 'gkg,rss' }).source, 'gkg,rss')
    assert.equal(parseRisingQuery({ source: 'gkg,bogus' }).source, 'gkg')
  })
})

describe('parseLeanList / parseDomainList (issue #26)', () => {
  it('parseLeanList accepts comma-separated left/right/center, drops unknown tokens, falls back to all', () => {
    assert.equal(parseLeanList('left'), 'left')
    assert.equal(parseLeanList('left,right'), 'left,right')
    assert.equal(parseLeanList('right,center'), 'right,center')
    assert.equal(parseLeanList('left,bogus'), 'left')
    assert.equal(parseLeanList('bogus1,bogus2'), 'all')
    assert.equal(parseLeanList(''), 'all')
    assert.equal(parseLeanList(undefined), 'all')
    assert.equal(parseLeanList('left,left'), 'left')
  })

  it('parseDomainList keeps a single host, joins a list, dedupes, falls back to all', () => {
    assert.equal(parseDomainList('a.com'), 'a.com')
    assert.equal(parseDomainList('a.com,b.com'), 'a.com,b.com')
    assert.equal(parseDomainList('a.com,a.com,a.com'), 'a.com')
    assert.equal(parseDomainList(''), 'all')
    assert.equal(parseDomainList(undefined), 'all')
    assert.equal(parseDomainList('BAD SPACE!'), 'all')
    assert.equal(parseDomainList('not valid!,also bad!'), 'all')
    assert.equal(parseDomainList('a.com,BAD SPACE!'), 'a.com')
  })

  it('parseQuery/parseDocsQuery/parseRisingQuery/parseTimelineQuery all thread domain-list and lean through', () => {
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).domain, 'a.com,b.com')
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).lean, 'left,right')
    assert.equal(parseDocsQuery({ lean: 'center' }).lean, 'center')
    assert.equal(parseRisingQuery({ lean: 'left' }).lean, 'left')
    assert.equal(parseTimelineQuery({ lean: 'right' }).lean, 'right')
  })
})

describe('parseToneQuery (issue #5)', () => {
  it("min defaults to 3 and snaps to MINS, independent of GraphQuery.min's default of 2", () => {
    assert.equal(parseToneQuery({}).min, 3)
    assert.equal(parseToneQuery({ min: 'nope' }).min, 3)
    assert.notEqual(parseToneQuery({}).min, 2, 'must not silently copy GraphQuery.min default of 2')
    assert.equal(parseToneQuery({ min: '0' }).min, 1)
    assert.equal(parseToneQuery({ min: '-1' }).min, 1)
    assert.equal(parseToneQuery({ min: '5000' }).min, 5)
    assert.equal(parseToneQuery({ min: '7' }).min, 5)
  })

  it('days defaults to 30 and snaps to an allowed window', () => {
    assert.equal(parseToneQuery({}).days, 30)
    assert.equal(parseToneQuery({ days: 'nope' }).days, 30)
    assert.equal(parseToneQuery({ days: '0' }).days, 7)
    assert.equal(parseToneQuery({ days: '-5' }).days, 7)
    assert.equal(parseToneQuery({ days: '9999' }).days, 60)
  })
})

describe('parseAgendaQuery (issue #208)', () => {
  it("min defaults to 5 and snaps to MINS, its own literal", () => {
    assert.equal(parseAgendaQuery({}).min, 5)
    assert.equal(parseAgendaQuery({ min: 'nope' }).min, 5)
    assert.equal(parseAgendaQuery({ min: '0' }).min, 1)
    assert.equal(parseAgendaQuery({ min: '-1' }).min, 1)
    assert.equal(parseAgendaQuery({ min: '7' }).min, 5)
  })

  it('days defaults to 30 and snaps to an allowed window', () => {
    assert.equal(parseAgendaQuery({}).days, 30)
    assert.equal(parseAgendaQuery({ days: 'nope' }).days, 30)
    assert.equal(parseAgendaQuery({ days: '0' }).days, 7)
    assert.equal(parseAgendaQuery({ days: '9999' }).days, 60)
  })

  it('source falls back to "all" for undefined, empty and unknown tokens, otherwise keeps a comma list', () => {
    assert.equal(parseAgendaQuery({}).source, 'all')
    assert.equal(parseAgendaQuery({ source: '' }).source, 'all')
    assert.equal(parseAgendaQuery({ source: 'bogus' }).source, 'all')
    assert.equal(parseAgendaQuery({ source: 'rss,gnews' }).source, 'rss,gnews')
    assert.equal(parseAgendaQuery({ source: 'rss,bogus' }).source, 'rss')
  })

  it('limit is always the fixed 30-domain cap, regardless of limit/domain/lean/kind in the query string', () => {
    assert.equal(parseAgendaQuery({}).limit, 30)
    assert.equal(parseAgendaQuery({ limit: '5' }).limit, 30)
    assert.equal(parseAgendaQuery({ limit: '1000' }).limit, 30)
    assert.equal(parseAgendaQuery({ domain: 'g1.globo.com' }).limit, 30)
    assert.equal(parseAgendaQuery({ lean: 'left' }).limit, 30)
    assert.equal(parseAgendaQuery({ kind: 'word' }).limit, 30)
  })

  it('has no domain, lean or kind field: those parameters are out of scope for this route', () => {
    assert.deepEqual(Object.keys(parseAgendaQuery({})).sort(), ['days', 'limit', 'min', 'source'])
  })

  it('days snaps to DAYS, min snaps to MINS (default 5), source parses via parseSourceList, limit is always the fixed constant (issue #208 AC12)', () => {
    assert.equal(parseAgendaQuery({ days: '45' }).days, 30)
    assert.equal(parseAgendaQuery({ min: '7' }).min, 5)
    assert.equal(parseAgendaQuery({ source: 'rss,bogus' }).source, 'rss')
    assert.equal(parseAgendaQuery({ source: 'bogus' }).source, 'all')
    for (const q of [{}, { limit: '1' }, { domain: 'g1.globo.com' }, { lean: 'left' }, { kind: 'word' }, { limit: '1', domain: 'x', lean: 'left', kind: 'word' }])
      assert.equal(parseAgendaQuery(q).limit, 30)
  })
})

describe('parseTestimonyQuery (issue #21)', () => {
  it('days defaults to 30 and snaps to an allowed window', () => {
    assert.equal(parseTestimonyQuery({}).days, 30)
    assert.equal(parseTestimonyQuery({ days: 'nope' }).days, 30)
    assert.equal(parseTestimonyQuery({ days: '0' }).days, 7)
    assert.equal(parseTestimonyQuery({ days: '366' }).days, 60)
    assert.equal(parseTestimonyQuery({ days: '9999' }).days, 60)
  })

  it('min defaults to 3 and snaps to MINS, as its own literal', () => {
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

  it('source reuses parseSourceList', () => {
    assert.equal(parseTestimonyQuery({}).source, 'all')
    assert.equal(parseTestimonyQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseTestimonyQuery({ source: 'not-a-real-source' }).source, 'all')
  })
})

describe('parseComentionQuery (issue #207)', () => {
  it('snaps days/min the same as its neighbours, defaulting to 30/3', () => {
    assert.equal(parseComentionQuery({}).days, 30)
    assert.equal(parseComentionQuery({ days: 'nope' }).days, 30)
    assert.equal(parseComentionQuery({ days: '9999' }).days, 60)
    assert.equal(parseComentionQuery({}).min, 3)
    assert.equal(parseComentionQuery({ min: 'nope' }).min, 3)
    assert.equal(parseComentionQuery({ min: '4' }).min, 3)
    assert.equal(parseComentionQuery({ min: '5000' }).min, 5)
  })

  it('keeps source/lean at all on an unknown token, and threads a known one through', () => {
    assert.equal(parseComentionQuery({}).source, 'all')
    assert.equal(parseComentionQuery({ source: 'bogus' }).source, 'all')
    assert.equal(parseComentionQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseComentionQuery({}).lean, 'all')
    assert.equal(parseComentionQuery({ lean: 'bogus' }).lean, 'all')
    assert.equal(parseComentionQuery({ lean: 'left,bogus' }).lean, 'left')
  })

  it('has no domain, kind, sort or country field', () => {
    assert.deepEqual(Object.keys(parseComentionQuery({})).sort(), ['days', 'lean', 'min', 'source'])
  })
})

describe('parseCompareQuery (issue #93)', () => {
  it('days defaults to 30 and snaps to the nearest allowed window', () => {
    assert.equal(parseCompareQuery({}).days, 30)
    assert.equal(parseCompareQuery({ days: 'nope' }).days, 30)
    assert.equal(parseCompareQuery({ days: '0' }).days, 7)
    assert.equal(parseCompareQuery({ days: '9999' }).days, 60)
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

  it('bridges=1 opts in; anything else is absent, like testimony/communities (issue #219)', () => {
    assert.equal(parseCompareQuery({}).bridges, false)
    assert.equal(parseCompareQuery({ bridges: '1' }).bridges, true)
    assert.equal(parseCompareQuery({ bridges: 'yes' }).bridges, false)
  })
})

describe('parseLens / parseLensesQuery (issue #206)', () => {
  it('parses a domain: lens with a valid host', () => {
    assert.deepEqual(parseLens('domain:folha.uol.com.br'), { lens: 'domain:folha.uol.com.br', domain: 'folha.uol.com.br', lean: 'all', source: 'all' })
  })

  it('parses a lean: lens with a known value', () => {
    assert.deepEqual(parseLens('lean:right'), { lens: 'lean:right', domain: 'all', lean: 'right', source: 'all' })
  })

  it('parses a source: lens with a known source', () => {
    assert.deepEqual(parseLens('source:gkg'), { lens: 'source:gkg', domain: 'all', lean: 'all', source: 'gkg' })
  })

  it('falls back to all on a malformed domain, an unknown lean, an unknown source, an unknown prefix, or an absent value', () => {
    const all = { lens: 'all', domain: 'all', lean: 'all', source: 'all' }
    assert.deepEqual(parseLens('domain:NOT VALID'), all)
    assert.deepEqual(parseLens('lean:nonsense'), all)
    assert.deepEqual(parseLens('source:bogus'), all)
    assert.deepEqual(parseLens('bogus:x'), all)
    assert.deepEqual(parseLens(undefined), all)
    assert.deepEqual(parseLens(''), all)
  })

  it('lean: accepts only one value, not a list', () => {
    assert.deepEqual(parseLens('lean:left,right'), { lens: 'all', domain: 'all', lean: 'all', source: 'all' })
  })

  it('days snaps to the nearest allowed window, defaulting to 30', () => {
    assert.equal(parseLensesQuery({}).days, 30)
    assert.equal(parseLensesQuery({ days: '9999' }).days, 60)
  })

  it('kind defaults to all and delegates to the shared list parser', () => {
    assert.equal(parseLensesQuery({}).kind, 'all')
    assert.equal(parseLensesQuery({ kind: 'word,bogus' }).kind, 'word')
  })

  it('limit defaults to 40 and snaps to SMALL_LIMITS, same ceiling as compare', () => {
    assert.equal(parseLensesQuery({}).limit, 40)
    assert.equal(parseLensesQuery({ limit: '9999' }).limit, 100)
  })

  it('has no min field, like CompareQuery', () => {
    assert.ok(!('min' in parseLensesQuery({})))
  })

  it('resolves a and b independently', () => {
    const q = parseLensesQuery({ a: 'domain:folha.uol.com.br', b: 'lean:right' })
    assert.equal(q.a.lens, 'domain:folha.uol.com.br')
    assert.equal(q.b.lens, 'lean:right')
  })

  it('bridges=1 opts in; anything else is absent, same convention as compare (issue #219)', () => {
    assert.equal(parseLensesQuery({}).bridges, false)
    assert.equal(parseLensesQuery({ bridges: '1' }).bridges, true)
  })
})

describe('parseWeekQuery (issue #147)', () => {
  it('days default 7, limit default 8, both snap', () => {
    assert.equal(parseWeekQuery({}).days, 7)
    assert.equal(parseWeekQuery({ days: 'abc' }).days, 7)
    assert.equal(parseWeekQuery({ days: '18' }).days, 7)
    assert.equal(parseWeekQuery({ days: '30' }).days, 30)
    assert.equal(parseWeekQuery({}).limit, 8)
    assert.equal(LIMITS.includes(8), true)
    assert.equal(parseWeekQuery({ limit: '1' }).limit, 1)
    assert.equal(parseWeekQuery({ limit: '10' }).limit, 8)
  })

  // Parse-only: whether these parsed values actually reach weekFor and change its result is
  // pinned in test/graph.test.ts's weekFor describe ("AC5: source, domain and lean each narrow
  // about, not just kind"), which has the db fixture this test does not.
  it('source/kind/domain/lean parse as on /graph', () => {
    assert.equal(parseWeekQuery({ source: 'gnews,bogus' }).source, 'gnews')
    assert.equal(parseWeekQuery({ source: 'bogus' }).source, 'all')
    assert.equal(parseWeekQuery({ kind: 'theme' }).kind, 'all')
    assert.equal(parseWeekQuery({ kind: 'word,hashtag' }).kind, 'word,hashtag')
    assert.equal(parseWeekQuery({ domain: 'g1.globo.com,bogus host' }).domain, 'g1.globo.com')
    assert.equal(parseWeekQuery({ lean: 'left,bogus' }).lean, 'left')
  })

  it('method is null absent the flag, resolves to the shared default when testimony=1 with no method, echoes a valid method, falls back on an invalid one, and stays off on a non-"1" value', () => {
    assert.equal(parseWeekQuery({}).method, null)
    assert.equal(parseWeekQuery({ testimony: '1' }).method, parseQuery({ testimony: '1' }).method)
    assert.ok(parseWeekQuery({ testimony: '1' }).method)
    assert.equal(parseWeekQuery({ testimony: '1', method: 'stub' }).method, 'stub')
    assert.equal(parseWeekQuery({ testimony: '1', method: 'bad label!' }).method, parseWeekQuery({ testimony: '1' }).method)
    assert.equal(parseWeekQuery({ testimony: 'yes', method: 'stub' }).method, null)
  })
})

describe('brtMidnightUtc (issue #147)', () => {
  it('derives the day\'s midnight from the tz database, not a hardcoded offset', () => {
    assert.equal(brtMidnightUtc('2026-09-14').toISOString(), '2026-09-14T03:00:00.000Z')
    assert.equal(brtMidnightUtc('2026-01-01').toISOString(), '2026-01-01T03:00:00.000Z')
  })

  // Brazil has had no DST since 2019, so these are fixed history in the tz database, not dates
  // that can drift. Each expected value is what `'<day>'::timestamp at time zone
  // 'America/Sao_Paulo'` returns; test/graph.test.ts asserts that agreement against the database
  // itself. A day inside DST is 02:00Z; a transition day resolves to standard time either way,
  // because its local midnight is ambiguous (clocks back) or missing (clocks forward).
  it('agrees with `at time zone` across Brazil\'s DST transitions', () => {
    const expected: [string, string][] = [
      ['2018-11-03', '2018-11-03T03:00:00.000Z'], // day before clocks went forward
      ['2018-11-04', '2018-11-04T03:00:00.000Z'], // clocks forward; local midnight never happened
      ['2018-11-05', '2018-11-05T02:00:00.000Z'], // inside DST
      ['2019-02-16', '2019-02-16T02:00:00.000Z'], // still inside DST
      ['2019-02-17', '2019-02-17T03:00:00.000Z'], // clocks back; local midnight happened twice
      ['2019-02-18', '2019-02-18T03:00:00.000Z'], // after DST
    ]
    for (const [day, iso] of expected) assert.equal(brtMidnightUtc(day).toISOString(), iso, day)
  })
})

describe('parseDocsQuery.day (issue #147)', () => {
  it('keeps an overlapping calendar day; malformed, out-of-window and future become empty', () => {
    const today = brtDate()
    assert.equal(parseDocsQuery({ day: today }).day, today)
    const sep8 = parseDocsQuery({ day: '2026-09-08' }).day
    assert.ok(sep8 === '2026-09-08' || sep8 === '', '2026-09-08 is kept only while it overlaps the snapped window')
    assert.equal(parseDocsQuery({ day: '2026-02-31' }).day, '')
    assert.equal(parseDocsQuery({ day: 'nope' }).day, '')
    assert.equal(parseDocsQuery({}).day, '')
    assert.equal(parseDocsQuery({ day: '2020-01-01' }).day, '')
    assert.equal(calendarDay('2026-02-31'), '')
    const nudge = new Date(`${today}T15:00:00.000Z`)
    nudge.setUTCDate(nudge.getUTCDate() + 1)
    assert.equal(parseDocsQuery({ day: brtDate(nudge) }).day, '')
  })
})

describe('parseDocsQuery.with (issue #207)', () => {
  // The parser only trims and rejects the route's own :id (self co-mention); it no longer
  // validates against a tracked-person id set. Existence is a table lookup the /api/people/:id/docs
  // handler makes against the live persons table (server.ts), the same pattern /api/compare uses,
  // so a seed.json edit never lags the next deploy (issue #235 review).
  it('trims and keeps an id even when it names no tracked person -- the parser does not check existence', () => {
    assert.equal(parseDocsQuery({ with: 'not-a-tracked-person' }, 'lula').with, 'not-a-tracked-person')
    assert.equal(parseDocsQuery({ with: '' }, 'lula').with, '')
    assert.equal(parseDocsQuery({}, 'lula').with, '')
  })

  it('drops with equal to the route\'s own :id', () => {
    assert.equal(parseDocsQuery({ with: 'lula' }, 'lula').with, '')
  })

  it('keeps another id, trimmed', () => {
    assert.equal(parseDocsQuery({ with: 'tarcisio' }, 'lula').with, 'tarcisio')
    assert.equal(parseDocsQuery({ with: '  tarcisio  ' }, 'lula').with, 'tarcisio')
  })

  it('falls back to no filter when personId is omitted, like every caller that predates with', () => {
    assert.equal(parseDocsQuery({ with: 'tarcisio' }).with, 'tarcisio')
    assert.equal(parseDocsQuery({}).with, '')
  })
})

describe('parseCandidatesQuery (issue #32)', () => {
  it('uses 7 / 5 / 50 as defaults', () => {
    assert.deepEqual(parseCandidatesQuery({}), { days: 7, min: 5, limit: 50 })
  })

  it('snaps out-of-range values to the nearest allowed one and falls back on garbage', () => {
    assert.deepEqual(parseCandidatesQuery({ days: '9999', min: '0', limit: '-3' }), { days: 60, min: 1, limit: 1 })
    assert.deepEqual(parseCandidatesQuery({ days: '0', min: '0', limit: '-3' }), { days: 7, min: 1, limit: 1 })
    assert.deepEqual(parseCandidatesQuery({ days: 'abc', min: '2000', limit: '999' }), { days: 7, min: 5, limit: 200 })
  })
})

describe('parseScope (issue #195)', () => {
  it('snaps days onto DAYS with the given default and normalizes the four lists', () => {
    assert.deepEqual(parseScope({}, { days: 7 }), { days: 7, source: 'all', domain: 'all', lean: 'all', kind: 'all', country: 'br' })
    assert.deepEqual(
      parseScope({ days: '40', source: 'rss, gkg,rss', domain: 'g1.globo.com,BAD HOST', lean: 'left,nope', kind: 'word,theme' }, { days: 30 }),
      { days: 30, source: 'rss,gkg', domain: 'g1.globo.com', lean: 'left', kind: 'word', country: 'br' },
    )
  })

  it('is the recorte every route with those fields reads', () => {
    const q = { days: '60', source: 'gkg,rss', domain: 'g1.globo.com', lean: 'right', kind: 'phrase', country: 'all' }
    const scope = parseScope(q, { days: 30 })
    for (const parse of [parseQuery, parseDocsQuery, parseRisingQuery, parseTimelineQuery, parseCompareQuery, parseWeekQuery]) {
      const { days, source, domain, lean, kind, country } = parse(q)
      assert.deepEqual({ days, source, domain, lean, kind, country }, scope, parse.name)
    }
  })
})

// issue #204
describe('parseCountryList', () => {
  it('falls back to br, not all, when omitted or entirely invalid -- unlike every other shared filter', () => {
    assert.equal(parseCountryList(undefined), 'br')
    assert.equal(parseCountryList(''), 'br')
    assert.equal(parseCountryList('xx'), 'br')
  })

  it('all is the explicit opt-in to include .pt docs', () => {
    assert.equal(parseCountryList('all'), 'all')
  })

  it('pt alone asks for .pt docs only', () => {
    assert.equal(parseCountryList('pt'), 'pt')
  })

  it('collapses to all when both known tokens are named, or all is named alongside another', () => {
    assert.equal(parseCountryList('br,pt'), 'all')
    assert.equal(parseCountryList('pt,br'), 'all')
    assert.equal(parseCountryList('all,pt'), 'all')
    assert.equal(parseCountryList('pt,br,all'), 'all')
  })

  it('drops an unknown token silently and honors the survivor, rather than falling back', () => {
    assert.equal(parseCountryList('pt,xx'), 'pt')
  })

  it('is case-sensitive: BR is not a known token', () => {
    assert.equal(parseCountryList('BR'), 'br')
  })

  it('parseScope and every route parser (graph, docs, rising, timeline, compare, week) agree on country', () => {
    const cases: Record<string, 'br' | 'pt' | 'all'> = { '': 'br', xx: 'br', all: 'all', pt: 'pt', 'br,pt': 'all' }
    for (const [input, expected] of Object.entries(cases)) {
      const q = { country: input }
      assert.equal(parseScope(q, { days: 30 }).country, expected, `parseScope(${input})`)
      for (const parse of [parseQuery, parseDocsQuery, parseRisingQuery, parseTimelineQuery, parseCompareQuery, parseWeekQuery]) {
        assert.equal(parse(q).country, expected, `${parse.name}(${input})`)
      }
    }
  })
})

describe('KINDS (issue #108)', () => {
  it("matches ATLAS_KINDS's set exactly (issue #195/#209)", () => {
    assert.deepEqual(new Set(KINDS), new Set(ATLAS_KINDS.split(',')))
  })

  it('no longer accepts the token theme, and now also accepts org', () => {
    assert.ok(!KINDS.includes('theme'))
    assert.deepEqual(KINDS, ['hashtag', 'word', 'phrase', 'org'])
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
  ['parseWeekQuery', parseWeekQuery, 7],
]

describe('days enumeration acceptance criteria (issue #111)', () => {
  it('the allowed windows are exactly the ones every period <select> in atlas.html offers, 30 selected, none offering 365', () => {
    type Node = { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[]; value?: string; content?: Node }
    const walk = (n: Node): Node[] => [n, ...[...(n.childNodes ?? []), ...(n.content ? [n.content] : [])].flatMap(walk)]
    const attr = (n: Node, name: string) => n.attrs?.find((a) => a.name === name)?.value
    const text = (n: Node): string => (n.childNodes ?? []).map((c) => (c.tagName ? text(c) : c.value ?? '')).join('')
    const page = walk(parse(pageMarkup('/')) as Node)
    const ids = ['days', 'testimonyDays', 'compareDays', 'lensesDays', 'agendaDays', 'comentionDays']
    for (const id of ids) {
      const select = page.find((n) => n.tagName === 'select' && attr(n, 'id') === id)
      assert.ok(select, `atlas.html has no #${id}`)
      const options = walk(select).filter((n) => n.tagName === 'option')
      assert.deepEqual(options.map((o) => Number(attr(o, 'value'))), DAYS, id)
      assert.deepEqual(options.filter((o) => attr(o, 'selected') !== undefined).map((o) => attr(o, 'value')), ['30'], id)
      assert.equal(text(options[2]), id === 'lensesDays' ? '60 dias' : 'últimos 60 dias', id)
    }
  })

  it('DAYS is 7, 30 and 60, and anything wider snaps to 60 (issue #270)', () => {
    assert.deepEqual(DAYS, [7, 30, 60])
    assert.equal(snapDays('365', 30), 60)
    assert.equal(snapDays('9999', 30), 60)
    assert.equal(snapDays('45', 30), 30)
    assert.equal(snapDays('46', 30), 60)
    assert.equal(snapDays('18', 30), 7)
    assert.equal(snapDays('19', 30), 30)
  })

  it('every parser that reads days keeps its own default when days is absent or non-numeric', () => {
    for (const [name, parse, fallback] of dayParsers) {
      assert.equal(parse({}).days, fallback, name)
      assert.equal(parse({ days: 'abc' }).days, fallback, name)
      assert.equal(parse({ days: '' }).days, fallback, name)
      assert.ok(DAYS.includes(fallback), `${name}'s default must itself be an allowed window`)
    }
  })

  it('an allowed window travels through every parser unchanged', () => {
    for (const [name, parse] of dayParsers) {
      for (const d of DAYS) assert.equal(parse({ days: String(d) }).days, d, `${name} days=${d}`)
    }
  })

  it('any other value snaps to the nearest allowed window, ties to the shorter one', () => {
    // 18.5 is the midpoint of 7 and 30; 45 the midpoint of 30 and 60.
    const cases: [string, number][] = [
      ['1', 7],
      ['0', 7],
      ['-5', 7],
      ['18', 7],
      ['19', 30],
      ['45', 30],
      ['46', 60],
      ['197', 60],
      ['365', 60],
      ['9999', 60],
    ]
    for (const [name, parse] of dayParsers) {
      for (const [given, expected] of cases) assert.equal(parse({ days: given }).days, expected, `${name} days=${given}`)
    }
  })

  it('the whole reachable surface is DAYS, so days cannot bust the cache', () => {
    const reached = new Set<number>()
    for (let n = -1000; n <= 1000; n++) reached.add(snapDays(String(n), 30))
    assert.deepEqual([...reached].sort((a, b) => a - b), DAYS)
  })

  it('snapDays never returns a value outside DAYS for a numeric input', () => {
    for (const v of ['3', '12', '90', '180', '366', '1e6', '30.9', '  45  ']) assert.ok(DAYS.includes(snapDays(v, 30)))
  })

  it('docs/api.md documents the enumeration and every window in it', () => {
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
  ['parseRisingQuery', parseRisingQuery, { limit: [40, SMALL_LIMITS], min: [3, MINS], baseline: [30, BASELINES] }],
  ['parseToneQuery', parseToneQuery, { min: [3, MINS] }],
  ['parseTestimonyQuery', parseTestimonyQuery, { min: [3, MINS] }],
  ['parseCandidatesQuery', parseCandidatesQuery, { limit: [50, LIMITS], min: [5, MINS] }],
  ['parseCompareQuery', parseCompareQuery, { limit: [40, SMALL_LIMITS] }],
  ['parseWeekQuery', parseWeekQuery, { limit: [8, LIMITS] }],
]

const numbers = (markup: string) => [...markup.matchAll(/<option[^>]*>(\d+)<\/option>|value="(\d+)"/g)].map((m) => Number(m[1] ?? m[2]))

describe('parameter enumeration acceptance criteria (issue #127)', () => {
  it('every limit the page sends is a member of LIMITS', () => {
    const page = pageMarkup('/')
    const atlas = page.match(/<select id="limit"[\s\S]*?<\/select>/)?.[0]
    assert.ok(atlas, 'atlas.html should carry the atlas limit select')
    const offered = numbers(atlas)
    assert.ok(offered.length >= 3)
    for (const v of offered) assert.ok(LIMITS.includes(v), `atlas offers limit=${v}`)
    // The compareLimit select is built by figures/compare.ts at mount, so its half of this
    // check is a mount test in test/figures-compare.test.ts.

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

  it('every parser keeps its own default when the parameter is absent or non-numeric, and every default is in its set', () => {
    for (const [name, parse, fields] of intParsers) {
      for (const [field, [fallback, set]] of Object.entries(fields)) {
        assert.equal(parse({})[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: 'abc' })[field], fallback, `${name}.${field}`)
        assert.equal(parse({ [field]: '' })[field], fallback, `${name}.${field}`)
        assert.ok(set.includes(fallback), `${name}'s default ${field}=${fallback} must itself be allowed`)
      }
    }
  })

  it('an allowed value travels through every parser unchanged', () => {
    for (const [name, parse, fields] of intParsers) {
      for (const [field, [, set]] of Object.entries(fields)) {
        for (const v of set) assert.equal(parse({ [field]: String(v) })[field], v, `${name} ${field}=${v}`)
      }
    }
  })

  it('any other value snaps to the nearest allowed one, ties to the smaller', () => {
    const cases: [string, readonly number[], string, number][] = [
      ['limit', LIMITS, '0', 1],
      ['limit', LIMITS, '-3', 1],
      ['limit', LIMITS, '3', 1],
      ['limit', LIMITS, '6', 5],
      ['limit', LIMITS, '7', 8],
      ['limit', LIMITS, '10', 8],
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

  it('the whole reachable surface of each parameter is its set, so none can bust the cache', () => {
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

  it('the sets are ascending, and SMALL_LIMITS is LIMITS capped at 100 (rising and compare, issue #93)', () => {
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

  it('snapDays is snapTo over DAYS, so the two enumerations cannot drift apart', () => {
    for (const v of ['-5', '0', '18', '19', '45', '46', '197', '198', '365', '9999', 'abc', undefined]) assert.equal(snapDays(v, 30), snapTo(DAYS, v, 30))
  })

  it('docs/api.md names every value of every set', () => {
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

describe('sort=reach (issue #210)', () => {
  it('sort=reach resolves to count', () => {
    assert.equal(parseQuery({ sort: 'reach' }).sort, 'count')
    assert.equal(parseQuery({ sort: 'pmi' }).sort, 'pmi')
  })
})

describe('parsePersistenceQuery (issue #215)', () => {
  it('snaps weeks onto 4, 12, 26 with a tie to the smaller value, and limit onto LIMITS', () => {
    assert.equal(parsePersistenceQuery({}).weeks, 12)
    assert.equal(parsePersistenceQuery({ weeks: '8' }).weeks, 4)
    assert.equal(parsePersistenceQuery({ weeks: '19' }).weeks, 12)
    assert.equal(parsePersistenceQuery({ weeks: '26' }).weeks, 26)
    assert.equal(parsePersistenceQuery({ weeks: '1000' }).weeks, 26)
    assert.equal(parsePersistenceQuery({ weeks: 'abc' }).weeks, 12)
    assert.equal(parsePersistenceQuery({}).limit, 40)
    assert.equal(parsePersistenceQuery({ limit: '41' }).limit, 40)
    assert.equal(parsePersistenceQuery({ limit: '7' }).limit, 8)
    assert.ok(LIMITS.includes(parsePersistenceQuery({ limit: '999' }).limit))
  })

  it('ignores an unknown key and answers nothing but weeks and limit', () => {
    assert.deepEqual(parsePersistenceQuery({ source: 'rss', days: '7', kind: 'word' }), { weeks: 12, limit: 40 })
  })
})

describe('mondayOf and addDays', () => {
  it('snap any calendar date to its Monday by pure date arithmetic', () => {
    assert.equal(mondayOf('2026-10-12'), '2026-10-12')
    assert.equal(mondayOf('2026-10-14'), '2026-10-12')
    assert.equal(mondayOf('2026-10-18'), '2026-10-12')
    assert.equal(mondayOf('2026-10-19'), '2026-10-19')
    assert.equal(mondayOf('2026-01-01'), '2025-12-29')
    assert.equal(addDays('2026-10-12', -7), '2026-10-05')
    assert.equal(addDays('2026-12-28', 7), '2027-01-04')
  })
})

describe('parseDocsQuery.week (issue #215)', () => {
  const now = new Date('2026-10-14T15:00:00Z')
  const parse = (q: Record<string, string>) => parseDocsQuery(q, 'lula', now)

  it('snaps to the Monday of the date given, a Wednesday or a Sunday alike', () => {
    for (const date of ['2026-10-12', '2026-10-14', '2026-10-05', '2026-10-11']) assert.equal(parse({ week: date }).week, mondayOf(date), date)
    assert.equal(parse({ week: '2026-10-18' }).week, '2026-10-12', 'a future date inside the current week still snaps to its Monday')
  })

  it('is empty when omitted, malformed, future, or outside the days window', () => {
    assert.equal(parse({}).week, '')
    assert.equal(parse({ week: 'nope' }).week, '')
    assert.equal(parse({ week: '2026-02-31' }).week, '')
    assert.equal(parse({ week: '2026-10-19' }).week, '')
    assert.equal(parse({ week: '2026-08-03' }).week, '')
    assert.equal(parse({ week: '2026-09-28', days: '7' }).week, '')
    assert.equal(parse({ week: '2026-10-05', days: '7' }).week, '2026-10-05')
  })

  it('a week only touching the window by its last day is kept, one just past the edge is not', () => {
    const edge = (iso: string) => parseDocsQuery({ week: '2026-10-05', days: '7' }, 'lula', new Date(iso)).week
    assert.equal(edge('2026-10-19T02:00:00Z'), '2026-10-05')
    assert.equal(edge('2026-10-19T04:00:00Z'), '')
  })

  it('a resolved day wins over the week', () => {
    assert.equal(parse({ day: '2026-10-14', week: '2026-10-05' }).week, '')
    assert.equal(parse({ day: '2026-10-14', week: '2026-10-05' }).day, '2026-10-14')
    assert.equal(parse({ day: '2026-10-14', week: 'nope' }).week, '')
  })

  it('malformed day plus valid week keeps the week; so do a future and an out-of-window day', () => {
    assert.equal(parse({ day: 'nope', week: '2026-10-12' }).week, '2026-10-12')
    assert.equal(parse({ day: '2099-01-01', week: '2026-10-12' }).week, '2026-10-12')
    assert.equal(parse({ day: '2020-01-01', week: '2026-10-12' }).week, '2026-10-12')
    assert.equal(parse({ day: 'nope', week: '2026-10-12' }).day, '')
  })

  it('every parse carries week as a string, never undefined', () => {
    assert.equal(typeof parseDocsQuery({}).week, 'string')
  })
})
