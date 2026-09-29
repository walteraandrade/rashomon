import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { before, describe, it } from 'node:test'
import seedJson from '../seed.json' with { type: 'json' }
import { idsFor, readCases } from '../scripts/bench/cases.js'
import { ANCHOR, runSeed } from '../scripts/bench/seed.js'
import { compare, median, p95, resultHash, table, type Report, type Verdict } from '../scripts/bench/stats.js'
import { db, migrateP } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import { queries } from '../src/graph.js'
import type { Person } from '../src/types.js'
import './close.js'

const pexec = promisify(execFile)

const report = (cells: [string, number, number, string][]): Report => ({
  meta: { src: '', rev: '', node: '', cpu: '', anchor: ANCHOR, runs: 5, windows: [], scales: [], calibrationMs: 1, startedAt: '' },
  cells: cells.map(([c, window, ms, hash]) => ({ scale: '10k', case: c, window, medianMs: ms, p95Ms: ms, samplesMs: [ms], rows: 1, hash })),
})

describe('bench harness stats', () => {
  it('median and nearest-rank p95', () => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(p95([1, 2, 3, 4, 5]), 5)
  })

  it('hash ignores float noise and key order, keeps row order', () => {
    assert.equal(resultHash([{ a: 0.1 + 0.2, b: 1 }]), resultHash([{ b: 1, a: 0.3 }]))
    assert.notEqual(resultHash([{ a: 1 }, { a: 2 }]), resultHash([{ a: 2 }, { a: 1 }]))
    assert.notEqual(resultHash([{ a: 0.3 }]), resultHash([{ a: 0.31 }]))
  })

  it('keeps a candidate whose rows match regardless of speed', () => {
    const base = report([['graph', 7, 100, 'x'], ['graph', 30, 200, 'y'], ['docs', 7, 10, 'z']])
    const r = compare(base, report([['graph', 7, 300, 'x'], ['graph', 30, 600, 'y'], ['docs', 7, 30, 'z']]), ['graph'])
    assert.equal(r.kept, true)
    assert.equal('slow' in r, false)
    assert.equal('fast' in r.verdicts[0], false)
    assert.ok(r.verdicts.every((v) => Number.isFinite(v.ratio)))
  })

  it('rejects on diverged rows, missing targeted cells, no targets, strict missing', () => {
    const base = report([['graph', 7, 100, 'x'], ['graph', 30, 200, 'y'], ['docs', 7, 10, 'z']])
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y'], ['docs', 7, 10, 'other']]), ['graph']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['docs', 7, 10, 'z']]), ['graph']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y']]), ['graph']).kept, true)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y'], ['docs', 7, 10, 'z']]), ['nothing']).kept, false)
    assert.equal(compare(base, report([['graph', 7, 50, 'x'], ['graph', 30, 50, 'y']]), ['graph'], true).kept, false)
  })

  it('a timed-out side is never diffed', () => {
    const base = report([['aggregate', 30, 600000, 'timeout'], ['graphFast', 30, 5, 'empty']])
    base.cells[0].timedOut = true
    const r = compare(base, report([['aggregate', 30, 9000, 'rows'], ['graphFast', 30, 4, 'full']]), ['aggregate'])
    assert.equal(r.kept, true)
    assert.equal(r.unverified.length, 2)
    assert.equal(r.diverged.length, 0)
  })

  it('the verdict has no speed field and compare takes no gain', () => {
    const v = {} as Verdict
    // @ts-expect-error Verdict.fast was removed
    void v.fast
    const base = report([['graph', 7, 100, 'x']])
    // @ts-expect-error the gain parameter was removed
    assert.equal(compare(base, base, ['graph'], 0.2).kept, true)
  })

  it('table keeps the ratio column', () => {
    const r = compare(report([['graph', 7, 100, 'x']]), report([['graph', 7, 300, 'x']]), ['graph'])
    const out = table(r.verdicts)
    assert.match(out, /\| new \/ base \|/)
    assert.match(out, /\| 3\.00 \|/)
  })

  it('compare.ts exits 0 on identical hashes and a slower candidate, with no percentage in the verdict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'compare-'))
    const write = async (name: string, ms: number) => {
      const path = join(dir, name)
      await writeFile(path, JSON.stringify(report([['graph', 7, ms, 'x'], ['graph', 30, ms * 2, 'y']])))
      return path
    }
    try {
      const { stdout } = await pexec(process.execPath, ['--import', 'tsx', 'scripts/bench/compare.ts', await write('base.json', 100), await write('cand.json', 300), '--cases', 'graph'])
      const verdict = stdout.split('\n').find((l) => l.startsWith('verdict:'))!
      assert.match(verdict, /^verdict: KEEP \(0 diverged, 0 unverifiable, 0 missing\)$/)
      assert.doesNotMatch(verdict, /%/)
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

describe('bench harness seed and cases', () => {
  const seedStatementTexts: string[] = []
  before(async () => {
    await migrateP()
    await runSeed((t, p) => (seedStatementTexts.push(t), db.query(t, p)), 400, seedJson as Person[], nameTokens, () => {})
    await migrateP()
  })

  it('bench seed leaves doc_tone to migrate', async () => {
    assert.equal(seedStatementTexts.filter((t) => /insert into doc_tone/i.test(t)).length, 0)
    const norm = (rows: { doc_id?: number; id?: number; tone: number }[]) => rows.map((r) => [r.doc_id ?? r.id, r.tone])
    const mirror = (await db.query<{ doc_id: number; tone: number }>(`select doc_id, tone from doc_tone order by doc_id`)).rows
    const toned = (await db.query<{ id: number; tone: number }>(`select id, tone from docs where tone is not null order by id`)).rows
    assert.ok(toned.length > 0)
    assert.deepEqual(norm(mirror), norm(toned))
  })

  it('freezes the clock at the anchor', async () => {
    const { rows } = await db.query<{ now: Date }>('select now() as now')
    assert.equal(new Date(rows[0].now).toISOString(), new Date(ANCHOR).toISOString())
  })

  it('is deterministic', async () => {
    const { rows } = await db.query<{ h: string }>(
      `select md5(string_agg(id || source || extract(epoch from published_at)::text || coalesce(domain, ''), ',' order by id)) as h from docs`,
    )
    assert.equal(rows[0].h, 'b5e96683d366ecfcdc071cbc5a4375ed')
  })

  it('every read case runs against the tree and the window has documents', async () => {
    const [person, other] = [(seedJson as Person[])[0], (seedJson as Person[])[20]]
    const ids = await idsFor((t, p) => db.query(t, p), person.id, 90)
    assert.ok(ids.length > 0)
    for (const c of readCases) {
      const { text, values } = c.sql(queries, { person, other, ids, term: 'w1', window: 90 })
      await assert.doesNotReject(db.query(text, values), c.name)
    }
    const sources = readCases.find((c) => c.name === 'sources')!.sql(queries, { person, other, ids, term: 'w1', window: 90 })
    assert.ok((await db.query(sources.text, sources.values)).rows.length > 0)
  })
})
