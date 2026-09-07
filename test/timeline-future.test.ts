import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { insertDoc } from '../src/store.js'
import { docsFor, timelineFor, type TimelineQuery } from '../src/graph.js'
import { persons, seed, futureDoc } from './fixture.js'

// Runs in its own process (node:test isolates one process per file), so seeding an
// extra future-dated doc here on top of the normal fixture cannot shift the
// person-agnostic `scope` totals that graph.test.ts/signature*.test.ts hardcode
// against in their own, separate processes.
const base: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', bucket: 'week' }
const [, , bolsonaro] = persons

describe('timelineFor: future-dated doc', () => {
  before(async () => {
    await seed()
    await insertDoc(futureDoc, persons)
  })

  it('lands in the newest bucket instead of falling through the open upper bound', async () => {
    const rows = await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word', days: 30 })
    assert.ok(rows.length > 0)
    assert.equal(rows[rows.length - 1].count, 1, 'the newest (last) bucket must hold the future doc')
  })

  it('keeps the bucket-sum invariant against docsFor total when a doc is future-dated', async () => {
    const q = { term: 'golpe', kind: 'word', days: 30, source: 'all', domain: 'all', lean: 'all' } as const
    const rows = await timelineFor(bolsonaro, { ...q, bucket: 'week' })
    const sum = rows.reduce((acc, r) => acc + r.count, 0)
    const { total } = await docsFor(bolsonaro, { ...q, limit: 50, offset: 0 })
    assert.equal(total, 1, 'sanity: only the future doc falls inside this 30-day window')
    assert.equal(sum, total)
  })
})
