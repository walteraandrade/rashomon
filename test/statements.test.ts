import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { queries, statements } from '../src/graph.js'
import { persons } from './fixture.js'

const [lula, tarcisio] = persons

// `statements` is what `pnpm bench` and the SQL-reading tests see; the routes run what
// `queries` builds. The two only agree because a builder numbers its placeholders by the
// statement's shape, never by the values, so this pins that the sample text is the route's text.
describe('statements render the same text the routes run (issue #131)', () => {
  const scope = { days: 7, source: 'rss,gkg', domain: 'folha.uol.com.br', lean: 'all', kind: 'word,phrase' }

  it('for every builder, with different values', () => {
    const built = {
      graph: queries.graph(lula, { ...scope, min: 5, sort: 'pmi', limit: 10 }),
      links: queries.links(lula, scope, ['word:a', 'word:b']),
      sources: queries.sources(lula, scope),
      docs: queries.docs(lula, { ...scope, term: 'x', kind: 'phrase', limit: 10, offset: 20 }),
      docsCount: queries.docsCount(lula, { ...scope, term: 'x', kind: 'phrase', limit: 10, offset: 20 }),
      timeline: queries.timeline(lula, { ...scope, term: 'x', kind: 'phrase', bucket: 'week' }),
      rising: queries.rising(lula, { ...scope, baseline: 14, min: 1, limit: 5 }),
      tone: queries.tone({ days: 1, min: 1 }),
      testimonySummary: queries.testimonySummary(lula, { days: 1, source: 'rss', method: 'kikori', min: 1 }),
      termTestimony: queries.termTestimony(lula, scope, 'kikori', ['word:a']),
      candidates: queries.candidates({ days: 1, min: 1, limit: 1 }),
      compare: queries.compare(lula, tarcisio, { ...scope, limit: 5 }),
    }
    for (const name of Object.keys(statements) as (keyof typeof statements)[]) {
      assert.equal(built[name].text, statements[name], name)
    }
  })

  it('binds exactly as many values as placeholders, and numbers them in order', () => {
    for (const [name, text] of Object.entries(statements)) {
      const placeholders = text.match(/\$\d+/g) ?? []
      assert.deepEqual(placeholders, placeholders.map((_, i) => `$${i + 1}`), name)
    }
    const q = queries.graph(lula, { ...scope, min: 5, sort: 'pmi', limit: 10 })
    assert.equal((q.text.match(/\$\d+/g) ?? []).length, q.values.length)
  })
})
