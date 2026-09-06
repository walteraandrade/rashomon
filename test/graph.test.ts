import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { graphFor, sourcesFor, type GraphQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'

const base: GraphQuery = { days: 30, source: 'all', domain: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula, tarcisio] = persons
const node = (g: Awaited<ReturnType<typeof graphFor>>, id: string) => g.nodes.find((n) => n.id === id)
const pmi = (cPt: number, cT: number, n: number, np: number) => Math.round(Math.log2((cPt * n) / (np * cT)) * 100) / 100

describe('graphFor', () => {
  before(seed)

  it('counts docs in the window and docs about the person', async () => {
    const g = await graphFor(lula, base)
    assert.equal(g.stats.docs, 5)
    assert.equal(g.stats.about, 3)
  })

  it('widens with the window', async () => {
    const g = await graphFor(lula, { ...base, days: 365 })
    assert.equal(g.stats.docs, 6)
    assert.equal(g.stats.about, 4)
  })

  it('never lists the person name as a term', async () => {
    const g = await graphFor(lula, base)
    assert.ok(!g.nodes.some((n) => n.term === 'lula'))
  })

  it('computes pmi as log2 lift against the whole window', async () => {
    const g = await graphFor(lula, base)
    assert.equal(node(g, 'word:reforma')?.pmi, pmi(2, 2, 5, 3))
    assert.equal(node(g, 'word:eleicao')?.pmi, pmi(1, 1, 5, 3))
    assert.equal(node(g, 'word:congresso'), undefined)
  })

  it('carries hashtags as their own kind and filters by kind', async () => {
    const all = await graphFor(lula, base)
    assert.equal(node(all, 'hashtag:reforma')?.count, 1)
    const only = await graphFor(lula, { ...base, kind: 'hashtag' })
    assert.ok(only.nodes.length > 0)
    assert.ok(only.nodes.every((n) => n.kind === 'hashtag'))
  })

  it('averages GDELT tone per term and leaves it null otherwise', async () => {
    const g = await graphFor(tarcisio, base)
    assert.equal(node(g, 'word:rodovia')?.tone, -1.5)
    assert.equal(node(g, 'word:eleicao')?.tone, null)
  })

  it('filters by source and by domain', async () => {
    const bs = await graphFor(lula, { ...base, source: 'bluesky' })
    assert.equal(bs.stats.about, 1)
    const g1 = await graphFor(lula, { ...base, domain: 'g1.globo.com' })
    assert.equal(g1.stats.about, 1)
    assert.equal(g1.stats.docs, 1)
  })

  it('honours min and limit', async () => {
    const g = await graphFor(lula, { ...base, min: 2 })
    assert.deepEqual(g.nodes.map((n) => n.term).sort(), ['reforma', 'tributaria'])
    const one = await graphFor(lula, { ...base, limit: 1 })
    assert.equal(one.nodes.length, 1)
  })

  it('links every term to the person and co-occurring terms to each other', async () => {
    const g = await graphFor(lula, base)
    const spokes = g.links.filter((l) => l.source === 'person:lula')
    assert.equal(spokes.length, g.nodes.length)
    const pair = g.links.find((l) => l.source === 'word:reforma' && l.target === 'word:tributaria')
    assert.equal(pair?.count, 2)
    assert.ok(!g.links.some((l) => l.source === 'word:disputam'), 'pairs seen in a single doc are not linked')
  })

  it('returns an empty graph for a person without docs', async () => {
    const g = await graphFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
  })
})

describe('sourcesFor', () => {
  before(seed)

  it('lists outlets that mention the person with doc counts and tone', async () => {
    const rows = await sourcesFor(tarcisio, base)
    const folha = rows.find((r) => r.domain === 'folha.uol.com.br')
    assert.equal(folha?.docs, 1)
    assert.equal(folha?.tone, -1.5)
    assert.equal(folha?.tone_n, 1)
    const bsky = rows.find((r) => r.source === 'bluesky')
    assert.equal(bsky?.domain, 'ana.bsky.social')
    assert.equal(bsky?.tone, null)
  })
})
