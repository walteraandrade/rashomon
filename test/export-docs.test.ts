import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { exportLines } from '../src/export-docs.js'
import { collidingUri, persons, seed } from './fixture.js'

describe('exportLines', () => {
  before(seed)

  it('produces one well-formed object per doc, JSON-line-parseable, with the right keys', async () => {
    const rows = await exportLines()
    const { rows: countRows } = await db.query<{ n: string }>(`select count(*) as n from docs`)
    assert.equal(rows.length, Number(countRows[0].n))
    for (const r of rows) {
      const parsed = JSON.parse(JSON.stringify(r))
      assert.deepEqual(Object.keys(parsed).sort(), ['domain', 'id', 'persons', 'published_at', 'source', 'text', 'tone', 'uri'])
      assert.ok(Array.isArray(parsed.persons))
      for (const p of parsed.persons) assert.equal(typeof p, 'string')
    }
  })

  it('orders rows by id ascending', async () => {
    const rows = await exportLines()
    const ids = rows.map((r) => r.id)
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      ids,
    )
  })

  it('emits an empty persons array for a doc with zero doc_persons rows, not a missing field', async () => {
    // the older colliding-uri rss row (day 3000) mentions tarcisio, so it is not a good
    // "no persons" fixture; instead assert the invariant holds for any doc with zero matches
    const rows = await exportLines()
    const withNoMatch = rows.find((r) => r.uri !== collidingUri && r.persons.length === 0)
    assert.ok(withNoMatch, 'expected at least one doc with no tracked person mentioned')
    assert.deepEqual(withNoMatch!.persons, [])
  })

  it('keeps tone as whatever docs.tone holds, null for non-GDELT docs', async () => {
    const rows = await exportLines()
    const gnewsDoc = rows.find((r) => r.source === 'gnews')
    assert.ok(gnewsDoc)
    assert.equal(gnewsDoc!.tone, null)
    const gkgDoc = rows.find((r) => r.source === 'gkg' && r.tone !== null)
    assert.ok(gkgDoc, 'expected at least one toned gkg doc')
  })
})
