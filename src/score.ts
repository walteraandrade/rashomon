import { db, migrate } from './db.js'
import { scorers } from './scorers/index.js'
import type { Person, Scorer } from './types.js'

type Pair = { doc_id: number; person_id: string; text: string; id: string; name: string; aliases: string[] }

// `not exists`, not `left join ... where is null`: keeps the "already scored under this
// method" filter obvious next to toneSql's own having-based filters, per the spec.
const unscoredSql = `
  select dp.doc_id, dp.person_id, d.text, p.id, p.name, p.aliases
  from doc_persons dp
  join docs d on d.id = dp.doc_id
  join persons p on p.id = dp.person_id
  where not exists (
    select 1 from doc_testimony dt
    where dt.doc_id = dp.doc_id and dt.person_id = dp.person_id and dt.method = $1
  )`

// Pure and testable on purpose: no migrate()/db.close() in here, so test/score.test.ts
// can call this against the shared in-memory fixture without racing another suite's close.
export const scoreAll = async (method: string, scorer: Scorer): Promise<number> => {
  const { rows } = await db.query<Pair>(unscoredSql, [method])
  await rows.reduce<Promise<void>>(async (acc, r) => {
    await acc
    const person: Person = { id: r.id, name: r.name, aliases: r.aliases }
    const score = await scorer(r.text, person)
    await db.query(
      `insert into doc_testimony (doc_id, person_id, method, score) values ($1, $2, $3, $4)
       on conflict (doc_id, person_id, method) do nothing`,
      [r.doc_id, r.person_id, method, score],
    )
  }, Promise.resolve())
  return rows.length
}

const main = async () => {
  await migrate()
  const method = process.env.TESTIMONY_SCORER ?? 'onnx'
  const scorer = (scorers as Record<string, Scorer>)[method]
  if (!scorer) throw new Error(`unknown scorer: ${method}`)
  const n = await scoreAll(method, scorer)
  console.log(`scored ${n} pairs`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
