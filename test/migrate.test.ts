import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db, migrateP, RETIRED_WINDOW_DAYS } from '../src/db.js'
import { DAYS } from '../src/query.js'
import { persons, reseed, seed } from './fixture.js'
import './close.js'

const seedWindow = async (days: number) => {
  const person = persons[0].id
  await db.query(`insert into graph_scopes (days, source, person_id, docs, tracked, about) values ($1, 'all', $2, 1, 1, 1)`, [days, person])
  await db.query(`insert into graph_terms (days, source, person_id, term, kind, c_pt, c_t) values ($1, 'all', $2, 'x', 'word', 1, 1)`, [days, person])
  await db.query(`insert into term_communities (days, source, person_id, term, kind, community) values ($1, 'all', $2, 'x', 'word', 0)`, [days, person])
  await db.query(`insert into term_links (days, source, person_id, a, b, count) values ($1, 'all', $2, 'a', 'b', 1)`, [days, person])
  await db.query(`insert into outlet_fields (days, person_id, domain, field) values ($1, $2, 'd.example', 0)`, [days, person])
  await db.query(`insert into outlet_neighbors (days, person_id, domain, neighbor, similarity) values ($1, $2, 'd.example', 'n.example', 0.5)`, [days, person])
}

const WINDOWED = ['graph_scopes', 'graph_terms', 'term_communities', 'term_links', 'outlet_fields', 'outlet_neighbors']
const daysIn = async (table: string) => (await db.query<{ days: number }>(`select days from ${table} order by days`)).rows.map((r) => r.days)

describe('migrate drops the retired windows (issues #270, #313)', () => {
  before(async () => {
    await seed()
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    for (const days of [7, 21, 30, 60, 365]) await seedWindow(days)
  })
  after(async () => {
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    await reseed()
  })

  it('removes the retired 30, 60 and 365 windows from every windowed table, keeps 7 and 21, and a second call changes nothing', async () => {
    await migrateP()
    for (const t of WINDOWED) assert.deepEqual(await daysIn(t), [7, 21], t)
    await migrateP()
    for (const t of WINDOWED) assert.deepEqual(await daysIn(t), [7, 21], t)
  })

  it('no retired window is in DAYS', () => {
    assert.deepEqual(RETIRED_WINDOW_DAYS, [30, 60, 365])
    assert.deepEqual(RETIRED_WINDOW_DAYS.filter((d) => DAYS.includes(d)), [])
  })
})

// Issue #313 acceptance criteria, quoted by number.
describe('migrate and the retired windows (issue #313 acceptance)', () => {
  before(async () => {
    await seed()
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    for (const days of [365, 30, 7, 60, 21]) await seedWindow(days)
  })
  after(async () => {
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    await reseed()
  })

  it('migrate() removes days 30, 60 and 365 from all six windowed tables, keeps 7 and 21, and a second call changes nothing (AC21)', async () => {
    assert.equal(WINDOWED.length, 6)
    await migrateP()
    const first = Object.fromEntries(await Promise.all(WINDOWED.map(async (t) => [t, await daysIn(t)] as const)))
    for (const t of WINDOWED) assert.deepEqual(first[t], [7, 21], t)
    await migrateP()
    for (const t of WINDOWED) assert.deepEqual(await daysIn(t), first[t], `${t} after a second migrate`)
  })

  it('RETIRED_WINDOW_DAYS names 30, 60 and 365 and shares no member with DAYS (AC21)', () => {
    assert.deepEqual([...RETIRED_WINDOW_DAYS].sort((a, b) => a - b), [30, 60, 365])
    assert.deepEqual(RETIRED_WINDOW_DAYS.filter((d) => (DAYS as readonly number[]).includes(d)), [])
  })
})
