import { db } from './db.js'
import { mentions, terms } from './extract.js'
import type { Person, RawDoc } from './types.js'

export const pruneRemoved = async (ps: Person[]) => {
  const ids = ps.map((p) => p.id)
  await db.query(`delete from doc_persons where not (person_id = any($1::text[]))`, [ids])
  const { rows } = await db.query<{ id: string }>(`delete from persons where not (id = any($1::text[])) returning id`, [ids])
  return rows.map((r) => r.id)
}

export const upsertPersons = (ps: Person[]) =>
  Promise.all(
    ps.map((p) =>
      db.query(
        `insert into persons (id, name, aliases) values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, aliases = excluded.aliases`,
        [p.id, p.name, p.aliases],
      ),
    ),
  )

export const insertDoc = async (doc: RawDoc, ps: Person[]): Promise<boolean> => {
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
