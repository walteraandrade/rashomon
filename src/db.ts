import { PgClient } from '@effect/sql-pg'
import { PgliteClient } from '@effect/sql-pglite'
import { Context, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import { SqlClient, SqlError } from 'effect/unstable/sql'
import { AsyncLocalStorage } from 'node:async_hooks'
import tls from 'node:tls'
import { instrument, perfEnabled } from './perf.js'

type Rows<T> = { rows: T[] }

export type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<Rows<T>>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}

// Same shape as query.ts's `int` without importing it (db.ts is below the query layer).
export const clampEnv = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// sslmode stripped (would override ssl option). Non-local connections are verified against
// PG_SSL_CA (the server's CA certificate, added to Node's default trust store). Without it,
// poolConfig refuses to build a config rather than connect with an unverified chain.
// Returns both `@effect/sql-pg`'s PgPoolConfig fields (url, maxConnections, connectTimeout) and
// pg's own (connectionString, connectionTimeoutMillis), so src/push.ts's `new pg.Pool(poolConfig(url))` still works.
export const poolConfig = (url: string) => {
  const parsed = new URL(url)
  parsed.searchParams.delete('sslmode')
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  const ca = process.env.PG_SSL_CA
  if (!isLocal && !ca) throw new Error('PG_SSL_CA is required for a non-local database connection')
  const connectionString = parsed.toString()
  const ssl = isLocal ? undefined : { ca: [...tls.rootCertificates, ca as string], rejectUnauthorized: true }
  return {
    url: Redacted.make(connectionString),
    connectionString,
    ssl,
    maxConnections: clampEnv(process.env.PG_POOL_MAX, 3, 1, 20),
    connectTimeout: 10_000,
    connectionTimeoutMillis: 10_000,
  }
}

// DATABASE_URL / POSTGRES_URL wins over embedded PGlite; 'memory://' for tests.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

// Internal wiring; no module outside this file reaches into DbLayer or the runtime it builds.
const DbLayer: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> = url
  ? PgClient.layer(poolConfig(url))
  : PgliteClient.layer({ dataDir: process.env.DATA_DIR ?? './data/pg' })

// Built once at module load, mirroring the eager pool/PGlite construction this replaces.
const runtime = ManagedRuntime.make(DbLayer)

// An open inTransaction leaves its live Effect context here for its callback's duration, so a
// plain db.query/db.exec call made inside it runs on that transaction's own connection instead
// of the pool/PGlite's top-level one. Module-private to db.ts/store.ts.
const txContext = new AsyncLocalStorage<Context.Context<SqlClient.SqlClient>>()

// Runs an Effect requiring SqlClient.SqlClient to a Promise, joining any already-open
// inTransaction the same way db.query/db.exec do. store.ts's *Effect writers are run through
// this, both by tests exercising them directly and, where a Promise counterpart chooses to,
// by that counterpart itself.
export const runSql = <A>(effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>): Promise<A> => {
  const ctx = txContext.getStore()
  return ctx ? Effect.runPromiseWith(ctx)(effect) : runtime.runPromise(effect)
}

const runStatement = <A extends object>(text: string, params: readonly unknown[] = []) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.unsafe<A>(text, params as unknown[])
  })

const execute = <A extends object>(text: string, params?: readonly unknown[]): Promise<readonly A[]> => runSql(runStatement<A>(text, params))

// store.ts's inTransaction, re-exported there: begins, or nested, savepoints, a real transaction
// via sql.withTransaction, and runs `fn` with its context set in txContext so every db.query/db.exec
// call it makes -- directly or through a store.ts writer -- joins it.
export const runInTransaction = <T>(fn: () => Promise<T>): Promise<T> => {
  const body = Effect.gen(function* () {
    const ctx = yield* Effect.context<SqlClient.SqlClient>()
    return yield* Effect.tryPromise({ try: () => txContext.run(ctx, fn), catch: (cause) => cause })
  })
  return runSql(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(body) as Effect.Effect<T, SqlError.SqlError, SqlClient.SqlClient>
    }),
  )
}

// PERF=1 swaps in a proxy that times query/exec into the current request's counters.
const base: Db = {
  query: (text, params) => execute(text, params).then((rows) => ({ rows })) as never,
  exec: (text) => execute(text),
  close: () => runtime.dispose(),
}

export const db: Db = perfEnabled ? instrument(base) : base

export const schema = `
    create table if not exists persons (
      id text primary key,
      name text not null,
      aliases text[] not null
    );
    create table if not exists docs (
      id serial primary key,
      source text not null,
      uri text unique not null,
      text text not null,
      published_at timestamptz not null,
      collected_at timestamptz not null default now()
    );
    create table if not exists doc_persons (
      doc_id int references docs(id) on delete cascade,
      person_id text references persons(id),
      primary key (doc_id, person_id)
    );
    create table if not exists doc_terms (
      doc_id int references docs(id) on delete cascade,
      term text not null,
      kind text not null,
      primary key (doc_id, term, kind)
    );
    alter table docs add column if not exists extra_terms jsonb not null default '[]';
    alter table docs add column if not exists domain text;
    alter table docs add column if not exists tone float8;
    update docs set tone = null where tone is not null and source not in ('gdelt', 'gkg');
    create index if not exists docs_domain_idx on docs (domain);
    create table if not exists gkg_files (
      slot text primary key,
      rows int not null,
      processed_at timestamptz not null default now()
    );
    create index if not exists docs_published_idx on docs (published_at);
    create index if not exists doc_terms_term_idx on doc_terms (kind, term);
    create table if not exists doc_testimony (
      doc_id int references docs(id) on delete cascade,
      person_id text references persons(id),
      method text not null,
      score float8,
      primary key (doc_id, person_id, method)
    );
    create index if not exists doc_testimony_person_idx on doc_testimony (person_id, method);
    alter table docs add column if not exists extra_names jsonb not null default '[]';
    create table if not exists doc_candidates (
      doc_id int references docs(id) on delete cascade,
      name text not null,
      primary key (doc_id, name)
    );
    create index if not exists doc_candidates_name_idx on doc_candidates (name);
    create index if not exists doc_persons_person_idx on doc_persons (person_id, doc_id);
    create table if not exists phrases (
      term text primary key,
      count int not null,
      score float8 not null
    );
    create table if not exists phrase_stage (
      w1 text not null,
      w2 text
    );
    create table if not exists graph_scopes (
      days int not null,
      source text not null,
      person_id text not null references persons(id) on delete cascade,
      docs int not null,
      tracked int not null,
      about int not null,
      built_at timestamptz not null default now(),
      primary key (days, source, person_id)
    );
    create table if not exists graph_terms_all (
      days int not null,
      source text not null,
      term text not null,
      kind text not null,
      c_t int not null,
      primary key (days, source, term, kind)
    );
    create table if not exists graph_terms (
      days int not null,
      source text not null,
      person_id text not null references persons(id) on delete cascade,
      term text not null,
      kind text not null,
      c_pt int not null,
      c_t int not null,
      tone float8,
      primary key (days, source, person_id, term, kind)
    );
`

// The extended query protocol behind sql.unsafe parses one statement per call, unlike the
// pg/PGlite exec() this replaces, which ran the whole semicolon-separated script at once.
const schemaStatements = schema
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

export const migrate = () => schemaStatements.reduce<Promise<unknown>>(async (acc, statement) => (await acc, db.exec(statement)), Promise.resolve(undefined))

// Table names cannot be bound as statement parameters; this fixed list is the entire maintenance surface.
export const ANALYZED_TABLES = ['docs', 'doc_persons', 'doc_terms', 'doc_candidates', 'doc_testimony', 'graph_scopes', 'graph_terms_all', 'graph_terms'] as const
export type AnalyzedTable = (typeof ANALYZED_TABLES)[number]

// How many new docs an ingest must write before its statistics refresh is worth the pause.
export const analyzeMinDocs = () => clampEnv(process.env.ANALYZE_MIN_DOCS, 200, 1, 1_000_000)

// Targeted analyze, never database-wide; only ingest and reindex call this (they own DATA_DIR).
export const analyzeTables = async (tables: readonly AnalyzedTable[] = ANALYZED_TABLES) => {
  const targets = tables.filter((t) => ANALYZED_TABLES.includes(t))
  await targets.reduce<Promise<void>>(async (acc, t) => (await acc, void (await db.exec(`analyze ${t}`))), Promise.resolve())
  return targets
}

// A handful of new docs does not move the planner's estimates; skip if below the threshold.
export const analyzeAfterWrite = async (written: number): Promise<readonly AnalyzedTable[]> =>
  written >= analyzeMinDocs() ? analyzeTables() : []
