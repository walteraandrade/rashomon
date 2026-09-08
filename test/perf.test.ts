import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { instrument, measure, percentile, perfEnabled, perfLine, perfLogEnabled, round } from '../src/perf.js'
import { app } from '../src/server.js'
import { seed } from './fixture.js'
import './close.js'

// Timings are never asserted here: this suite pins the instrumentation's shape and its
// off-by-default contract. The numbers themselves come from `pnpm bench`, which is not
// part of the test run.

describe('instrumentation is opt-in', () => {
  before(seed)

  it('is disabled unless PERF is set, which is how the test suite runs', () => {
    assert.equal(process.env.PERF, undefined)
    assert.equal(perfEnabled, false)
    assert.equal(perfLogEnabled, false)
  })

  it('adds no x-perf header and no body change to an API response', async () => {
    const res = await app.request('/api/people/lula/graph?days=30')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-perf-total-ms'), null)
    assert.equal(res.headers.get('x-perf-db-ms'), null)
    assert.equal(res.headers.get('x-perf-sql-count'), null)
    const body = await res.json()
    assert.deepEqual(Object.keys(body as object).sort(), ['links', 'nodes', 'outlets', 'person', 'signature', 'stats'])
  })

  it('leaves db as the raw PGlite instance when disabled', async () => {
    // A proxy would hand back a fresh bound function on each access; the untouched
    // instance hands back the same one.
    assert.equal(db.query, db.query)
  })
})

describe('measure', () => {
  before(seed)

  it('counts statements and db time of an instrumented handle', async () => {
    const timed = instrument(db)
    const { value, sql, dbMs, ms } = await measure(async () => {
      const a = await timed.query<{ n: number }>(`select count(*)::int as n from docs`)
      const b = await timed.query<{ n: number }>(`select count(*)::int as n from persons`)
      return a.rows[0].n + b.rows[0].n
    })
    assert.equal(sql, 2)
    assert.ok(value > 0)
    assert.ok(dbMs >= 0)
    assert.ok(ms >= dbMs - 0.001)
  })

  it('returns identical rows through the proxy', async () => {
    const direct = await db.query(`select id, name from persons order by id`)
    const proxied = await instrument(db).query(`select id, name from persons order by id`)
    assert.deepEqual(proxied.rows, direct.rows)
  })

  it('reports zero when no statement runs', async () => {
    const { sql, dbMs } = await measure(async () => 1)
    assert.equal(sql, 0)
    assert.equal(dbMs, 0)
  })

  it('does not throw when an instrumented query runs outside a measured scope', async () => {
    const { rows } = await instrument(db).query<{ n: number }>(`select 1::int as n`)
    assert.equal(rows[0].n, 1)
  })

  it('counts statements issued concurrently', async () => {
    const timed = instrument(db)
    const { sql } = await measure(async () => {
      await Promise.all([timed.query(`select 1`), timed.query(`select 2`), timed.query(`select 3`)])
    })
    assert.equal(sql, 3)
  })
})

describe('perfLine', () => {
  it('carries only the request line and timings, never a row or a body', () => {
    const line = perfLine({ method: 'GET', path: '/api/people/lula/docs', query: 'term=reforma', status: 200, ms: 12.345, dbMs: 6.789, sql: 3 })
    const parsed = JSON.parse(line) as Record<string, unknown>
    assert.deepEqual(Object.keys(parsed).sort(), ['db_ms', 'method', 'ms', 'path', 'perf', 'query', 'sql', 'status'])
    assert.equal(parsed.ms, 12.35)
    assert.equal(parsed.db_ms, 6.79)
    assert.equal(parsed.sql, 3)
  })

  it('never quotes document text, since it is only given the request line', async () => {
    const { rows } = await db.query<{ text: string }>(`select text from docs order by id limit 1`)
    const line = perfLine({ method: 'GET', path: '/api/people/lula/docs', query: '', status: 200, ms: 1, dbMs: 1, sql: 1 })
    assert.ok(rows[0].text.length > 0)
    assert.ok(!line.includes(rows[0].text))
  })
})

describe('percentile', () => {
  it('is the nearest-rank percentile of a copy, leaving the input unsorted', () => {
    const input = [5, 1, 4, 2, 3]
    assert.equal(percentile(input, 50), 3)
    assert.equal(percentile(input, 95), 5)
    assert.equal(percentile(input, 1), 1)
    assert.deepEqual(input, [5, 1, 4, 2, 3])
  })

  it('is 0 for an empty sample', () => {
    assert.equal(percentile([], 50), 0)
  })
})

describe('round', () => {
  it('keeps two decimals', () => {
    assert.equal(round(12.3456), 12.35)
    assert.equal(round(7), 7)
  })
})
