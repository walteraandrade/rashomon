import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { inTransaction, insertDoc } from '../src/store.js'
import { docsFor, timelineFor, type TimelineQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import type { Source } from '../src/types.js'

// A doc can only sit *exactly* on a bucket edge if the instant it is dated from and the
// instant timelineFor buckets against are the same one. now() is transaction_timestamp(),
// so an explicit transaction freezes both: each case inserts its docs, dates them by an
// interval from that frozen now(), asserts, and rolls back, leaving the shared fixture
// untouched for the next case.
//
// bolsonaro is the canvas: every fixture doc naming him is 2100+ days old except doc /37
// at day 35, so any window of 30 days holds only what a case inserts.
const [, , bolsonaro] = persons
const base: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', bucket: 'week' }
const golpe = 'Bolsonaro volta a comentar o golpe em nota oficial'
const quiet = 'Bolsonaro visita uma cooperativa agrícola no litoral'

type Placed = { offset: string; text?: string; source?: Source; domain?: string }

// offset is subtracted from the frozen now(), so '7 days' is exactly one week old and
// '-1 days' is a day in the future.
// The rollback travels as a thrown sentinel because `inTransaction` commits on success. Going
// through it rather than a raw `begin` is what keeps now() frozen: the store tracks whether a
// transaction is open, and an unseen one makes insertDoc open and commit its own.
const rollback = new Error('rollback')

const withDocs = (placed: Placed[], run: () => Promise<void>) =>
  inTransaction(async () => {
    for (const [i, p] of placed.entries()) {
      const uri = `https://example.org/boundary/${i}`
      await insertDoc(
        { source: p.source ?? 'rss', uri, text: p.text ?? golpe, publishedAt: new Date().toISOString(), domain: p.domain ?? 'example.org' },
        persons,
      )
      await db.query(`update docs set published_at = now() - ($1)::interval where uri = $2`, [p.offset, uri])
    }
    await run()
    throw rollback
  }).catch((e) => {
    if (e !== rollback) throw e
  })

const sumOf = (rows: { count: number }[]) => rows.reduce((a, r) => a + r.count, 0)
const totalFor = async (q: TimelineQuery) =>
  (await docsFor(bolsonaro, { term: q.term, kind: q.kind, days: q.days, source: q.source, domain: q.domain, lean: q.lean, limit: 500, offset: 0 })).total

describe('timelineFor bucket edges against a frozen reference time', () => {
  before(seed)

  it('a doc exactly one bucket width old lands in the newest bucket, not the second', async () => {
    await withDocs([{ offset: '7 days' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows.length, 5)
      assert.equal(rows[4].count, 1, 'newest bucket is [now() - 7 days, infinity)')
      assert.equal(sumOf(rows), 1)
    })
  })

  it('a microsecond past that edge falls into the next-older bucket', async () => {
    await withDocs([{ offset: '7 days 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows[4].count, 0)
      assert.equal(rows[3].count, 1)
      assert.equal(sumOf(rows), 1)
    })
  })

  it('the same edge rule holds for day buckets', async () => {
    await withDocs([{ offset: '1 day' }, { offset: '1 day 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, { ...base, bucket: 'day' })
      assert.equal(rows.length, 30)
      assert.equal(rows[29].count, 1)
      assert.equal(rows[28].count, 1)
      assert.equal(sumOf(rows), 2)
    })
  })

  it('a doc exactly at the oldest edge of the window is kept, in the oldest bucket', async () => {
    await withDocs([{ offset: '30 days' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows[0].count, 1)
      assert.equal(sumOf(rows), 1)
      assert.equal(await totalFor(base), 1, 'docsFor keeps it too: the window edge is inclusive')
    })
  })

  it('a microsecond older than the window is outside it, for the timeline as for docsFor', async () => {
    await withDocs([{ offset: '30 days 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows.length, 5)
      assert.ok(rows.every((r) => r.count === 0))
      assert.equal(await totalFor(base), 0)
    })
  })

  it('the oldest week bucket is the partial one: 30 days over 7-day buckets leaves it 2 days wide', async () => {
    await withDocs([{ offset: '29 days 23:59:59' }, { offset: '28 days' }, { offset: '27 days 23:59:59' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows.length, 5, 'ceil(30/7)')
      assert.equal(rows[0].count, 1, 'only the doc older than 28 days sits in the clamped oldest bucket')
      assert.equal(rows[1].count, 2, 'the 28-day edge belongs to the newer, full-width bucket')
      assert.equal(sumOf(rows), 3)
    })
  })

  it('future-dated docs still belong to the newest bucket and still count toward the total', async () => {
    await withDocs([{ offset: '-1 days' }, { offset: '-400 days' }, { offset: '0 days' }], async () => {
      const rows = await timelineFor(bolsonaro, base)
      assert.equal(rows[4].count, 3)
      assert.equal(sumOf(rows), 3)
      assert.equal(await totalFor(base), 3)
    })
  })

  it('counts sum to the docsFor total across every bucket width, edges and future dates included', async () => {
    const placed: Placed[] = [
      { offset: '-3 days' },
      { offset: '0 days' },
      { offset: '7 days' },
      { offset: '7 days 00:00:00.000001' },
      { offset: '13 days 12:00:00' },
      { offset: '21 days' },
      { offset: '28 days' },
      { offset: '30 days' },
    ]
    await withDocs(placed, async () => {
      for (const bucket of ['day', 'week'] as const) {
        const q = { ...base, bucket }
        const rows = await timelineFor(bolsonaro, q)
        assert.equal(rows.length, bucket === 'day' ? 30 : 5)
        assert.equal(sumOf(rows), placed.length)
        assert.equal(sumOf(rows), await totalFor(q))
      }
    })
  })

  it('holds over a 365-day window, where the bucket series is at its widest', async () => {
    const q = { ...base, term: 'golpe', kind: 'word', days: 365, bucket: 'day' as const }
    await withDocs([{ offset: '-1 days' }, { offset: '0 days' }, { offset: '364 days 23:59:59' }, { offset: '365 days' }], async () => {
      const rows = await timelineFor(bolsonaro, q)
      assert.equal(rows.length, 365)
      assert.equal(rows[364].count, 2, 'today and tomorrow share the newest bucket')
      assert.equal(rows[0].count, 2, 'both docs at the clamped oldest edge stay in the series')
      assert.equal(sumOf(rows), 4)
      assert.equal(sumOf(rows), await totalFor(q))
    })
  })

  it('term, kind, source and domain narrow the buckets exactly as they narrow docsFor', async () => {
    const placed: Placed[] = [
      { offset: '2 days' },
      { offset: '9 days', source: 'gnews', domain: 'oantagonista.com.br' },
      { offset: '16 days', text: quiet },
    ]
    await withDocs(placed, async () => {
      const cases: TimelineQuery[] = [
        { ...base, term: 'golpe', kind: 'word' },
        { ...base, term: 'golpe', kind: 'hashtag' },
        { ...base, term: 'golpe', kind: 'not-a-real-kind' },
        { ...base, source: 'gnews' },
        { ...base, domain: 'oantagonista.com.br' },
        { ...base, source: 'bluesky' },
        { ...base, domain: 'nonexistent.example' },
      ]
      for (const q of cases) {
        const rows = await timelineFor(bolsonaro, q)
        assert.equal(rows.length, 5, JSON.stringify(q))
        assert.equal(sumOf(rows), await totalFor(q), JSON.stringify(q))
      }
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'word' })), 2)
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...base, term: 'golpe', kind: 'hashtag' })), 0)
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...base, source: 'bluesky' })), 0)
    })
  })

  it('every bucket in an empty scope is present and zero, in ascending order', async () => {
    await withDocs([{ offset: '3 days' }], async () => {
      const rows = await timelineFor(bolsonaro, { ...base, source: 'bluesky', bucket: 'day' })
      assert.equal(rows.length, 30)
      assert.ok(rows.every((r) => r.count === 0))
      for (let i = 1; i < rows.length; i++) {
        assert.ok(new Date(rows[i - 1].bucket_start).getTime() < new Date(rows[i].bucket_start).getTime())
      }
    })
  })

  it('rolls back cleanly: the fixture window is empty again', async () => {
    const rows = await timelineFor(bolsonaro, base)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })
})
