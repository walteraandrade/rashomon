import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { betweenness, communities, neighbors, type CommunityEdge } from '../src/communities.js'

describe('communities (issue #214)', () => {
  it('imports nothing from db.ts, store.ts, aggregate.ts or an Effect/SQL module', () => {
    const source = readFileSync(new URL('../src/communities.ts', import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, /\.\/(db|store|aggregate)\.js$/)
      assert.doesNotMatch(specifier, /^effect|@effect\//)
    }
  })

  it('same edges and same seed give the same map twice', () => {
    const edges: CommunityEdge[] = [
      { a: 'word:a', b: 'word:b', count: 3 },
      { a: 'word:b', b: 'word:c', count: 2 },
    ]
    const first = communities(edges, 42)
    const second = communities(edges, 42)
    assert.deepEqual([...first], [...second])
  })

  it('two disconnected components yield two distinct community numbers', () => {
    const edges: CommunityEdge[] = [
      { a: 'word:a', b: 'word:b', count: 5 },
      { a: 'word:x', b: 'word:y', count: 5 },
    ]
    const assignment = communities(edges, 42)
    assert.equal(assignment.get('word:a'), assignment.get('word:b'))
    assert.equal(assignment.get('word:x'), assignment.get('word:y'))
    assert.notEqual(assignment.get('word:a'), assignment.get('word:x'))
  })

  it('a self-referencing entry still assigns an isolated node its own community, never a missing key', () => {
    const edges: CommunityEdge[] = [{ a: 'word:alone', b: 'word:alone', count: 0 }]
    const assignment = communities(edges, 42)
    assert.equal(assignment.size, 1)
    assert.equal(typeof assignment.get('word:alone'), 'number')
  })

  it('graphology and graphology-communities-louvain are pinned exact in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    for (const name of ['graphology', 'graphology-communities-louvain']) {
      const version = pkg.dependencies[name]
      assert.ok(version, `${name} must be a dependency`)
      assert.doesNotMatch(version, /[\^~]/)
      assert.match(version, /^\d+\.\d+\.\d+$/)
    }
  })

  it('an empty edge list yields an empty map, never a thrown error', () => {
    assert.deepEqual([...communities([], 42)], [])
  })

  it('mixing a real edge and an isolated self-entry covers every node with a community', () => {
    const edges: CommunityEdge[] = [
      { a: 'word:a', b: 'word:b', count: 4 },
      { a: 'word:solo', b: 'word:solo', count: 0 },
    ]
    const assignment = communities(edges, 42)
    assert.deepEqual([...assignment.keys()].sort(), ['word:a', 'word:b', 'word:solo'])
  })
})

describe('betweenness (issue #219)', () => {
  it("ranks a path graph's middle node highest", () => {
    const edges: CommunityEdge[] = [
      { a: 'word:a', b: 'word:b', count: 1 },
      { a: 'word:b', b: 'word:c', count: 1 },
    ]
    const scores = betweenness(edges)
    assert.ok(scores.get('word:b')! > scores.get('word:a')!)
    assert.ok(scores.get('word:b')! > scores.get('word:c')!)
  })

  it('on an edgeless graph returns 0 for every node', () => {
    const edges: CommunityEdge[] = [
      { a: 'word:x', b: 'word:x', count: 0 },
      { a: 'word:y', b: 'word:y', count: 0 },
    ]
    const scores = betweenness(edges)
    assert.equal(scores.get('word:x'), 0)
    assert.equal(scores.get('word:y'), 0)
  })

  it('an empty edge list yields an empty map', () => {
    assert.deepEqual([...betweenness([])], [])
  })
})

describe('neighbors (issue #218)', () => {
  it('an empty sets map yields no pairs and no edges', () => {
    assert.deepEqual(neighbors(new Map(), 5), { pairs: [], edges: [] })
  })

  it('a single domain has no one to pair against', () => {
    const sets = new Map([['a.example', new Set(['word:x'])]])
    assert.deepEqual(neighbors(sets, 5), { pairs: [], edges: [] })
  })

  it('two domains sharing every term get similarity 1, both directions', () => {
    const sets = new Map([
      ['a.example', new Set(['word:x', 'word:y'])],
      ['b.example', new Set(['word:x', 'word:y'])],
    ])
    const { pairs, edges } = neighbors(sets, 5)
    assert.deepEqual(pairs, [
      { domain: 'a.example', neighbor: 'b.example', similarity: 1 },
      { domain: 'b.example', neighbor: 'a.example', similarity: 1 },
    ])
    assert.deepEqual(edges, [{ a: 'a.example', b: 'b.example', count: 1 }])
  })

  it('topK caps pairs but never edges: a bridge neither side kept still reaches Louvain', () => {
    const sets = new Map<string, Set<string>>([
      ['a.example', new Set(['word:x', 'word:b'])],
      ['a1.example', new Set(['word:x'])],
      ['a2.example', new Set(['word:x'])],
      ['b.example', new Set(['word:y', 'word:b'])],
      ['b1.example', new Set(['word:y'])],
      ['b2.example', new Set(['word:y'])],
    ])
    const { pairs, edges } = neighbors(sets, 2)
    const bridge = (x: { domain?: string; neighbor?: string; a?: string; b?: string }) =>
      [x.domain ?? x.a, x.neighbor ?? x.b].sort().join('|') === 'a.example|b.example'
    assert.ok(!pairs.some(bridge), 'each side keeps two closer neighbours')
    assert.equal(edges.filter(bridge).length, 1, 'the bridge is one undirected edge')
    assert.equal(edges.length, new Set(edges.map((e) => [e.a, e.b].sort().join('|'))).size, 'no pair appears twice')
  })

  it('two domains sharing nothing produce no pair and no edge', () => {
    const sets = new Map([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:y'])],
    ])
    assert.deepEqual(neighbors(sets, 5), { pairs: [], edges: [] })
  })

  it('a tied similarity pair breaks the tie by neighbour name ascending', () => {
    const sets = new Map([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['c.example', new Set(['word:x'])],
    ])
    const { pairs } = neighbors(sets, 5)
    const forA = pairs.filter((p) => p.domain === 'a.example')
    assert.deepEqual(forA.map((p) => p.neighbor), ['b.example', 'c.example'])
    assert.ok(forA.every((p) => p.similarity === 1))
  })

  it('topK truncates each domain\'s own neighbour list, keeping the highest-similarity ones', () => {
    const sets = new Map<string, Set<string>>([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['c.example', new Set(['word:x'])],
      ['d.example', new Set(['word:x'])],
    ])
    const { pairs } = neighbors(sets, 2)
    const forA = pairs.filter((p) => p.domain === 'a.example')
    assert.equal(forA.length, 2)
    assert.deepEqual(forA.map((p) => p.neighbor), ['b.example', 'c.example'])
  })

  it('a domain with a nonempty set but zero edges is absent from pairs/edges, leaving it for the caller to self-loop', () => {
    const sets = new Map([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['lonely.example', new Set(['word:z'])],
    ])
    const { pairs, edges } = neighbors(sets, 5)
    assert.ok(!pairs.some((p) => p.domain === 'lonely.example' || p.neighbor === 'lonely.example'))
    assert.ok(!edges.some((e) => e.a === 'lonely.example' || e.b === 'lonely.example'))
    // still one of the sets' own keys, so a caller iterating sets.keys() can find it and add
    // the self-loop buildCommunitiesForWindow's own convention uses for an isolated term.
    assert.ok(sets.has('lonely.example'))
  })

  it('neighbors is pure (no SQL/DB import) and covers empty input, single domain, tied pair, topK truncation and a zero-edge domain remaining self-loop-eligible (AC16)', () => {
    const src = readFileSync(new URL('../src/communities.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(src, /from ['"](\.\/(db|store|aggregate)\.js|effect)/, 'communities.ts must not import db/store/aggregate or an Effect/SQL module')

    assert.deepEqual(neighbors(new Map(), 5), { pairs: [], edges: [] }, 'empty input')

    const single = new Map([['a.example', new Set(['word:x'])]])
    assert.deepEqual(neighbors(single, 5), { pairs: [], edges: [] }, 'single domain has no pairs')

    const tied = new Map([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['c.example', new Set(['word:x'])],
    ])
    const { pairs: tiedPairs } = neighbors(tied, 5)
    assert.deepEqual(tiedPairs.filter((p) => p.domain === 'a.example').map((p) => p.neighbor), ['b.example', 'c.example'], 'tied similarity breaks by domain asc')

    const four = new Map<string, Set<string>>([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['c.example', new Set(['word:x'])],
      ['d.example', new Set(['word:x'])],
    ])
    const { pairs: truncated } = neighbors(four, 2)
    assert.equal(truncated.filter((p) => p.domain === 'a.example').length, 2, 'topK truncates to the highest-similarity neighbours')

    const withLonely = new Map([
      ['a.example', new Set(['word:x'])],
      ['b.example', new Set(['word:x'])],
      ['lonely.example', new Set(['word:z'])],
    ])
    const { pairs: p2, edges: e2 } = neighbors(withLonely, 5)
    assert.ok(!p2.some((p) => p.domain === 'lonely.example'))
    assert.ok(!e2.some((e) => e.a === 'lonely.example' || e.b === 'lonely.example'))
    assert.ok(withLonely.has('lonely.example'), 'a zero-edge domain still remains a self-loop-eligible node for the caller')
  })
})
