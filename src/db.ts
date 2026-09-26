import { PgClient } from '@effect/sql-pg'
import { PgliteClient } from '@effect/sql-pglite'
import { Context, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import { SqlClient, SqlError } from 'effect/unstable/sql'
import { AsyncLocalStorage } from 'node:async_hooks'
import tls from 'node:tls'
import { perfEnabled, record } from './perf.js'

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

// vercel env pull hands back literal \n/\r\n text; longer sequence first so \r\n isn't split.
const normalizeCa = (ca: string) => ca.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n')

// sslmode stripped (would override ssl option). Non-local connections are verified against
// PG_SSL_CA (the server's CA certificate, added to Node's default trust store). Without it,
// poolConfig refuses to build a config rather than connect with an unverified chain.
// Also carries pg's connectionString/connectionTimeoutMillis for src/push.ts's one-shot pool,
// which sets its own `max` (pg ignores maxConnections).
export const poolConfig = (url: string) => {
  const parsed = new URL(url)
  parsed.searchParams.delete('sslmode')
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  const rawCa = process.env.PG_SSL_CA
  if (!isLocal && !rawCa) throw new Error('PG_SSL_CA is required for a non-local database connection')
  const ca = isLocal ? undefined : normalizeCa(rawCa as string)
  if (!isLocal && !ca?.includes('-----BEGIN CERTIFICATE-----'))
    throw new Error(`PG_SSL_CA has no -----BEGIN CERTIFICATE----- line; it starts with ${JSON.stringify(ca?.slice(0, 24))}`)
  const connectionString = parsed.toString()
  const ssl = isLocal ? undefined : { ca: [...tls.rootCertificates, ca as string], rejectUnauthorized: true }
  return {
    url: Redacted.make(connectionString),
    connectionString,
    ssl,
    maxConnections: clampEnv(process.env.PG_POOL_MAX, 3, 1, 20),
    connectTimeout: 10_000,
    connectionTimeoutMillis: 10_000,
    // Off: a transaction-mode pooler (port 6543) can hand a named prepared statement to a different physical connection than the one that parsed it. pg.Pool ignores the field.
    prepare: false,
  }
}

// DATABASE_URL / POSTGRES_URL wins over embedded PGlite; 'memory://' for tests.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

const rawLayer: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> = url
  ? PgClient.layer(poolConfig(url))
  : PgliteClient.layer({ dataDir: process.env.DATA_DIR ?? './data/pg' })

// PERF=1 times every sql.unsafe call, the one point every write -- db.query/db.exec and store.ts's Effect writers alike -- passes through.
const instrumentSql = (client: SqlClient.SqlClient): SqlClient.SqlClient =>
  new Proxy(client, {
    apply: (target, thisArg, args) => Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args),
    get: (target, prop, receiver) => {
      if (prop === 'unsafe') {
        return <A extends object>(sql: string, params?: readonly unknown[]) => {
          const started = performance.now()
          return Effect.ensuring(target.unsafe<A>(sql, params), Effect.sync(() => record(performance.now() - started))) as unknown as ReturnType<SqlClient.SqlClient['unsafe']>
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

const DbLayer: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> = perfEnabled
  ? Layer.effect(SqlClient.SqlClient, Effect.map(SqlClient.SqlClient, instrumentSql)).pipe(Layer.provide(rawLayer))
  : rawLayer

const runtime = ManagedRuntime.make(DbLayer)

// An open inTransaction leaves its Effect context here for its callback's duration, so a plain db.query/db.exec made inside it runs on that transaction's connection, not the top-level one.
const txContext = new AsyncLocalStorage<Context.Context<SqlClient.SqlClient>>()

// Effect to Promise, joining an open inTransaction the way db.query/db.exec do.
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

// store.ts's inTransaction: a real transaction via sql.withTransaction (a nested call is a savepoint), with `fn` run under txContext so every db.query/db.exec inside it joins.
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

export const db: Db = {
  query: (text, params) => execute(text, params).then((rows) => ({ rows })) as never,
  exec: (text) => execute(text),
  close: () => runtime.dispose(),
}

// Split on ';' below, so no statement here may hold a semicolon in a literal or dollar-quoted body.
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
    alter table docs add column if not exists country text;
    create index if not exists docs_country_idx on docs (country);
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
    drop table if exists graph_terms_all;
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
    create table if not exists person_attention (
      person_id text not null references persons(id) on delete cascade,
      day date not null,
      views int not null,
      primary key (person_id, day)
    );
`

// sql.unsafe parses one statement per call, unlike the exec() it replaces.
const schemaStatements = schema
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

// One transaction for the whole script: a failure partway through leaves the schema untouched.
export const migrate = (): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.withTransaction(Effect.forEach(schemaStatements, (statement) => sql.unsafe(statement), { discard: true })))
export const migrateP = () => runSql(migrate())

// Table names cannot be bound as statement parameters; this fixed list is the entire maintenance surface.
export const ANALYZED_TABLES = ['docs', 'doc_persons', 'doc_terms', 'doc_candidates', 'doc_testimony', 'graph_scopes', 'graph_terms'] as const
export type AnalyzedTable = (typeof ANALYZED_TABLES)[number]

// How many new docs an ingest must write before its statistics refresh is worth the pause.
export const analyzeMinDocs = () => clampEnv(process.env.ANALYZE_MIN_DOCS, 200, 1, 1_000_000)

// Targeted analyze, never database-wide; only ingest and reindex call this (they own DATA_DIR).
export const analyzeTables = (tables: readonly AnalyzedTable[] = ANALYZED_TABLES): Effect.Effect<readonly AnalyzedTable[], SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const targets = tables.filter((t) => ANALYZED_TABLES.includes(t))
    yield* Effect.forEach(targets, (t) => sql.unsafe(`analyze ${t}`), { discard: true })
    return targets
  })
export const analyzeTablesP = (tables?: readonly AnalyzedTable[]) => runSql(analyzeTables(tables))

// A handful of new docs does not move the planner's estimates; skip if below the threshold.
export const analyzeAfterWrite = (written: number): Effect.Effect<readonly AnalyzedTable[], SqlError.SqlError, SqlClient.SqlClient> =>
  written >= analyzeMinDocs() ? analyzeTables() : Effect.succeed([])
export const analyzeAfterWriteP = (written: number) => runSql(analyzeAfterWrite(written))

export const docCount = (): Effect.Effect<number, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.map(runStatement<{ n: string }>(`select count(*) as n from docs`), (rows) => Number(rows[0].n))
