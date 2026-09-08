import { spawnSync } from 'node:child_process'
import { rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import seedJson from '../seed.json' with { type: 'json' }
import { corpus } from './bench-corpus.js'
import type { Person } from './types.js'

// The write-path benchmark owns its own database, like `pnpm bench`. Never point it at
// ./data/pg: PGlite allows one process per directory and a second opener corrupts it.
const DATA_DIR = process.env.BENCH_WRITES_DATA_DIR ?? './data/bench-writes'
if (/(^|\/)data\/pg\/?$/.test(DATA_DIR)) throw new Error('refusing to benchmark against the live ./data/pg directory')

const DOCS = Number(process.env.BENCH_WRITES_DOCS ?? 20000)
const DAYS = Number(process.env.BENCH_WRITES_DAYS ?? 120)
const SEED = Number(process.env.BENCH_WRITES_SEED ?? 20260908)
const NOW = Number(process.env.BENCH_WRITES_NOW ?? 1757289600000)
const phase = process.env.BENCH_WRITES_PHASE ?? 'all'

process.env.DATA_DIR = DATA_DIR
// Counters on, per-statement log off: the report below is the output.
process.env.PERF ??= '1'
process.env.PERF_LOG = '0'

const persons = seedJson as Person[]
const here = fileURLToPath(import.meta.url)

type Result = { phase: string; docs: number; sql: number; ms: number; peakRss: number; peakHeap: number }

// Each phase runs in its own process so maxRSS is that phase's peak and not the whole run's,
// and so the reindex opens a database the inserting process already closed.
const runPhase = (name: string): Result => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', here], {
    env: { ...process.env, BENCH_WRITES_PHASE: name },
    encoding: 'utf8',
  })
  if (child.status !== 0) throw new Error(`phase ${name} failed (${child.status}): ${child.stderr}`)
  const line = child.stdout.trim().split('\n').at(-1) ?? ''
  return JSON.parse(line) as Result
}

const sampleHeap = () => {
  let peak = 0
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 20)
  timer.unref()
  return () => (clearInterval(timer), Math.max(peak, process.memoryUsage().heapUsed))
}

const report = async (name: string, docs: number, fn: () => Promise<void>) => {
  const { measure } = await import('./perf.js')
  const stopHeap = sampleHeap()
  const { ms, sql } = await measure(fn)
  const peakHeap = stopHeap()
  const out: Result = { phase: name, docs, sql, ms, peakRss: process.resourceUsage().maxRSS * 1024, peakHeap }
  console.log(JSON.stringify(out))
}

const ingestPhase = async () => {
  await mkdir(resolve(DATA_DIR), { recursive: true })
  const { db, migrate } = await import('./db.js')
  const { insertDoc, upsertPersons } = await import('./store.js')
  await migrate()
  await upsertPersons(persons)
  const docs = corpus(persons, { docs: DOCS, days: DAYS, seed: SEED, now: NOW })
  await report('ingest', docs.length, async () => {
    for (const doc of docs) await insertDoc(doc, persons)
  })
  await db.close()
}

const reindexPhase = async () => {
  const { db, migrate } = await import('./db.js')
  const { reindexAll } = await import('./reindex.js')
  await migrate()
  await report('reindex', DOCS, async () => void (await reindexAll(persons)))
  await db.close()
}

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`

const all = async () => {
  await rm(resolve(DATA_DIR), { recursive: true, force: true })
  const results = [runPhase('ingest'), runPhase('reindex')]
  const header = ['phase', 'docs', 'sql statements', 'seconds', 'docs/s', 'peak rss', 'peak heap']
  const rows = results.map((r) => [
    r.phase,
    String(r.docs),
    String(r.sql),
    (r.ms / 1000).toFixed(1),
    Math.round(r.docs / (r.ms / 1000)).toString(),
    mb(r.peakRss),
    mb(r.peakHeap),
  ])
  console.log(`| ${header.join(' | ')} |`)
  console.log(`| ${header.map(() => '---').join(' | ')} |`)
  for (const r of rows) console.log(`| ${r.join(' | ')} |`)
}

if (phase === 'ingest') await ingestPhase()
else if (phase === 'reindex') await reindexPhase()
else await all()
