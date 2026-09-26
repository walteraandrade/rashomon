import { db, type Db } from './db.js'

// Scoped to disk-usage reporting, not maintenance (db.ts's ANALYZED_TABLES): includes
// persons, gkg_files, phrases and phrase_stage, which have all caused real disk incidents
// but are never analyzed/vacuumed by that other list.
export const SIZE_TABLES = [
  'persons',
  'docs',
  'doc_persons',
  'doc_terms',
  'doc_candidates',
  'doc_testimony',
  'gkg_files',
  'phrases',
  'phrase_stage',
  'graph_scopes',
  'graph_terms',
  'term_communities',
] as const

export type SizeReport = { tables: Record<string, number>; total: number }

type QueryFn = Db['query']

// Table names cannot be bound as parameters (same constraint as db.ts's ANALYZED_TABLES),
// so each is interpolated into its own single-table select.
export const collectSizes = async (query: QueryFn): Promise<SizeReport> => {
  const tables: Record<string, number> = {}
  for (const table of SIZE_TABLES) {
    const { rows } = await query<{ size: string }>(`select pg_total_relation_size('${table}') as size`)
    tables[table] = Number(rows[0].size)
  }
  const { rows: totalRows } = await query<{ size: string }>(`select pg_database_size(current_database()) as size`)
  return { tables, total: Number(totalRows[0].size) }
}

const formatReport = ({ tables, total }: SizeReport): string => {
  const lines = Object.entries(tables)
    .sort(([, a], [, b]) => b - a)
    .map(([name, size]) => `${name.padEnd(15)} ${size} B`)
  return [...lines, `${'total'.padEnd(15)} ${total} B`].join('\n')
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
