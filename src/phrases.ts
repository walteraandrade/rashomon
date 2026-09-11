import { clampEnv, db } from './db.js'
import { wordPairs } from './extract.js'
import { inBatches, writeBatchRows } from './store.js'
import type { Phrases } from './types.js'

// A bigram is a phrase when it clears two floors.
// Stickiness = `c(a b) / min(c(a), c(b))`: of every time the rarer word appears, how often
// is it inside this pair? Deliberately not PMI, which rewards two rare words that co-occur once.
const minPhraseCount = () => clampEnv(process.env.MIN_PHRASE_COUNT, 5, 2, 1_000_000)
const minPhrasePercent = () => clampEnv(process.env.MIN_PHRASE_PERCENT, 35, 1, 100)

export const resetPhraseStage = () => db.exec(`truncate phrase_stage`)

export const stagePhrases = (texts: readonly string[], size = writeBatchRows()) => {
  const rows = texts.flatMap(wordPairs)
  return inBatches(rows, size, (b) =>
    db.query(`insert into phrase_stage (w1, w2) select * from unnest($1::text[], $2::text[])`, [b.map((r) => r.w1), b.map((r) => r.w2)]),
  )
}

// $3 narrows `pairs` but not `uni`: names stay in the denominator to avoid inflating stickiness.
// A pair touching a name is excluded: a phrase would replace its words, deleting the non-name
// word from that person's graph with nothing in its place.
const buildSql = `
  insert into phrases (term, count, score)
  with uni as (select w1 as w, count(*)::float8 as c from phrase_stage group by 1),
  pairs as (
    select w1, w2, count(*)::float8 as c from phrase_stage
    where w2 is not null and not (w1 = any($3::text[]) or w2 = any($3::text[]))
    group by 1, 2
  )
  select p.w1 || ' ' || p.w2, p.c::int, round((p.c / least(a.c, b.c))::numeric, 4)::float8
  from pairs p join uni a on a.w = p.w1 join uni b on b.w = p.w2
  where p.c >= $1 and p.c / least(a.c, b.c) >= $2`

export const buildPhrases = async (nameWords: readonly string[] = []) => {
  await db.exec(`truncate phrases`)
  await db.query(buildSql, [minPhraseCount(), minPhrasePercent() / 100, [...new Set(nameWords)]])
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from phrases`)
  await resetPhraseStage()
  return rows[0].n
}

export const loadPhrases = async (): Promise<Phrases> =>
  new Set((await db.query<{ term: string }>(`select term from phrases`)).rows.map((r) => r.term))
