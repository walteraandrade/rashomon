import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db, migrateP } from '../src/db.js'
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

describe('migrate drops the retired 365-day window (issue #270)', () => {
  before(async () => {
    await seed()
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    for (const days of [30, 60, 365]) await seedWindow(days)
  })
  after(async () => {
    for (const t of WINDOWED) await db.exec(`delete from ${t}`)
    await reseed()
  })

  it('removes days = 365 from every windowed table, keeps 30 and 60, and a second call changes nothing', async () => {
    await migrateP()
    for (const t of WINDOWED) assert.deepEqual(await daysIn(t), [30, 60], t)
    await migrateP()
    for (const t of WINDOWED) assert.deepEqual(await daysIn(t), [30, 60], t)
  })
})
