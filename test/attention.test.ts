import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
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
const outsideDay = daysAgoYmd(40) // outside every window (retention is 21 days), still a stored row

describe('#211: GET /api/people/:id/attention', () => {
  before(async () => {
    await seed()
    await attentionRows(lula.id, [
      { day: recentDay, views: 1532 },
      { day: olderDay, views: 980 },
      { day: outsideDay, views: 200 },
    ])
  })

  it('returns the seeded rows ordered ascending by day, matching attentionFor (AC1)', async () => {
    const res = await app.request(`/api/people/${lula.id}/attention?days=21`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, JSON.parse(JSON.stringify(await attentionFor(lula, parseAttentionQuery({ days: '21' })))))
    assert.deepEqual(body, {
      days: 21,
      series: [
        { day: olderDay, views: 980 },
        { day: recentDay, views: 1532 },
      ],
    })
  })

  it('excludes a row outside the 21-day window, whichever wider days the caller asks for (AC2)', async () => {
    for (const days of ['21', '30', '60', '365']) {
      const body = await (await app.request(`/api/people/${lula.id}/attention?days=${days}`)).json()
      assert.equal(body.days, 21, days)
      assert.ok(!body.series.some((r: { day: string }) => r.day === outsideDay), days)
    }
  })

  it('a stored row older than the window is still in person_attention, never trimmed by retention', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from person_attention where person_id = $1 and day = $2`, [lula.id, outsideDay])
    assert.equal(rows[0].n, 1)
  })

  it('a tracked person with no wikipedia field and no rows returns { days: 21, series: [] } with 200 by default and for a retired days=60 (AC3, issue #313 AC23)', async () => {
    const res = await app.request(`/api/people/${bolsonaro.id}/attention`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { days: 21, series: [] })
    const wide = await app.request(`/api/people/${bolsonaro.id}/attention?days=60`)
    assert.deepEqual(await wide.json(), { days: 21, series: [] })
  })

  it('an unknown id returns 404 with { error: "person not found" } (AC4)', async () => {
    const res = await app.request('/api/people/does-not-exist/attention')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('?days=45 snaps to 21, the nearest of [7, 21] (AC5)', () => {
    assert.equal(parseAttentionQuery({ days: '45' }).days, 21)
    assert.equal(parseAttentionQuery({}).days, 21)
  })

  it("the attention builder's rendered SQL is pinned via the statements pattern (AC11)", () => {
    const q = queries.attention(lula, { days: 21 })
    assert.match(q.text, /from person_attention/)
    assert.match(q.text, /order by day/)
  })

  it('docs/api.md names the route, its days parameter/default and the { days, series } / { day, views } shape (AC12)', () => {
    const match = /## attention\n[\s\S]*?(?=\n## |$)/.exec(docsText)
    assert.ok(match, 'docs/api.md has an attention section')
    const section = match[0]
    assert.match(section, /\/api\/people\/:id\/attention/)
    assert.match(section, /days[\s\S]*?21/)
    assert.match(section, /\bseries\b/)
    assert.match(section, /\bday\b[\s\S]*?\bviews\b/)
    assert.match(section, /\{ days, series \}/)
    assert.match(section, /\{ day, views \}/)
  })
})
