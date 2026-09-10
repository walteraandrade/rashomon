import { db, migrate } from './db.js'
import { SOURCES } from './query.js'

const usage = 'usage: pnpm purge <source|orphan-terms|themes>'

// Validated here, not left to purgeSource to silently no-op on a typo: an argument that is
// neither a known source nor one of the two maintenance targets throws the usage error instead
// of running a delete that matches zero rows and looking like it worked.
export const resolveTarget = (target: string | undefined): string => {
  if (target === 'orphan-terms' || target === 'themes' || (target !== undefined && SOURCES.includes(target))) return target
  throw new Error(usage)
}

// Reclaims the doc_terms rows written before docs naming no tracked person stopped producing
// terms. `vacuum full` and not plain `vacuum`: measured on a synthetic 13k-doc database, a plain
// vacuum only marks the pages reusable and leaves the on-disk size unchanged (14.7 MB before and
// after), while `vacuum full` rewrites the table and brings it down to 1.0 MB. It takes an
// exclusive lock on doc_terms, which is fine for a one-off run with the server stopped.
const purgeOrphanTerms = async () => {
  const { rows } = await db.query<{ n: number }>(
    `with d as (
       delete from doc_terms t where not exists (select 1 from doc_persons p where p.doc_id = t.doc_id) returning 1
     ) select count(*)::int as n from d`,
  )
  await db.exec(`vacuum full doc_terms`)
  console.log(`purged ${rows[0].n} doc_terms rows without a tracked person`)
}

// Same reasoning as orphan-terms, applied to the cascade: a source purge is a permanent
// deletion run with the server stopped, so the pages are never refilled and `vacuum full` is
// what returns them to disk. One statement per exec: vacuum cannot run inside the implicit
// transaction a multi-statement exec opens.
const vacuumFull = (tables: readonly string[]) =>
  tables.reduce<Promise<void>>(async (acc, t) => (await acc, void (await db.exec(`vacuum full ${t}`))), Promise.resolve())

const purgeSource = async (source: string) => {
  const { rows } = await db.query<{ n: number }>(`with d as (delete from docs where source = $1 returning 1) select count(*)::int as n from d`, [source])
  if (source === 'gkg') await db.query(`delete from gkg_files`)
  if (rows[0].n) await vacuumFull(['docs', 'doc_terms', 'doc_persons', 'doc_candidates', 'doc_testimony'])
  console.log(`purged ${rows[0].n} docs from ${source}`)
}

// Neither the GDELT theme terms nor the pre-revision kikori rows are read anywhere (issue
// #108); the extra_terms update is scoped to rows that actually carry something, so the
// reported count means "docs that had themes", not "every doc touched". docs is vacuumed with
// the other two: an update is not an edit in place under MVCC, it writes a new tuple and leaves
// the old one dead, so emptying a jsonb column on ~30k rows bloats docs exactly as a bulk
// delete would. Without it the largest share of the space this purge frees stays in the file.
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

// Same guard as reindex.ts/score.ts: only runs main() when this file is the process entry
// point, not when a test imports purgeThemes/resolveTarget. Without it, importing this module
// at all ran the CLI unconditionally against process.argv.
if (import.meta.url === `file://${process.argv[1]}`) await main()
