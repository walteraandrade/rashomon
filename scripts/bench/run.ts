import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    timeout: { type: 'string', default: '600' },
    progress: { type: 'string' },
    skip: { type: 'string', default: '' },
    dead: { type: 'string', default: '' },
    cpu: { type: 'string', default: process.env.BENCH_CPU ?? '' },
  },
})

const persons = seedJson as Person[]
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const src = resolve(args.src)
const seedsDir = resolve(args.seeds ?? join(args.root, 'seeds'))
const log = (line: string) => process.stderr.write(`${line}\n`)
const cellKey = (c: string, w: number) => `${c}|${w}`
const childEnv = { ...process.env, DATABASE_URL: '', POSTGRES_URL: '', PERF: '0', PERF_LOG: '0' }

type DbModule = typeof import('../../src/db.js')

const openDb = async (dataDir: string) => {
  process.env.DATA_DIR = dataDir
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  return (await import(pathToFileURL(join(src, 'db.ts')).href)) as DbModule
}

const timed = async <T>(fn: () => Promise<T>) => {
  const started = performance.now()
  const value = await fn()
  return { ms: performance.now() - started, value }
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

// The tracked person with the fewest docs in the window: the build's per-person plans differ most there.
const smallestPersonSql = `
  select p.id from persons p
  left join doc_persons dp on dp.person_id = p.id
  left join docs d on d.id = dp.doc_id and d.published_at >= now() - make_interval(days => $1::int)
  group by p.id order by count(d.id), p.id limit 1`

// Runs in a child the parent can kill: PGlite has no statement_timeout (WASM, no signals), so a
// cell past `--timeout` is ended from outside. Every cell is announced (`start`) before it runs
// and recorded (`cell`) after, so the parent knows which one hung and a restart skips the rest.
const measurePhase = async (scale: string, work: string) => {
  const mod = await openDb(work)
  const { db } = mod
  const graph = (await import(pathToFileURL(join(src, 'graph.ts')).href)) as typeof import('../../src/graph.js')
  const aggregate = (await import(pathToFileURL(join(src, 'aggregate.ts')).href)) as typeof import('../../src/aggregate.js')
  const q: Queries = graph.queries
  const windows = list(args.windows).map(Number)
  const runs = Number(args.runs)
  const budgetMs = Number(args.budget) * 1000
  const wanted = new Set(list(args.cases))
  const skip = new Set(list(args.skip))
  const dead = new Set(list(args.dead))
  const emit = (line: object) => appendFile(args.progress!, `${JSON.stringify(line)}\n`)

  await db.exec(SEARCH_PATH)
  const { rows: clock } = await db.query<{ now: Date; docs: number }>('select now() as now, (select count(*) from public.docs)::int as docs')
  if (new Date(clock[0].now).toISOString() !== new Date(ANCHOR).toISOString()) throw new Error(`clock not frozen: ${clock[0].now}`)
  if (clock[0].docs !== SCALES[scale]) throw new Error(`expected ${SCALES[scale]} docs, found ${clock[0].docs}`)

  // The tree's own schema: a candidate's new index or table is created here, before any timing.
  await mod.migrateP()
  await db.exec('analyze')

  const calibration = []
  for (let i = 0; i < 3; i++) calibration.push((await timed(() => db.query('select sum(g) from generate_series(1, 5000000) g'))).ms)
  await emit({ calibration: median(calibration) })

  // One warm-up, then up to `n` samples, fewer when they would overrun the budget; none when the
  // warm-up alone did, and then it is the one sample. samplesMs shows how many were taken.
  const sample = async <T>(key: string, fn: () => Promise<T>, n: number) => {
    const warm = await timed(fn)
    await emit({ beat: key })
    if (n === 0 || warm.ms >= budgetMs) return { samples: [warm.ms], value: warm.value }
    const k = Math.max(1, Math.min(n, Math.floor(budgetMs / Math.max(warm.ms, 1))))
    const samples = []
    for (let i = 0; i < k; i++) {
      samples.push((await timed(fn)).ms)
      await emit({ beat: key })
    }
    return { samples, value: warm.value }
  }
  const record = async (c: string, w: number, samples: number[], rows: number, hash: string) => {
    const cell: Cell = { scale, case: c, window: w, medianMs: median(samples), p95Ms: p95(samples), samplesMs: samples, rows, hash }
    log(`${scale} ${c} ${w}d: ${cell.medianMs.toFixed(2)} ms (${samples.length} samples)`)
    await emit({ cell })
  }
  const hashRows = async (texts: string[], params: unknown[]) => {
    const parts = []
    for (const t of texts) parts.push((await db.query(t, params)).rows)
    return { rows: parts.reduce((n, p) => n + p.length, 0), hash: resultHash(parts) }
  }

  // Built even when not measured, or already measured by an earlier child: graphFast reads it.
  // Neither asked for: no build at all, and no aggregate cell.
  const buildOnce = (w: number) => aggregate.buildGraphAggregates(persons, [w])
  for (const w of wanted.has(BUILD_CASE) || wanted.has('graphFast') ? windows : []) {
    const key = cellKey(BUILD_CASE, w)
    if (dead.has(key)) continue
    await emit({ start: key })
    if (skip.has(key)) {
      await buildOnce(w)
      continue
    }
    const r = await sample(key, () => buildOnce(w), wanted.has(BUILD_CASE) ? runs : 0)
    const result = await hashRows(buildResultSql, [w])
    await record(BUILD_CASE, w, r.samples, result.rows, result.hash)
  }
  await emit({ start: 'vacuum' })
  for (const t of ['graph_scopes', 'graph_terms', 'term_communities']) await db.exec(`vacuum analyze ${t}`)

  const person = persons.find((p) => p.id === 'lula')!
  const other = persons.find((p) => p.id === 'bolsonaro')!
  const explainDir = args.explain ? resolve(args.explain, scale) : null
  if (explainDir) await mkdir(explainDir, { recursive: true })

  for (const w of windows) {
    const ids = (await db.query<{ id: string }>(idsSql, [person.id, w])).rows.map((r) => r.id)
    const ctx: Ctx = { person, other, ids, term: 'w1', window: w }
    for (const c of readCases.filter((c) => wanted.has(c.name))) {
      const key = cellKey(c.name, w)
      if (skip.has(key) || dead.has(key)) continue
      await emit({ start: key })
      const { text, values } = c.sql(q, ctx)
      const r = await sample(key, () => db.query(text, values), runs)
      await record(c.name, w, r.samples, r.value.rows.length, resultHash(r.value.rows))
      if (explainDir) {
        const plan = await db.query<Record<string, string>>(`explain (analyze, buffers) ${text}`, values)
        await writeFile(join(explainDir, `${c.name}.${w}d.txt`), plan.rows.map((r) => r['QUERY PLAN']).join('\n') + '\n')
      }
    }
    const explainKey = cellKey(`explain:${BUILD_CASE}`, w)
    if (explainDir && wanted.has(BUILD_CASE) && !dead.has(cellKey(BUILD_CASE, w)) && !skip.has(explainKey) && !dead.has(explainKey)) {
      await emit({ start: explainKey })
      const { rows } = await db.query<{ id: string }>(smallestPersonSql, [w])
      const smallest = persons.find((p) => p.id === rows[0]?.id) ?? person
      await explainBuild(mod, aggregate, w, [person, smallest], join(explainDir, `${BUILD_CASE}.${w}d.txt`))
      await emit({ done: explainKey })
    }
  }
  await db.close()
}

// Plans of the build's heavy statements for the largest and the smallest person, inside a
// transaction that is rolled back.
const explainBuild = async (mod: DbModule, aggregate: typeof import('../../src/aggregate.js'), w: number, who: Person[], file: string) => {
  const sections: string[] = []
  const rollback = new Error('rollback')
  const explain = async (label: string, s: { text: string; values: unknown[] }) => {
    const { rows } = await mod.db.query<Record<string, string>>(`explain (analyze, buffers) ${s.text}`, s.values)
    sections.push(`-- ${label}\n${rows.map((r) => r['QUERY PLAN']).join('\n')}`)
    await writeFile(file, sections.join('\n\n') + '\n')
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

const seedReady = async (dir: string) => {
  const file = join(dir, 'bench-manifest.json')
  if (!existsSync(file)) return false
  return JSON.parse(await readFile(file, 'utf8')).version === GENERATOR_VERSION
}

const revOf = (dir: string) => {
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  try {
    return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--', '.') ? '+dirty' : ''}`
  } catch {
    return 'unknown'
  }
}

type Line = { cell?: Cell; calibration?: number; start?: string; done?: string; beat?: string }

const readLines = async (file: string): Promise<Line[]> =>
  existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : []

const finishedKeys = (lines: Line[]) =>
  new Set([...lines.flatMap((l) => (l.cell ? [cellKey(l.cell.case, l.cell.window)] : [])), ...lines.flatMap((l) => (l.done ? [l.done] : []))])

// Spawns one measuring child and kills it when `timeoutMs` passes with no new progress line while
// a cell is open. Every sample writes a beat, so the limit applies to one execution, not a cell.
const watched = (extra: string[], progress: string, timeoutMs: number) =>
  new Promise<{ code: number | null; hung?: string }>((done) => {
    const argv = [process.execPath, '--import', 'tsx', here, '--phase', 'measure', '--src', src, '--progress', progress, ...extra]
    // A hybrid CPU's efficiency cores run the same statement ~2x slower: pin to one named core.
    const [cmd, ...rest] = args.cpu ? ['taskset', '-c', args.cpu, ...argv] : argv
    const proc = spawn(cmd, rest, { stdio: 'inherit', env: childEnv })
    let from = -1
    let seen = 0
    let since = Date.now()
    const tick = setInterval(async () => {
      const lines = await readLines(progress)
      if (from < 0) from = lines.length
      if (lines.length !== seen) [seen, since] = [lines.length, Date.now()]
      const mine = lines.slice(from)
      const finished = finishedKeys(lines)
      const open = [...mine].reverse().find((l) => l.start)?.start
      if (open && !finished.has(open) && Date.now() - since > timeoutMs) {
        clearInterval(tick)
        proc.removeAllListeners('exit')
        proc.once('exit', () => done({ code: null, hung: open }))
        proc.kill('SIGKILL')
      }
    }, 1000)
    proc.once('exit', (code) => {
      clearInterval(tick)
      done({ code })
    })
  })

const measureScale = async (scale: string, seed: string) => {
  const timeoutMs = Number(args.timeout) * 1000
  const work = join(resolve(args.root), 'work', `${scale}-${process.pid}`)
  const progress = `${work}.jsonl`
  await rm(progress, { force: true })
  const dead: string[] = []
  const timedOut: Cell[] = []
  try {
    for (;;) {
      await rm(work, { recursive: true, force: true })
      await cp(seed, work, { recursive: true })
      const finished = finishedKeys(await readLines(progress))
      const r = await watched(
        ['--scale', scale, '--work', work, '--windows', args.windows, '--runs', args.runs, '--cases', args.cases, '--budget', args.budget,
          '--skip', [...finished].join(','), '--dead', dead.join(','), ...(args.explain ? ['--explain', resolve(args.explain)] : [])],
        progress,
        timeoutMs,
      )
      if (r.code === 0) break
      if (!r.hung) throw new Error(`measure ${scale} failed (${r.code})`)
      log(`${scale} ${r.hung}: killed after ${args.timeout} s, restarting from a fresh copy`)
      dead.push(r.hung)
      const [c, w] = r.hung.split('|')
      if (!c.startsWith('explain:') && c !== 'vacuum')
        timedOut.push({ scale, case: c, window: Number(w), medianMs: timeoutMs, p95Ms: timeoutMs, samplesMs: [], rows: 0, hash: 'timeout', timedOut: true })
      if (c === 'vacuum') throw new Error(`vacuum on ${scale} outlived the timeout`)
    }
    const lines = await readLines(progress)
    const cells = lines.flatMap((l) => (l.cell ? [l.cell] : []))
    return { cells: [...cells, ...timedOut], calibration: lines.find((l) => l.calibration)?.calibration ?? 0 }
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(progress, { force: true })
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
      cpuPin: args.cpu || null,
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
    if (args.fresh || !(await seedReady(seed))) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', here, '--phase', 'seed', '--src', src, '--scale', scale, '--work', seed], { stdio: 'inherit', env: childEnv })
      if (r.status !== 0) throw new Error(`seed ${scale} failed (${r.status})`)
    }
    const { cells, calibration } = await measureScale(scale, seed)
    report.cells.push(...cells)
    calibrations.push(calibration)
  }
  report.meta.calibrationMs = median(calibrations)
  await writeFile(args.out, JSON.stringify(report, null, 2) + '\n')
  log(`written ${args.out}`)
}

if (args.phase === 'seed') await seedPhase(args.scale!, resolve(args.work!))
else if (args.phase === 'measure') await measurePhase(args.scale!, resolve(args.work!))
else await main()
