import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  DAYS,
  parseCandidatesQuery,
  parseCompareQuery,
  parseDocsQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
  snapDays,
} from '../src/query.js'

// Issue #111, step 3: `days` used to clamp to [1, 365], so every value in that range was its own
// CDN key and its own cold invocation. These criteria are written against the issue, not against
// the implementation: what matters is that the reachable surface is the handful of windows the
// page offers, that a stray value lands on the nearest of them, and that no default moves.

// Every parser that reads `days`, with the default it must keep when `days` is absent.
const parsers: [string, (q: Record<string, string | undefined>) => { days: number }, number][] = [
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
    for (const [name, parse, fallback] of parsers) {
      assert.equal(parse({}).days, fallback, name)
      assert.equal(parse({ days: 'abc' }).days, fallback, name)
      assert.equal(parse({ days: '' }).days, fallback, name)
      assert.ok(DAYS.includes(fallback), `${name}'s default must itself be an allowed window`)
    }
  })

  it('AC3: an allowed window travels through every parser unchanged', () => {
    for (const [name, parse] of parsers) {
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
    for (const [name, parse] of parsers) {
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
