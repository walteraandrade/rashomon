import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveTarget } from '../src/purge.js'

// main() itself is never imported by tests (it calls process.argv, migrate() and db.close());
// resolveTarget is the pure piece of it that decides whether an argument is a known source,
// one of the two maintenance targets, or a usage error.
describe('purge target resolution (issue #108)', () => {
  it('accepts a known source, orphan-terms and themes', () => {
    assert.equal(resolveTarget('gkg'), 'gkg')
    assert.equal(resolveTarget('orphan-terms'), 'orphan-terms')
    assert.equal(resolveTarget('themes'), 'themes')
  })

  it('throws the usage error, naming all three targets, when the argument is missing or unrecognized', () => {
    const usage = { message: 'usage: pnpm purge <source|orphan-terms|themes>' }
    assert.throws(() => resolveTarget(undefined), usage)
    assert.throws(() => resolveTarget('bogus'), usage)
    assert.throws(() => resolveTarget(''), usage)
  })
})
