import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'

// PERF is read once, at import time, by src/perf.ts: it has to be set before src/db.ts is
// loaded, which is why every import below is dynamic. With it on, `db` counts the statements
// it sends to PGlite, and that counter is the only direct proof that a batch really is one
// statement and not one per row. node:test gives this file its own process and its own
// memory:// database, so the flag never reaches another suite.
process.env.PERF = '1'

const { db, migrate } = await import('../src/db.js')
const { measure } = await import('../src/perf.js')
const { insertDocs, upsertPersons, writeDerived } = await import('../src/store.js')
const { reindexAll } = await import('../src/reindex.js')
await import('./close.js')

const persons = [{ id: 'lula', name: 'Lula', aliases: ['Lula'] }]

// Lowercase on purpose: the alias still matches (matching is accent- and case-insensitive)
// while no capitalized run is left for candidate discovery, so the only derived rows are one
// doc_persons and exactly two doc_terms ("lula" and "reforma<i>") per document.
const docs = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    source: 'rss' as const,
    uri: `https://example.org/${prefix}/${i}`,
    text: `lula fala sobre reforma${i}`,
    publishedAt: new Date().toISOString(),
    domain: 'example.org',
  }))

const statements = async (fn: () => Promise<unknown>) => (await measure(fn)).sql

describe('bounded write batches (issue #50)', () => {
  before(async () => {
    if (process.env.DATA_DIR !== 'memory://') throw new Error('tests must run with DATA_DIR=memory://')
    await migrate()
    await upsertPersons(persons)
  })

  it('spends one statement per batch of rows, not one per row', async () => {
    const { rows } = await db.query<{ id: number }>(
      `insert into docs (source, uri, text, published_at) select 'rss', 'https://example.org/rows/' || i, 'x', now() from generate_series(1, 7) as i returning id`,
    )
    const derived = rows.map((r) => ({ docId: r.id, persons: ['lula'], terms: [], names: [] }))
    // 7 person rows, no terms and no candidates: ceil(7/3) statements and nothing else.
    assert.equal(await statements(() => writeDerived(derived, 3)), 3)
    assert.equal(await statements(() => writeDerived(derived, 500)), 1)
    assert.equal(await statements(() => writeDerived([], 500)), 0)
  })

  it('spends one transaction and a handful of statements per group of documents', async () => {
    // begin + 4 upserts + 1 doc_persons batch + 1 doc_terms batch + commit.
    assert.equal(await statements(() => insertDocs(docs(4, 'group'), persons, 4)), 8)
    // Same documents with the row bound at 1, which is what the old per-row path cost:
    // begin + 4 upserts + 4 person rows + 8 term rows + commit.
    process.env.WRITE_BATCH_ROWS = '1'
    const unbatched = await statements(() => insertDocs(docs(4, 'unbatched'), persons, 4))
    delete process.env.WRITE_BATCH_ROWS
    assert.equal(unbatched, 18)
  })

  it('grows its statement count with the number of groups, not with the number of documents', async () => {
    const one = await statements(() => insertDocs(docs(8, 'one-group'), persons, 8))
    const four = await statements(() => insertDocs(docs(8, 'four-groups'), persons, 2))
    assert.equal(one, 12)
    assert.equal(four, 4 * 6)
  })

  it('reindexes in a fixed number of statements per page, whatever the corpus size', async () => {
    await insertDocs(docs(40, 'reindex'), persons)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs`)
    // Two passes over the corpus since phrases (issue: tokenization noise): the first stages
    // every adjacent word pair, the second derives. Per page that is one staging insert plus
    // begin + doc_persons + doc_terms + commit; no candidates in this corpus.
    const perPage = 6
    const pages = Math.ceil(rows[0].n / 10)
    const overhead = await statements(() => reindexAll(persons, 10))
    // truncate, the persons upsert, its transaction, the domain backfill probes, the page
    // reads of both passes, the phrase lexicon build and the five `analyze` statements are the
    // rest; the point is that the per-page cost is constant, so this stays proportional to
    // pages and never to rows[0].n.
    assert.ok(overhead <= pages * perPage + 3 * pages + 20, `reindex spent ${overhead} statements over ${pages} pages`)
    // The ceiling a reindex that touched one document at a time would hit: one statement per
    // document per pass. Batching has to stay strictly under it, which is the whole claim.
    assert.ok(overhead < rows[0].n * 2, `reindex spent ${overhead} statements for ${rows[0].n} docs`)
  })
})
