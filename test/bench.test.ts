import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { corpus, DOMAINS, vocabulary } from '../src/bench-corpus.js'
import { atlasScenarios, scenarios } from '../src/bench-scenarios.js'
import { personsMentioned } from '../src/extract.js'
import { SOURCES } from '../src/query.js'
import { app } from '../src/server.js'
import { persons, seed } from './fixture.js'

// The benchmark itself is not run by `pnpm test` (it builds its own database and reports
// timings). What is asserted here is that its request set stays valid against the shared
// fixture, and that its synthetic corpus is deterministic and well-formed.

const options = { docs: 300, days: 120, seed: 1234, now: Date.UTC(2026, 0, 1) }

describe('bench scenarios', () => {
  before(seed)

  it('names are unique', () => {
    assert.equal(new Set(scenarios.map((s) => s.name)).size, scenarios.length)
  })

  it('covers graph, sources, docs, timeline, tone and testimony', () => {
    const routes = new Set(scenarios.map((s) => s.route))
    for (const route of ['graph', 'sources', 'docs', 'timeline', 'tone', 'testimony']) assert.ok(routes.has(route), route)
  })

  it('every scenario is a request the API still answers', async () => {
    for (const s of scenarios) {
      const res = await app.request(s.url('lula', 'reforma'))
      assert.equal(res.status, 200, `${s.name}: ${s.url('lula', 'reforma')}`)
    }
  })

  it('the atlas group is a subset of the scenarios', () => {
    const names = new Set(scenarios.map((s) => s.name))
    for (const name of atlasScenarios) assert.ok(names.has(name), name)
  })
})

describe('bench corpus', () => {
  it('is deterministic for a seed and different for another', () => {
    assert.deepEqual(corpus(persons, options), corpus(persons, options))
    assert.notDeepEqual(corpus(persons, options), corpus(persons, { ...options, seed: options.seed + 1 }))
  })

  it('emits the requested number of docs with unique uris', () => {
    const docs = corpus(persons, options)
    assert.equal(docs.length, options.docs)
    assert.equal(new Set(docs.map((d) => d.uri)).size, options.docs)
  })

  it('only uses known sources and stays inside the window', () => {
    const docs = corpus(persons, options)
    const oldest = options.now - options.days * 86_400_000
    for (const d of docs) {
      assert.ok(SOURCES.includes(d.source), d.source)
      const at = Date.parse(d.publishedAt)
      assert.ok(at >= oldest && at <= options.now, d.publishedAt)
    }
  })

  it('gives tone to gdelt and gkg only, matching the store rule', () => {
    for (const d of corpus(persons, options)) {
      if (d.source === 'gdelt' || d.source === 'gkg') assert.equal(typeof d.tone, 'number')
      else assert.equal(d.tone, undefined)
    }
  })

  it('names a tracked person in roughly a third of the docs, as production does', () => {
    const docs = corpus(persons, { ...options, docs: 2000 })
    const named = docs.filter((d) => personsMentioned(d.text, persons).length > 0).length
    assert.ok(named / docs.length > 0.2 && named / docs.length < 0.5, `${named}/${docs.length}`)
  })

  it('gives themes to gkg docs only', () => {
    for (const d of corpus(persons, options)) {
      if (d.source === 'gkg') assert.ok((d.extraTerms ?? []).every((t) => t.kind === 'theme'))
      else assert.deepEqual(d.extraTerms, [])
    }
  })

  it('draws domains from the fixed list, or a handle for bluesky', () => {
    for (const d of corpus(persons, options)) {
      if (d.source === 'bluesky') assert.match(d.domain ?? '', /^perfil\d+\.bsky\.social$/)
      else assert.ok(DOMAINS.includes(d.domain ?? ''), String(d.domain))
    }
  })

  it('keeps the head of the vocabulary ahead of the synthetic tail', () => {
    const words = vocabulary(10)
    assert.equal(words.at(-1), 'termo0009')
    assert.equal(words[0], 'reforma')
  })
})
