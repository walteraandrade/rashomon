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
const recordingTarget = (): QueryTarget & { calls: unknown[][]; texts: string[] } => {
  const calls: unknown[][] = []
  const texts: string[] = []
  return {
    calls,
    texts,
    query: async (sql: string, params?: unknown[]) => {
      texts.push(sql)
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

describe('push: doc_terms (issue #252)', () => {
  it('doc_terms is pushed as text pairs, never ids (issue #252) (AC15)', async () => {
    const source = new PGlite('memory://')
    await source.exec(schema)
    await source.query(`insert into persons (id, name, aliases) values ('lula', 'Lula', array['Lula'])`)
    await source.query(
      `insert into docs (id, source, uri, text, published_at) values (1001, 'rss', 'https://example.org/push-1', 'x', now()), (1002, 'rss', 'https://example.org/push-2', 'x', now())`,
    )
    await source.query(`insert into terms (term, kind) values ('reforma', 'word'), ('reforma', 'hashtag'), ('teto', 'word')`)
    await source.query(`insert into doc_terms (doc_id, term_id) select d.id, v.id from docs d, terms v where d.id in (1001, 1002) and (v.term <> 'teto' or d.id = 1002)`)
    const { rows: ids } = await source.query<{ id: number }>(`select id from terms`)

    assert.ok(!tables.some((t) => t.name === 'terms'), 'the vocabulary is not a copied table')
    const target = recordingTarget()
    await copy(source, target, tables.find((t) => t.name === 'doc_terms')!)

    assert.equal(target.calls.length, 1)
    const [docIds, terms, kinds] = target.calls[0] as [number[], string[], string[]]
    assert.equal(target.calls[0].length, 3)
    assert.deepEqual([...new Set(docIds)].sort(), [1001, 1002])
    assert.deepEqual([...new Set(terms)].sort(), ['reforma', 'teto'])
    assert.deepEqual([...new Set(kinds)].sort(), ['hashtag', 'word'])
    for (const { id } of ids) assert.ok(!target.calls[0].flat().includes(id), `term id ${id} was sent`)
    assert.match(target.texts[0], /insert into terms \(term, kind\)/, 'the target resolves the vocabulary itself')
    await source.close()
  })
})
