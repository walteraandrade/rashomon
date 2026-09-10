import persons from '../seed.json' with { type: 'json' }
import { analyzeAfterWrite, analyzeMinDocs, db, migrate } from './db.js'
import { collectors, defaultSources } from './collectors/index.js'
import { loadPhrases } from './phrases.js'
import { insertDocs, pruneRemoved, upsertPersons } from './store.js'
import type { Person, Phrases, RawDoc } from './types.js'

const runSource = async (name: string, ps: Person[], lexicon: Phrases) => {
  const collect = collectors[name as keyof typeof collectors]
  const docs = await collect(ps).catch((e: Error) => (console.error(`[${name}] ${e.message}`), [] as RawDoc[]))
  const { written, enriched, failed } = await insertDocs(docs, ps, undefined, lexicon)
  // `enriched` is the early warning this project has no other source for: it counts documents
  // whose stored text a feed just replaced with a longer one. A feed that quietly stops filling
  // `content:encoded` shows up here as a number falling to zero, before the atlas gets duller.
  console.log(`[${name}] fetched ${docs.length}, new ${written}${enriched ? `, enriched ${enriched}` : ''}${failed ? `, failed ${failed}` : ''}`)
  return written
}

const main = async () => {
  await migrate()
  const removed = await pruneRemoved(persons)
  if (removed.length) console.log(`removed persons: ${removed.join(', ')}`)
  await upsertPersons(persons)
  const only = process.argv.slice(2)
  const names = only.length ? only : defaultSources
  // Read once, before any collector runs: ingest tags new documents with the phrases the last
  // `pnpm reindex` found, and never discovers new ones itself. A pair that only becomes a
  // phrase because of documents collected today is tagged by the next reindex, not by this run.
  const lexicon = await loadPhrases()
  const written = await names.reduce<Promise<number>>(async (acc, n) => (await acc) + (await runSource(n, persons, lexicon)), Promise.resolve(0))
  const { rows } = await db.query<{ n: string }>(`select count(*) as n from docs`)
  console.log(`total docs: ${rows[0].n}`)
  const analyzed = await analyzeAfterWrite(written)
  console.log(
    analyzed.length
      ? `analyzed ${analyzed.join(', ')} after ${written} new docs`
      : `skipped analyze: ${written} new docs below ANALYZE_MIN_DOCS=${analyzeMinDocs()}`,
  )
  await db.close()
}

main()
