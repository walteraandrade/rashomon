import persons from '../seed.json' with { type: 'json' }
import { analyzeAfterWrite, analyzeMinDocs, db, migrate } from './db.js'
import { collectors, defaultSources } from './collectors/index.js'
import { insertDoc, pruneRemoved, upsertPersons } from './store.js'
import type { Person, RawDoc } from './types.js'

const runSource = async (name: string, ps: Person[]) => {
  const collect = collectors[name as keyof typeof collectors]
  const docs = await collect(ps).catch((e: Error) => (console.error(`[${name}] ${e.message}`), [] as RawDoc[]))
  const results = await docs.reduce<Promise<boolean[]>>(
    async (acc, d) => [...(await acc), await insertDoc(d, ps)],
    Promise.resolve([]),
  )
  const written = results.filter(Boolean).length
  console.log(`[${name}] fetched ${docs.length}, new ${written}`)
  return written
}

const main = async () => {
  await migrate()
  const removed = await pruneRemoved(persons)
  if (removed.length) console.log(`removed persons: ${removed.join(', ')}`)
  await upsertPersons(persons)
  const only = process.argv.slice(2)
  const names = only.length ? only : defaultSources
  const written = await names.reduce<Promise<number>>(async (acc, n) => (await acc) + (await runSource(n, persons)), Promise.resolve(0))
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
