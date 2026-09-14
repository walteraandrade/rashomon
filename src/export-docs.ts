import { db, migrate } from './db.js'
import { scoredText } from './scorers/window.js'

export type ExportedDoc = {
  id: number
  source: string
  domain: string | null
  published_at: Date
  text: string
  uri: string
  tone: number | null
  persons: string[]
  // Per tracked person mentioned, the text the scorer sends (src/scorers/window.ts): kikori
  // trains on `windows[person]`, never on `text`, so it learns the text production shows it.
  windows: Record<string, string>
}

type Aliases = { id: string; aliases: string[] }

const exportSql = `
  select d.id, d.source, d.domain, d.published_at, d.text, d.uri, d.tone,
    coalesce(array_agg(dp.person_id) filter (where dp.person_id is not null), '{}') as persons
  from docs d
  left join doc_persons dp on dp.doc_id = d.id
  group by d.id
  order by d.id`

// Pure line-generation, separate from main()'s stdout/db wiring, so tests can assert on
// the shape without spawning the script or touching process.stdout.
export const exportLines = async (): Promise<ExportedDoc[]> => {
  const aliases = new Map((await db.query<Aliases>('select id, aliases from persons')).rows.map((p) => [p.id, p.aliases]))
  const { rows } = await db.query<Omit<ExportedDoc, 'windows'>>(exportSql)
  return rows.map((r) => ({
    ...r,
    windows: Object.fromEntries(r.persons.map((id) => [id, scoredText(r.text, aliases.get(id) ?? [])])),
  }))
}

const main = async () => {
  await migrate()
  const rows = await exportLines()
  for (const r of rows) console.log(JSON.stringify(r))
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
