import { db, type Db } from './db.js'

// Scoped to disk-usage reporting, not maintenance (db.ts's ANALYZED_TABLES): includes
// persons, gkg_files, phrases and phrase_stage, which have all caused real disk incidents
// but are never analyzed/vacuumed by that other list.
export const SIZE_TABLES = [
  'persons',
  'docs',
  'doc_persons',
  'doc_terms',
  'terms',
  'doc_candidates',
  'doc_testimony',
  'gkg_files',
  'phrases',
  'phrase_stage',
  'graph_scopes',
  'graph_terms',
  'person_attention',
  'term_communities',
  'term_links',
  'outlet_fields',
  'outlet_neighbors',
] as const

export type SizeReport = { tables: Record<string, number>; missing: string[]; total: number }

type QueryFn = Db['query']

// Table names cannot be bound as parameters (same constraint as db.ts's ANALYZED_TABLES),
// so each is interpolated into its own single-table select. A table a pending migration has
// not created yet (to_regclass is null) is left out of `tables` and named in `missing`, so a
// size report never reads an absent table as an empty one; every table missing means an
// unmigrated database, which is still a failure.
export const collectSizes = async (query: QueryFn): Promise<SizeReport> => {
  const tables: Record<string, number> = {}
  const missing: string[] = []
  for (const table of SIZE_TABLES) {
    const { rows } = await query<{ size: string | null }>(
      `select pg_total_relation_size(to_regclass('${table}')) as size`,
    )
    if (rows[0].size === null) missing.push(table)
    else tables[table] = Number(rows[0].size)
  }
  if (missing.length === SIZE_TABLES.length) throw new Error('no SIZE_TABLES table exists; run pnpm migrate')
  const { rows: totalRows } = await query<{ size: string }>(`select pg_database_size(current_database()) as size`)
  return { tables, missing, total: Number(totalRows[0].size) }
}

const formatReport = ({ tables, missing, total }: SizeReport): string => {
  const lines = Object.entries(tables)
    .sort(([, a], [, b]) => b - a)
    .map(([name, size]) => `${name.padEnd(15)} ${size} B`)
  const absent = missing.map((name) => `${name.padEnd(15)} missing`)
  return [...lines, ...absent, `${'total'.padEnd(15)} ${total} B`].join('\n')
}

const main = async () => {
  try {
    const report = await collectSizes(db.query.bind(db))
    console.log(formatReport(report))
    console.log(JSON.stringify(report))
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    await db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
