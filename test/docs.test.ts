import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, type DocsQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'

const base: DocsQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', limit: 50, offset: 0 }
const [lula] = persons

describe('docsFor', () => {
  before(seed)

  it('returns every doc about the person in the window, newest first, when no term is given', async () => {
    const { total, docs } = await docsFor(lula, base)
    assert.equal(total, 3)
    assert.equal(docs.length, 3)
    assert.ok(new Date(docs[0].published_at) > new Date(docs[1].published_at))
    assert.ok(new Date(docs[1].published_at) > new Date(docs[2].published_at))
  })

  it('filters by term and kind, matching normalized tokens exactly', async () => {
    const { total, docs } = await docsFor(lula, { ...base, term: 'reforma', kind: 'word' })
    assert.equal(total, 2)
    assert.equal(docs.length, 2)
  })

  it('falls back to matching every kind when kind is unknown', async () => {
    const { total } = await docsFor(lula, { ...base, term: 'reforma', kind: 'bogus' })
    assert.equal(total, 2)
  })

  it('widens with the window', async () => {
    const { total, docs } = await docsFor(lula, { ...base, days: 365 })
    assert.equal(total, 4)
    assert.equal(docs.length, 4)
  })

  it('filters by source', async () => {
    const { total } = await docsFor(lula, { ...base, source: 'bluesky' })
    assert.equal(total, 1)
  })

  it('filters by domain', async () => {
    const { total } = await docsFor(lula, { ...base, domain: 'g1.globo.com' })
    assert.equal(total, 1)
  })

  it('paginates with limit and offset while total reflects the full match count', async () => {
    const q = { ...base, term: 'reforma', kind: 'word', limit: 1 }
    const first = await docsFor(lula, { ...q, offset: 0 })
    const second = await docsFor(lula, { ...q, offset: 1 })
    assert.equal(first.total, 2)
    assert.equal(second.total, 2)
    assert.equal(first.docs.length, 1)
    assert.equal(second.docs.length, 1)
    assert.notEqual(first.docs[0].id, second.docs[0].id)
    assert.ok(new Date(first.docs[0].published_at) > new Date(second.docs[0].published_at))
  })

  it('never returns a tone for non-GDELT sources', async () => {
    const { docs } = await docsFor(lula, base)
    assert.ok(docs.every((d) => d.tone === null))
  })

  it('returns an empty result for a person without matching docs', async () => {
    const { total, docs } = await docsFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.equal(total, 0)
    assert.deepEqual(docs, [])
  })
})
