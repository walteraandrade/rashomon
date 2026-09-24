import seedJson from '../seed.json' with { type: 'json' }
import { db, migrateP } from './db.js'
import { fitsApprox, scoredText } from './scorers/window.js'
import type { Person } from './types.js'

export type ExportedDoc = {
  id: number
  source: string
  domain: string | null
  published_at: Date
  text: string
  uri: string
  tone: number | null
  persons: string[]
  // Per tracked person mentioned, the text the scorer sends (src/scorers/window.ts), to the token
  // budget approxTokens estimates where the scorer measures with the tokenizer. Kikori trains on
  // `windows[person]`, never on `text`, so it learns the text production shows it.
  windows: Record<string, string>
}

type Stored = { id: string; name: string; aliases: string[] }

const exportSql = `
  select d.id, d.source, d.domain, d.published_at, d.text, d.uri, d.tone,
    coalesce(array_agg(dp.person_id) filter (where dp.person_id is not null), '{}') as persons
  from docs d
  left join doc_persons dp on dp.doc_id = d.id
  group by d.id
  order by d.id`

const window = (text: string, person: Person, persons: Person[]) => scoredText(text, person, persons, fitsApprox(person))

// Pure line-generation, separate from main()'s stdout/db wiring, so tests can assert on
// the shape without spawning the script or touching process.stdout. `persons` is the tracked
// list, seed.json in production, for the same reason scoreAll takes it: `exclude` and the other
// people's aliases decide where a window lands, and the persons table holds neither.
export const exportLines = async (persons: Person[]): Promise<ExportedDoc[]> => {
  const byId = new Map(persons.map((p) => [p.id, p]))
  const stored = new Map((await db.query<Stored>('select id, name, aliases from persons')).rows.map((p) => [p.id, p]))
  const personOf = (id: string): Person => byId.get(id) ?? stored.get(id) ?? { id, name: id, aliases: [] }
  const { rows } = await db.query<Omit<ExportedDoc, 'windows'>>(exportSql)
  return rows.map((r) => ({
    ...r,
    windows: Object.fromEntries(r.persons.map((id) => [id, window(r.text, personOf(id), persons)])),
  }))
}

const main = async () => {
  await migrateP()
  const rows = await exportLines(seedJson as Person[])
  for (const r of rows) console.log(JSON.stringify(r))
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
