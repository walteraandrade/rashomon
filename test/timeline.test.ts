import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, timelineFor, type TimelineQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import './close.js'

const base: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', bucket: 'week' }
const [lula, , bolsonaro] = persons

describe('timelineFor', () => {
  before(seed)

  it('AC1: returns ceil(days/bucket_days) buckets, oldest first, for the default window', async () => {
    const rows = await timelineFor(lula, base)
    assert.equal(rows.length, 5)
    for (let i = 1; i < rows.length; i++) {
      assert.ok(new Date(rows[i - 1].bucket_start).getTime() <= new Date(rows[i].bucket_start).getTime())
    }
  })

  it('AC2: bucket counts sum to the equivalent docsFor total', async () => {
    const q = { ...base, term: 'golpe', kind: 'word', days: 2140 }
    const rows = await timelineFor(bolsonaro, q)
    const sum = rows.reduce((a, r) => a + r.count, 0)
    const { total } = await docsFor(bolsonaro, { term: q.term, kind: q.kind, days: q.days, source: q.source, domain: q.domain, lean: q.lean, limit: 50, offset: 0 })
    assert.equal(total, 4)
    assert.equal(sum, total)
  })

  it('AC3: zero-count buckets are present, not omitted', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 2140 })
    const nonZeroIdx = rows.map((r, i) => (r.count > 0 ? i : -1)).filter((i) => i >= 0)
    assert.equal(nonZeroIdx.length, 3, 'three distinct week buckets should hold docs')
    assert.ok(nonZeroIdx[1] - nonZeroIdx[0] > 1, 'a zero bucket must sit between the first two clusters')
    assert.ok(nonZeroIdx[2] - nonZeroIdx[1] > 1, 'a zero bucket must sit between the last two clusters')
    assert.deepEqual(
      rows.filter((r) => r.count > 0).map((r) => r.count).sort((a, b) => b - a),
      [2, 1, 1],
    )
  })

  it('AC4: day buckets split what a week bucket merges', async () => {
    const q = { term: 'golpe', kind: 'word', days: 2140, source: 'all', domain: 'all', lean: 'all' } as const
    const day = await timelineFor(bolsonaro, { ...q, bucket: 'day' })
    const week = await timelineFor(bolsonaro, { ...q, bucket: 'week' })
    assert.deepEqual(day.filter((r) => r.count > 0).map((r) => r.count).sort(), [1, 1, 1, 1])
    assert.deepEqual(week.filter((r) => r.count > 0).map((r) => r.count).sort((a, b) => b - a), [2, 1, 1])
  })

  it('AC5: without a term, kind has no effect and every doc about the person counts', async () => {
    const q = { term: '', days: 2151, source: 'all', domain: 'all', lean: 'all', bucket: 'week' } as const
    const withHashtagKind = await timelineFor(bolsonaro, { ...q, kind: 'hashtag' })
    const withAllKind = await timelineFor(bolsonaro, { ...q, kind: 'all' })
    const sumHashtag = withHashtagKind.reduce((a, r) => a + r.count, 0)
    const sumAll = withAllKind.reduce((a, r) => a + r.count, 0)
    // doc /37 (day 35, issue #5's two-person tone fixture) also names bolsonaro, widening this
    // window's count from 5 to 6
    assert.equal(sumHashtag, 6)
    assert.equal(sumAll, 6)
  })

  it('AC6: an unrecognized kind still matches the term under any kind', async () => {
    const bogus = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'bogus', days: 2140 })
    const all = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'all', days: 2140 })
    assert.equal(bogus.reduce((a, r) => a + r.count, 0), 4)
    assert.equal(all.reduce((a, r) => a + r.count, 0), 4)
  })

  it('AC7: a person without docs gets every bucket at zero', async () => {
    const rows = await timelineFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })

  it('AC8: an empty window still returns a full, zero-filled bucket list', async () => {
    const rows = await timelineFor(bolsonaro, base)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })

  it('AC9: source and domain narrow counts the same way they narrow docsFor', async () => {
    const bySource = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 2140, source: 'gnews' })
    const byDomain = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 2140, domain: 'oantagonista.com.br' })
    const byMiss = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 2140, source: 'bluesky' })
    assert.equal(bySource.reduce((a, r) => a + r.count, 0), 1)
    assert.equal(byDomain.reduce((a, r) => a + r.count, 0), 1)
    assert.equal(byMiss.reduce((a, r) => a + r.count, 0), 0)
    assert.ok(byMiss.every((r) => r.count === 0))
  })

  it('AC12: no bucket row ever carries a tone field', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 2140 })
    assert.ok(rows.every((r) => !('tone' in r)))
  })
})
