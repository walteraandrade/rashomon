import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { docsText } from './docs.js'

// Facts about the 60-day window and retention (issue #270), asserted against every page at once.
describe('the docs state the 60-day window and retention (issue #270)', () => {
  it('days takes 7, 30 or 60, snaps larger values (365 included) to 60, and names the 45/46 midpoint', () => {
    assert.match(docsText, /\*\*7\*\*, \*\*30\*\* or \*\*60\*\*/)
    assert.match(docsText, /days=365[^.]{0,60}same body as [`?]*days=60/)
    assert.match(docsText, /`\?days=45` as 30, `\?days=46` as 60/)
    assert.doesNotMatch(docsText, /\*\*7\*\*, \*\*30\*\* or \*\*365\*\*/)
    assert.doesNotMatch(docsText, /`DAYS` \(7, 30, 365\)/)
  })

  it('ingest deletes docs older than the widest window and says what goes with them, what stays and what is logged', () => {
    assert.match(docsText, /deletes every doc published (before|more than)[^.]*(DAYS|60 days)/)
    assert.match(docsText, /horizon is `DAYS`' largest value/)
    assert.match(docsText, /`doc_persons`, `doc_terms`, `doc_testimony` and `doc_candidates` go with the doc/)
    assert.match(docsText, /`person_attention`[^.]*and `terms`[^.]*are not trimmed/)
    assert.match(docsText, /retention: deleted <n> docs older than <days> days/)
  })

  it('reindex recovers nothing a deletion removed, and ingest frees pages without shrinking the database', () => {
    assert.match(docsText, /`pnpm reindex` recomputes from the stored `docs\.text`[^.]*a deleted doc is not recovered/)
    assert.match(docsText, /`pg_database_size` does not shrink/)
    assert.match(docsText, /no `vacuum`/)
  })

  it('rising at days=60 has an empty baseline because it lies beyond retention', () => {
    assert.match(docsText, /`rising` at `days=60`[^]*?empty baseline[^]*?beyond retention|`rising` at `days=60`[^]*?older than retention[^]*?empty baseline/)
  })
})
