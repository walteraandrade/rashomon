import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sql } from '../src/sql.js'

describe('sql tagged template (issue #131)', () => {
  it('numbers primitives in order of appearance', () => {
    const q = sql`select * from docs where source = ${'rss'} and days <= ${30}`
    assert.equal(q.text, 'select * from docs where source = $1 and days <= $2')
    assert.deepEqual(q.values, ['rss', 30])
  })

  it('binds an array as one value, never spreads it', () => {
    const q = sql`where term = any(${['a', 'b']}::text[])`
    assert.equal(q.text, 'where term = any($1::text[])')
    assert.deepEqual(q.values, [['a', 'b']])
  })

  it('splices a nested fragment and renumbers its binds', () => {
    const scope = sql`d.days <= ${30} and d.source = ${'rss'}`
    const q = sql`select ${'x'} from docs d where ${scope} limit ${5}`
    assert.equal(q.text, 'select $1 from docs d where d.days <= $2 and d.source = $3 limit $4')
    assert.deepEqual(q.values, ['x', 30, 'rss', 5])
  })

  it('renumbers through several levels of nesting', () => {
    const inner = sql`a = ${1}`
    const middle = sql`(${inner} or b = ${2})`
    const q = sql`where c = ${0} and ${middle}`
    assert.equal(q.text, 'where c = $1 and (a = $2 or b = $3)')
    assert.deepEqual(q.values, [0, 1, 2])
  })

  it('gives a fragment used twice two numbers, bound twice', () => {
    const names = sql`any(${['lula']}::text[])`
    const q = sql`t.term = ${names} or k.term = ${names}`
    assert.equal(q.text, 't.term = any($1::text[]) or k.term = any($2::text[])')
    assert.deepEqual(q.values, [['lula'], ['lula']])
  })

  it('binds a value used in two places twice', () => {
    const days = 7
    const q = sql`select ${days}::int as days, now() - make_interval(days => ${days})`
    assert.equal(q.text, 'select $1::int as days, now() - make_interval(days => $2)')
    assert.deepEqual(q.values, [7, 7])
  })

  it('binds null and undefined rather than dropping them', () => {
    const q = sql`select ${null}, ${undefined}`
    assert.equal(q.text, 'select $1, $2')
    assert.deepEqual(q.values, [null, undefined])
  })

  it('splices raw text without binding it', () => {
    const q = sql`select count(*) from about_${sql.raw('a')} where id = ${1}`
    assert.equal(q.text, 'select count(*) from about_a where id = $1')
    assert.deepEqual(q.values, [1])
  })

  it('joins fragments with a separator, renumbering across them', () => {
    const q = sql.join([sql`a = ${1}`, sql`b = ${2}`, sql`c = ${3}`], ' and ')
    assert.equal(q.text, 'a = $1 and b = $2 and c = $3')
    assert.deepEqual(q.values, [1, 2, 3])
  })

  it('joins an empty list into an empty fragment', () => {
    const q = sql.join([])
    assert.equal(q.text, '')
    assert.deepEqual(q.values, [])
    assert.equal(sql`where ${q}`.text, 'where ')
  })

  it('keeps the placeholder count equal to the values length', () => {
    const q = sql`${1} ${sql`${2} ${sql.raw('x')} ${3}`} ${[4]} ${sql.join([sql`${5}`, sql`${6}`])}`
    const placeholders = q.text.match(/\$\d+/g) ?? []
    assert.equal(placeholders.length, q.values.length)
    assert.deepEqual(placeholders, q.values.map((_, i) => `$${i + 1}`))
  })

  it('does not treat a plain object or array as a fragment', () => {
    const q = sql`${{ text: 'x', values: [] }} ${['y']}`
    assert.equal(q.text, '$1 $2')
    assert.deepEqual(q.values, [{ text: 'x', values: [] }, ['y']])
  })
})
