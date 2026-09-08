import { PGlite } from '@electric-sql/pglite'
import { instrument, perfEnabled } from './perf.js'

// DATA_DIR points at the PGlite directory; 'memory://' gives a throwaway in-memory database (tests).
const pg = new PGlite(process.env.DATA_DIR ?? './data/pg')

// With PERF unset this is the PGlite instance itself, untouched; PERF=1 swaps in a proxy
// that times query/exec into the current request's counters (src/perf.ts).
export const db = perfEnabled ? instrument(pg) : pg

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
    alter table docs add column if not exists extra_names jsonb not null default '[]';
    create table if not exists doc_candidates (
      doc_id int references docs(id) on delete cascade,
      name text not null,
      primary key (doc_id, name)
    );
    create index if not exists doc_candidates_name_idx on doc_candidates (name);
    create index if not exists doc_persons_person_idx on doc_persons (person_id, doc_id);
  `)

// Table names cannot be bound as statement parameters, so the maintenance surface is this
// fixed list and nothing a caller passes can widen it.
export const ANALYZED_TABLES = ['docs', 'doc_persons', 'doc_terms', 'doc_candidates', 'doc_testimony'] as const
export type AnalyzedTable = (typeof ANALYZED_TABLES)[number]

// Same shape as query.ts's `int` (default, floor, ceiling) without importing it: db.ts sits
// below the query layer and must not depend on it. Exported so every knob that reads the
// environment (statistics threshold, write batch sizes) clamps the same way.
export const clampEnv = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// How many new docs an ingest must write before its statistics refresh is worth the pause.
export const analyzeMinDocs = () => clampEnv(process.env.ANALYZE_MIN_DOCS, 200, 1, 1_000_000)

// Targeted `analyze`, never a database-wide one, and never from a request: it is called only
// by `pnpm ingest` and `pnpm reindex`, the processes that already own DATA_DIR. PGlite allows
// a single process per directory, so a second maintenance process cannot exist while the
// server is up; the policy is structural, not a lock.
export const analyzeTables = async (tables: readonly AnalyzedTable[] = ANALYZED_TABLES) => {
  const targets = tables.filter((t) => ANALYZED_TABLES.includes(t))
  await targets.reduce<Promise<void>>(async (acc, t) => (await acc, void (await db.exec(`analyze ${t}`))), Promise.resolve())
  return targets
}

// Gate for the ingest path: a handful of new docs does not move the planner's estimates, so
// only a large write pays for the refresh. Returns what it analyzed, so callers can log it.
export const analyzeAfterWrite = async (written: number): Promise<readonly AnalyzedTable[]> =>
  written >= analyzeMinDocs() ? analyzeTables() : []
