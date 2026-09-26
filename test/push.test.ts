import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { schema } from '../src/db.js'
import { copy, tables } from '../src/push.js'
import { withEnv } from './env.js'

// issue #211 AC10 regression: person_attention.day is a `date` column. PGlite hands the driver a
// JS Date at UTC midnight for it; a plain (non-::text) select would let that Date cross the wire
// as-is, and a driver (pg's own dateToString, unlike PGlite's) that formats a Date parameter in
// the process's local TZ would then land it one calendar day early outside UTC. Selecting the
// column as text sidesteps the Date object entirely, so no downstream driver's TZ handling can
// shift it -- verified here end to end, under a real negative-offset TZ, copying PGlite -> PGlite.
describe('push: person_attention day', () => {
  it('crosses unchanged under TZ=America/Sao_Paulo (issue #211 AC10)', () =>
    withEnv({ TZ: 'America/Sao_Paulo' }, async () => {
      const source = new PGlite('memory://')
      const target = new PGlite('memory://')
      await source.exec(schema)
      await target.exec(schema)
      await source.query(`insert into persons (id, name, aliases) values ('lula', 'Lula', array['Lula'])`)
      await target.query(`insert into persons (id, name, aliases) values ('lula', 'Lula', array['Lula'])`)
      await source.query(`insert into person_attention (person_id, day, views) values ('lula', '2026-01-15', 42)`)

      const personsTable = tables.find((t) => t.name === 'persons')!
      const attentionTable = tables.find((t) => t.name === 'person_attention')!
      await copy(source, target, personsTable)
      await copy(source, target, attentionTable)

      const { rows } = await target.query<{ day: unknown }>('select day from person_attention')
      const day = rows[0].day
      // The target's own `day` column is a real `date`, read back as a Date at UTC midnight;
      // only `toISOString` (never `toString`, which renders in the process's own TZ) reports it.
      assert.equal(typeof day === 'string' ? day.slice(0, 10) : (day as Date).toISOString().slice(0, 10), '2026-01-15')

      await source.close()
      await target.close()
    }))

  it('selects day as text, never as a Date instance, so no driver can re-interpret it in a local TZ', () =>
    withEnv({ TZ: 'America/Sao_Paulo' }, async () => {
      const source = new PGlite('memory://')
      await source.exec(schema)
      await source.query(`insert into persons (id, name, aliases) values ('lula', 'Lula', array['Lula'])`)
      await source.query(`insert into person_attention (person_id, day, views) values ('lula', '2026-01-15', 42)`)

      const attentionTable = tables.find((t) => t.name === 'person_attention')!
      const { rows } = await source.query<{ day: unknown }>(`select ${(attentionTable.select ?? attentionTable.columns).join(', ')} from person_attention`)
      assert.equal(typeof rows[0].day, 'string')
      assert.equal(rows[0].day, '2026-01-15')

      await source.close()
    }))
})
