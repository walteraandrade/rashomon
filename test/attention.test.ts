import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { attentionFor, queries } from '../src/graph.js'
import { parseAttentionQuery } from '../src/query.js'
import { app } from '../src/server.js'
import { docsText } from './docs.js'
import { attentionRows, persons, seed } from './fixture.js'
import './close.js'

const [lula, , bolsonaro] = persons

// Calendar-day strings relative to the moment the suite runs, not a fixed date, so the fixture
// stays valid regardless of when the tests execute.
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const daysAgoYmd = (n: number) => ymd(new Date(Date.now() - n * 86_400_000))
const recentDay = daysAgoYmd(1)
const olderDay = daysAgoYmd(2)
const outsideDay = daysAgoYmd(40) // outside days:30, inside days:365

describe('GET /api/people/:id/attention', () => {
  before(async () => {
    await seed()
    await attentionRows(lula.id, [
      { day: recentDay, views: 1532 },
      { day: olderDay, views: 980 },
      { day: outsideDay, views: 200 },
    ])
  })

  it('returns the seeded rows ordered ascending by day, matching attentionFor', async () => {
    const res = await app.request(`/api/people/${lula.id}/attention?days=30`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, JSON.parse(JSON.stringify(await attentionFor(lula, parseAttentionQuery({ days: '30' })))))
    assert.equal(body.days, 30)
    assert.deepEqual(
      body.series.filter((r: { day: string }) => r.day === recentDay || r.day === olderDay),
      body.series,
    )
    assert.ok(body.series[0].day < body.series[1].day, 'ascending by day')
  })

  it('excludes a row outside the days:30 window, and includes it at days:365', async () => {
    const res30 = await app.request(`/api/people/${lula.id}/attention?days=30`)
    const body30 = await res30.json()
    assert.ok(!body30.series.some((r: { day: string }) => r.day === outsideDay))

    const res365 = await app.request(`/api/people/${lula.id}/attention?days=365`)
    const body365 = await res365.json()
    assert.ok(body365.series.some((r: { day: string }) => r.day === outsideDay))
  })

  it('a tracked person with no wikipedia field and no rows returns { days: 30, series: [] } with 200', async () => {
    const res = await app.request(`/api/people/${bolsonaro.id}/attention`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { days: 30, series: [] })
  })

  it('an unknown id returns 404 with { error: "person not found" }', async () => {
    const res = await app.request('/api/people/does-not-exist/attention')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('?days=45 snaps to 30, the nearest of [7, 30, 365]', () => {
    assert.equal(parseAttentionQuery({ days: '45' }).days, 30)
  })

  it("the attention builder's rendered SQL is pinned via the statements pattern", () => {
    const q = queries.attention(lula, { days: 30 })
    assert.match(q.text, /from person_attention/)
    assert.match(q.text, /order by day/)
  })

  it('docs/api.md names the route, its days parameter/default and the { days, series } / { day, views } shape', () => {
    assert.match(docsText, /\/api\/people\/:id\/attention/)
    assert.match(docsText, /days.*30/)
    assert.match(docsText, /\bseries\b/)
    assert.match(docsText, /\bday\b.*\bviews\b/)
  })
})
