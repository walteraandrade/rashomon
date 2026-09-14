import seedJson from '../seed.json' with { type: 'json' }
import { db, migrate } from './db.js'
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
export const scoreAll = async (method: string, scorer: Scorer, persons: Person[]): Promise<number> => {
  const byId = new Map(persons.map((p) => [p.id, p]))
  const { rows } = await db.query<Pair>(unscoredSql, [method])
  await rows.reduce<Promise<void>>(async (acc, r) => {
    await acc
    const person = byId.get(r.person_id) ?? { id: r.id, name: r.name, aliases: r.aliases }
    const score = await scorer(r.text, person, persons)
    await db.query(
      `insert into doc_testimony (doc_id, person_id, method, score) values ($1, $2, $3, $4)
       on conflict (doc_id, person_id, method) do nothing`,
      [r.doc_id, r.person_id, method, score],
    )
  }, Promise.resolve())
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
  await migrate()
  const n = await scoreAll(method, scorer, seedJson as Person[])
  console.log(`scored ${n} pairs as ${method}`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
