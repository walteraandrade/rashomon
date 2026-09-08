import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { risingFor, type RisingQuery } from '../src/graph.js'
import { nameTokens } from '../src/extract.js'
import { persons, seed } from './fixture.js'
import './close.js'

// Independent verification of issue #3's numbered acceptance criteria. Query shape
// (limit/min) deliberately differs from graph.test.ts's risingBase so a passing
// assertion here exercises real behaviour, not an accidental match on shared defaults.
// limit:15 (was 10): doc /38 (gkg, issue #8's press-vs-network fixture) adds six
// single-mention terms to the recent window, pushing "defende"/"fiscal"/"estabilidade"
// past a limit of 10.
const base: RisingQuery = { days: 7, baseline: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 15, min: 1 }
const [lula] = persons
const nobody = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }

const rnode = (r: Awaited<ReturnType<typeof risingFor>>, id: string) => r.terms.find((t) => `${t.kind}:${t.term}` === id)
const rate = (raw: number, span: number) => Math.round((raw / span) * 100) / 100
const lift = (cRecent: number, days: number, cBaseline: number, baseline: number) =>
  Math.round(((cRecent / days) / ((cBaseline + 1) / baseline)) * 100) / 100

describe('rising acceptance criteria (issue #3)', () => {
  before(seed)

  it('AC2: response has { days, baseline, terms } and terms sorted by lift desc, ties by term asc', async () => {
    const r = await risingFor(lula, base)
    assert.equal(r.days, 7)
    assert.equal(r.baseline, 30)
    assert.ok(Array.isArray(r.terms) && r.terms.length > 1, 'sanity: need more than one row to exercise ordering')
    for (let i = 1; i < r.terms.length; i++) {
      const prev = r.terms[i - 1]
      const cur = r.terms[i]
      assert.ok(
        prev.lift > cur.lift || (prev.lift === cur.lift && prev.term < cur.term),
        `row ${i - 1} (${prev.term}, lift ${prev.lift}) must sort before row ${i} (${cur.term}, lift ${cur.lift})`,
      )
    }
  })

  it('AC3: count_recent/count_baseline are the raw window doc counts divided by window length, rounded to 2 decimals', async () => {
    const r = await risingFor(lula, base)
    // "anuncia" appears once in doc /1 (day1, recent) and never in the 8-37-day baseline
    const anuncia = rnode(r, 'word:anuncia')
    assert.equal(anuncia?.count_recent, rate(1, 7))
    assert.equal(anuncia?.count_baseline, rate(0, 30))
    // "defende" appears once in doc /5 (day1, recent) and once in doc /17 (day31, baseline)
    const defende = rnode(r, 'word:defende')
    assert.equal(defende?.count_recent, rate(1, 7))
    assert.equal(defende?.count_baseline, rate(1, 30))
  })

  it('AC4: lift matches the pinned formula exactly', async () => {
    const r = await risingFor(lula, base)
    const defende = rnode(r, 'word:defende')
    assert.equal(defende?.lift, lift(1, 7, 1, 30))
    const anuncia = rnode(r, 'word:anuncia')
    assert.equal(anuncia?.lift, lift(1, 7, 0, 30))
  })

  it('AC5: a term absent from the baseline outranks one present in it at the same recent rate', async () => {
    const r = await risingFor(lula, base)
    const anuncia = rnode(r, 'word:anuncia') // baseline-absent
    const defende = rnode(r, 'word:defende') // present once in the baseline
    assert.equal(anuncia?.count_recent, defende?.count_recent, 'sanity: same recent rate')
    assert.equal(anuncia?.count_baseline, 0)
    assert.ok((anuncia?.lift ?? 0) > (defende?.lift ?? 0))
  })

  it('AC6: a term whose per-day rate is unchanged between symmetric windows has lift exactly 1', async () => {
    const r = await risingFor(lula, { ...base, days: 40, baseline: 40 })
    // "fiscal"/"estabilidade" have 2 mentions in the last 40 days (day31, day35)
    // and 1 mention in the 40 days before that (day50)
    assert.equal(rnode(r, 'word:fiscal')?.lift, 1)
    assert.equal(rnode(r, 'word:estabilidade')?.lift, 1)
  })

  it('AC7: min filters on the raw recent count, and lowering it includes the term again', async () => {
    const below = await risingFor(lula, { ...base, min: 1 })
    assert.ok(rnode(below, 'word:anuncia'), '"anuncia" has a raw recent count of 1')
    const above = await risingFor(lula, { ...base, min: 2 })
    assert.equal(rnode(above, 'word:anuncia'), undefined)
  })

  it('AC8: the person own alias tokens never appear as a term', async () => {
    const excluded = new Set(nameTokens(lula))
    const r = await risingFor(lula, { ...base, days: 2000, baseline: 2000 })
    assert.ok(r.terms.length > 0, 'sanity: wide window must yield rows to make the check meaningful')
    for (const t of r.terms) assert.ok(!excluded.has(t.term), `${t.term} is a name token and must be excluded`)
  })

  it('AC9: kind filters both windows identically', async () => {
    const hashtagOnly = await risingFor(lula, { ...base, kind: 'hashtag' })
    assert.ok(hashtagOnly.terms.length > 0)
    assert.ok(hashtagOnly.terms.every((t) => t.kind === 'hashtag'))
    const wordOnly = await risingFor(lula, { ...base, kind: 'word' })
    assert.ok(wordOnly.terms.every((t) => t.kind === 'word'))
  })

  it('AC9: source filters both windows identically', async () => {
    const bluesky = await risingFor(lula, { ...base, source: 'bluesky', days: 30, baseline: 30 })
    assert.ok(bluesky.terms.some((t) => t.term === 'disputam'))
    assert.ok(!bluesky.terms.some((t) => t.term === 'reforma'), 'reforma never appears in the bluesky doc')
  })

  it('AC9: domain filters both windows identically', async () => {
    const domainScoped = await risingFor(lula, { ...base, domain: 'g1.globo.com' })
    assert.ok(domainScoped.terms.some((t) => t.term === 'anuncia'))
    assert.ok(!domainScoped.terms.some((t) => t.term === 'defende'), 'defende only appears on valor.globo.com')
  })

  it('AC10: returns an empty terms array for a person without docs', async () => {
    const r = await risingFor(nobody, base)
    assert.deepEqual(r, { days: 7, baseline: 30, terms: [], outlets: [] })
  })

  it('AC10: returns an empty terms array for an empty recent window', async () => {
    const r = await risingFor(lula, { ...base, days: 1 })
    assert.deepEqual(r.terms, [])
  })

  it('AC11: limit clamps the returned rows without altering their order', async () => {
    const full = await risingFor(lula, { ...base, limit: 100 })
    assert.ok(full.terms.length > 1, 'sanity: need more than one qualifying term for the clamp to be meaningful')
    const clamped = await risingFor(lula, { ...base, limit: 1 })
    assert.equal(clamped.terms.length, 1)
    assert.deepEqual(clamped.terms[0], full.terms[0])
  })
})
