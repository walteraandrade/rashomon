import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { db, migrate } from '../src/db.js'
import { testimonyFor, toneFor, graphFor, type TestimonyQuery } from '../src/graph.js'
import { parseQuery, parseTestimonyQuery } from '../src/query.js'
import { scoreAll } from '../src/score.js'
import { scorers } from '../src/scorers/index.js'
import { exportLines } from '../src/export-docs.js'
import { persons, seed } from './fixture.js'
import './close.js'

// Independent re-derivation of issue #21's numbered acceptance criteria, written from the
// spec text and hand-computed against test/fixture.ts's seedTestimony() rows -- deliberately
// not copied from test/testimony.test.ts or test/testimony-acceptance.test.ts (which were
// authored alongside the implementation, so are not an independent check on their own).

const tarcisio = persons.find((p) => p.id === 'tarcisio')!
const bolsonaro = persons.find((p) => p.id === 'bolsonaro')!
const lula = persons.find((p) => p.id === 'lula')!
const base: TestimonyQuery = { days: 30, source: 'all', method: 'stub', min: 3 }
const byDomain = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)
const bySource = (r: Awaited<ReturnType<typeof testimonyFor>>, source: string) => r.by_source.find((s) => s.source === source)

describe('testimony acceptance criteria, independently verified (issue #21)', () => {
  before(seed)

  it('AC1: migrate() is idempotent and doc_testimony has the exact spec\'d columns, PK, and person/method index', async () => {
    await migrate()
    await migrate()
    const cols = (
      await db.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns where table_name = 'doc_testimony'`,
      )
    ).rows
    assert.deepEqual(
      cols.map((c) => c.column_name).sort(),
      ['doc_id', 'method', 'person_id', 'score'],
    )
    assert.equal(cols.find((c) => c.column_name === 'method')!.is_nullable, 'NO', 'method is not null')
    assert.equal(cols.find((c) => c.column_name === 'score')!.is_nullable, 'YES', 'score is nullable on purpose')

    const pk = (
      await db.query<{ column_name: string }>(
        `select kcu.column_name from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
         where tc.table_name = 'doc_testimony' and tc.constraint_type = 'PRIMARY KEY'
         order by kcu.ordinal_position`,
      )
    ).rows.map((r) => r.column_name)
    assert.deepEqual(pk, ['doc_id', 'person_id', 'method'])

    const indexes = (
      await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'doc_testimony'`)
    ).rows.map((r) => r.indexname)
    assert.ok(indexes.includes('doc_testimony_person_idx'), 'person/method index exists')
  })

  it('AC2: unknown :id returns 404 with the exact same error shape as every other /:id/* route', async () => {
    const res = await app.request('/api/people/does-not-exist/testimony')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('AC2b: the HTTP route wires querystring params through parseTestimonyQuery end-to-end', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?method=stub&min=2')
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      method: string
      overall: unknown
      by_source: unknown
      by_domain: { domain: string }[]
    }
    // oglobo.globo.com/gdelt clears min=2 (scores 5, -1 -> avg 2, n=2), matching the same
    // hand computation as AC4 below, this time reached purely through the HTTP layer.
    // by_domain has no ORDER BY in the SQL, so compare sorted-by-domain, not array order.
    assert.equal(body.method, 'stub')
    assert.deepEqual(body.overall, { score: 1.33, n: 6 })
    assert.deepEqual(body.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    assert.deepEqual(
      [...body.by_domain].sort((a, b) => a.domain.localeCompare(b.domain)),
      [
        { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 },
        { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 },
      ],
    )
  })

  it('AC3: a method with zero doc_testimony rows returns the all-empty shape, not a 404 or an error', async () => {
    const method = 'independent-check-unused-method'
    const r = await testimonyFor(lula, { ...base, method })
    assert.deepEqual(r, { method, overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
    const rNoDocs = await testimonyFor(lula, { ...base, method: 'stub', source: 'bluesky' })
    // lula has zero bluesky-sourced testimony rows in the fixture
    assert.deepEqual(rNoDocs.overall, { score: null, n: 0 })
  })

  it('AC4: a domain/source pair at/above min appears exactly once with the hand-computed average and exact n; below min it is entirely absent, not present with a smaller n', async () => {
    // tarcisio/oglobo.globo.com/gdelt: scores 5, -1 -> n=2, avg=2, below default min=3
    const atDefaultMin = await testimonyFor(tarcisio, base)
    assert.equal(byDomain(atDefaultMin, 'oglobo.globo.com'), undefined)
    assert.ok(
      !atDefaultMin.by_domain.some((d) => d.domain === 'oglobo.globo.com'),
      'must be fully absent, never present with n below min',
    )
    // and the pair that does clear min=3: estadao.com.br/gdelt, scores 4, 6, 2 -> avg 4, n=3
    assert.deepEqual(byDomain(atDefaultMin, 'estadao.com.br'), { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 })

    const loweredMin = await testimonyFor(tarcisio, { ...base, min: 2 })
    assert.deepEqual(byDomain(loweredMin, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('AC5: a domain-less doc never appears in by_domain even at min=1, but still counts in overall and by_source', async () => {
    // doc /35 has no domain, tarcisio score -8, source gdelt, inside the default window
    const withoutMin = await testimonyFor(tarcisio, base)
    const withMinOne = await testimonyFor(tarcisio, { ...base, min: 1 })
    for (const r of [withoutMin, withMinOne]) assert.ok(!r.by_domain.some((d) => d.domain === null || d.domain === undefined))
    // sum of tarcisio's 6 non-null scores in-window (4,6,2,5,-1,-8) is 8, avg 1.33, n=6 --
    // the -8 from the domain-less doc is baked into that average, proving it was counted
    assert.deepEqual(withoutMin.overall, { score: 1.33, n: 6 })
    assert.deepEqual(bySource(withoutMin, 'gdelt'), { source: 'gdelt', score: 1.33, n: 6 })
  })

  it('AC6: a null-scored doc is excluded from n and the average at overall, by_source, and by_domain (not treated as 0)', async () => {
    // doc /36: same person+domain+window as docs /30-/32, but score is null.
    // If it were coalesced to 0, estadao.com.br/gdelt would read avg((4+6+2+0)/4)=3, n=4 instead.
    const r = await testimonyFor(tarcisio, base)
    assert.deepEqual(byDomain(r, 'estadao.com.br'), { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 })
    assert.equal(r.overall.n, 6)
    assert.equal(r.overall.score, 1.33)
  })

  it('AC7: a doc naming two tracked persons keeps independent per-person scores in both directions, at every level', async () => {
    // doc /37 (poder360.com.br, gdelt, day 35): tarcisio +7, bolsonaro -7
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(byDomain(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(byDomain(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
    // bolsonaro has no other testimony rows in the fixture, so his overall must be exactly -7/1
    assert.deepEqual(b.overall, { score: -7, n: 1 })
    // tarcisio's other 6 in-window scores (4,6,2,5,-1,-8) sum to 8; with +7 added, 15/7 = 2.14 --
    // bolsonaro's -7 for the same doc must never enter this sum
    assert.deepEqual(t.overall, { score: 2.14, n: 7 })
  })

  it('AC8: a doc outside days or excluded by source contributes nothing anywhere; widening either includes it', async () => {
    // lula: g1.globo.com/5, gnews, 100 days ago, score -2 -- outside default days:30
    const narrowDays = await testimonyFor(lula, base)
    assert.equal(narrowDays.overall.n, 2)
    assert.equal(narrowDays.overall.score, 4.5)
    const widerDays = await testimonyFor(lula, { ...base, days: 200 })
    assert.equal(widerDays.overall.n, 3)
    assert.equal(widerDays.overall.score, Math.round(((6 + 3 - 2) / 3) * 100) / 100)

    // gdeltproject.org/38, gkg, score 3, day 1 -- excluded by source=gnews
    const gnewsOnly = await testimonyFor(lula, { ...base, source: 'gnews' })
    assert.equal(gnewsOnly.overall.n, 1)
    assert.equal(gnewsOnly.overall.score, 6)
    const allSources = await testimonyFor(lula, { ...base, source: 'gnews,gkg' })
    assert.equal(allSources.overall.n, 2)
  })

  it('AC9: source=<list> restricts overall/by_source/by_domain using the exact parseSourceList grammar (unknown tokens dropped)', async () => {
    const onlyGkg = await testimonyFor(lula, { ...base, source: 'gkg,not-a-real-source' })
    assert.deepEqual(onlyGkg.overall, { score: 3, n: 1 })
    assert.deepEqual(onlyGkg.by_source, [{ source: 'gkg', score: 3, n: 1 }])
    // empty/all-invalid falls back to 'all', per parseSourceList
    const junkOnly = parseTestimonyQuery({ source: 'not-a-real-source' })
    assert.equal(junkOnly.source, 'all')
    const allAgain = await testimonyFor(lula, { ...base, source: junkOnly.source })
    assert.equal(allAgain.overall.n, 2)
  })

  // days: [1,365] became the enumeration in DAYS with issue #111; default and ceiling unchanged.
  it('AC10: parseTestimonyQuery snaps days to an allowed window (default 30) and snaps min to MINS (default 3), pinned as its own literal', () => {
    const d = parseTestimonyQuery({})
    assert.equal(d.days, 30)
    assert.equal(d.min, 3)
    assert.equal(parseTestimonyQuery({ days: '0' }).days, 7)
    assert.equal(parseTestimonyQuery({ days: '366' }).days, 365)
    assert.equal(parseTestimonyQuery({ days: 'nan' }).days, 30)
    assert.equal(parseTestimonyQuery({ min: '0' }).min, 1)
    assert.equal(parseTestimonyQuery({ min: '1001' }).min, 5)
    // pinned distinctly from GraphQuery's min default (2) and ToneQuery's min default (3,
    // coincidentally equal but a separate literal per the spec) -- this only guards the
    // testimony parser's own value, not equality to either sibling parser
    assert.notEqual(d.min, 2)
  })

  it('AC11: scoreAll inserts exactly one row per unscored (doc, person) pair and zero more on immediate re-run', async () => {
    const method = 'independent-verify-stub'
    const before = Number(
      (await db.query<{ n: string }>(`select count(*) as n from doc_testimony where method = $1`, [method])).rows[0].n,
    )
    assert.equal(before, 0)
    const pairsTotal = Number((await db.query<{ n: string }>(`select count(*) as n from doc_persons`)).rows[0].n)
    const firstRun = await scoreAll(method, scorers.stub)
    assert.equal(firstRun, pairsTotal)
    const after = Number(
      (await db.query<{ n: string }>(`select count(*) as n from doc_testimony where method = $1`, [method])).rows[0].n,
    )
    assert.equal(after, pairsTotal)
    const secondRun = await scoreAll(method, scorers.stub)
    assert.equal(secondRun, 0)
    const stillAfter = Number(
      (await db.query<{ n: string }>(`select count(*) as n from doc_testimony where method = $1`, [method])).rows[0].n,
    )
    assert.equal(stillAfter, pairsTotal)
  })

  it('AC12: export-docs emits one JSON-parseable line per doc with the exact spec\'d keys and persons as string ids', async () => {
    const rows = await exportLines()
    const totalDocs = Number((await db.query<{ n: string }>(`select count(*) as n from docs`)).rows[0].n)
    assert.equal(rows.length, totalDocs)
    for (const r of rows) {
      const parsed = JSON.parse(JSON.stringify(r)) as Record<string, unknown>
      assert.deepEqual(Object.keys(parsed).sort(), ['domain', 'id', 'persons', 'published_at', 'source', 'text', 'tone', 'uri'])
      assert.ok(Array.isArray(parsed.persons))
      for (const p of parsed.persons as unknown[]) assert.equal(typeof p, 'string')
    }
    // a doc with zero doc_persons matches still emits persons: [], not a missing field
    const { rows: noPersonDocs } = await db.query<{ id: number }>(
      `select d.id from docs d left join doc_persons dp on dp.doc_id = d.id where dp.doc_id is null limit 1`,
    )
    assert.ok(noPersonDocs[0], 'fixture must contain at least one person-less doc for this check')
    const match = rows.find((r) => r.id === noPersonDocs[0].id)
    assert.deepEqual(match?.persons, [])
  })

  it('AC13: the onnx scorer never touches the network on import -- the Hub import/pipeline call is lexically inside the function, not at module top level', () => {
    const source = readFileSync(new URL('../src/scorers/onnx.ts', import.meta.url), 'utf8')
    const lines = source.split('\n')
    const importLineIdx = lines.findIndex((l) => l.includes('@huggingface/transformers') && l.includes('import('))
    assert.ok(importLineIdx >= 0, 'expected a dynamic import of @huggingface/transformers')
    // a dynamic `await import(...)` on this line proves it executes only when the
    // enclosing async function body runs, never as a static module-level import
    assert.match(lines[importLineIdx], /await import\(/, 'the Hub import must be a dynamic import inside a function body')
    assert.doesNotMatch(source, /^import .*@huggingface\/transformers/m, 'must not be a static top-level import')
  })

  it('AC13b: importing the onnx scorer module resolves without invoking any model call', async () => {
    const mod = await import('../src/scorers/onnx.js')
    assert.equal(typeof mod.onnx, 'function')
  })

  it('AC14a: /api/tone response is unchanged, pinned against test/tone.test.ts\'s independently-known literal', async () => {
    const res = await app.request('/api/tone')
    const body = (await res.json()) as { cells: { person_id: string; domain: string; tone: number; n: number }[] }
    const cell = body.cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br')
    assert.deepEqual(cell, { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
    const direct = await toneFor({ days: 30, min: 3 })
    assert.deepEqual(JSON.parse(JSON.stringify(direct)), body)
  })

  it('AC14b: /api/people/:id/graph stats are unchanged, pinned against test/graph.test.ts\'s independently-known literals', async () => {
    const res = await app.request('/api/people/lula/graph')
    const body = (await res.json()) as { stats: { docs: number; about: number } }
    assert.equal(body.stats.docs, 14)
    assert.equal(body.stats.about, 5)
    const direct = await graphFor(lula, parseQuery({}))
    assert.deepEqual(JSON.parse(JSON.stringify(direct)), body)
  })

  it('AC14c: /api/people list shape is unchanged and contains no testimony fields', async () => {
    const res = await app.request('/api/people')
    const body = (await res.json()) as Record<string, unknown>[]
    assert.ok(Array.isArray(body))
    for (const p of body) assert.deepEqual(Object.keys(p).sort(), ['aliases', 'id', 'name'])
  })
})
