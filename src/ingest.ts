import persons from '../seed.json' with { type: 'json' }
import { db, migrate } from './db.js'
import { collectors, defaultSources } from './collectors/index.js'
import { mentions, terms } from './extract.js'
import type { Person, RawDoc } from './types.js'

const pruneRemoved = async (ps: Person[]) => {
  const ids = ps.map((p) => p.id)
  await db.query(`delete from doc_persons where not (person_id = any($1::text[]))`, [ids])
  const { rows } = await db.query<{ id: string }>(`delete from persons where not (id = any($1::text[])) returning id`, [ids])
  if (rows.length) console.log(`removed persons: ${rows.map((r) => r.id).join(', ')}`)
}

const upsertPersons = (ps: Person[]) =>
  Promise.all(
    ps.map((p) =>
      db.query(
        `insert into persons (id, name, aliases) values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, aliases = excluded.aliases`,
        [p.id, p.name, p.aliases],
      ),
    ),
  )

const insertDoc = async (doc: RawDoc, ps: Person[]): Promise<boolean> => {
  const inserted = await db.query<{ id: number; inserted: boolean }>(
    `insert into docs (source, uri, text, published_at, extra_terms, domain, tone) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (uri) do update set domain = coalesce(docs.domain, excluded.domain), tone = coalesce(docs.tone, excluded.tone)
     returning id, (xmax = 0) as inserted`,
    [doc.source, doc.uri, doc.text, doc.publishedAt, JSON.stringify(doc.extraTerms ?? []), doc.domain ?? null, doc.tone ?? null],
  )
  const row = inserted.rows[0]
  if (!row?.inserted) return false
  const id = row.id
  const matched = ps.filter((p) => mentions(doc.text, p))
  const ts = terms(doc.text, doc.extraTerms)
  await Promise.all([
    ...matched.map((p) => db.query(`insert into doc_persons values ($1, $2)`, [id, p.id])),
    ...ts.map((t) => db.query(`insert into doc_terms values ($1, $2, $3)`, [id, t.term, t.kind])),
  ])
  return true
}

const runSource = async (name: string, ps: Person[]) => {
  const collect = collectors[name as keyof typeof collectors]
  const docs = await collect(ps).catch((e: Error) => (console.error(`[${name}] ${e.message}`), [] as RawDoc[]))
  const results = await docs.reduce<Promise<boolean[]>>(
    async (acc, d) => [...(await acc), await insertDoc(d, ps)],
    Promise.resolve([]),
  )
  console.log(`[${name}] fetched ${docs.length}, new ${results.filter(Boolean).length}`)
}

const main = async () => {
  await migrate()
  await pruneRemoved(persons)
  await upsertPersons(persons)
  const only = process.argv.slice(2)
  const names = only.length ? only : defaultSources
  await names.reduce<Promise<void>>(async (acc, n) => (await acc, runSource(n, persons)), Promise.resolve())
  const { rows } = await db.query<{ n: string }>(`select count(*) as n from docs`)
  console.log(`total docs: ${rows[0].n}`)
  await db.close()
}

main()
