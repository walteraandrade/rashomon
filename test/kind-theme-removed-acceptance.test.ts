import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { graphFor, type GraphQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import './close.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Issue #108, AC1: Term's kind union drops 'theme' and keeps exactly the other three. tsc
// enforces this at compile time (pnpm typecheck); this test pins the same fact in the source
// text itself, the way kinds-consistency.test.ts already pins KINDS/docsWhereSql, so a
// regression is caught by `pnpm test` too, not only by a separate typecheck run.
describe('issue #108 AC1: Term.kind drops theme', () => {
  it('src/types.ts declares kind as exactly hashtag | word | phrase, never theme', () => {
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8')
    const m = /export type Term = \{[^}]*kind:\s*([^}]+)\}/.exec(types)
    assert.ok(m, 'Term type must be declared in src/types.ts')
    const union = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1])
    assert.deepEqual(union, ['hashtag', 'word', 'phrase'])
  })
})

const graphBase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula] = persons

// Issue #108, AC4: the graph route's own behaviour for an unrecognized kind token. docsFor,
// risingFor and timelineFor are already covered by test/docs.test.ts, test/rising-acceptance.test.ts
// and test/timeline.test.ts; graphFor's own "filtered to nothing" half of AC4 had no direct
// assertion (only shared parity coverage in test/graph-aggregations.test.ts, which pins the
// merged statement against a reference implementation of the same query, not the actual
// behaviour), so it is added here.
describe('issue #108 AC4: kind=theme on /graph behaves exactly like any other unrecognized kind', () => {
  before(seed)

  it('graphFor returns zero nodes for kind=theme, exactly as for kind=bogus, though kind=all has nodes', async () => {
    const all = await graphFor(lula, graphBase)
    assert.ok(all.nodes.length > 0, 'sanity: this window must have nodes for the comparison to mean anything')
    const theme = await graphFor(lula, { ...graphBase, kind: 'theme' })
    const bogus = await graphFor(lula, { ...graphBase, kind: 'bogus' })
    assert.deepEqual(theme.nodes, [])
    assert.deepEqual(bogus.nodes, [])
  })

  it('GET /people/:id/graph, /docs, /rising and /timeline?kind=theme all still return 200, never a route error', async () => {
    const paths = [
      '/api/people/lula/graph?kind=theme',
      '/api/people/lula/docs?kind=theme',
      '/api/people/lula/rising?kind=theme',
      '/api/people/lula/timeline?term=reforma&kind=theme',
    ]
    for (const path of paths) {
      const res = await app.request(path)
      assert.equal(res.status, 200, `${path} must return 200`)
    }
  })
})
