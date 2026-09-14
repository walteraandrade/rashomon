import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { exportLines } from '../src/export-docs.js'
import { fitsApprox } from '../src/scorers/window.js'
import { collidingUri, longText, persons, seed } from './fixture.js'
import './close.js'

describe('exportLines', () => {
  before(seed)

  it('produces one well-formed object per doc, JSON-line-parseable, with the right keys', async () => {
    const rows = await exportLines(persons)
    const { rows: countRows } = await db.query<{ n: string }>(`select count(*) as n from docs`)
    assert.equal(rows.length, Number(countRows[0].n))
    for (const r of rows) {
      const parsed = JSON.parse(JSON.stringify(r))
      assert.deepEqual(Object.keys(parsed).sort(), ['domain', 'id', 'persons', 'published_at', 'source', 'text', 'tone', 'uri', 'windows'])
      assert.ok(Array.isArray(parsed.persons))
      for (const p of parsed.persons) assert.equal(typeof p, 'string')
    }
  })

  it('carries one window per mentioned person, the text the scorer sends (issue #154)', async () => {
    const rows = await exportLines(persons)
    for (const r of rows) {
      assert.deepEqual(Object.keys(r.windows).sort(), [...r.persons].sort())
      for (const [id, w] of Object.entries(r.windows)) {
        assert.ok(fitsApprox(persons.find((p) => p.id === id)!)(w), id)
        assert.ok(r.text.includes(w), `${id}: window is not a slice of the text`)
      }
    }
    const withMatch = rows.find((r) => r.persons.length > 0)
    assert.ok(withMatch)
  })

  it('cuts each person her own window on the long doc, and leaves every short doc whole', async () => {
    const rows = await exportLines(persons)
    const long = rows.find((r) => r.text === longText)
    assert.ok(long, 'the fixture must hold one doc longer than the budget')
    assert.deepEqual([...long!.persons].sort(), ['bolsonaro', 'lula'])
    assert.ok(long!.text.length > 1500)
    assert.match(long!.windows.bolsonaro, /^Jair Bolsonaro /)
    assert.doesNotMatch(long!.windows.bolsonaro, /Lula/)
    assert.match(long!.windows.lula, /(?<![a-z0-9])Lula(?![a-z0-9])/)
    assert.doesNotMatch(long!.windows.lula, /Bolsonaro/)
    assert.notEqual(long!.windows.lula, long!.windows.bolsonaro)
    for (const r of rows.filter((r) => r.text !== longText)) for (const w of Object.values(r.windows)) assert.equal(w, r.text)
  })

  it('orders rows by id ascending', async () => {
    const rows = await exportLines(persons)
    const ids = rows.map((r) => r.id)
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      ids,
    )
  })

  it('emits an empty persons array for a doc with zero doc_persons rows, not a missing field', async () => {
    // the older colliding-uri rss row (day 3000) mentions tarcisio, so it is not a good
    // "no persons" fixture; instead assert the invariant holds for any doc with zero matches
    const rows = await exportLines(persons)
    const withNoMatch = rows.find((r) => r.uri !== collidingUri && r.persons.length === 0)
    assert.ok(withNoMatch, 'expected at least one doc with no tracked person mentioned')
    assert.deepEqual(withNoMatch!.persons, [])
  })

  it('keeps tone as whatever docs.tone holds, null for non-GDELT docs', async () => {
    const rows = await exportLines(persons)
    const gnewsDoc = rows.find((r) => r.source === 'gnews')
    assert.ok(gnewsDoc)
    assert.equal(gnewsDoc!.tone, null)
    const gkgDoc = rows.find((r) => r.source === 'gkg' && r.tone !== null)
    assert.ok(gkgDoc, 'expected at least one toned gkg doc')
  })
})
