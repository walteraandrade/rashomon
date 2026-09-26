import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { schema } from '../src/db.js'
import { copy, tables, type QueryTarget } from '../src/push.js'
import { withEnv } from './env.js'

// pg has no published types for this subpath (it is not part of its public API): require() it
// directly, the same value preparation a real pg.Pool.query applies before a value hits the wire.
const { prepareValue }: { prepareValue: (v: unknown) => string } = createRequire(import.meta.url)('pg/lib/utils')

// A fake QueryTarget that never touches a real Postgres connection, just records the exact
// params copy() would hand pg's own Pool -- the seam the day-shift bug lives in, not in PGlite,
// which never exhibits it (PGlite's own param binding stays UTC regardless of process TZ; only
// pg's dateToString formats a Date parameter in the process's local TZ).
const recordingTarget = (): QueryTarget & { calls: unknown[][] } => {
  const calls: unknown[][] = []
  return {
    calls,
    query: async (_sql: string, params?: unknown[]) => {
      calls.push(params ?? [])
      return { rows: [] }
    },
  }
}

describe('push: person_attention day', () => {
  it('the day param copy() would hand pg survives pg\'s own prepareValue under TZ=America/Sao_Paulo (issue #211 AC10)', () =>
    withEnv({ TZ: 'America/Sao_Paulo' }, async () => {
      const source = new PGlite('memory://')
      await source.exec(schema)
      await source.query(`insert into persons (id, name, aliases) values ('lula', 'Lula', array['Lula'])`)
      await source.query(`insert into person_attention (person_id, day, views) values ('lula', '2026-01-15', 42)`)

      const attentionTable = tables.find((t) => t.name === 'person_attention')!
      const target = recordingTarget()
      await copy(source, target, attentionTable)

      assert.equal(target.calls.length, 1)
      const day = target.calls[0][1]
      // The value copy() actually sends: run it through pg's own value preparation (the code
      // path a real pg.Pool takes before a query ever reaches the wire), not PGlite's.
      assert.equal(prepareValue(day).slice(0, 10), '2026-01-15')

      await source.close()
    }))
})
