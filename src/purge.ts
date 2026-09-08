import { db, migrate } from './db.js'

const usage = 'usage: pnpm purge <source|orphan-terms>'

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

const main = async () => {
  const target = process.argv[2]
  if (!target) throw new Error(usage)
  await migrate()
  await (target === 'orphan-terms' ? purgeOrphanTerms() : purgeSource(target))
  await db.close()
}

main()
