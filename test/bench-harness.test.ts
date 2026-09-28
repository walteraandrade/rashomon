import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import seedJson from '../seed.json' with { type: 'json' }
import { idsSql, readCases } from '../scripts/bench/cases.js'
import { ANCHOR, runSeed } from '../scripts/bench/seed.js'
import { compare, median, p95, resultHash, type Report } from '../scripts/bench/stats.js'
import { db, migrateP } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import { queries } from '../src/graph.js'
import type { Person } from '../src/types.js'
import './close.js'

const report = (cells: [string, number, number, string][]): Report => ({
  meta: { src: '', rev: '', node: '', cpu: '', anchor: ANCHOR, runs: 5, windows: [], scales: [], calibrationMs: 1, startedAt: '' },
  cells: cells.map(([c, window, ms, hash]) => ({ scale: '10k', case: c, window, medianMs: ms, p95Ms: ms, samplesMs: [ms], rows: 1, hash })),
})

describe('bench harness stats', () => {
  it('median and nearest-rank p95', () => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(p95([1, 2, 3, 4, 5]), 5)
  })

  it('hash ignores float noise and key order, keeps row order', () => {
    assert.equal(resultHash([{ a: 0.1 + 0.2, b: 1 }]), resultHash([{ b: 1, a: 0.3 }]))
    assert.notEqual(resultHash([{ a: 1 }, { a: 2 }]), resultHash([{ a: 2 }, { a: 1 }]))
    assert.notEqual(resultHash([{ a: 0.3 }]), resultHash([{ a: 0.31 }]))
  })

  it('keeps a candidate only when every cell matches and every targeted cell gains 20%', () => {
    const base = report([['graph', 7, 100, 'x'], ['graph', 30, 200, 'y'], ['docs', 7, 10, 'z']])
    assert.equal(compare(base, report([['graph', 7, 80, 'x'], ['graph', 30, 150, 'y'], ['docs', 7, 30, 'z']]), ['graph']).kept, true)
    assert.equal(compare(base, report([['graph', 7, 80, 'x'], ['graph', 30, 170, 'y'], ['docs', 7, 10, 'z']]), ['graph']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y'], ['docs', 7, 10, 'other']]), ['graph']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['docs', 7, 10, 'z']]), ['graph']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y']]), ['graph']).kept, true)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y']]), ['graph'], 0.2, true).kept, false)
  })

  it('a timed-out side is never diffed, and a timed-out candidate is never fast', () => {
    const base = report([['aggregate', 30, 600000, 'timeout'], ['graphFast', 30, 5, 'empty']])
    base.cells[0].timedOut = true
    const r = compare(base, report([['aggregate', 30, 9000, 'rows'], ['graphFast', 30, 4, 'full']]), ['aggregate'])
    assert.equal(r.kept, true)
    assert.equal(r.unverified.length, 2)
    const slow = report([['aggregate', 30, 600000, 'timeout'], ['graphFast', 30, 4, 'empty']])
    slow.cells[0].timedOut = true
    assert.equal(compare(base, slow, ['aggregate']).kept, false)
  })
})

describe('bench harness seed and cases', () => {
  before(async () => {
    await migrateP()
    await runSeed((t, p) => db.query(t, p), 400, seedJson as Person[], nameTokens, () => {})
  })

  it('freezes the clock at the anchor', async () => {
    const { rows } = await db.query<{ now: Date }>('select now() as now')
    assert.equal(new Date(rows[0].now).toISOString(), new Date(ANCHOR).toISOString())
  })

  it('is deterministic', async () => {
    const { rows } = await db.query<{ h: string }>(
      `select md5(string_agg(id || source || extract(epoch from published_at)::text || coalesce(domain, ''), ',' order by id)) as h from docs`,
    )
    assert.equal(rows[0].h, 'b5e96683d366ecfcdc071cbc5a4375ed')
  })

  it('every read case runs against the tree and the window has documents', async () => {
    const [person, other] = [(seedJson as Person[])[0], (seedJson as Person[])[20]]
    const ids = (await db.query<{ id: string }>(idsSql, [person.id, 90])).rows.map((r) => r.id)
    assert.ok(ids.length > 0)
    for (const c of readCases) {
      const { text, values } = c.sql(queries, { person, other, ids, term: 'w1', window: 90 })
      await assert.doesNotReject(db.query(text, values), c.name)
    }
    const sources = readCases.find((c) => c.name === 'sources')!.sql(queries, { person, other, ids, term: 'w1', window: 90 })
    assert.ok((await db.query(sources.text, sources.values)).rows.length > 0)
  })
})
