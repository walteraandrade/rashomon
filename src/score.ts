import seedJson from '../seed.json' with { type: 'json' }
import { db, migrateP } from './db.js'
import { methods, scorers } from './scorers/index.js'
// Direct, not through scorers/index.js: method.ts has no imports, so nothing it exports pulls in the model loader.
import { modelRevision } from './scorers/method.js'
import type { Person, Scorer } from './types.js'

type Pair = { doc_id: number; person_id: string; text: string; id: string; name: string; aliases: string[] }

// `not exists` not `left join ... where is null`: keeps the filter obvious.
const unscoredSql = `
  select dp.doc_id, dp.person_id, d.text, p.id, p.name, p.aliases
  from doc_persons dp
  join docs d on d.id = dp.doc_id
  join persons p on p.id = dp.person_id
  where not exists (
    select 1 from doc_testimony dt
    where dt.doc_id = dp.doc_id and dt.person_id = dp.person_id and dt.method = $1
  )`

// No migrate()/db.close() here: test/score.test.ts calls this against the shared in-memory fixture.
// `persons` is the tracked list, seed.json in production: it carries `exclude`, which the persons
// table does not, and the scorer's window needs every alias to land on the right mention. A pair
// whose person has left the list scores on the row's own aliases.
// Rows reach the database `batch` per insert: one round trip to Supabase costs ~130 ms, the model
// ~6 ms, so an insert per pair is a 4.5-hour full re-score. A run stopped mid-way loses one batch.
type Row = [number, string, string, number | null]

const flush = async (rows: Row[]): Promise<void> => {
  if (rows.length === 0) return
  const values = rows.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ')
  await db.query(
    `insert into doc_testimony (doc_id, person_id, method, score) values ${values}
     on conflict (doc_id, person_id, method) do nothing`,
    rows.flat(),
  )
}

const progress = (done: number, total: number, startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000
  const rate = done / Math.max(seconds, 0.001)
  const left = Math.round((total - done) / Math.max(rate, 0.001))
  process.stderr.write(`scored ${done}/${total} (${rate.toFixed(1)}/s, ~${Math.ceil(left / 60)} min left)\n`)
}

export const scoreAll = async (method: string, scorer: Scorer, persons: Person[], batch = 500): Promise<number> => {
  const byId = new Map(persons.map((p) => [p.id, p]))
  const { rows } = await db.query<Pair>(unscoredSql, [method])
  const startedAt = Date.now()
  let pending: Row[] = []
  let done = 0
  for (const r of rows) {
    const person = byId.get(r.person_id) ?? { id: r.id, name: r.name, aliases: r.aliases }
    pending.push([r.doc_id, r.person_id, method, await scorer(r.text, person, persons)])
    done += 1
    if (pending.length >= batch) {
      await flush(pending)
      pending = []
    }
    if (done % 1000 === 0) progress(done, rows.length, startedAt)
  }
  await flush(pending)
  return rows.length
}

// TESTIMONY_REVISION must be set for onnx: a row without it could fill gaps across retrain boundaries.
export const resolveRun = (name: string) => {
  const scorer = (scorers as Record<string, Scorer>)[name]
  if (!scorer) throw new Error(`unknown scorer: ${name}`)
  if (name === 'onnx' && !modelRevision())
    throw new Error(
      'TESTIMONY_REVISION is unset or malformed: set it to the Hub revision of TESTIMONY_MODEL (commit sha, tag or branch, matching /^[\\w.-]{1,64}$/) so doc_testimony records which model scored each row',
    )
  return { scorer, method: (methods as Record<string, () => string>)[name]() }
}

const main = async () => {
  // resolveRun before migrate(): a refused run must not have touched the database.
  const { scorer, method } = resolveRun(process.env.TESTIMONY_SCORER ?? 'onnx')
  await migrateP()
  const n = await scoreAll(method, scorer, seedJson as Person[])
  console.log(`scored ${n} pairs as ${method}`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
