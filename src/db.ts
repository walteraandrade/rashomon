import { PGlite } from '@electric-sql/pglite'
import tls from 'node:tls'
import pg from 'pg'
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
export const poolConfig = (url: string): pg.PoolConfig => {
  const parsed = new URL(url)
  parsed.searchParams.delete('sslmode')
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  const ca = process.env.PG_SSL_CA
  if (!isLocal && !ca) throw new Error('PG_SSL_CA is required for a non-local database connection')
  return {
    connectionString: parsed.toString(),
    max: clampEnv(process.env.PG_POOL_MAX, 3, 1, 20),
    connectionTimeoutMillis: 10_000,
    ssl: isLocal ? undefined : { ca: [...tls.rootCertificates, ca as string], rejectUnauthorized: true },
  }
}

const remote = (url: string): Db => {
  const pool = new pg.Pool(poolConfig(url))
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  }
}

const embedded = (dir: string): Db => {
  const pglite = new PGlite(dir)
  return {
    query: (sql, params) => pglite.query(sql, params as unknown[]) as never,
    exec: (sql) => pglite.exec(sql),
    close: () => pglite.close(),
  }
}

// DATABASE_URL / POSTGRES_URL wins over embedded PGlite; 'memory://' for tests.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

const base: Db = url ? remote(url) : embedded(process.env.DATA_DIR ?? './data/pg')

// PERF=1 swaps in a proxy that times query/exec into the current request's counters.
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
`

export const migrate = () => db.exec(schema)

// Table names cannot be bound as statement parameters; this fixed list is the entire maintenance surface.
export const ANALYZED_TABLES = ['docs', 'doc_persons', 'doc_terms', 'doc_candidates', 'doc_testimony'] as const
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
