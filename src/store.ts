import { Cause, Effect, Exit } from 'effect'
import { SqlClient, type SqlError } from 'effect/unstable/sql'
import { clampEnv, runInTransaction, runSql } from './db.js'
import { sql as statement } from './sql.js'
import { countryOf, discoverNames, personsMentioned, terms } from './extract.js'
import type { AttentionRow } from './collectors/pageviews.js'
import type { Person, Phrases, RawDoc, Source, Term } from './types.js'

// Tone is GDELT-only; a later gkg row must not leak tone into a doc stored by rss/gnews.
export const tonedSources: Source[] = ['gdelt', 'gkg']
const toneFor = (doc: RawDoc) => (tonedSources.includes(doc.source) ? doc.tone ?? null : null)

// Reach is Bluesky-only, and a value outside int4 would make jsonb_to_recordset throw for the whole layer.
const INT4_MAX = 2_147_483_647
const countOf = (n: number | undefined) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= INT4_MAX ? (n as number) : null)
const reachFor = (doc: RawDoc) => {
  const on = doc.source === 'bluesky'
  return {
    reach_likes: on ? countOf(doc.reach?.likes) : null,
    reach_reposts: on ? countOf(doc.reach?.reposts) : null,
    reach_replies: on ? countOf(doc.reach?.replies) : null,
    reach_quotes: on ? countOf(doc.reach?.quotes) : null,
  }
}

// One text per statement, so a writer and its Promise adapter cannot drift.
const UPSERT_PERSONS_SQL = `insert into persons (id, name, aliases)
         select p->>'id', p->>'name', array(select jsonb_array_elements_text(p->'aliases'))
         from jsonb_array_elements($1::jsonb) as p
         on conflict (id) do update set name = excluded.name, aliases = excluded.aliases
         where persons.name is distinct from excluded.name or persons.aliases is distinct from excluded.aliases`
const INSERT_DOC_PERSONS_SQL = `insert into doc_persons (doc_id, person_id) select * from unnest($1::int[], $2::text[]) on conflict do nothing`
// One statement resolves the vocabulary itself, so a batch costs no round-trip for ids. A data-modifying CTE's rows are invisible to `terms` in the same statement, hence the coalesce over `ins`.
export const INSERT_DOC_TERMS_SQL = `with v as (select * from unnest($1::int[], $2::text[], $3::text[]) as v(doc_id, term, kind)),
     ins as (insert into terms (term, kind) select distinct term, kind from v on conflict (kind, term) do nothing returning id, term, kind)
     insert into doc_terms (doc_id, term_id)
     select v.doc_id, coalesce(ins.id, t.id)
     from v left join ins on ins.kind = v.kind and ins.term = v.term
            left join terms t on t.kind = v.kind and t.term = v.term
     on conflict do nothing`
const INSERT_DOC_CANDIDATES_SQL = `insert into doc_candidates (doc_id, name) select * from unnest($1::int[], $2::text[]) on conflict do nothing`
const DELETE_DOC_TERMS_SQL = `delete from doc_terms where doc_id = any($1::int[])`
const DELETE_DOC_CANDIDATES_SQL = `delete from doc_candidates where doc_id = any($1::int[])`
const DELETE_ORPHAN_DOC_PERSONS_SQL = `delete from doc_persons where not (person_id = any($1::text[]))`
const DELETE_ORPHAN_PERSONS_SQL = `delete from persons where not (id = any($1::text[])) returning id`
// A plain overwrite, not `do nothing`: a day Wikimedia corrects after the fact heals on the next run.
const UPSERT_PERSON_ATTENTION_SQL = `insert into person_attention (person_id, day, views) select * from unnest($1::text[], $2::date[], $3::int[])
     on conflict (person_id, day) do update set views = excluded.views`
// One statement for a whole uriLayers layer: domain keeps first non-null, tone is null for
// non-GDELT, longer text wins. doc_tone follows the stored tone (never the incoming one) in the same statement. The layer travels as one json value: sql-pg cannot bind an
// all-null or mixed int/float array. RETURNING can't see the input row, so it's joined back by uri.
const UPSERT_DOCS_SQL = `with input as (
       select * from jsonb_to_recordset($1::jsonb)
         as t(source text, uri text, text text, published_at timestamptz, extra_terms jsonb, domain text, country text, tone float8, extra_names jsonb)
     ), up as (
       insert into docs (source, uri, text, published_at, extra_terms, domain, country, tone, extra_names)
       select source, uri, text, published_at, extra_terms, domain, country, tone, extra_names from input
       on conflict (uri) do update set
         text = case when length(excluded.text) > length(docs.text) then excluded.text else docs.text end,
         domain = coalesce(docs.domain, excluded.domain),
         country = coalesce(docs.country, excluded.country),
         tone = case when docs.source = any($2::text[]) then coalesce(docs.tone, excluded.tone) else null end
       where docs.domain is distinct from coalesce(docs.domain, excluded.domain)
          or docs.country is distinct from coalesce(docs.country, excluded.country)
          or docs.tone is distinct from (case when docs.source = any($2::text[]) then coalesce(docs.tone, excluded.tone) else null end)
          or length(excluded.text) > length(docs.text)
       returning id, uri, source, extra_terms, extra_names, tone, (xmax = 0) as inserted, text as stored_text
     ), tone_up as (
       insert into doc_tone (doc_id, tone) select id, tone from up where tone is not null
       on conflict (doc_id) do update set tone = excluded.tone
     ), tone_del as (
       delete from doc_tone where doc_id in (select id from up where tone is null and not inserted)
     )
     select input.uri, up.id, up.source, up.extra_terms, up.extra_names, up.inserted, (up.stored_text = input.text) as took_incoming
     from up join input using (uri)`
const upsertDocsParams = (docs: readonly RawDoc[]) => [
  JSON.stringify(
    docs.map((d) => ({
      source: d.source,
      uri: d.uri,
      text: d.text,
      published_at: d.publishedAt,
      extra_terms: d.extraTerms ?? [],
      domain: d.domain ?? null,
      country: countryOf(d.domain) ?? null,
      tone: toneFor(d),
      extra_names: d.extraNames ?? [],
    })),
  ),
  tonedSources,
]
// Its own statement, never part of UPSERT_DOCS_SQL's staleness clause: a larger count must not make `took_incoming` read true and register as enrichment. Bare `greatest` skips nulls, so a doc with no known count stays null.
const UPDATE_REACH_SQL = `update docs d set
       reach_likes = greatest(d.reach_likes, i.reach_likes),
       reach_reposts = greatest(d.reach_reposts, i.reach_reposts),
       reach_replies = greatest(d.reach_replies, i.reach_replies),
       reach_quotes = greatest(d.reach_quotes, i.reach_quotes)
     from jsonb_to_recordset($1::jsonb) as i(uri text, reach_likes int, reach_reposts int, reach_replies int, reach_quotes int)
     where d.uri = i.uri and d.source = 'bluesky'
       and (d.reach_likes is distinct from greatest(d.reach_likes, i.reach_likes)
         or d.reach_reposts is distinct from greatest(d.reach_reposts, i.reach_reposts)
         or d.reach_replies is distinct from greatest(d.reach_replies, i.reach_replies)
         or d.reach_quotes is distinct from greatest(d.reach_quotes, i.reach_quotes))`
const reachParams = (docs: readonly RawDoc[]) => {
  const rows = docs
    .map((d) => ({ uri: d.uri, ...reachFor(d) }))
    .filter((r) => r.reach_likes !== null || r.reach_reposts !== null || r.reach_replies !== null || r.reach_quotes !== null)
  return rows.length ? [JSON.stringify(rows)] : null
}
type UpsertRow = { uri: string; id: number; source: Source; extra_terms: Term[]; extra_names: string[]; inserted: boolean; took_incoming: boolean }

// A multi-row upsert errors on a repeated uri: the nth occurrence of a uri goes to layer n,
// so running the layers in order replays doc-by-doc outcomes.
export const uriLayers = <T extends { uri: string }>(docs: readonly T[]): T[][] => {
  const seen = new Map<string, number>()
  return docs.reduce<T[][]>((layers, doc) => {
    const n = seen.get(doc.uri) ?? 0
    seen.set(doc.uri, n + 1)
    ;(layers[n] ??= []).push(doc)
    return layers
  }, [])
}

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

// db.ts owns the real transaction (sql.withTransaction); a nested inTransaction call registers as a savepoint there instead of a second transaction.
export const inTransaction = runInTransaction

export type Derived = { docId: number; persons: string[]; terms: Term[]; names: string[] }
type Extractable = Pick<RawDoc, 'source' | 'text' | 'extraTerms' | 'extraNames'>

// `matched` is the writer's own tagging of the same text, so a doc is matched once.
export const derive = (docId: number, doc: Extractable, ps: Person[], lexicon: Phrases = new Set<string>(), matched: Person[] = personsMentioned(doc.text, ps)): Derived => ({
  docId,
  persons: matched.map((p) => p.id),
  terms: matched.length ? terms(doc.text, doc.extraTerms, lexicon) : [],
  names: discoverNames(doc, ps),
})

const derivedStatements = (rows: readonly Derived[], size: number): [string, unknown[]][] => {
  const persons = rows.flatMap((r) => r.persons.map((personId) => ({ docId: r.docId, personId })))
  const termRows = rows.flatMap((r) => r.terms.map((t) => ({ docId: r.docId, term: t.term, kind: t.kind })))
  const names = rows.flatMap((r) => r.names.map((name) => ({ docId: r.docId, name })))
  return [
    ...batches(persons, size).map((b): [string, unknown[]] => [INSERT_DOC_PERSONS_SQL, [b.map((x) => x.docId), b.map((x) => x.personId)]]),
    ...batches(termRows, size).map((b): [string, unknown[]] => [INSERT_DOC_TERMS_SQL, [b.map((x) => x.docId), b.map((x) => x.term), b.map((x) => x.kind)]]),
    ...batches(names, size).map((b): [string, unknown[]] => [INSERT_DOC_CANDIDATES_SQL, [b.map((x) => x.docId), b.map((x) => x.name)]]),
  ]
}

export type Written = 'inserted' | 'enriched' | 'unchanged'
const outcome = (row: { inserted: boolean; took_incoming: boolean } | undefined): Written =>
  !row ? 'unchanged' : row.inserted ? 'inserted' : row.took_incoming ? 'enriched' : 'unchanged'

type Batch = { derived: Derived[]; stale: number[]; written: number; enriched: number }
type Counts = { written: number; enriched: number; dropped: number }

// Every writer below is Effect-native, so a caller can Effect.catchTag a typed SqlError; each has a one-line `P`-suffixed Promise adapter, `runSql(<name>(...))`, for a caller outside the Effect world.

const writeDerivedRows = (sql: SqlClient.SqlClient, rows: readonly Derived[], size: number) =>
  Effect.forEach(derivedStatements(rows, size), ([text, params]) => sql.unsafe(text, params), { discard: true })

export const pruneRemoved = (ps: Person[]): Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ids = ps.map((p) => p.id)
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql.unsafe(DELETE_ORPHAN_DOC_PERSONS_SQL, [ids])
        const rows = yield* sql.unsafe<{ id: string }>(DELETE_ORPHAN_PERSONS_SQL, [ids])
        return rows.map((r) => r.id)
      }),
    )
  })
export const pruneRemovedP = (ps: Person[]) => runSql(pruneRemoved(ps))

// One statement, the count taken from the same delete, so no id list crosses the wire. Strict `<`: a doc at the horizon stays, as in every window's `>=`. The doc_* children go by cascade.
export const trimOlderThan = (days: number): Effect.Effect<number, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { text, values } = statement`with gone as (delete from docs where published_at < now() - make_interval(days => ${days}::int) returning 1) select count(*)::int as n from gone`
    const rows = yield* sql.unsafe<{ n: number }>(text, values)
    return Number(rows[0].n)
  })
export const trimOlderThanP = (days: number) => runSql(trimOlderThan(days))

export const upsertAttention = (rows: readonly AttentionRow[]): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    if (!rows.length) return
    const sql = yield* SqlClient.SqlClient
    yield* sql.unsafe(UPSERT_PERSON_ATTENTION_SQL, [rows.map((r) => r.person_id), rows.map((r) => r.day), rows.map((r) => r.views)])
  })
export const upsertAttentionP = (rows: readonly AttentionRow[]) => runSql(upsertAttention(rows))

// Aliases travel as json: `unnest` would mix one person's aliases into the next.
export const upsertPersons = (ps: Person[], size = writeBatchRows()): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const unique = [...new Map(ps.map((p) => [p.id, p])).values()]
    yield* sql.withTransaction(
      Effect.forEach(
        batches(unique, size),
        (batch) =>
          sql.unsafe(UPSERT_PERSONS_SQL, [JSON.stringify(batch.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })))]),
        { discard: true },
      ),
    )
  })
export const upsertPersonsP = (ps: Person[], size?: number) => runSql(upsertPersons(ps, size))

export const writeDerived = (rows: readonly Derived[], size = writeBatchRows()): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => writeDerivedRows(sql, rows, size))
export const writeDerivedP = (rows: readonly Derived[], size?: number) => runSql(writeDerived(rows, size))

// Keyed by object identity, not uri: two layers can each hold a row for the same uri.
const upsertDocsBatch = (sql: SqlClient.SqlClient, docs: readonly RawDoc[]): Effect.Effect<Map<RawDoc, UpsertRow>, SqlError.SqlError> =>
  Effect.gen(function* () {
    const results = new Map<RawDoc, UpsertRow>()
    for (const layer of uriLayers(docs)) {
      const rows = yield* sql.unsafe<UpsertRow>(UPSERT_DOCS_SQL, upsertDocsParams(layer))
      const reach = reachParams(layer)
      if (reach) yield* sql.unsafe(UPDATE_REACH_SQL, reach)
      const byUri = new Map(rows.map((r) => [r.uri, r]))
      for (const doc of layer) {
        const row = byUri.get(doc.uri)
        if (row) results.set(doc, row)
      }
    }
    return results
  })

// Clear terms when text is replaced: headline terms must not sum with the article's. doc_persons is left alone: the headline already named them; the body only adds.
const clearDerived = (sql: SqlClient.SqlClient, ids: readonly number[]) =>
  ids.length
    ? Effect.gen(function* () {
        yield* sql.unsafe(DELETE_DOC_TERMS_SQL, [ids])
        yield* sql.unsafe(DELETE_DOC_CANDIDATES_SQL, [ids])
      })
    : Effect.void

// Cap is applied before the match, the upsert and `derive`, so the text judged, stored and derived is one. A doc naming nobody tracked is dropped here, before any statement: the corpus holds only docs a `doc_persons` row points at.
const writeBatch = (sql: SqlClient.SqlClient, docs: readonly RawDoc[], ps: Person[], lexicon: Phrases): Effect.Effect<Counts, SqlError.SqlError> =>
  Effect.gen(function* () {
    const judged = docs.map((raw) => {
      const doc = { ...raw, text: truncateText(raw.text) }
      return { doc, matched: personsMentioned(doc.text, ps) }
    })
    const kept = judged.filter((j) => j.matched.length > 0)
    const rows = yield* upsertDocsBatch(sql, kept.map((j) => j.doc))
    const batch = kept.reduce((a: Batch, { doc, matched }): Batch => {
      const row = rows.get(doc)
      const result = outcome(row)
      if (result === 'unchanged' || !row) return a
      return {
        derived: [...a.derived, derive(row.id, { ...doc, source: row.source, extraTerms: row.extra_terms, extraNames: row.extra_names }, ps, lexicon, matched)],
        stale: result === 'enriched' ? [...a.stale, row.id] : a.stale,
        written: a.written + (result === 'inserted' ? 1 : 0),
        enriched: a.enriched + (result === 'enriched' ? 1 : 0),
      }
    }, { derived: [], stale: [], written: 0, enriched: 0 })
    yield* clearDerived(sql, batch.stale)
    yield* writeDerivedRows(sql, batch.derived, writeBatchRows())
    return { written: batch.written, enriched: batch.enriched, dropped: judged.length - kept.length }
  })

export const insertDoc = (doc: RawDoc, ps: Person[], lexicon: Phrases = new Set<string>()): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const result = yield* sql.withTransaction(writeBatch(sql, [doc], ps, lexicon))
    return result.written === 1
  })
export const insertDocP = (doc: RawDoc, ps: Person[], lexicon?: Phrases) => runSql(insertDoc(doc, ps, lexicon))

// A batch failure rolls back and is replayed doc by doc, so one bad doc costs only itself.
export type InsertTotals = { written: number; enriched: number; dropped: number; failed: number }

export const insertDocs = (
  docs: readonly RawDoc[],
  ps: Person[],
  size = writeBatchDocs(),
  lexicon: Phrases = new Set<string>(),
): Effect.Effect<InsertTotals, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const insertGroup = (group: readonly RawDoc[]) => sql.withTransaction(writeBatch(sql, group, ps, lexicon))
    return yield* Effect.reduce(batches(docs, size), (): InsertTotals => ({ written: 0, enriched: 0, dropped: 0, failed: 0 }), (totals, group) =>
      Effect.gen(function* () {
        // Effect.exit: a defect costs the group the same doc-by-doc replay the Promise path used to give.
        const counts = yield* Effect.exit(insertGroup(group))
        if (Exit.isSuccess(counts)) return { ...totals, written: totals.written + counts.value.written, enriched: totals.enriched + counts.value.enriched, dropped: totals.dropped + counts.value.dropped }
        return yield* Effect.reduce(group, (): InsertTotals => totals, (t, doc) =>
          Effect.gen(function* () {
            const one = yield* Effect.exit(insertGroup([doc]))
            if (Exit.isSuccess(one)) return { ...t, written: t.written + one.value.written, enriched: t.enriched + one.value.enriched, dropped: t.dropped + one.value.dropped }
            console.error(`[store] ${doc.uri}: ${(Cause.squash(one.cause) as Error).message}`)
            return { ...t, failed: t.failed + 1 }
          }),
        )
      }),
    )
  })
export const insertDocsP = (docs: readonly RawDoc[], ps: Person[], size?: number, lexicon?: Phrases) => runSql(insertDocs(docs, ps, size, lexicon))
