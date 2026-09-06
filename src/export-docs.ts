import { db, migrate } from './db.js'

export type ExportedDoc = {
  id: number
  source: string
  domain: string | null
  published_at: Date
  text: string
  uri: string
  tone: number | null
  persons: string[]
}

const exportSql = `
  select d.id, d.source, d.domain, d.published_at, d.text, d.uri, d.tone,
    coalesce(array_agg(dp.person_id) filter (where dp.person_id is not null), '{}') as persons
  from docs d
  left join doc_persons dp on dp.doc_id = d.id
  group by d.id
  order by d.id`

// Pure line-generation, separate from main()'s stdout/db wiring, so tests can assert on
// the shape without spawning the script or touching process.stdout.
export const exportLines = async (): Promise<ExportedDoc[]> => (await db.query<ExportedDoc>(exportSql)).rows

const main = async () => {
  await migrate()
  const rows = await exportLines()
  for (const r of rows) console.log(JSON.stringify(r))
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
