import { clampEnv, db } from './db.js'
import { discoverNames, personsMentioned, terms } from './extract.js'
import type { Person, RawDoc, Source, Term } from './types.js'

// Tone is a GDELT measure. A doc keeps the source that first delivered it, so a
// later gkg row sharing the uri must not leak its tone into an rss/gnews doc.
export const tonedSources: Source[] = ['gdelt', 'gkg']
const toneFor = (doc: RawDoc) => (tonedSources.includes(doc.source) ? doc.tone ?? null : null)

// The two bounds every write path here respects: rows carried by one statement, and documents
// carried by one transaction. Neither grows with the size of the corpus, so ingest and reindex
// run in constant memory and never hold a transaction open across an arbitrary amount of work.
export const writeBatchRows = () => clampEnv(process.env.WRITE_BATCH_ROWS, 500, 1, 10_000)
export const writeBatchDocs = () => clampEnv(process.env.WRITE_BATCH_DOCS, 200, 1, 5_000)

export const batches = <T>(xs: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size))

export const inBatches = <T>(xs: readonly T[], size: number, fn: (batch: T[]) => Promise<unknown>) =>
  batches(xs, size).reduce<Promise<void>>(async (acc, b) => (await acc, void (await fn(b))), Promise.resolve())

let open = 0

// PGlite is a single connection, so a nested `begin` would silently join the transaction
// already open and the inner `commit` would end it early: an inner call just runs in the
// outer one and the outermost caller decides whether the whole unit commits.
export const inTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (open) return fn()
  await db.exec(`begin`)
  open = 1
  try {
    const value = await fn()
    await db.exec(`commit`)
    return value
  } catch (e) {
    // A failed `commit` already ended the transaction, so this rollback is allowed to be a no-op.
    await db.exec(`rollback`).catch(() => undefined)
    throw e
  } finally {
    open = 0
  }
}

export const pruneRemoved = async (ps: Person[]) => {
  const ids = ps.map((p) => p.id)
  return inTransaction(async () => {
    await db.query(`delete from doc_persons where not (person_id = any($1::text[]))`, [ids])
    const { rows } = await db.query<{ id: string }>(`delete from persons where not (id = any($1::text[])) returning id`, [ids])
    return rows.map((r) => r.id)
  })
}

// One statement per batch of people instead of one per person, and `where` on the conflict so a
// seed that did not change writes no row version at all. Aliases travel as json because
// `unnest` flattens a text[][] across rows and would mix one person's aliases into the next.
export const upsertPersons = (ps: Person[], size = writeBatchRows()) => {
  const unique = [...new Map(ps.map((p) => [p.id, p])).values()]
  return inTransaction(() =>
    inBatches(unique, size, (batch) =>
      db.query(
        `insert into persons (id, name, aliases)
         select p->>'id', p->>'name', array(select jsonb_array_elements_text(p->'aliases'))
         from jsonb_array_elements($1::jsonb) as p
         on conflict (id) do update set name = excluded.name, aliases = excluded.aliases
         where persons.name is distinct from excluded.name or persons.aliases is distinct from excluded.aliases`,
        [JSON.stringify(batch.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })))],
      ),
    ),
  )
}

export type Derived = { docId: number; persons: string[]; terms: Term[]; names: string[] }
type Extractable = Pick<RawDoc, 'source' | 'text' | 'extraTerms' | 'extraNames'>

// The only place extraction happens on the write path, so ingest and reindex cannot drift:
// the same document yields the same person, term and candidate rows through either.
export const derive = (docId: number, doc: Extractable, ps: Person[]): Derived => {
  const matched = personsMentioned(doc.text, ps)
  return {
    docId,
    persons: matched.map((p) => p.id),
    // Terms of a doc naming nobody tracked only ever fed the PMI denominator, at 68% of the
    // largest table; the denominator now counts the same docs the numerator does (see graph.ts).
    terms: matched.length ? terms(doc.text, doc.extraTerms) : [],
    names: discoverNames(doc, ps),
  }
}

// `unnest` keeps a batch of any size at two or three bound parameters, and `on conflict do
// nothing` makes replaying a batch idempotent, which is what lets an interrupted run be retried.
export const writeDerived = async (rows: readonly Derived[], size = writeBatchRows()) => {
  const persons = rows.flatMap((r) => r.persons.map((personId) => ({ docId: r.docId, personId })))
  const termRows = rows.flatMap((r) => r.terms.map((t) => ({ docId: r.docId, term: t.term, kind: t.kind })))
  const names = rows.flatMap((r) => r.names.map((name) => ({ docId: r.docId, name })))
  await inBatches(persons, size, (b) =>
    db.query(`insert into doc_persons (doc_id, person_id) select * from unnest($1::int[], $2::text[]) on conflict do nothing`, [
      b.map((x) => x.docId),
      b.map((x) => x.personId),
    ]),
  )
  await inBatches(termRows, size, (b) =>
    db.query(`insert into doc_terms (doc_id, term, kind) select * from unnest($1::int[], $2::text[], $3::text[]) on conflict do nothing`, [
      b.map((x) => x.docId),
      b.map((x) => x.term),
      b.map((x) => x.kind),
    ]),
  )
  await inBatches(names, size, (b) =>
    db.query(`insert into doc_candidates (doc_id, name) select * from unnest($1::int[], $2::text[]) on conflict do nothing`, [
      b.map((x) => x.docId),
      b.map((x) => x.name),
    ]),
  )
}

// The `where` on the conflict is what keeps a re-collected document from writing a new row
// version for nothing: it fires only when the enrichment would really change something. It
// restates the two assignments rather than sharing them because a conflict target cannot see
// the values it is about to set. Both rules survive it: `coalesce(docs.domain, ...)` still
// keeps the first domain, and a non-GDELT source still resolves to null tone.
const upsertDoc = async (doc: RawDoc) => {
  const { rows } = await db.query<{ id: number; inserted: boolean }>(
    `insert into docs (source, uri, text, published_at, extra_terms, domain, tone, extra_names) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (uri) do update set
       domain = coalesce(docs.domain, excluded.domain),
       tone = case when docs.source = any($9::text[]) then coalesce(docs.tone, excluded.tone) else null end
     where docs.domain is distinct from coalesce(docs.domain, excluded.domain)
        or docs.tone is distinct from (case when docs.source = any($9::text[]) then coalesce(docs.tone, excluded.tone) else null end)
     returning id, (xmax = 0) as inserted`,
    [doc.source, doc.uri, doc.text, doc.publishedAt, JSON.stringify(doc.extraTerms ?? []), doc.domain ?? null, toneFor(doc), JSON.stringify(doc.extraNames ?? []), tonedSources],
  )
  // A suppressed conflict update returns no row at all: the uri is known and nothing changed.
  return rows[0]
}

// One transaction per document: it can commit with its derived rows or not at all, so no
// document is ever left in `docs` without the person, term and candidate rows it implies.
export const insertDoc = (doc: RawDoc, ps: Person[]): Promise<boolean> =>
  inTransaction(async () => {
    const row = await upsertDoc(doc)
    if (!row?.inserted) return false
    await writeDerived([derive(row.id, doc, ps)])
    return true
  })

const insertGroup = (docs: readonly RawDoc[], ps: Person[]) =>
  inTransaction(async () => {
    const derived = await docs.reduce<Promise<Derived[]>>(async (acc, doc) => {
      const rows = await acc
      const row = await upsertDoc(doc)
      return row?.inserted ? [...rows, derive(row.id, doc, ps)] : rows
    }, Promise.resolve([]))
    await writeDerived(derived)
    return derived.length
  })

// The bulk path. A group commits as one transaction; when it fails it rolls back whole and is
// replayed document by document, so one unwritable document costs only itself and everything
// else in the group still lands with its derived rows.
export const insertDocs = (docs: readonly RawDoc[], ps: Person[], size = writeBatchDocs()) =>
  batches(docs, size).reduce<Promise<{ written: number; failed: number }>>(async (acc, group) => {
    const totals = await acc
    const written = await insertGroup(group, ps).catch(() => null)
    if (written !== null) return { written: totals.written + written, failed: totals.failed }
    return group.reduce<Promise<{ written: number; failed: number }>>(async (inner, doc) => {
      const t = await inner
      const ok = await insertDoc(doc, ps).catch((e: Error) => (console.error(`[store] ${doc.uri}: ${e.message}`), null))
      return ok === null ? { written: t.written, failed: t.failed + 1 } : { written: t.written + (ok ? 1 : 0), failed: t.failed }
    }, Promise.resolve(totals))
  }, Promise.resolve({ written: 0, failed: 0 }))
