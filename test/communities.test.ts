import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { communities, type CommunityEdge } from '../src/communities.js'

describe('communities (issue #214)', () => {
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
