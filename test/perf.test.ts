import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { percentile, perfEnabled, perfLine, perfLogEnabled, round, serverTiming } from '../src/perf.js'
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
    assert.equal(res.headers.get('server-timing'), null)
    const body = await res.json()
    assert.deepEqual(Object.keys(body as object).sort(), ['links', 'nodes', 'outlets', 'person', 'signature', 'stats'])
  })

  it('leaves db as the raw PGlite instance when disabled', async () => {
    // A proxy would hand back a fresh bound function on each access; the untouched
    // instance hands back the same one.
    assert.equal(db.query, db.query)
  })
})

// PERF is read once, at import time, by src/perf.ts, so `measure`'s own instrumentation of
// db.query/db.exec only exists with PERF=1 -- one subprocess per test, the same pattern as
// the PERF=1 test in the serverTiming describe below.
const runMeasured = (script: string) => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    env: { ...process.env, PERF: '1', PERF_LOG: '0', DATA_DIR: 'memory://' },
    encoding: 'utf8',
  })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout.trim().split('\n').pop() as string)
}

describe('measure', () => {
  it('counts statements and db time through the real SqlClient path', () => {
    const out = runMeasured(`
      const { db, migrateP } = await import('./src/db.ts')
      const { measure } = await import('./src/perf.ts')
      await migrateP()
      const { value, sql, dbMs, ms } = await measure(async () => {
        const a = await db.query('select count(*)::int as n from docs')
        const b = await db.query('select count(*)::int as n from persons')
        return a.rows[0].n + b.rows[0].n
      })
      console.log(JSON.stringify({ value, sql, dbMs, ms }))
    `)
    assert.equal(out.sql, 2)
    assert.ok(out.value >= 0)
    assert.ok(out.dbMs >= 0)
    assert.ok(out.ms >= out.dbMs - 0.001)
  })

  it('reports zero when no statement runs', () => {
    const out = runMeasured(`
      const { measure } = await import('./src/perf.ts')
      const { sql, dbMs } = await measure(async () => 1)
      console.log(JSON.stringify({ sql, dbMs }))
    `)
    assert.equal(out.sql, 0)
    assert.equal(out.dbMs, 0)
  })

  it('does not throw when a query runs outside a measured scope', () => {
    const out = runMeasured(`
      const { db, migrateP } = await import('./src/db.ts')
      await migrateP()
      const { rows } = await db.query('select 1::int as n')
      console.log(JSON.stringify({ n: rows[0].n }))
    `)
    assert.equal(out.n, 1)
  })

  it('counts statements issued concurrently', () => {
    const out = runMeasured(`
      const { db, migrateP } = await import('./src/db.ts')
      const { measure } = await import('./src/perf.ts')
      await migrateP()
      const { sql } = await measure(async () => {
        await Promise.all([db.query('select 1'), db.query('select 2'), db.query('select 3')])
      })
      console.log(JSON.stringify({ sql }))
    `)
    assert.equal(out.sql, 3)
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

describe('serverTiming', () => {
  it('renders db and total as Server-Timing metrics, two decimals, statement count as the description', () => {
    // db > total is a fan-out, not a bug: the two overlap, so the metric is `total`, never `app`.
    assert.equal(serverTiming({ ms: 227.567, sql: 5, dbMs: 446.234 }), 'db;dur=446.23;desc="5 sql", total;dur=227.57')
  })

  it('parses back as two metrics the browser can read', () => {
    const metrics = serverTiming({ ms: 12, sql: 0, dbMs: 0 }).split(', ').map((m) => m.split(';')[0])
    assert.deepEqual(metrics, ['db', 'total'])
  })

  // perfEnabled is read once at import, so the on state needs its own process: an
  // in-memory database, migrate, one request, the header on stdout.
  it('PERF=1 sets server-timing on an API response through the middleware, on a 404 too', () => {
    const script = `
      const { migrateP } = await import('./src/db.ts')
      const { app } = await import('./src/server.ts')
      await migrateP()
      const res = await app.request('/api/people/nobody/graph?days=30')
      console.log(JSON.stringify({ status: res.status, header: res.headers.get('server-timing') }))
    `
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      env: { ...process.env, PERF: '1', PERF_LOG: '0', DATA_DIR: 'memory://' },
      encoding: 'utf8',
    })
    assert.equal(child.status, 0, child.stderr)
    const out = JSON.parse(child.stdout.trim().split('\n').pop() as string) as { status: number; header: string }
    assert.equal(out.status, 404)
    assert.match(out.header, /^db;dur=\d+(\.\d+)?;desc="\d+ sql", total;dur=\d+(\.\d+)?$/)
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
