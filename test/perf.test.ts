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
// db.query/db.exec only exists with PERF=1 and the on state needs a process of its own: one
// child for every PERF=1 case, which migrates once and runs the cases one after another so no
// measure() scope overlaps another. It closes the database at the end: PGlite would hold the
// event loop open for ten seconds otherwise.
const CHILD_SCRIPT = `
  const { db, migrateP } = await import('./src/db.ts')
  const { measure } = await import('./src/perf.ts')
  const { app } = await import('./src/server.ts')
  await migrateP()
  const run = async (label, body) => {
    try {
      console.log(JSON.stringify({ case: label, ...(await body()) }))
    } catch (err) {
      console.log(JSON.stringify({ case: label, error: String(err?.stack ?? err) }))
    }
  }
  await run('statements', async () => {
    const { value, sql, dbMs, ms } = await measure(async () => {
      const a = await db.query('select count(*)::int as n from docs')
      const b = await db.query('select count(*)::int as n from persons')
      return a.rows[0].n + b.rows[0].n
    })
    return { value, sql, dbMs, ms }
  })
  await run('zero', async () => {
    const { sql, dbMs } = await measure(async () => 1)
    return { sql, dbMs }
  })
  await run('outside', async () => {
    const { rows } = await db.query('select 1::int as n')
    return { n: rows[0].n }
  })
  await run('concurrent', async () => {
    const { sql } = await measure(async () => {
      await Promise.all([db.query('select 1'), db.query('select 2'), db.query('select 3')])
    })
    return { sql }
  })
  await run('serverTiming', async () => {
    const res = await app.request('/api/people/nobody/graph?days=30')
    return { status: res.status, header: res.headers.get('server-timing') }
  })
  await db.close()
`

type Payload = Record<string, any>
type Child = { status: number | null; stderr: string; cases: Record<string, Payload> }

const parseCases = (stdout: string): Record<string, Payload> =>
  Object.fromEntries(
    stdout
      .split('\n')
      .flatMap((line): Payload[] => {
        try {
          const parsed = JSON.parse(line)
          return parsed && typeof parsed === 'object' && typeof parsed.case === 'string' ? [parsed] : []
        } catch {
          return []
        }
      })
      .map((parsed) => [parsed.case, parsed]),
  )

let cached: Child | undefined
const perfChild = (): Child => {
  if (!cached) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', CHILD_SCRIPT], {
      env: { ...process.env, PERF: '1', PERF_LOG: '0', DATA_DIR: 'memory://' },
      encoding: 'utf8',
    })
    cached = { status: child.status, stderr: child.stderr, cases: parseCases(child.stdout) }
  }
  return cached
}

const caseOf = (label: string): Payload => {
  const child = perfChild()
  assert.equal(child.status, 0, child.stderr)
  const payload = child.cases[label]
  assert.ok(payload, `missing case ${label}\n${child.stderr}`)
  assert.equal(payload.error, undefined, payload.error)
  return payload
}

describe('measure', () => {
  it('counts statements and db time through the real SqlClient path', () => {
    const out = caseOf('statements')
    assert.equal(out.sql, 2)
    assert.ok(out.value >= 0)
    assert.ok(out.dbMs >= 0)
    assert.ok(out.ms >= out.dbMs - 0.001)
  })

  it('reports zero when no statement runs', () => {
    const out = caseOf('zero')
    assert.equal(out.sql, 0)
    assert.equal(out.dbMs, 0)
  })

  it('does not throw when a query runs outside a measured scope', () => {
    assert.equal(caseOf('outside').n, 1)
  })

  it('counts statements issued concurrently', () => {
    assert.equal(caseOf('concurrent').sql, 3)
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

  it('PERF=1 sets server-timing on an API response through the middleware, on a 404 too', () => {
    const out = caseOf('serverTiming')
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
