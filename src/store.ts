import { clampEnv, db } from './db.js'
import { discoverNames, personsMentioned, terms } from './extract.js'
import type { Person, Phrases, RawDoc, Source, Term } from './types.js'

// Tone is GDELT-only; a later gkg row must not leak tone into a doc stored by rss/gnews.
export const tonedSources: Source[] = ['gdelt', 'gkg']
const toneFor = (doc: RawDoc) => (tonedSources.includes(doc.source) ? doc.tone ?? null : null)

export const writeBatchRows = () => clampEnv(process.env.WRITE_BATCH_ROWS, 500, 1, 10_000)
export const writeBatchDocs = () => clampEnv(process.env.WRITE_BATCH_DOCS, 200, 1, 5_000)

export const MAX_DOC_CHARS = 20_000

export const truncateText = (text: string, max = MAX_DOC_CHARS): string => {
  if (text.length <= max) return text
  const head = text.slice(0, max + 1)
  const at = head.search(/\s\S*$/)
  return at > 0 ? head.slice(0, at).trimEnd() : text.slice(0, max)
}

export const batches = <T>(xs: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size))

export const inBatches = <T>(xs: readonly T[], size: number, fn: (batch: T[]) => Promise<unknown>) =>
  batches(xs, size).reduce<Promise<void>>(async (acc, b) => (await acc, void (await fn(b))), Promise.resolve())

let open = 0

// PGlite is a single connection; a nested `begin` would silently join the open transaction and
// the inner `commit` would end it early. Nested calls run in the outer one.
export const inTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (open) return fn()
  await db.exec(`begin`)
  open = 1
  try {
    const value = await fn()
    await db.exec(`commit`)
    return value
  } catch (e) {
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

// Aliases travel as json: `unnest` would mix one person's aliases into the next.
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

export const derive = (docId: number, doc: Extractable, ps: Person[], lexicon: Phrases = new Set<string>()): Derived => {
  const matched = personsMentioned(doc.text, ps)
  return {
    docId,
    persons: matched.map((p) => p.id),
    terms: matched.length ? terms(doc.text, doc.extraTerms, lexicon) : [],
    names: discoverNames(doc, ps),
  }
}

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

// On conflict: domain keeps first non-null; tone is null for non-GDELT; longer text wins.
const upsertDoc = async (doc: RawDoc) => {
  const { rows } = await db.query<{ id: number; inserted: boolean; took_incoming: boolean }>(
    `insert into docs (source, uri, text, published_at, extra_terms, domain, tone, extra_names) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (uri) do update set
       text = case when length(excluded.text) > length(docs.text) then excluded.text else docs.text end,
       domain = coalesce(docs.domain, excluded.domain),
       tone = case when docs.source = any($9::text[]) then coalesce(docs.tone, excluded.tone) else null end
     where docs.domain is distinct from coalesce(docs.domain, excluded.domain)
        or docs.tone is distinct from (case when docs.source = any($9::text[]) then coalesce(docs.tone, excluded.tone) else null end)
        or length(excluded.text) > length(docs.text)
     returning id, (xmax = 0) as inserted, (text = $3) as took_incoming`,
    [doc.source, doc.uri, doc.text, doc.publishedAt, JSON.stringify(doc.extraTerms ?? []), doc.domain ?? null, toneFor(doc), JSON.stringify(doc.extraNames ?? []), tonedSources],
  )
  return rows[0]
}

export type Written = 'inserted' | 'enriched' | 'unchanged'
const outcome = (row: { inserted: boolean; took_incoming: boolean } | undefined): Written =>
  !row ? 'unchanged' : row.inserted ? 'inserted' : row.took_incoming ? 'enriched' : 'unchanged'

// Clear terms when text is replaced: headline terms must not sum with the article's.
// doc_persons is left alone: the headline already named them; the body only adds.
const clearDerived = async (ids: readonly number[]) => {
  if (!ids.length) return
  await db.query(`delete from doc_terms where doc_id = any($1::int[])`, [ids])
  await db.query(`delete from doc_candidates where doc_id = any($1::int[])`, [ids])
}

type Batch = { derived: Derived[]; stale: number[]; written: number; enriched: number }

// Cap is applied before upsert and before `derive` so stored text and derived terms match.
const writeBatch = async (docs: readonly RawDoc[], ps: Person[], lexicon: Phrases): Promise<{ written: number; enriched: number }> => {
  const batch = await docs.reduce<Promise<Batch>>(async (acc, raw) => {
    const a = await acc
    const doc = { ...raw, text: truncateText(raw.text) }
    const row = await upsertDoc(doc)
    const result = outcome(row)
    if (result === 'unchanged') return a
    return {
      derived: [...a.derived, derive(row.id, doc, ps, lexicon)],
      stale: result === 'enriched' ? [...a.stale, row.id] : a.stale,
      written: a.written + (result === 'inserted' ? 1 : 0),
      enriched: a.enriched + (result === 'enriched' ? 1 : 0),
    }
  }, Promise.resolve({ derived: [], stale: [], written: 0, enriched: 0 }))
  await clearDerived(batch.stale)
  await writeDerived(batch.derived)
  return { written: batch.written, enriched: batch.enriched }
}

export const insertDoc = (doc: RawDoc, ps: Person[], lexicon: Phrases = new Set<string>()): Promise<boolean> =>
  inTransaction(async () => (await writeBatch([doc], ps, lexicon)).written === 1)

const insertGroup = (docs: readonly RawDoc[], ps: Person[], lexicon: Phrases) => inTransaction(() => writeBatch(docs, ps, lexicon))

// A batch failure rolls back and is replayed doc by doc, so one bad doc costs only itself.
export type InsertTotals = { written: number; enriched: number; failed: number }

export const insertDocs = (docs: readonly RawDoc[], ps: Person[], size = writeBatchDocs(), lexicon: Phrases = new Set<string>()) =>
  batches(docs, size).reduce<Promise<InsertTotals>>(async (acc, group) => {
    const totals = await acc
    const counts = await insertGroup(group, ps, lexicon).catch(() => null)
    if (counts) return { ...totals, written: totals.written + counts.written, enriched: totals.enriched + counts.enriched }
    return group.reduce<Promise<InsertTotals>>(async (inner, doc) => {
      const t = await inner
      const one = await insertGroup([doc], ps, lexicon).catch((e: Error) => (console.error(`[store] ${doc.uri}: ${e.message}`), null))
      return one ? { ...t, written: t.written + one.written, enriched: t.enriched + one.enriched } : { ...t, failed: t.failed + 1 }
    }, Promise.resolve(totals))
  }, Promise.resolve({ written: 0, enriched: 0, failed: 0 }))
