import { spawnSync, execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import seedJson from '../../seed.json' with { type: 'json' }
import type { Person } from '../../src/types.js'
import { ALL_CASES, BUILD_CASE, buildResultSql, idsSql, readCases, type Ctx, type Queries } from './cases.js'
import { ANCHOR, GENERATOR_VERSION, SCALES, SEARCH_PATH, runSeed } from './seed.js'
import { median, p95, resultHash, type Cell, type Report } from './stats.js'

const here = fileURLToPath(import.meta.url)
const repo = resolve(dirname(here), '../..')

const { values: args } = parseArgs({
  options: {
    phase: { type: 'string', default: 'main' },
    src: { type: 'string', default: join(repo, 'src') },
    scales: { type: 'string', default: '10k,100k,1m' },
    scale: { type: 'string' },
    windows: { type: 'string', default: '1,7,30,90' },
    runs: { type: 'string', default: '5' },
    cases: { type: 'string', default: ALL_CASES.join(',') },
    root: { type: 'string', default: process.env.BENCH_ROOT ?? join(repo, 'data/bench-harness') },
    seeds: { type: 'string', default: process.env.BENCH_SEEDS },
    work: { type: 'string' },
    out: { type: 'string', default: 'bench.json' },
    explain: { type: 'string' },
    fresh: { type: 'boolean', default: false },
    budget: { type: 'string', default: '120' },
  },
})

const persons = seedJson as Person[]
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const src = resolve(args.src)
const seedsDir = resolve(args.seeds ?? join(args.root, 'seeds'))
const log = (line: string) => process.stderr.write(`${line}\n`)

// Each scale is its own process: db.ts opens DATA_DIR once, at import.
const child = (phase: string, extra: string[]) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', here, '--phase', phase, '--src', src, ...extra], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: '', POSTGRES_URL: '', PERF: '0', PERF_LOG: '0' },
  })
  if (r.status !== 0) throw new Error(`${phase} ${extra.join(' ')} failed (${r.status})`)
}

type DbModule = typeof import('../../src/db.js')

const openDb = async (dataDir: string) => {
  process.env.DATA_DIR = dataDir
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  return (await import(pathToFileURL(join(src, 'db.ts')).href)) as DbModule
}

const seedPhase = async (scale: string, dir: string) => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const mod = await openDb(dir)
  const { nameTokens } = (await import(pathToFileURL(join(src, 'extract.ts')).href)) as typeof import('../../src/extract.js')
  await mod.migrateP()
  log(`seed ${scale}: ${SCALES[scale]} docs into ${dir}`)
  const started = performance.now()
  await runSeed((t, p) => mod.db.query(t, p), SCALES[scale], persons, nameTokens, log)
  await mod.db.exec('vacuum analyze')
  const { rows } = await mod.db.query<Record<string, number>>(
    `select (select count(*) from docs)::int as docs, (select count(*) from doc_persons)::int as doc_persons,
       (select count(*) from doc_terms)::int as doc_terms, pg_database_size(current_database())::float8 as bytes`,
  )
  log(`seed ${scale}: ${JSON.stringify(rows[0])} in ${Math.round((performance.now() - started) / 1000)} s`)
  await mod.db.close()
  await writeFile(join(dir, 'bench-manifest.json'), JSON.stringify({ version: GENERATOR_VERSION, scale, anchor: ANCHOR, ...rows[0] }))
}

const seedReady = async (dir: string) => {
  const file = join(dir, 'bench-manifest.json')
  if (!existsSync(file)) return false
  return JSON.parse(await readFile(file, 'utf8')).version === GENERATOR_VERSION
}

const timed = async <T>(fn: () => Promise<T>) => {
  const started = performance.now()
  const value = await fn()
  return { ms: performance.now() - started, value }
}

const measurePhase = async (scale: string, work: string) => {
  const mod = await openDb(work)
  const { db } = mod
  const graph = (await import(pathToFileURL(join(src, 'graph.ts')).href)) as typeof import('../../src/graph.js')
  const aggregate = (await import(pathToFileURL(join(src, 'aggregate.ts')).href)) as typeof import('../../src/aggregate.js')
  const q: Queries = graph.queries
  const windows = list(args.windows).map(Number)
  const runs = Number(args.runs)
  const wanted = new Set(list(args.cases))

  await db.exec(SEARCH_PATH)
  const { rows: clock } = await db.query<{ now: Date; docs: number }>('select now() as now, (select count(*) from public.docs)::int as docs')
  if (new Date(clock[0].now).toISOString() !== new Date(ANCHOR).toISOString()) throw new Error(`clock not frozen: ${clock[0].now}`)
  if (clock[0].docs !== SCALES[scale]) throw new Error(`expected ${SCALES[scale]} docs, found ${clock[0].docs}`)

  // The tree's own schema: a candidate's new index or table is created here, before any timing.
  const migrated = await timed(() => mod.migrateP())
  await db.exec('analyze')
  log(`${scale}: migrate ${Math.round(migrated.ms)} ms, analyze done`)

  const calibration = []
  for (let i = 0; i < 3; i++) calibration.push((await timed(() => db.query('select sum(g) from generate_series(1, 5000000) g'))).ms)

  const cells: Cell[] = []
  const hashRows = async (texts: string[], params: unknown[]) => {
    const parts = []
    for (const t of texts) parts.push((await db.query(t, params)).rows)
    return { rows: parts.reduce((n, p) => n + p.length, 0), hash: resultHash(parts) }
  }

  // One warm-up, then `runs` samples, fewer when the warm-up says they would overrun the budget;
  // the cell's own samplesMs shows how many were taken.
  const budgetMs = Number(args.budget) * 1000
  const sample = async (fn: () => Promise<unknown>, n: number) => {
    const warm = await timed(fn)
    const k = Math.max(1, Math.min(n, Math.floor(budgetMs / Math.max(warm.ms, 1))))
    const samples = []
    for (let i = 0; i < k; i++) samples.push((await timed(fn)).ms)
    return samples
  }

  // Built even when not measured: graphFast reads it, and its rows are part of the equivalence check.
  const buildOnce = (w: number) => aggregate.buildGraphAggregates(persons, [w])
  for (const w of windows) {
    const samples = wanted.has(BUILD_CASE) ? await sample(() => buildOnce(w), runs) : [(await timed(() => buildOnce(w))).ms]
    const result = await hashRows(buildResultSql, [w])
    cells.push({ scale, case: BUILD_CASE, window: w, medianMs: median(samples), p95Ms: p95(samples), samplesMs: samples, ...result })
    log(`${scale} ${BUILD_CASE} ${w}d: ${median(samples).toFixed(1)} ms (${samples.length} samples)`)
  }
  await db.exec('vacuum analyze graph_scopes')
  await db.exec('vacuum analyze graph_terms')
  await db.exec('vacuum analyze term_communities')

  const person = persons.find((p) => p.id === 'lula')!
  const other = persons.find((p) => p.id === 'bolsonaro')!
  const explainDir = args.explain ? resolve(args.explain, scale) : null
  if (explainDir) await mkdir(explainDir, { recursive: true })

  for (const w of windows) {
    const ids = (await db.query<{ id: string }>(idsSql, [person.id, w])).rows.map((r) => r.id)
    const ctx: Ctx = { person, other, ids, term: 'w1', window: w }
    for (const c of readCases.filter((c) => wanted.has(c.name))) {
      const { text, values } = c.sql(q, ctx)
      const first = await db.query(text, values)
      const samples = await sample(() => db.query(text, values), runs)
      cells.push({ scale, case: c.name, window: w, medianMs: median(samples), p95Ms: p95(samples), samplesMs: samples, rows: first.rows.length, hash: resultHash(first.rows) })
      log(`${scale} ${c.name} ${w}d: ${median(samples).toFixed(2)} ms`)
      if (explainDir) {
        const plan = await db.query<Record<string, string>>(`explain (analyze, buffers) ${text}`, values)
        await writeFile(join(explainDir, `${c.name}.${w}d.txt`), plan.rows.map((r) => r['QUERY PLAN']).join('\n') + '\n')
      }
    }
    if (explainDir && wanted.has(BUILD_CASE)) {
      const { rows } = await db.query<{ id: string }>(smallestPersonSql, [w])
      const smallest = persons.find((p) => p.id === rows[0]?.id) ?? person
      await explainBuild(mod, aggregate, w, [person, smallest], join(explainDir, `${BUILD_CASE}.${w}d.txt`))
    }
  }

  await db.close()
  return { cells, calibrationMs: median(calibration) }
}

// The tracked person with the fewest docs in the window: the build's per-person plans differ most there.
const smallestPersonSql = `
  select p.id from persons p
  left join doc_persons dp on dp.person_id = p.id
  left join docs d on d.id = dp.doc_id and d.published_at >= now() - make_interval(days => $1::int)
  group by p.id order by count(d.id), p.id limit 1`

// Plans of the build's heavy statements for the largest and the smallest person, inside a transaction that is rolled back.
const explainBuild = async (mod: DbModule, aggregate: typeof import('../../src/aggregate.js'), w: number, who: Person[], file: string) => {
  const sections: string[] = []
  const rollback = new Error('rollback')
  const explain = async (label: string, s: { text: string; values: unknown[] }) => {
    const { rows } = await mod.db.query<Record<string, string>>(`explain (analyze, buffers) ${s.text}`, s.values)
    sections.push(`-- ${label}\n${rows.map((r) => r['QUERY PLAN']).join('\n')}`)
  }
  try {
    await mod.runInTransaction(async () => {
      const [delTerms, delScopes, universe, key, scopes] = aggregate.queries.window(w, persons)
      for (const s of [delTerms, delScopes]) await mod.db.query(s.text, s.values)
      await explain('universe', universe)
      await mod.db.query(key.text, key.values)
      await explain('scopes', scopes)
      for (const p of who) {
        await explain(`personTerms ${p.id}`, aggregate.queries.personTerms(w, p))
        await explain(`communityEdges all ${p.id}`, aggregate.queries.communityEdges(w, 'all', p.id))
      }
      throw rollback
    })
  } catch (e) {
    if (e !== rollback) sections.push(`-- EXPLAIN failed: ${(e as Error).message}`)
  }
  await writeFile(file, sections.join('\n\n') + '\n')
}

const revOf = (dir: string) => {
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  try {
    return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--', '.') ? '+dirty' : ''}`
  } catch {
    return 'unknown'
  }
}

const main = async () => {
  const scales = list(args.scales)
  for (const s of scales) if (!SCALES[s]) throw new Error(`unknown scale ${s}; one of ${Object.keys(SCALES).join(', ')}`)
  const report: Report = {
    meta: {
      src,
      rev: revOf(src),
      node: process.version,
      cpu: `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
      anchor: ANCHOR,
      runs: Number(args.runs),
      windows: list(args.windows).map(Number),
      scales,
      calibrationMs: 0,
      startedAt: new Date().toISOString(),
    },
    cells: [],
  }
  const calibrations = []
  for (const scale of scales) {
    const seed = join(seedsDir, scale)
    if (args.fresh || !(await seedReady(seed))) child('seed', ['--scale', scale, '--work', seed])
    const work = join(resolve(args.root), 'work', `${scale}-${process.pid}`)
    await rm(work, { recursive: true, force: true })
    await cp(seed, work, { recursive: true })
    const partial = `${work}.json`
    try {
      child('measure', ['--scale', scale, '--work', work, '--out', partial, '--windows', args.windows, '--runs', args.runs, '--cases', args.cases, '--budget', args.budget, ...(args.explain ? ['--explain', resolve(args.explain)] : [])])
      const { cells, calibrationMs } = JSON.parse(await readFile(partial, 'utf8'))
      report.cells.push(...cells)
      calibrations.push(calibrationMs)
    } finally {
      await rm(work, { recursive: true, force: true })
      await rm(partial, { force: true })
    }
  }
  report.meta.calibrationMs = median(calibrations)
  await writeFile(args.out, JSON.stringify(report, null, 2) + '\n')
  log(`written ${args.out}`)
}

if (args.phase === 'seed') await seedPhase(args.scale!, resolve(args.work!))
else if (args.phase === 'measure') await writeFile(args.out, JSON.stringify(await measurePhase(args.scale!, resolve(args.work!))))
else await main()
