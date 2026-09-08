import { resetCaches } from './cache.js'
import { db } from './db.js'
import { discoverNames, personsMentioned, terms } from './extract.js'
import type { Person, RawDoc, Source } from './types.js'

// Tone is a GDELT measure. A doc keeps the source that first delivered it, so a
// later gkg row sharing the uri must not leak its tone into an rss/gnews doc.
export const tonedSources: Source[] = ['gdelt', 'gkg']
const toneFor = (doc: RawDoc) => (tonedSources.includes(doc.source) ? doc.tone ?? null : null)

export const pruneRemoved = async (ps: Person[]) => {
  const ids = ps.map((p) => p.id)
  await db.query(`delete from doc_persons where not (person_id = any($1::text[]))`, [ids])
  const { rows } = await db.query<{ id: string }>(`delete from persons where not (id = any($1::text[])) returning id`, [ids])
  resetCaches()
  return rows.map((r) => r.id)
}

// Every write goes through this file, so this is where the read cache is dropped. Whole-cache,
// not per-key: one new doc can move any window, any PMI denominator and any person's terms at
// once, and there is no cheap key-level answer to which entries it touched. `pnpm ingest` and
// `pnpm reindex` run in their own process and have no cache to drop, so this only matters to a
// process that both writes and serves (the test suite, and any future in-process write).
export const upsertPersons = (ps: Person[]) =>
  Promise.all(
    ps.map((p) =>
      db.query(
        `insert into persons (id, name, aliases) values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, aliases = excluded.aliases`,
        [p.id, p.name, p.aliases],
      ),
    ),
  ).finally(resetCaches)

export const insertDoc = async (doc: RawDoc, ps: Person[]): Promise<boolean> => {
  const inserted = await db.query<{ id: number; inserted: boolean }>(
    `insert into docs (source, uri, text, published_at, extra_terms, domain, tone, extra_names) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (uri) do update set
       domain = coalesce(docs.domain, excluded.domain),
       tone = case when docs.source = any($9::text[]) then coalesce(docs.tone, excluded.tone) else null end
     returning id, (xmax = 0) as inserted`,
    [doc.source, doc.uri, doc.text, doc.publishedAt, JSON.stringify(doc.extraTerms ?? []), doc.domain ?? null, toneFor(doc), JSON.stringify(doc.extraNames ?? []), tonedSources],
  )
  const row = inserted.rows[0]
  // The upsert may still have filled a missing domain or tone on an existing row.
  if (!row?.inserted) {
    resetCaches()
    return false
  }
  const id = row.id
  const matched = personsMentioned(doc.text, ps)
  // Terms of a doc naming nobody tracked only ever fed the PMI denominator, at 68% of the
  // largest table; the denominator now counts the same docs the numerator does (see graph.ts).
  const ts = matched.length ? terms(doc.text, doc.extraTerms) : []
  const names = discoverNames(doc, ps)
  await Promise.all([
    ...matched.map((p) => db.query(`insert into doc_persons values ($1, $2)`, [id, p.id])),
    ...ts.map((t) => db.query(`insert into doc_terms values ($1, $2, $3)`, [id, t.term, t.kind])),
    ...names.map((n) => db.query(`insert into doc_candidates values ($1, $2)`, [id, n])),
  ])
  resetCaches()
  return true
}
