import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { materialize } from '../src/materialize.js'
import { pgWarmStore } from '../src/warmstore.js'
import type { Person } from '../src/types.js'
import { persons, reseed, seed } from './fixture.js'

// Rows as the routes' own middleware reads them: no wikipedia, no seed fields.
export const dbPersons = async () => (await db.query<Person>(`select id, name, aliases from persons order by name`)).rows

// A test that mutates the shared in-memory database ends with this, or the byte-identity tests
// after it would compare against a corpus with no terms.
export const restore = async () => {
  await reseed()
  await db.exec(`delete from warm_entries`)
  await buildGraphAggregates(persons)
}

// Entries outlive a rebuild of graph_scopes, so a leftover row would turn a `miss` case into `stale`.
export const built = async () => {
  await seed()
  await db.exec(`delete from warm_entries`)
  await buildGraphAggregates(persons)
}

export const materialized = async () => {
  await built()
  const result = await materialize(await dbPersons(), { store: pgWarmStore })
  return { store: pgWarmStore, result }
}

export const storedEntries = async (): Promise<Map<string, string>> =>
  new Map((await db.query<{ pathname: string; body: string }>(`select pathname, body from warm_entries`)).rows.map((r) => [r.pathname, r.body]))

// Every statement text db.query sees while fn runs, in order.
export const recordStatements = async (fn: () => Promise<unknown>): Promise<string[]> => {
  const original = db.query.bind(db)
  const descriptor = Object.getOwnPropertyDescriptor(db, 'query')
  const texts: string[] = []
  Object.defineProperty(db, 'query', {
    configurable: true,
    writable: true,
    value: (sql: string, ...rest: unknown[]) => {
      texts.push(sql)
      return (original as (...a: unknown[]) => Promise<unknown>)(sql, ...rest)
    },
  })
  try {
    await fn()
  } finally {
    if (descriptor) Object.defineProperty(db, 'query', descriptor)
    else delete (db as unknown as { query?: unknown }).query
  }
  return texts
}
