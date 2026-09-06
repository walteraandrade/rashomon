import { PGlite } from '@electric-sql/pglite'

// DATA_DIR points at the PGlite directory; 'memory://' gives a throwaway in-memory database (tests).
export const db = new PGlite(process.env.DATA_DIR ?? './data/pg')

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
