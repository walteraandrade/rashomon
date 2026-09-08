import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, before, after } from 'node:test'
import { ANALYZED_TABLES, analyzeAfterWrite, analyzeMinDocs, analyzeTables, db, migrate } from '../src/db.js'
import { indexDefs, lastAnalyzed, planRowEstimate, seed } from './fixture.js'
import './close.js'

describe('read indexes and planner statistics (issue #44)', () => {
  before(seed)

  it('indexes doc_persons by person_id first, the column every route filters on', async () => {
    const defs = await indexDefs('doc_persons')
    assert.ok(
      defs.some((d) => d.indexname === 'doc_persons_person_idx' && /btree \(person_id, doc_id\)/.test(d.indexdef)),
      `expected doc_persons_person_idx, got ${JSON.stringify(defs)}`,
    )
  })

  it('keeps schema setup idempotent: a second migrate leaves one index of each name', async () => {
    await migrate()
    await migrate()
    const names = (await indexDefs('doc_persons')).map((d) => d.indexname).sort()
    assert.deepEqual(names, ['doc_persons_person_idx', 'doc_persons_pkey'])
  })

  it('adds no redundant index on docs: the rejected candidates are not in the schema', async () => {
    const defs = (await indexDefs('docs')).map((d) => d.indexdef)
    assert.deepEqual(
      defs.filter((d) => /\(source, published_at\)|\(domain, published_at\)|published_at DESC/i.test(d)),
      [],
    )
    // The two docs indexes measured as sufficient stay exactly as they were.
    assert.ok(defs.some((d) => /btree \(published_at\)/.test(d)))
    assert.ok(defs.some((d) => /btree \(domain\)/.test(d)))
  })

  // The fixture is far too small for the planner to prefer an index on its own, so this
  // asserts the access path exists and covers (person_id, doc_id) -- the shape every
  // person-scoped route needs -- not that the planner picks it at this row count. The
  // timings that justify the index are in docs/perf-baseline.md, on the benchmark corpus.
  it('offers the person scope an index-only path over (person_id, doc_id)', async () => {
    await db.exec(`analyze doc_persons`)
    // vacuum sets the visibility map, without which even a covering index still visits the heap.
    await db.exec(`vacuum doc_persons`)
    await db.exec(`set enable_seqscan = off`)
    const { rows } = await db.query<Record<string, string>>(
      `explain select dp.doc_id from doc_persons dp where dp.person_id = $1`,
      ['lula'],
    )
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n')
    await db.exec(`reset enable_seqscan`)
    assert.match(plan, /Index Only Scan using doc_persons_person_idx/)
    assert.match(plan, /Index Cond: \(person_id = /)
  })
})

describe('analyze maintenance policy (issue #44)', () => {
  before(seed)

  it('refreshes the planner row estimate of every table it targets', async () => {
    // A table that was written but never analyzed carries reltuples = -1: "no estimate yet".
    const before = await Promise.all(ANALYZED_TABLES.map(planRowEstimate))
    assert.ok(before.some((n) => n < 0), 'sanity: the fixture must not analyze on its own')
    const analyzed = await analyzeTables()
    assert.deepEqual([...analyzed], [...ANALYZED_TABLES])
    for (const t of ANALYZED_TABLES) {
      assert.ok((await planRowEstimate(t)) >= 0, `${t} still has no row estimate`)
      assert.ok((await lastAnalyzed(t)) !== null, `${t} was never analyzed`)
    }
  })

  it('analyzes only the tables asked for', async () => {
    const analyzed = await analyzeTables(['doc_persons'])
    assert.deepEqual([...analyzed], ['doc_persons'])
  })

  it('ignores a table name outside the allow list, since a table name cannot be a parameter', async () => {
    const analyzed = await analyzeTables(['persons; drop table docs' as never])
    assert.deepEqual([...analyzed], [])
    assert.ok((await db.query<{ n: number }>(`select count(*)::int as n from docs`)).rows[0].n > 0)
  })

  it('skips the refresh under the threshold and runs it at or above', async () => {
    assert.deepEqual([...(await analyzeAfterWrite(0))], [])
    assert.deepEqual([...(await analyzeAfterWrite(analyzeMinDocs() - 1))], [])
    assert.deepEqual([...(await analyzeAfterWrite(analyzeMinDocs()))], [...ANALYZED_TABLES])
  })
})

describe('ANALYZE_MIN_DOCS clamping (issue #44)', () => {
  const original = process.env.ANALYZE_MIN_DOCS
  after(() => {
    if (original === undefined) delete process.env.ANALYZE_MIN_DOCS
    else process.env.ANALYZE_MIN_DOCS = original
  })

  const withEnv = (v: string | undefined) => {
    if (v === undefined) delete process.env.ANALYZE_MIN_DOCS
    else process.env.ANALYZE_MIN_DOCS = v
    return analyzeMinDocs()
  }

  it('defaults to 200 and falls back to it on garbage', () => {
    assert.equal(withEnv(undefined), 200)
    assert.equal(withEnv('nao-e-numero'), 200)
    assert.equal(withEnv(''), 200)
  })

  it('clamps to the floor and the ceiling', () => {
    assert.equal(withEnv('0'), 1)
    assert.equal(withEnv('-5000'), 1)
    assert.equal(withEnv('99999999'), 1_000_000)
    assert.equal(withEnv('750'), 750)
  })
})

describe('maintenance stays out of the request path (issue #44)', () => {
  const root = new URL('../src/', import.meta.url).pathname
  const owners = ['db.ts', 'ingest.ts', 'reindex.ts', 'bench.ts']

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
    )

  it('no module outside ingest/reindex/bench runs analyze', () => {
    const offenders = sources(root)
      .filter((f) => !owners.includes(f.slice(root.length)))
      .filter((f) => /analyzeTables|analyzeAfterWrite|`\s*analyze\b/i.test(readFileSync(f, 'utf8')))
    assert.deepEqual(offenders, [], 'maintenance must run only in the process that owns DATA_DIR')
  })
})
