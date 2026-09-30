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

describe('agenda seeds (#288)', () => {
  const keys = ['days', 'source']
  it('agenda AC15: agenda.days=7&days=60 seeds 7', () => {
    assert.equal(seedFor('agenda', keys, '?agenda.days=7&days=60').days, '7')
  })
  it('agenda AC15: days=60 alone seeds 60', () => {
    assert.equal(seedFor('agenda', keys, '?days=60').days, '60')
  })
  it('agenda AC15: an absent value seeds undefined', () => {
    assert.equal(seedFor('agenda', keys, '?other=1').source, undefined)
  })
})
