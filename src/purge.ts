import { db, migrate } from './db.js'
import { SOURCES } from './query.js'

const usage = 'usage: pnpm purge <source|orphan-terms|themes>'

// Unknown targets throw rather than silently deleting zero rows.
export const resolveTarget = (target: string | undefined): string => {
  if (target === 'orphan-terms' || target === 'themes' || (target !== undefined && SOURCES.includes(target))) return target
  throw new Error(usage)
}

// `vacuum full` rewrites the table to reclaim disk; plain vacuum only marks pages reusable.
const purgeOrphanTerms = async () => {
  const { rows } = await db.query<{ n: number }>(
    `with d as (
       delete from doc_terms t where not exists (select 1 from doc_persons p where p.doc_id = t.doc_id) returning 1
     ) select count(*)::int as n from d`,
  )
  await db.exec(`vacuum full doc_terms`)
  console.log(`purged ${rows[0].n} doc_terms rows without a tracked person`)
}

// One statement per exec: vacuum cannot run inside the implicit transaction of a multi-statement exec.
const vacuumFull = (tables: readonly string[]) =>
  tables.reduce<Promise<void>>(async (acc, t) => (await acc, void (await db.exec(`vacuum full ${t}`))), Promise.resolve())

const purgeSource = async (source: string) => {
  const { rows } = await db.query<{ n: number }>(`with d as (delete from docs where source = $1 returning 1) select count(*)::int as n from d`, [source])
  if (source === 'gkg') await db.query(`delete from gkg_files`)
  if (rows[0].n) await vacuumFull(['docs', 'doc_terms', 'doc_persons', 'doc_candidates', 'doc_testimony'])
  console.log(`purged ${rows[0].n} docs from ${source}`)
}

// MVCC writes a new tuple on update; vacuum docs with the others or freed space stays in the file.
export const purgeThemes = async () => {
  const { rows: extra } = await db.query<{ n: number }>(
    `with d as (update docs set extra_terms = '[]' where extra_terms <> '[]'::jsonb returning 1) select count(*)::int as n from d`,
  )
  const { rows: terms } = await db.query<{ n: number }>(
    `with d as (delete from doc_terms where kind = 'theme' returning 1) select count(*)::int as n from d`,
  )
  const { rows: testimony } = await db.query<{ n: number }>(
    `with d as (
       delete from doc_testimony where method like 'kikori:%' and method not like 'kikori:%:%' returning 1
     ) select count(*)::int as n from d`,
  )
  const tables = [...(extra[0].n ? ['docs'] : []), ...(terms[0].n || testimony[0].n ? ['doc_terms', 'doc_testimony'] : [])]
  if (tables.length) await vacuumFull(tables)
  console.log(`purged ${terms[0].n} theme terms, ${extra[0].n} extra_terms rows and ${testimony[0].n} stale testimony rows`)
}

const main = async () => {
  const target = resolveTarget(process.argv[2])
  await migrate()
  await (target === 'orphan-terms' ? purgeOrphanTerms() : target === 'themes' ? purgeThemes() : purgeSource(target))
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
