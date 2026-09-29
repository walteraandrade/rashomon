import type { Person } from '../../src/types.js'

// Every run reads `now()` as this instant: `bench.now()` shadows `pg_catalog.now()` through the
// session's search_path, so a seed read today and a seed read next week return identical rows,
// and two trees measured in two processes can be diffed row for row.
export const ANCHOR = '2026-09-01T12:00:00Z'
export const SPAN_DAYS = 120
export const GENERATOR_VERSION = 1

export const SCALES: Record<string, number> = { '10k': 10_000, '100k': 100_000, '1m': 1_000_000 }

// Heaps-like: the vocabulary grows with the corpus, as a live collector's does.
export const vocabularySize = (docs: number) => Math.round(3000 * Math.sqrt(docs / 10_000))

const DOMAINS = [
  'g1.globo.com', 'folha.uol.com.br', 'estadao.com.br', 'oglobo.globo.com', 'valor.globo.com', 'uol.com.br',
  'terra.com.br', 'r7.com', 'band.uol.com.br', 'cnnbrasil.com.br', 'metropoles.com', 'gazetadopovo.com.br',
  'correiobraziliense.com.br', 'em.com.br', 'zerohora.com.br', 'atarde.com.br', 'diariodonordeste.com.br',
  'poder360.com.br', 'cartacapital.com.br', 'oantagonista.com.br', 'crusoe.com.br', 'brasil247.com',
  'agenciabrasil.ebc.com.br', 'camara.leg.br', 'senado.leg.br', 'revistaoeste.com', 'jovempan.com.br',
  'theintercept.com', 'publico.pt', 'observador.pt', 'expresso.pt', 'gdeltproject.org',
]

const CANDIDATES = [
  'Hugo Motta', 'Renan Calheiros', 'Rodrigo Pacheco', 'Arthur Lira', 'Fernando Haddad', 'Paulo Guedes',
  'Carla Zambelli', 'Marina Silva', 'Simone Tebet', 'Alexandre Padilha',
]

// Source mix of production: gkg and bluesky dominate, legislative and niche feeds are thin.
const SOURCE_CASE = `case
  when rs < 0.42 then 'gkg' when rs < 0.62 then 'gnews' when rs < 0.76 then 'rss' when rs < 0.89 then 'bluesky'
  when rs < 0.92 then 'gdelt' when rs < 0.93 then 'camara' when rs < 0.94 then 'senado' when rs < 0.95 then 'juridico'
  when rs < 0.97 then 'oficial' else 'nicho' end`

type Exec = (text: string, params?: unknown[]) => Promise<unknown>

// `public` first so the tree's migrate still creates its tables there; `bench` before the
// explicit `pg_catalog` so `now()` resolves to the frozen clock. Session-only: PGlite ignores
// a database-level setting, so every process sets it again before its first statement.
export const SEARCH_PATH = `set search_path = public, bench, pg_catalog`

// One statement per call: the extended protocol parses one at a time.
export const clockStatements = [
  `create schema if not exists bench`,
  `create or replace function bench.now() returns timestamptz language sql stable as $$ select '${ANCHOR}'::timestamptz $$`,
  `create or replace function bench.r(k bigint) returns float8 language sql immutable parallel safe as $$ select (hashint8(k)::float8 + 2147483648.0) / 4294967296.0 $$`,
  SEARCH_PATH,
]

// The seed's doc_terms keeps the legacy (doc_id, term, kind) shape whatever tree runs it: a base tree reads it as is,
// a candidate's own migrate converts it, and GENERATOR_VERSION stays valid.
export const legacyShapeStatements = [
  `drop table if exists doc_terms`,
  `drop table if exists terms`,
  `drop table if exists doc_tone`,
  `create table doc_terms (doc_id int references docs(id) on delete cascade, term text not null, kind text not null, primary key (doc_id, term, kind))`,
  `create index doc_terms_term_idx on doc_terms (kind, term)`,
]

// Deterministic: every value is a hash of the row id, so the same scale always yields the same rows.
export const seedStatements = (docs: number, persons: Person[], nameTokens: (p: Person) => string[]): [string, unknown[]][] => {
  const ids = persons.map((p) => p.id)
  const tokens = persons.map((p) => nameTokens(p).join(' '))
  const vocab = vocabularySize(docs)
  return [
    [
      `insert into persons (id, name, aliases) select id, name, aliases from json_to_recordset($1::json) as p(id text, name text, aliases text[])`,
      [JSON.stringify(persons.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })))],
    ],
    [
      `insert into docs (id, source, uri, text, published_at, collected_at, domain, country, tone)
       with base as (
         select g as id, bench.r(g * 16 + 1) as rs, bench.r(g * 16 + 2) as rt, bench.r(g * 16 + 3) as rd, bench.r(g * 16 + 7) as rtone
         from generate_series(1, $1::int) g
       ),
       sourced as (select id, rt, rd, rtone, ${SOURCE_CASE} as source from base),
       placed as (
         select id, rt, rtone, source,
           case when source = 'bluesky' then 'perfil' || floor(rd * 400)::int || '.bsky.social'
                else ($2::text[])[1 + floor(rd * array_length($2::text[], 1))::int] end as domain
         from sourced
       )
       select id, source, 'https://bench.local/' || source || '/' || id,
         'Texto sintetico numero ' || id || ' sobre politica brasileira, governo, congresso e eleicao.',
         $3::timestamptz - make_interval(secs => $4::float8 * 86400 * rt * rt),
         $3::timestamptz, domain,
         case when domain like '%.pt' then 'pt' when domain like '%.br' then 'br' end,
         case when source in ('gkg', 'gdelt') then round((rtone * 12 - 7)::numeric, 2)::float8 end
       from placed`,
      [docs, DOMAINS, ANCHOR, SPAN_DAYS],
    ],
    [`select setval('docs_id_seq', $1::int)`, [docs]],
    [
      `insert into doc_persons (doc_id, person_id)
       select distinct d.id, ($1::text[])[1 + floor(pick * array_length($1::text[], 1))::int]
       from docs d,
         lateral (values (power(bench.r(d.id * 16 + 5), 2)), (case when bench.r(d.id * 16 + 8) < 0.15 then power(bench.r(d.id * 16 + 6), 1.5) end)) as v(pick)
       where bench.r(d.id * 16 + 4) < 0.33 and pick is not null`,
      [ids],
    ],
    [
      `insert into doc_terms (doc_id, term, kind)
       with named as (
         select d.id, d.source, 8 + floor(bench.r(d.id * 16 + 9) * 18)::int as k
         from docs d where exists (select 1 from doc_persons dp where dp.doc_id = d.id)
       ),
       drawn as (
         select n.id, n.source, floor($1::int * power(bench.r(n.id::bigint * 4096 + 64 + j), 2.5))::int as idx, bench.r(n.id::bigint * 4096 + 2048 + j) as rk
         from named n, generate_series(1, n.k) j
       )
       select distinct id,
         case when rk < 0.85 or (rk >= 0.98 and source <> 'gkg') then 'w' || idx
              when rk < 0.93 then 'p' || (idx % greatest(1, $1::int / 4)) || ' q' || (idx % 97)
              when rk < 0.98 then 'h' || (idx % greatest(1, $1::int / 5))
              else 'o' || (idx % greatest(1, $1::int / 10)) end,
         case when rk < 0.85 or (rk >= 0.98 and source <> 'gkg') then 'word' when rk < 0.93 then 'phrase' when rk < 0.98 then 'hashtag' else 'org' end
       from drawn`,
      [vocab],
    ],
    [
      `insert into doc_terms (doc_id, term, kind)
       select dp.doc_id, tok, 'word'
       from doc_persons dp
       join unnest($1::text[], $2::text[]) as p(id, tokens) on p.id = dp.person_id,
         lateral unnest(string_to_array(p.tokens, ' ')) as tok
       where bench.r(dp.doc_id * 16 + 10) < 0.8
       on conflict do nothing`,
      [ids, tokens],
    ],
    [
      `insert into doc_terms (doc_id, term, kind)
       select dp.doc_id, split_part(p.tokens, ' ', 1) || ' w' || floor(bench.r(dp.doc_id * 16 + 12) * 50)::int, 'phrase'
       from doc_persons dp join unnest($1::text[], $2::text[]) as p(id, tokens) on p.id = dp.person_id
       where bench.r(dp.doc_id * 16 + 11) < 0.1 and p.tokens <> ''
       on conflict do nothing`,
      [ids, tokens],
    ],
    [
      `insert into doc_testimony (doc_id, person_id, method, score)
       select doc_id, person_id, 'stub', round((bench.r(doc_id * 64 + length(person_id)) * 20 - 10)::numeric, 2)::float8 from doc_persons`,
      [],
    ],
    [
      `insert into doc_candidates (doc_id, name)
       select id, ($1::text[])[1 + floor(bench.r(id * 16 + 14) * array_length($1::text[], 1))::int]
       from docs where bench.r(id * 16 + 13) < 0.3`,
      [CANDIDATES],
    ],
  ]
}

export const runSeed = async (exec: Exec, docs: number, persons: Person[], nameTokens: (p: Person) => string[], log: (line: string) => void) => {
  for (const s of [...clockStatements, ...legacyShapeStatements]) await exec(s)
  for (const [text, params] of seedStatements(docs, persons, nameTokens)) {
    const started = performance.now()
    await exec(text, params)
    log(`  ${text.trim().split('\n')[0].slice(0, 60)}  ${Math.round(performance.now() - started)} ms`)
  }
}
