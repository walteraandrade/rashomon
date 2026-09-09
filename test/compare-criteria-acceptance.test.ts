import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { docsText } from './docs.js'
import { persons, seed } from './fixture.js'
import './close.js'

// Independent HTTP-level verification of issue #93's numbered acceptance criteria, written
// against the spec rather than against test/compare-api-acceptance.test.ts.

const lula = persons.find((p) => p.id === 'lula')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!

describe('GET /api/compare acceptance criteria (issue #93)', () => {
  before(seed)

  it('AC1: returns 200 with a body of exactly { days, a, b, terms } — no links/signature/nodes/outlets', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['a', 'b', 'days', 'terms'])
    assert.ok(!('links' in (body.a as object)))
    assert.ok(!('nodes' in body))
    assert.ok(!('signature' in body))
    assert.ok(!('outlets' in body))
  })

  it('AC2: a.person and b.person are each { id, name, aliases }, matching the persons row', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    const body = (await res.json()) as { a: { person: unknown }; b: { person: unknown } }
    assert.deepEqual(body.a.person, { id: lula.id, name: lula.name, aliases: lula.aliases })
    assert.deepEqual(body.b.person, { id: bolsonaro.id, name: bolsonaro.name, aliases: bolsonaro.aliases })
  })

  it('AC3: an unknown a or an unknown b both return 404 with { error: "person not found" }', async () => {
    const resA = await app.request('/api/compare?a=nobody&b=lula')
    assert.equal(resA.status, 404)
    assert.deepEqual(await resA.json(), { error: 'person not found' })
    const resB = await app.request('/api/compare?a=lula&b=nobody')
    assert.equal(resB.status, 404)
    assert.deepEqual(await resB.json(), { error: 'person not found' })
  })

  it('AC4: a and b omitted returns 404 with the same body', async () => {
    const res = await app.request('/api/compare')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('AC14: /api/compare gets the rolling-window s-maxage on success and no-store on its 404s', async () => {
    const ok = await app.request('/api/compare?a=lula&b=bolsonaro')
    assert.match(ok.headers.get('cache-control') ?? '', /^public, s-maxage=\d+, stale-while-revalidate=\d+$/)
    const notFoundA = await app.request('/api/compare?a=nobody&b=lula')
    assert.equal(notFoundA.headers.get('cache-control'), 'no-store')
    const notFoundBoth = await app.request('/api/compare')
    assert.equal(notFoundBoth.headers.get('cache-control'), 'no-store')
  })

  it('AC15: the docs name /api/compare, its a/b parameters, and distinguish an absent term from one hidden as a name word', () => {
    assert.match(docsText, /\/api\/compare/)
    assert.match(docsText, /a=<personId>&b=<personId>|`a`.*`b`|`a`\/`b`/)
    // the null-vs-"name" distinction: an absent term reads null, a hidden-own-name term reads
    // the literal string "name" -- both facts must be stated, not merely the word "null"
    assert.match(docsText, /`?null`?\s*\(measured[^)]*\)|null.*measured|measured.*null/)
    assert.match(docsText, /"name"/)
    assert.match(docsText, /own name word/)
  })
})
