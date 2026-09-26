import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { poolConfig, schema } from './db.js'

// One-way copy of an embedded PGlite database (DATA_DIR) into a managed Postgres. Prefers
// the direct, unpooled URL because a transaction pooler chokes on large batches.
// Run `pnpm migrate` against the target first.
type Table = { name: string; columns: string[]; json?: string[]; select?: string[] }

// The minimal shape copy() needs from its target: pg.Pool satisfies it, and so does a test's second PGlite.
export type QueryTarget = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

const tables: Table[] = [
  { name: 'persons', columns: ['id', 'name', 'aliases'] },
  // `day` is a `date`: PGlite hands pg a Date at UTC midnight, which pg then serializes in the
  // process's local TZ, landing it a day early outside UTC. `::text` sidesteps Date entirely.
  { name: 'person_attention', columns: ['person_id', 'day', 'views'], select: ['person_id', 'day::text as day', 'views'] },
  {
    name: 'docs',
    columns: ['id', 'source', 'uri', 'text', 'published_at', 'collected_at', 'extra_terms', 'domain', 'tone', 'extra_names'],
    json: ['extra_terms', 'extra_names'],
  },
  { name: 'doc_persons', columns: ['doc_id', 'person_id'] },
  { name: 'doc_terms', columns: ['doc_id', 'term', 'kind'] },
  { name: 'gkg_files', columns: ['slot', 'rows', 'processed_at'] },
  { name: 'doc_testimony', columns: ['doc_id', 'person_id', 'method', 'score'] },
  { name: 'doc_candidates', columns: ['doc_id', 'name'] },
]

const batchSize = Number(process.env.PUSH_BATCH ?? 500)

const chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

const placeholders = (rows: number, cols: number) =>
  Array.from({ length: rows }, (_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`).join(',')

export const copy = async (source: PGlite, target: QueryTarget, t: Table) => {
  const { rows } = await source.query<Record<string, unknown>>(`select ${(t.select ?? t.columns).join(', ')} from ${t.name}`)
  const values = rows.map((row) => t.columns.map((c) => (t.json?.includes(c) ? JSON.stringify(row[c]) : row[c])))
  await chunks(values, batchSize).reduce<Promise<void>>(
    async (acc, batch) => (
      await acc,
      void (await target.query(
        `insert into ${t.name} (${t.columns.join(', ')}) values ${placeholders(batch.length, t.columns.length)} on conflict do nothing`,
        batch.flat(),
      ))
    ),
    Promise.resolve(),
  )
  console.log(`[${t.name}] ${rows.length}`)
}

const main = async () => {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING, DATABASE_URL or POSTGRES_URL is required')
  const source = new PGlite(process.env.DATA_DIR ?? './data/pg')
  await source.exec(schema)
  const target = new pg.Pool({ ...poolConfig(url), max: 1 })
  await tables.reduce<Promise<void>>(async (acc, t) => (await acc, copy(source, target, t)), Promise.resolve())
  await target.query(`select setval(pg_get_serial_sequence('docs', 'id'), coalesce(max(id), 1)) from docs`)
  await source.close()
  await target.end()
}

export { tables }

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href
if (isMain) await main()
