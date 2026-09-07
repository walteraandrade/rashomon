import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRisingQuery, parseSourceList, parseTimelineQuery } from '../src/query.js'

// parseSourceList actually lives in src/query.ts (the choke point every other parseXQuery
// helper already uses in this codebase), not src/server.ts as issue #8's spec sketched it.

describe('parseSourceList', () => {
  it('AC6: falls back to "all" for undefined, empty, "all" and an unknown token', () => {
    assert.equal(parseSourceList(undefined), 'all')
    assert.equal(parseSourceList(''), 'all')
    assert.equal(parseSourceList('all'), 'all')
    assert.equal(parseSourceList('bogus'), 'all')
  })

  it('AC6: keeps a single valid token as-is, unknown tokens dropped silently', () => {
    assert.equal(parseSourceList('gnews'), 'gnews')
    assert.equal(parseSourceList('gnews,bogus'), 'gnews')
  })

  it('AC6: joins and dedupes valid tokens', () => {
    assert.equal(parseSourceList('gnews,rss'), 'gnews,rss')
    assert.equal(parseSourceList('gnews,rss,gnews'), 'gnews,rss')
  })

  it('every token invalid falls back to "all"', () => {
    assert.equal(parseSourceList('bogus1,bogus2'), 'all')
  })

  it('trims whitespace around tokens', () => {
    assert.equal(parseSourceList('gnews, rss'), 'gnews,rss')
    assert.equal(parseSourceList(' gnews , rss '), 'gnews,rss')
  })

  it('accepts camara, alone or in a comma list', () => {
    assert.equal(parseSourceList('camara'), 'camara')
    assert.equal(parseSourceList('camara,gdelt'), 'camara,gdelt')
  })
})

// issue #24: the two independent inline literals in parseRisingQuery/parseTimelineQuery
// must accept 'camara' too, so they cannot silently drift from SOURCES again.
describe('parseRisingQuery/parseTimelineQuery source', () => {
  it('resolves source: camara to camara, not all', () => {
    assert.equal(parseRisingQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseTimelineQuery({ source: 'camara' }).source, 'camara')
  })
})
