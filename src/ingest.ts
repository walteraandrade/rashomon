import persons from '../seed.json' with { type: 'json' }
import { db, migrate } from './db.js'
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
  console.log(`[${name}] fetched ${docs.length}, new ${results.filter(Boolean).length}`)
}

const main = async () => {
  await migrate()
  const removed = await pruneRemoved(persons)
  if (removed.length) console.log(`removed persons: ${removed.join(', ')}`)
  await upsertPersons(persons)
  const only = process.argv.slice(2)
  const names = only.length ? only : defaultSources
  await names.reduce<Promise<void>>(async (acc, n) => (await acc, runSource(n, persons)), Promise.resolve())
  const { rows } = await db.query<{ n: string }>(`select count(*) as n from docs`)
  console.log(`total docs: ${rows[0].n}`)
  await db.close()
}

main()
