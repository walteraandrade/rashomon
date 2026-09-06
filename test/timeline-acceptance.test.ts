import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, timelineFor, type TimelineQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'

// Independent verification of issue #4's numbered acceptance criteria, written against
// the spec rather than against test/timeline.test.ts. Values below are derived from the
// fixture's own dated offsets (docs 20-24), not copied from the builder's assertions.
const base: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', bucket: 'week' }
const [lula, , bolsonaro] = persons
const golpe = { term: 'golpe', kind: 'word', days: 2140, source: 'all', domain: 'all' } as const

describe('timeline acceptance criteria (issue #4)', () => {
  before(seed)

  it('AC1: default window returns ceil(30/7) = 5 buckets, oldest bucket_start first', async () => {
    const rows = await timelineFor(lula, base)
    assert.equal(rows.length, 5)
    for (const r of rows) assert.ok('bucket_start' in r && 'count' in r)
    for (let i = 1; i < rows.length; i++) {
      assert.ok(new Date(rows[i - 1].bucket_start).getTime() < new Date(rows[i].bucket_start).getTime())
    }
  })

  it('AC2: bucket counts sum to docsFor total for the same term/kind/days/source/domain', async () => {
    const rows = await timelineFor(lula, base)
    const sum = rows.reduce((acc, r) => acc + r.count, 0)
    const { total } = await docsFor(lula, { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', limit: 200, offset: 0 })
    assert.equal(total, 4, 'sanity: known fixture total for lula in the default window')
    assert.equal(sum, total)
  })

  it('AC2: also holds for a scoped term/kind/days window with multiple non-empty buckets', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, ...golpe })
    const sum = rows.reduce((acc, r) => acc + r.count, 0)
    const { total } = await docsFor(bolsonaro, { term: golpe.term, kind: golpe.kind, days: golpe.days, source: golpe.source, domain: golpe.domain, limit: 200, offset: 0 })
    assert.equal(sum, total)
  })

  it('AC3: a zero-count week bucket sits between two clusters of "golpe" docs, not omitted', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, ...golpe })
    assert.equal(rows.length, 306, 'ceil(2140/7)')
    // doc /23 (2139 days ago) lands in the oldest (edge-clamped) bucket -> row 0
    // doc /22 (2116 days ago) lands 3 week-buckets later -> row 3
    // docs /20,/21 (2102/2105 days ago, same calendar week) merge into one bucket -> row 5
    assert.equal(rows[0].count, 1)
    assert.equal(rows[1].count, 0)
    assert.equal(rows[2].count, 0)
    assert.equal(rows[3].count, 1)
    assert.equal(rows[4].count, 0, 'a zero bucket must separate the row-3 and row-5 clusters')
    assert.equal(rows[5].count, 2)
  })

  it('AC4: bucket=day splits a pair of docs from the same week into two day-buckets of 1', async () => {
    const day = await timelineFor(bolsonaro, { ...golpe, bucket: 'day' })
    assert.equal(day.length, 2140)
    // 2102 and 2105 days ago are 3 calendar days apart: distinct day-buckets, count 1 each
    const nonZero = day.filter((r) => r.count > 0)
    assert.equal(nonZero.length, 4, 'four golpe docs land in four distinct day-buckets')
    for (const r of nonZero) assert.equal(r.count, 1)
  })

  it('AC4: the same window merges into fewer, higher-count buckets with bucket=week', async () => {
    const week = await timelineFor(bolsonaro, { ...golpe, bucket: 'week' })
    const nonZero = week.filter((r) => r.count > 0).map((r) => r.count).sort((a, b) => a - b)
    assert.deepEqual(nonZero, [1, 1, 2])
  })

  it('AC5: without a term, kind has no effect on the per-bucket counts', async () => {
    const withHashtag = await timelineFor(lula, { ...base, kind: 'hashtag' })
    const withTheme = await timelineFor(lula, { ...base, kind: 'theme' })
    const withAll = await timelineFor(lula, { ...base, kind: 'all' })
    const sumOf = (rows: Awaited<ReturnType<typeof timelineFor>>) => rows.reduce((a, r) => a + r.count, 0)
    assert.equal(sumOf(withHashtag), sumOf(withAll))
    assert.equal(sumOf(withTheme), sumOf(withAll))
  })

  it('AC6: an unrecognized kind still matches the term under any kind, like docsFor', async () => {
    const bogus = await timelineFor(bolsonaro, { ...base, ...golpe, kind: 'not-a-real-kind' })
    const all = await timelineFor(bolsonaro, { ...base, ...golpe, kind: 'all' })
    const sumOf = (rows: Awaited<ReturnType<typeof timelineFor>>) => rows.reduce((a, r) => a + r.count, 0)
    assert.equal(sumOf(bogus), sumOf(all))
    assert.ok(sumOf(bogus) > 0, 'sanity: the term actually matches something')
  })

  it('AC7: a person with zero docs anywhere gets every bucket at zero, no error', async () => {
    const ghost = { id: 'ghost', name: 'Ghost', aliases: ['Ghost'] }
    const rows = await timelineFor(ghost, base)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })

  it('AC8: a window narrow enough to hold no docs still returns a full zero-filled bucket list', async () => {
    // bolsonaro's earliest doc is 2102 days ago, so a 1-day window is guaranteed empty
    const rows = await timelineFor(bolsonaro, { ...base, days: 1 })
    assert.equal(rows.length, 1, 'ceil(1/7) = 1')
    assert.equal(rows[0].count, 0)
  })

  it('AC9: filtering by source to a matching value narrows counts like docsFor', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, ...golpe, source: 'gnews' })
    const sum = rows.reduce((a, r) => a + r.count, 0)
    assert.equal(sum, 1, 'only doc /21 (oantagonista.com.br) is gnews')
  })

  it('AC9: filtering by domain to a matching value narrows counts like docsFor', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, ...golpe, domain: 'oantagonista.com.br' })
    const sum = rows.reduce((a, r) => a + r.count, 0)
    assert.equal(sum, 1)
  })

  it('AC9: filtering by source/domain to a value with zero matches zeroes every bucket without erroring', async () => {
    const bySource = await timelineFor(bolsonaro, { ...base, ...golpe, source: 'bluesky' })
    const byDomain = await timelineFor(bolsonaro, { ...base, ...golpe, domain: 'nonexistent.example' })
    assert.ok(bySource.every((r) => r.count === 0))
    assert.ok(byDomain.every((r) => r.count === 0))
  })

  it('AC12: no bucket row ever carries a tone field', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, ...golpe })
    assert.ok(rows.length > 0)
    for (const r of rows) assert.ok(!('tone' in r))
  })
})
