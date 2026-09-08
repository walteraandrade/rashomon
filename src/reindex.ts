import seedPersons from '../seed.json' with { type: 'json' }
import { analyzeTables, db, migrate } from './db.js'
import { discoverNames, domainOf, personsMentioned, terms } from './extract.js'
import { upsertPersons } from './store.js'
import type { Person, Source, Term } from './types.js'

type Row = { id: number; source: Source; text: string; extra_terms: Term[]; extra_names: string[] }

const reindexDoc = async (persons: Person[], { id, source, text, extra_terms, extra_names }: Row) => {
  const matched = personsMentioned(text, persons)
  const names = discoverNames({ source, text, extraNames: extra_names }, persons)
  const ts = matched.length ? terms(text, extra_terms) : []
  await Promise.all([
    ...matched.map((p) => db.query(`insert into doc_persons values ($1, $2)`, [id, p.id])),
    ...ts.map((t) => db.query(`insert into doc_terms values ($1, $2, $3)`, [id, t.term, t.kind])),
    ...names.map((n) => db.query(`insert into doc_candidates values ($1, $2)`, [id, n])),
  ])
}

// Separate from main()'s stdout/db wiring, so tests can reindex the fixture in-process.
export const reindexAll = async (persons: Person[]) => {
  await db.exec(`delete from doc_terms; delete from doc_persons; delete from doc_candidates;`)
  await upsertPersons(persons)
  const missing = await db.query<{ id: number; uri: string }>(`select id, uri from docs where domain is null and source <> 'bluesky'`)
  await missing.rows.reduce<Promise<void>>(
    async (acc, r) => (await acc, void (await db.query(`update docs set domain = $2 where id = $1`, [r.id, domainOf(r.uri) ?? null]))),
    Promise.resolve(),
  )
  const { rows } = await db.query<Row>(`select id, source, text, extra_terms, extra_names from docs`)
  await rows.reduce<Promise<void>>(async (acc, r) => (await acc, reindexDoc(persons, r)), Promise.resolve())
  // A reindex rewrites every derived table from empty, so the planner's row counts and
  // most-common-value lists are stale by construction when it ends: refresh them here,
  // unconditionally, in the process that owns DATA_DIR.
  const analyzed = await analyzeTables()
  return { docs: rows.length, backfilled: missing.rows.length, analyzed }
}

const main = async () => {
  await migrate()
  const { docs, backfilled, analyzed } = await reindexAll(seedPersons)
  if (backfilled) console.log(`backfilled domain for ${backfilled} docs`)
  console.log(`reindexed ${docs} docs`)
  console.log(`analyzed ${analyzed.join(', ')}`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
