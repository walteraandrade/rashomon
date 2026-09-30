import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seedFor } from '../src/ui/seed.js'

describe('seedFor', () => {
  it('a prefixed key beats the bare one', () => {
    assert.deepEqual(seedFor('atlas', ['days'], '?days=7&atlas.days=60'), { days: '60' })
  })
  it('falls back to the bare key', () => {
    assert.deepEqual(seedFor('atlas', ['days'], '?days=7'), { days: '7' })
  })
  it('[key, null] ignores the bare key but reads the prefixed one', () => {
    assert.deepEqual(seedFor('rising', [['weeks', null]], '?weeks=4'), { weeks: undefined })
    assert.deepEqual(seedFor('rising', [['weeks', null]], '?rising.weeks=4'), { weeks: '4' })
  })
  it('[key, other] reads the other bare key', () => {
    assert.deepEqual(seedFor('compare', [['a', 'person']], '?person=x'), { a: 'x' })
  })
  it('a missing key is undefined', () => {
    assert.deepEqual(seedFor('atlas', ['days'], ''), { days: undefined })
  })
})
