import { clampEnv, db } from './db.js'
import { wordPairs } from './extract.js'
import { inBatches, writeBatchRows } from './store.js'
import type { Phrases } from './types.js'

// A bigram is a phrase when it clears two floors at once, and both are deliberately blunt.
//
// The count floor is what keeps a pair seen twice from becoming vocabulary: PMI-style
// measures are wildest exactly where the counts are smallest, which is the same reason
// graph.ts's sort=pmi multiplies by ln(1 + count).
//
// The stickiness floor is `c(a b) / min(c(a), c(b))`: of every time the rarer of the two
// words appears, how often is it inside this pair? "primeiro turno" scores high because
// "turno" has almost nowhere else to be; "faltam dias" scores near zero because "dias" is
// everywhere. Deliberately not PMI: PMI's denominator rewards two rare words that happen to
// co-occur once, which is the failure mode a lexicon must not have. It is a ratio of two
// counts of the same kind, so it reads as a percentage and thresholds without calibration.
export const minPhraseCount = () => clampEnv(process.env.MIN_PHRASE_COUNT, 5, 2, 1_000_000)
export const minPhrasePercent = () => clampEnv(process.env.MIN_PHRASE_PERCENT, 35, 1, 100)

export const resetPhraseStage = () => db.exec(`truncate phrase_stage`)

// One row per content-word occurrence, not per pair: the trailing null-w2 row is what makes
// `select w1, count(*) group by 1` the exact occurrence count of every word, with no
// double counting of the words that sit in the middle of a run.
export const stagePhrases = (texts: readonly string[], size = writeBatchRows()) => {
  const rows = texts.flatMap(wordPairs)
  return inBatches(rows, size, (b) =>
    db.query(`insert into phrase_stage (w1, w2) select * from unnest($1::text[], $2::text[])`, [b.map((r) => r.w1), b.map((r) => r.w2)]),
  )
}

// `uni` is total, not partial: every w2 also appears as some row's w1 (its own occurrence),
// so the join can be an inner one and no pair is silently dropped for want of a unigram. Note
// $3 narrows `pairs` and never `uni`: a tracked name is still a word like any other in the
// denominator, and removing it there would inflate the stickiness of every pair beside it.
//
// $3 is why "lula defende" is not a phrase. A pair touching a tracked person's own name would
// be dropped from that person's graph anyway (graph.ts's name filter), and since a phrase now
// replaces its words, keeping it would delete "defende" from Lula's map and put nothing in its
// place. Multi-word names still reach the map through properNouns, which spells them whole.
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

// Rebuilt whole, never merged: a lexicon is a statement about the corpus as it stands, and a
// pair that stopped clearing the floors has to be able to leave. The staging table is dropped
// with it -- it is as big as the corpus is long and nothing reads it between builds.
export const buildPhrases = async (nameWords: readonly string[] = []) => {
  await db.exec(`truncate phrases`)
  await db.query(buildSql, [minPhraseCount(), minPhrasePercent() / 100, [...new Set(nameWords)]])
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from phrases`)
  await resetPhraseStage()
  return rows[0].n
}

export const loadPhrases = async (): Promise<Phrases> =>
  new Set((await db.query<{ term: string }>(`select term from phrases`)).rows.map((r) => r.term))
