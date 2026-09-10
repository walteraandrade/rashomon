import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { docsWhereSql } from '../src/graph.js'
import { KINDS } from '../src/query.js'

// docsWhereSql carries its own copy of the kind set, used only to decide whether an
// unrecognized kind list falls back to matching any kind (issue #108's own postmortem: a stale
// copy here would silently start treating an unknown token as a known, empty subset instead of
// falling back like every other route). This pins the two in sync instead of re-typing a third
// copy that could drift from both.
describe('the kind set query.ts and graph.ts agree on (issue #108)', () => {
  it('matches KINDS against the literal array embedded in docsWhereSql', () => {
    const literal = docsWhereSql.match(/<@ array\[([^\]]+)\]/)?.[1]
    assert.ok(literal, 'docsWhereSql must embed a kind array literal')
    const embedded = literal.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    assert.deepEqual(embedded, KINDS)
  })

  it('no longer accepts the token theme', () => {
    assert.ok(!KINDS.includes('theme'))
  })
})
