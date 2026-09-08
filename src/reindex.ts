import persons from '../seed.json' with { type: 'json' }
import { db, migrate } from './db.js'
import { discoverNames, domainOf, personsMentioned, terms } from './extract.js'
import { upsertPersons } from './store.js'
import type { Source, Term } from './types.js'

type Row = { id: number; source: Source; text: string; extra_terms: Term[]; extra_names: string[] }

const reindexDoc = async ({ id, source, text, extra_terms, extra_names }: Row) => {
  const matched = personsMentioned(text, persons)
  const names = discoverNames({ source, text, extraNames: extra_names }, persons)
  await Promise.all([
    ...matched.map((p) => db.query(`insert into doc_persons values ($1, $2)`, [id, p.id])),
    ...terms(text, extra_terms).map((t) => db.query(`insert into doc_terms values ($1, $2, $3)`, [id, t.term, t.kind])),
    ...names.map((n) => db.query(`insert into doc_candidates values ($1, $2)`, [id, n])),
  ])
}

const main = async () => {
  await migrate()
  await db.exec(`delete from doc_terms; delete from doc_persons; delete from doc_candidates;`)
  await upsertPersons(persons)
  const missing = await db.query<{ id: number; uri: string }>(`select id, uri from docs where domain is null and source <> 'bluesky'`)
  await missing.rows.reduce<Promise<void>>(
    async (acc, r) => (await acc, void (await db.query(`update docs set domain = $2 where id = $1`, [r.id, domainOf(r.uri) ?? null]))),
    Promise.resolve(),
  )
  if (missing.rows.length) console.log(`backfilled domain for ${missing.rows.length} docs`)
  const { rows } = await db.query<Row>(`select id, source, text, extra_terms, extra_names from docs`)
  await rows.reduce<Promise<void>>(async (acc, r) => (await acc, reindexDoc(r)), Promise.resolve())
  console.log(`reindexed ${rows.length} docs`)
  await db.close()
}

main()
