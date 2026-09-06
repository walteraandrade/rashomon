import { db, migrate } from '../src/db.js'
import { insertDoc, upsertPersons } from '../src/store.js'
import type { Person, RawDoc } from '../src/types.js'

export const persons: Person[] = [
  { id: 'lula', name: 'Lula', aliases: ['Lula', 'Luiz Inácio'] },
  { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio', 'Tarcísio de Freitas'] },
]

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

export const docs: RawDoc[] = [
  { source: 'gnews', uri: 'https://g1.globo.com/1', text: 'Lula anuncia reforma tributária #reforma', publishedAt: daysAgo(1), domain: 'g1.globo.com' },
  { source: 'bluesky', uri: 'at://did:plc:x/post/2', text: 'Lula e Tarcísio disputam a eleição', publishedAt: daysAgo(2), domain: 'ana.bsky.social' },
  { source: 'gnews', uri: 'https://folha.uol.com.br/3', text: 'Tarcísio inaugura rodovia no interior', publishedAt: daysAgo(3), domain: 'folha.uol.com.br', tone: -1.5 },
  { source: 'rss', uri: 'https://example.org/4', text: 'Congresso avança na pauta econômica', publishedAt: daysAgo(4), domain: 'example.org' },
  { source: 'gnews', uri: 'https://valor.globo.com/6', text: 'Lula defende reforma tributária', publishedAt: daysAgo(5), domain: 'valor.globo.com' },
  { source: 'gnews', uri: 'https://g1.globo.com/5', text: 'Lula viaja para a Bahia', publishedAt: daysAgo(100), domain: 'g1.globo.com' },
]

let ready: Promise<void> | null = null

export const seed = () =>
  (ready ??= (async () => {
    if (process.env.DATA_DIR !== 'memory://') throw new Error('tests must run with DATA_DIR=memory://')
    await migrate()
    await db.exec(`delete from doc_terms; delete from doc_persons; delete from docs; delete from persons;`)
    await upsertPersons(persons)
    for (const d of docs) await insertDoc(d, persons)
  })())
