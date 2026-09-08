import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, type DocsQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import './close.js'

const base: DocsQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0 }
const [lula] = persons

describe('docsFor', () => {
  before(seed)

  it('AC1,AC2: returns every doc about the person in the window, newest first, ties broken by id desc, when no term is given', async () => {
    const { total, docs } = await docsFor(lula, base)
    // widened by doc /38 (gkg, day1, issue #8's press-vs-network fixture)
    assert.equal(total, 5)
    assert.equal(docs.length, 5)
    for (let i = 1; i < docs.length; i++) {
      const prevTime = new Date(docs[i - 1].published_at).getTime()
      const curTime = new Date(docs[i].published_at).getTime()
      assert.ok(prevTime > curTime || (prevTime === curTime && docs[i - 1].id > docs[i].id))
    }
  })

  it('AC3: filters by term and kind, matching normalized tokens exactly', async () => {
    const { total, docs } = await docsFor(lula, { ...base, term: 'reforma', kind: 'word' })
    assert.equal(total, 3)
    assert.equal(docs.length, 3)
  })

  it('AC4: falls back to matching every kind when kind is unknown', async () => {
    const { total } = await docsFor(lula, { ...base, term: 'reforma', kind: 'bogus' })
    assert.equal(total, 3)
  })

  it('AC5: widens with the window', async () => {
    // 365 days also picks up docs /17-/19 (estabilidade fiscal, day31/35/50), added for risingFor's tests
    const { total, docs } = await docsFor(lula, { ...base, days: 365 })
    assert.equal(total, 9)
    assert.equal(docs.length, 9)
  })

  it('AC6: filters by source', async () => {
    const { total } = await docsFor(lula, { ...base, source: 'bluesky' })
    assert.equal(total, 1)
  })

  it('AC7: filters by domain', async () => {
    const { total } = await docsFor(lula, { ...base, domain: 'g1.globo.com' })
    assert.equal(total, 1)
  })

  it('AC8: paginates with limit and offset while total reflects the full match count, stable across a tied timestamp', async () => {
    // two of the three reforma docs share the exact same published_at in the fixture, on purpose
    const q = { ...base, term: 'reforma', kind: 'word', limit: 1 }
    const first = await docsFor(lula, { ...q, offset: 0 })
    const second = await docsFor(lula, { ...q, offset: 1 })
    assert.equal(first.total, 3)
    assert.equal(second.total, 3)
    assert.equal(first.docs.length, 1)
    assert.equal(second.docs.length, 1)
    const ids = new Set([first.docs[0].id, second.docs[0].id])
    assert.equal(ids.size, 2, 'union of the two pages must not repeat or skip a doc')
  })

  it('AC9: never returns a tone for non-GDELT sources', async () => {
    // doc /38 (gkg) now sits in this window with a real tone; scope this assertion to the
    // non-GDELT sources it was actually checking, and cover the gkg case separately below.
    const { docs } = await docsFor(lula, { ...base, source: 'gnews,rss,bluesky' })
    assert.ok(docs.every((d) => d.tone === null))
  })

  it('AC9: returns a tone for gkg docs', async () => {
    const { docs } = await docsFor(lula, { ...base, source: 'gkg' })
    assert.equal(docs.length, 1)
    assert.equal(docs[0].tone, 0.6)
  })

  it('AC10: returns an empty result for a person without matching docs', async () => {
    const { total, docs } = await docsFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.equal(total, 0)
    assert.deepEqual(docs, [])
  })

  it('AC10: returns an empty result for an empty window', async () => {
    const { total, docs } = await docsFor(lula, { ...base, days: 1 })
    assert.equal(total, 0)
    assert.deepEqual(docs, [])
  })

  it('issue #8: a comma-separated source list returns only docs whose source is in the list', async () => {
    const { total, docs } = await docsFor(lula, { ...base, source: 'gnews,rss' })
    assert.equal(total, 3)
    assert.ok(docs.every((d) => d.source === 'gnews' || d.source === 'rss'))
  })

  it('issue #8: adding gkg to the list includes the gkg doc', async () => {
    const { total, docs } = await docsFor(lula, { ...base, source: 'gnews,rss,gkg' })
    assert.equal(total, 4)
    assert.ok(docs.some((d) => d.source === 'gkg'))
  })
})
