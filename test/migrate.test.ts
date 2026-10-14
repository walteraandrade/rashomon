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

// Issue #317 acceptance criterion 1, read back through the catalog rather than the schema string.
describe('migrate and warm_entries (issue #317 acceptance)', () => {
  before(seed)
  after(async () => {
    await db.exec(`delete from warm_entries`)
    await reseed()
  })

  const columns = async () =>
    (await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_schema = current_schema() and table_name = 'warm_entries' order by column_name`,
    )).rows
  const insert = (pathname: string, person: string | null, body: string | null) =>
    db.query(`insert into warm_entries (pathname, person_id, body) values ($1, $2, $3)`, [pathname, person, body])

  it('migrate() creates warm_entries: pathname text primary key, person_id text not null cascading from persons, body text not null (AC1)', async () => {
    await migrateP()
    assert.deepEqual(await columns(), [
      { column_name: 'body', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'pathname', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'person_id', data_type: 'text', is_nullable: 'NO' },
    ])
    const { rows } = await db.query<{ type: string; columns: string[]; target: string | null; delete_rule: string | null }>(
      `select c.contype::text as type,
              array(select a.attname::text from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k order by a.attname) as columns,
              c.confrelid::regclass::text as target,
              c.confdeltype::text as delete_rule
         from pg_constraint c where c.conrelid = 'warm_entries'::regclass order by c.contype`,
    )
    const primary = rows.find((r) => r.type === 'p')
    const foreign = rows.find((r) => r.type === 'f')
    assert.deepEqual(primary?.columns, ['pathname'])
    assert.deepEqual(foreign?.columns, ['person_id'])
    assert.equal(foreign?.target, 'persons')
    assert.equal(foreign?.delete_rule, 'c')
  })

  it('refuses a null body, a null person, an unknown person and a repeated pathname (AC1)', async () => {
    await assert.rejects(insert('warm/v1/lula/graph/null-body.json', 'lula', null))
    await assert.rejects(insert('warm/v1/lula/graph/null-person.json', null, 'k\n{}'))
    await assert.rejects(insert('warm/v1/nobody/graph/a.json', 'nobody', 'k\n{}'))
    await insert('warm/v1/lula/graph/once.json', 'lula', 'k\n{}')
    await assert.rejects(insert('warm/v1/lula/graph/once.json', 'lula', 'k\n{}'))
  })

  it('a second migrate() call leaves existing rows untouched (AC1)', async () => {
    await db.exec(`delete from warm_entries`)
    await insert('warm/v1/lula/graph/kept.json', 'lula', 'built\n{"a":1}')
    await insert('warm/v1/tarcisio/sources/kept.json', 'tarcisio', 'built\n{"b":2}')
    await migrateP()
    await migrateP()
    const { rows } = await db.query(`select pathname, person_id, body from warm_entries order by pathname`)
    assert.deepEqual(rows, [
      { pathname: 'warm/v1/lula/graph/kept.json', person_id: 'lula', body: 'built\n{"a":1}' },
      { pathname: 'warm/v1/tarcisio/sources/kept.json', person_id: 'tarcisio', body: 'built\n{"b":2}' },
    ])
    assert.deepEqual(await columns(), [
      { column_name: 'body', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'pathname', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'person_id', data_type: 'text', is_nullable: 'NO' },
    ])
  })
})
