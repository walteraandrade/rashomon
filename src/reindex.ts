import seedPersons from '../seed.json' with { type: 'json' }
import { analyzeTables, db, migrate } from './db.js'
import { domainOf, nameTokens } from './extract.js'
import { buildPhrases, loadPhrases, resetPhraseStage, stagePhrases } from './phrases.js'
import { MAX_DOC_CHARS, derive, inBatches, inTransaction, truncateText, upsertPersons, writeBatchDocs, writeDerived } from './store.js'
import type { Person, Source, Term } from './types.js'

type Row = { id: number; source: Source; text: string; extra_terms: Term[]; extra_names: string[] }

// Keyset pagination on the primary key: stable while the rebuild writes, constant memory.
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

// Docs whose uri yields no domain are skipped; a null-to-null update would only cost a row version.
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

// Rows stored before the cap existed are cut with the same truncateText ingest uses.
// `length(text)` is Postgres's character count; any row it selects does shrink.
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
  const capped = await capTexts(size)
  // Corpus is read twice: lexicon cannot exist until every doc is counted, and no doc can be
  // tagged until the lexicon does. phrase_stage is scratch, so no transaction.
  await resetPhraseStage()
  await eachPage(size, (rows) => stagePhrases(rows.map((r) => r.text)))
  const phrases = await buildPhrases(persons.flatMap(nameTokens))
  const lexicon = await loadPhrases()
  // `truncate` not `delete`: PGlite has no autovacuum; delete would leave dead pages forever.
  await db.exec(`truncate doc_terms, doc_persons, doc_candidates`)
  const docs = await eachPage(size, (rows) =>
    inTransaction(() =>
      writeDerived(rows.map((r) => derive(r.id, { source: r.source, text: r.text, extraTerms: r.extra_terms, extraNames: r.extra_names }, persons, lexicon))),
    ),
  )
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
