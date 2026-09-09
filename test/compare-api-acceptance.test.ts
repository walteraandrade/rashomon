import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { docsText } from './docs.js'
import { persons, seed } from './fixture.js'
import './close.js'

// Independent verification of issue #93's numbered acceptance criteria, written against the
// spec rather than against test/compare.test.ts. HTTP-level, pattern of
// test/testimony-acceptance.test.ts. Named compare-api-acceptance (not compare-acceptance):
// Issue #91 deletes public/compare.html and its test/compare-acceptance.test.ts along with it,
// so this file is the only acceptance suite for the compare surface.

const lula = persons.find((p) => p.id === 'lula')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!

describe('compare API acceptance criteria (issue #93)', () => {
  before(seed)

  it('AC1: GET /api/compare?a=lula&b=bolsonaro returns 200 with exactly { days, a, b, terms }', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['a', 'b', 'days', 'terms'])
  })

  it('AC2: a.person and b.person are each { id, name, aliases }, matching the persons row', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    const body = (await res.json()) as { a: { person: unknown }; b: { person: unknown } }
    assert.deepEqual(body.a.person, { id: lula.id, name: lula.name, aliases: lula.aliases })
    assert.deepEqual(body.b.person, { id: bolsonaro.id, name: bolsonaro.name, aliases: bolsonaro.aliases })
  })

  it('AC3: an unknown a or an unknown b both return 404 with { error: "person not found" }', async () => {
    for (const url of ['/api/compare?a=nobody&b=lula', '/api/compare?a=lula&b=nobody']) {
      const res = await app.request(url)
      assert.equal(res.status, 404)
      assert.deepEqual(await res.json(), { error: 'person not found' })
    }
  })

  it('AC4: a/b omitted returns 404 with the same body', async () => {
    const res = await app.request('/api/compare')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('AC14: /api/compare is publicly cacheable on success, and its 404s are never stored (the exact ROLLING window is pinned in test/cache-control.test.ts)', async () => {
    const ok = await app.request('/api/compare?a=lula&b=bolsonaro')
    const notFound = await app.request('/api/compare?a=nobody&b=lula')
    assert.match(ok.headers.get('cache-control') ?? '', /^public, s-maxage=\d+/)
    assert.equal(notFound.headers.get('cache-control'), 'no-store')
  })

  it('AC15: the docs name the /api/compare route, its a/b parameters, and distinguish an absent term from one hidden as a name word', () => {
    assert.match(docsText, /\/api\/compare/)
    assert.match(docsText, /\?a=.*&b=|`a`\/`b`|`a`\s+.*`b`/)
    assert.match(docsText, /"name"/)
    assert.match(docsText, /\bnull\b/)
    assert.match(docsText, /own name/)
  })
})
