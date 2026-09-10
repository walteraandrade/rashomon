import seedPersons from '../seed.json' with { type: 'json' }
import { analyzeTables, db, migrate } from './db.js'
import { domainOf, nameTokens } from './extract.js'
import { buildPhrases, loadPhrases, resetPhraseStage, stagePhrases } from './phrases.js'
import { MAX_DOC_CHARS, derive, inBatches, inTransaction, truncateText, upsertPersons, writeBatchDocs, writeDerived } from './store.js'
import type { Person, Source, Term } from './types.js'

type Row = { id: number; source: Source; text: string; extra_terms: Term[]; extra_names: string[] }

// Keyset pagination on the primary key, not offset: it is stable while the rebuild writes and
// it never holds more than one page of document text in memory, whatever the corpus size.
const pageOf = async (after: number, size: number) =>
  (
    await db.query<Row>(`select id, source, text, extra_terms, extra_names from docs where id > $1 order by id limit $2`, [after, size])
  ).rows

const eachPage = async (size: number, fn: (rows: Row[]) => Promise<void>) => {
  let after = 0
  let seen = 0
  for (;;) {
    const rows = await pageOf(after, size)
    if (!rows.length) return seen
    await fn(rows)
    after = rows[rows.length - 1].id
    seen += rows.length
  }
}

// Docs whose uri yields no domain are skipped rather than written back as null: the update
// would change nothing and only cost a row version. They stay in the predicate, as before.
const backfillDomains = async (size: number) => {
  let after = 0
  let filled = 0
  for (;;) {
    const { rows } = await db.query<{ id: number; uri: string }>(
      `select id, uri from docs where domain is null and source <> 'bluesky' and id > $1 order by id limit $2`,
      [after, size],
    )
    if (!rows.length) return filled
    const found = rows.flatMap((r) => {
      const domain = domainOf(r.uri)
      return domain ? [{ id: r.id, domain }] : []
    })
    await inTransaction(() =>
      inBatches(found, size, (b) =>
        db.query(`update docs set domain = u.domain from unnest($1::int[], $2::text[]) as u(id, domain) where docs.id = u.id`, [
          b.map((x) => x.id),
          b.map((x) => x.domain),
        ]),
      ),
    )
    after = rows[rows.length - 1].id
    filled += found.length
  }
}

// Rows stored before the cap existed are cut to it with the same `truncateText` ingest uses, so
// a reindex and an ingest agree on every document. `length(text)` is Postgres's character count
// and `text.length` JavaScript's code-unit count, which only differ on non-BMP characters, so the
// predicate here reads as "certainly over", and any row it selects does shrink.
const capTexts = async (size: number) => {
  let capped = 0
  for (;;) {
    const { rows } = await db.query<{ id: number; text: string }>(`select id, text from docs where length(text) > $1 order by id limit $2`, [MAX_DOC_CHARS, size])
    if (!rows.length) return capped
    await inTransaction(() =>
      inBatches(rows, size, (b) =>
        db.query(`update docs set text = u.text from unnest($1::int[], $2::text[]) as u(id, text) where docs.id = u.id`, [
          b.map((r) => r.id),
          b.map((r) => truncateText(r.text)),
        ]),
      ),
    )
    capped += rows.length
  }
}

// Separate from main()'s stdout/db wiring, so tests can reindex the fixture in-process.
export const reindexAll = async (persons: Person[], size = writeBatchDocs()) => {
  await upsertPersons(persons)
  const backfilled = await backfillDomains(size)
  // Before the phrase pass and the derive pass, so both read the text that will stay.
  const capped = await capTexts(size)
  // The corpus is read twice, and it has to be: which pairs of words stick together is a fact
  // about the whole corpus, so the lexicon cannot exist until every document has been counted,
  // and no document can be tagged with a phrase until it does. The alternative -- deriving
  // phrase rows in SQL from the staging table -- would put a second extraction path next to
  // `derive`, which is exactly the drift `derive`'s own comment exists to prevent.
  //
  // This pass runs *before* the truncate below, and the order matters on a live database. A
  // reindex serves nothing while its derived tables are empty, and neither `phrase_stage` nor
  // `phrases` is read by any route, so the whole staging pass belongs outside that window.
  // Putting it after the truncate would roughly double the time the site answers with no terms.
  //
  // No transaction around it, unlike the derive pass: phrase_stage is scratch that only
  // buildPhrases reads, and it is truncated at both ends of that read, so a half-written pass
  // costs nothing and rolling one back would buy nothing either.
  await resetPhraseStage()
  await eachPage(size, (rows) => stagePhrases(rows.map((r) => r.text)))
  const phrases = await buildPhrases(persons.flatMap(nameTokens))
  const lexicon = await loadPhrases()
  // `truncate`, not `delete`: PGlite has no autovacuum, so deleting every row would leave the
  // pages dead and the rebuild below would append past them, growing the files on every run.
  // Truncate returns the space immediately, which is why no vacuum follows it here — unlike
  // `pnpm purge`, whose deletions are permanent and need `vacuum full` to shrink the file.
  await db.exec(`truncate doc_terms, doc_persons, doc_candidates`)
  // One transaction per page: an interruption leaves whole pages committed and never a
  // document with only part of its derived rows. Recovery is to run it again (see README).
  const docs = await eachPage(size, (rows) =>
    inTransaction(() =>
      writeDerived(rows.map((r) => derive(r.id, { source: r.source, text: r.text, extraTerms: r.extra_terms, extraNames: r.extra_names }, persons, lexicon))),
    ),
  )
  // A reindex rewrites every derived table from empty, so the planner's row counts and
  // most-common-value lists are stale by construction when it ends: refresh them here,
  // unconditionally, in the process that owns DATA_DIR.
  const analyzed = await analyzeTables()
  return { docs, backfilled, capped, analyzed, phrases }
}

const main = async () => {
  await migrate()
  const { docs, backfilled, capped, analyzed, phrases } = await reindexAll(seedPersons)
  if (backfilled) console.log(`backfilled domain for ${backfilled} docs`)
  if (capped) console.log(`capped text of ${capped} docs at ${MAX_DOC_CHARS} chars`)
  console.log(`reindexed ${docs} docs`)
  console.log(`kept ${phrases} phrases`)
  console.log(`analyzed ${analyzed.join(', ')}`)
  await db.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
