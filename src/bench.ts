import { spawnSync } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import seedJson from '../seed.json' with { type: 'json' }
import { corpus } from './bench-corpus.js'
import { atlasScenarios, scenarios } from './bench-scenarios.js'
import type { Sql } from './sql.js'
import type { Person } from './types.js'

// The benchmark owns its own database. Never point it at ./data/pg: PGlite allows one process
// per directory and a second opener corrupts it, so the default is a throwaway sibling.
const DATA_DIR = process.env.BENCH_DATA_DIR ?? './data/bench'
if (/(^|\/)data\/pg\/?$/.test(DATA_DIR)) throw new Error('refusing to benchmark against the live ./data/pg directory')

const DOCS = Number(process.env.BENCH_DOCS ?? 20000)
const DAYS = Number(process.env.BENCH_DAYS ?? 120)
const SEED = Number(process.env.BENCH_SEED ?? 20260908)
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 30)
const PERSON = process.env.BENCH_PERSON ?? 'lula'
const TERM = process.env.BENCH_TERM ?? 'reforma'
const OUT = process.env.BENCH_OUT ?? 'docs/perf-baseline.md'
const phase = process.env.BENCH_PHASE ?? 'all'

process.env.DATA_DIR = DATA_DIR
// Counters and x-perf-* headers on, per-request log line off: the report is the output here.
// `PERF=0 pnpm bench` measures the same scenarios with the instrumentation disabled, which
// is how the overhead of the instrumentation itself is checked (sql/db columns read 0 then).
process.env.PERF ??= '1'
process.env.PERF_LOG = '0'

// Imported after the env assignments above, not with the static imports: src/perf.ts reads
// PERF once at import time, and a static import would have run before this file's body.
const { percentile, round } = await import('./perf.js')

const persons = seedJson as Person[]
const here = fileURLToPath(import.meta.url)

// Generation runs in its own process so the measuring process opens a database nobody has
// touched: that is what makes the "cold" column mean anything.
const generateInChild = () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', here], {
    env: { ...process.env, BENCH_PHASE: 'generate' },
    stdio: 'inherit',
  })
  if (child.status !== 0) throw new Error(`dataset generation failed (${child.status})`)
}

const generate = async () => {
  // PGlite creates the leaf directory but not its parents.
  await mkdir(resolve(DATA_DIR), { recursive: true })
  const { db, migrate } = await import('./db.js')
  const { insertDoc, upsertPersons } = await import('./store.js')
  await migrate()
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs`)
  if (rows[0].n === DOCS && process.env.BENCH_RESET !== '1') {
    console.log(`dataset: reusing ${rows[0].n} docs in ${DATA_DIR}`)
    await db.close()
    return
  }
  console.log(`dataset: generating ${DOCS} docs into ${DATA_DIR}`)
  const started = performance.now()
  await db.exec(`delete from doc_testimony; delete from doc_candidates; delete from doc_terms; delete from doc_persons; delete from docs; delete from persons;`)
  await upsertPersons(persons)
  const docs = corpus(persons, { docs: DOCS, days: DAYS, seed: SEED, now: Date.now() })
  for (const doc of docs) await insertDoc(doc, persons)
  // One testimony row per (doc, person) pair, deterministic, so the testimony route has
  // something to aggregate. `stub` is the hermetic scorer's label.
  await db.query(
    `insert into doc_testimony (doc_id, person_id, method, score)
     select doc_id, person_id, 'stub', round((((doc_id * 37 + length(person_id) * 11) % 200) - 100) / 10.0, 2)
     from doc_persons`,
  )
  await db.exec(`analyze`)
  console.log(`dataset: built in ${Math.round((performance.now() - started) / 1000)}s`)
  await db.close()
}

type Row = { scenario: string; route: string; cold: number; p50: number; p95: number; sql: number; dbMs: number; bytes: number; status: number }

const request = async (app: { request: (url: string) => Promise<Response> | Response }, url: string) => {
  const started = performance.now()
  const res = await app.request(url)
  const body = await res.text()
  return {
    ms: performance.now() - started,
    status: res.status,
    sql: Number(res.headers.get('x-perf-sql-count') ?? 0),
    dbMs: Number(res.headers.get('x-perf-db-ms') ?? 0),
    bytes: body.length,
  }
}

const table = (header: string[], rows: string[][]) =>
  [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

const measurePhase = async () => {
  const { db } = await import('./db.js')
  const { queries } = await import('./graph.js')

  // First statement on a freshly opened directory: PGlite's wasm boot and page-cache warm-up.
  const openedAt = performance.now()
  await db.query(`select 1`)
  const startupMs = performance.now() - openedAt

  const { app } = await import('./server.js')

  const cold = new Map<string, Awaited<ReturnType<typeof request>>>()
  for (const s of scenarios) cold.set(s.name, await request(app, s.url(PERSON, TERM)))

  const rows: Row[] = []
  for (const s of scenarios) {
    const url = s.url(PERSON, TERM)
    const samples: number[] = []
    let last = cold.get(s.name)!
    for (let i = 0; i < ITERATIONS; i++) {
      last = await request(app, url)
      samples.push(last.ms)
    }
    rows.push({
      scenario: s.name,
      route: s.route,
      cold: cold.get(s.name)!.ms,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      sql: last.sql,
      dbMs: last.dbMs,
      bytes: last.bytes,
      status: last.status,
    })
  }

  const atlas = rows.filter((r) => atlasScenarios.includes(r.scenario))
  const atlasSql = atlas.reduce((a, r) => a + r.sql, 0)
  const atlasP50 = atlas.reduce((a, r) => a + r.p50, 0)

  const stats = (
    await db.query<{ name: string; rows: number; bytes: number }>(`
      select 'docs' as name, count(*)::int as rows, pg_total_relation_size('docs')::int as bytes from docs
      union all select 'doc_terms', count(*)::int, pg_total_relation_size('doc_terms')::int from doc_terms
      union all select 'doc_persons', count(*)::int, pg_total_relation_size('doc_persons')::int from doc_persons
      union all select 'doc_candidates', count(*)::int, pg_total_relation_size('doc_candidates')::int from doc_candidates
      union all select 'doc_testimony', count(*)::int, pg_total_relation_size('doc_testimony')::int from doc_testimony
      union all select 'persons', count(*)::int, pg_total_relation_size('persons')::int from persons
      order by 3 desc`)
  ).rows
  const dbBytes = (await db.query<{ bytes: number }>(`select pg_database_size(current_database())::int as bytes`)).rows[0].bytes

  const person = persons.find((p) => p.id === PERSON)!
  const ids = (
    await db.query<{ id: string }>(
      `select kind || ':' || term as id from doc_terms t join doc_persons p on p.doc_id = t.doc_id
       where p.person_id = $1 group by 1 order by count(*) desc limit 40`,
      [PERSON],
    )
  ).rows.map((r) => r.id)

  const scope = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all' }
  const docs = { ...scope, term: TERM, kind: 'word', limit: 50, offset: 0, day: '' }
  const plans: [string, Sql][] = [
    ['graph', queries.graph(person, { ...scope, min: 2, sort: 'count', limit: 40 })],
    ['links', queries.links(person, scope, ids)],
    ['sources', queries.sources(person, scope)],
    ['docs', queries.docs(person, docs)],
    ['docsCount', queries.docsCount(person, docs)],
    ['timeline', queries.timeline(person, { ...docs, days: 90, bucket: 'day' })],
    ['week', queries.week(person, { ...scope, days: 7, limit: 8 })],
    ['rising', queries.rising(person, { ...scope, days: 7, baseline: 30, min: 3, limit: 20 })],
    ['tone', queries.tone({ days: 30, min: 3 })],
    ['testimonySummary', queries.testimonySummary(person, { days: 30, source: 'all', method: 'stub', min: 3 })],
    ['candidates', queries.candidates({ days: 7, min: 5, limit: 50 })],
  ]

  const explained: [string, string][] = []
  for (const [name, { text, values }] of plans) {
    try {
      const { rows } = await db.query<Record<string, string>>(`explain (analyze, buffers, verbose false) ${text}`, values)
      explained.push([name, rows.map((r) => r['QUERY PLAN']).join('\n')])
    } catch (e) {
      explained.push([name, `EXPLAIN unavailable: ${(e as Error).message}`])
    }
  }

  const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`
  const report = [
    '# Performance baseline',
    '',
    `Generated by \`pnpm bench\` on ${new Date().toISOString()}. Reproduce with the steps in README, "Performance baseline".`,
    '',
    '**The dataset is synthetic.** It is generated by `src/bench-corpus.ts` from a fixed seed into its own',
    '`DATA_DIR` and resembles the production corpus in shape (source mix, recency skew, ~1/3 of docs naming a',
    'tracked person, a Zipf vocabulary), not in content. No production database is opened, copied or read.',
    'Numbers below are API latency and database work only; browser rendering is out of scope.',
    '',
    '## Environment',
    '',
    table(
      ['key', 'value'],
      [
        ['node', process.version],
        ['platform', `${process.platform} ${process.arch}`],
        ['cpu', `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`],
        ['memory', mb(totalmem())],
        ['data dir', DATA_DIR],
        ['docs / days / seed', `${DOCS} / ${DAYS} / ${SEED}`],
        ['iterations per scenario', String(ITERATIONS)],
        ['person / term', `${PERSON} / ${TERM}`],
        ['pglite open + first statement', `${round(startupMs)} ms`],
      ],
    ),
    '',
    '## Dataset',
    '',
    table(
      ['table', 'rows', 'total size'],
      stats.map((s) => [s.name, String(s.rows), mb(s.bytes)]),
    ),
    '',
    `Database size: ${mb(dbBytes)}.`,
    '',
    '## Latency',
    '',
    'Cold is the first call of that scenario in a process that just opened the database (generation ran in a',
    'separate process); p50/p95 are the nearest-rank percentiles over the warm iterations that follow. The',
    'operating system page cache is not dropped, so the row above (`pglite open + first statement`) is the',
    'honest process-level cold cost; the cold column only shows what a first call adds on top of it.',
    '',
    '`sql` counts statements sent to PGlite for that request, `db` is the time awaited on them summed across',
    'statements: routes that fan out with `Promise.all` (graph, docs, tone, testimony) can report more `db`',
    'time than wall time, and the gap is exactly the concurrency. `bytes` is the response body length.',
    '',
    table(
      ['scenario', 'route', 'cold ms', 'p50 ms', 'p95 ms', 'sql', 'db ms', 'bytes', 'status'],
      rows.map((r) => [
        r.scenario,
        r.route,
        String(round(r.cold)),
        String(round(r.p50)),
        String(round(r.p95)),
        String(r.sql),
        String(round(r.dbMs)),
        String(r.bytes),
        String(r.status),
      ]),
    ),
    '',
    `One atlas load (${atlasScenarios.join(', ')}): **${atlasSql} SQL statements**, ${round(atlasP50)} ms of warm p50 summed.`,
    '',
    'Run `PERF=0 pnpm bench` on the same dataset to measure the same scenarios with the instrumentation',
    'disabled, which is what the server runs by default.',
    '',
    '## Plans',
    '',
    'EXPLAIN (ANALYZE, BUFFERS) on the statements the routes run, with the same parameters.',
    '',
    ...explained.flatMap(([name, plan]) => [`### ${name}`, '', '```', plan, '```', '']),
  ].join('\n')

  await mkdir(dirname(resolve(OUT)), { recursive: true })
  await writeFile(OUT, `${report}\n`)
  console.log(report)
  console.log(`\nwritten to ${OUT}`)
  await db.close()
}

if (phase === 'generate') await generate()
else {
  generateInChild()
  await measurePhase()
}
