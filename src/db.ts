import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

type Rows<T> = { rows: T[] }

export type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<Rows<T>>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}

// Supabase serves a self-signed chain, and any sslmode in the URL would override the ssl
// option, so it is stripped: the connection stays encrypted, without chain verification.
export const poolConfig = (url: string): pg.PoolConfig => {
  const parsed = new URL(url)
  parsed.searchParams.delete('sslmode')
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  return {
    connectionString: parsed.toString(),
    max: Number(process.env.PG_POOL_MAX ?? 3),
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
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

// A managed Postgres URL wins: it is the only shape that survives a read-only, short-lived
// serverless filesystem. POSTGRES_URL is what the Vercel/Supabase integration injects.
// Without either, PGlite runs embedded from DATA_DIR ('memory://' is the tests' database).
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

export const db: Db = url ? remote(url) : embedded(process.env.DATA_DIR ?? './data/pg')

export const migrate = () =>
  db.exec(`
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
  `)
