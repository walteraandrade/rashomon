import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { compareQ, idsSql, lensesQ, readCases, scope, type Ctx, type Queries, type ReadCase } from './bench/cases.js'
import { poolConfig } from '../src/db.js'
import { queries } from '../src/graph.js'
import { int, snapDays } from '../src/query.js'
import type { Person } from '../src/types.js'

// Production EXPLAIN (ANALYZE, BUFFERS) and pg_stat_statements are the timing source of truth; the
// PGlite harness under scripts/bench only proves identical rows and plan shape. Read-only by
// construction: the client only ever receives `begin transaction read only`, `rollback`, an
// `explain (analyze, buffers, format text)` and `select`.

// The fast variants production reads and the harness does not list.
const fastCases: ReadCase[] = [
  { name: 'linksFast', sql: (q, c) => q.linksFast(c.person, scope(c.window), c.ids) },
  { name: 'compareFast', sql: (q, c) => q.compareFast(c.person, c.other, compareQ(c.window)) },
  { name: 'lensesFast', sql: (q, c) => q.lensesFast(c.person, lensesQ(c.window)) },
]

const cases = [...readCases, ...fastCases]

export const caseNames = cases.map((c) => c.name)

const WITH_OTHER = ['compare', 'compareFast']

export type Rendered = { name: string; text: string; values: unknown[] }

export const renderCases = (q: Queries, ctx: Ctx, names: string[]): Rendered[] =>
  names.map((name) => {
    const c = cases.find((x) => x.name === name)
    if (!c) throw new Error(`unknown case ${name}`)
    const { text, values } = c.sql(q, ctx)
    return { name, text, values: [...values] }
  })

export const explainOf = ({ text, values }: { text: string; values: unknown[] }) => ({
  text: 'explain (analyze, buffers, format text) ' + text,
  values,
})

export type Summary = {
  executionMs: number
  planningMs: number
  sharedHit: number
  sharedRead: number
  tempRead: number
  tempWritten: number
  flagged: string[]
}

const timeOf = (lines: string[], label: string) => {
  const m = lines.map((l) => new RegExp(`${label}:\\s*([\\d.]+)\\s*ms`).exec(l)).find((x) => x)
  return m ? Number(m[1]) : 0
}

const counters = (line: string, group: string, key: string) => {
  const m = new RegExp(`\\b${group}\\b([^,]*)`).exec(line)
  const v = m && new RegExp(`\\b${key}=(\\d+)`).exec(m[1])
  return v ? Number(v[1]) : 0
}

// The top node's own `Buffers:` line is the first one before any child (`->`) or the trailing
// `Planning:` block, and it already counts its children.
const topBuffers = (lines: string[]) => {
  const end = lines.findIndex((l, i) => i > 0 && /^\s*(->|Planning\b|Execution Time|Trigger|JIT)/.test(l))
  return lines.slice(0, end === -1 ? lines.length : end).find((l) => l.includes('Buffers:')) ?? ''
}

const flags = (line: string) => {
  const batches = /Batches:\s*(\d+)/.exec(line)
  return (
    (batches !== null && Number(batches[1]) > 1) ||
    /Sort Method:\s*external/.test(line) ||
    line.includes('Rows Removed by Join Filter:') ||
    /\bDisk:/.test(line)
  )
}

export const summarize = (planLines: string[]): Summary => {
  const buffers = topBuffers(planLines)
  return {
    executionMs: timeOf(planLines, 'Execution Time'),
    planningMs: timeOf(planLines, 'Planning Time'),
    sharedHit: counters(buffers, 'shared', 'hit'),
    sharedRead: counters(buffers, 'shared', 'read'),
    tempRead: counters(buffers, 'temp', 'read'),
    tempWritten: counters(buffers, 'temp', 'written'),
    flagged: planLines.filter(flags).map((l) => l.trim()),
  }
}

// `17 */6` cron plus about 45 minutes of build.
export const inBuildWindow = (date: Date) => {
  const h = date.getUTCHours()
  const m = date.getUTCMinutes()
  return ([0, 6, 12, 18].includes(h) && m >= 17) || ([1, 7, 13, 19].includes(h) && m < 2)
}

export const statStatementsSql = (top: number) => ({
  text: `select query, calls, total_exec_time, mean_exec_time, temp_blks_read, temp_blks_written, shared_blks_read from pg_stat_statements order by total_exec_time desc limit $1`,
  values: [top] as unknown[],
})

export type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

export type RunResult = { label: 'cold' | 'warm'; summary: Summary; plan: string }
export type CaseReport = { name: string; title: string; runs: RunResult[]; error?: string }
export type StatRow = { query: string; calls: number; totalMs: number; meanMs: number; tempRead: number; tempWritten: number; sharedRead: number }
export type StatReport = { rows: StatRow[] } | { error: string }

const num = (v: unknown) => Number(v ?? 0)
const fixed = (x: number) => x.toFixed(1)
const perCall = (x: number, calls: number) => (calls === 0 ? '-' : fixed(x / calls))
const cell = (text: string, max: number) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, max)

const caseSection = (c: CaseReport) =>
  [
    `### ${c.title}`,
    '',
    ...(c.error !== undefined ? [`error: ${c.error}`, ''] : []),
    ...(c.runs.length
      ? [
          '| run | execution ms | planning ms | shared hit | shared read | temp read | temp written |',
          '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
          ...c.runs.map(
            ({ label, summary: s }) =>
              `| ${label} | ${fixed(s.executionMs)} | ${fixed(s.planningMs)} | ${s.sharedHit} | ${s.sharedRead} | ${s.tempRead} | ${s.tempWritten} |`,
          ),
          '',
          ...(c.runs[0].summary.flagged.length ? ['flagged lines (cold):', ...c.runs[0].summary.flagged.map((l) => `  ${l}`), ''] : []),
          ...c.runs.flatMap((r) => [`<details><summary>plan (${r.label})</summary>`, '', '```', r.plan, '```', '', '</details>', '']),
        ]
      : []),
  ].join('\n')

const statSection = (top: number, s: StatReport) =>
  [
    `### pg_stat_statements (top ${top} by total time)`,
    '',
    ...('error' in s
      ? [`pg_stat_statements indisponível: ${s.error}`]
      : [
          '| calls | total ms | mean ms | temp_blks_read / call | temp_blks_written / call | shared_blks_read / call | query |',
          '| ---: | ---: | ---: | ---: | ---: | ---: | --- |',
          ...s.rows.map(
            (r) =>
              `| ${r.calls} | ${fixed(r.totalMs)} | ${fixed(r.meanMs)} | ${perCall(r.tempRead, r.calls)} | ${perCall(r.tempWritten, r.calls)} | ${perCall(r.sharedRead, r.calls)} | ${cell(r.query, 200)} |`,
          ),
        ]),
    '',
  ].join('\n')

export const report = (head: string, sections: CaseReport[], top: number, stats: StatReport) =>
  [
    `# prod-explain ${head}`,
    '',
    '`cold` is the first execution in this run, not a flushed cache: a read-only session cannot flush shared buffers or the OS cache. `warm` runs right after it on the same connection.',
    '',
    ...sections.map(caseSection),
    statSection(top, stats),
  ].join('\n')

export type Opts = {
  person: string
  other?: string
  days?: number
  cases?: string[]
  top?: number
  force?: boolean
  now?: Date
}

export type Result = { report: string; failed: boolean }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const refuse = (text: string): Result => ({ report: text, failed: true })

const personRow = (r: Record<string, unknown>): Person => ({ id: String(r.id), name: String(r.name), aliases: (r.aliases ?? []) as string[] })

const knownIds = async (client: Client) => (await client.query(`select id from persons order by name`)).rows.map((r) => String(r.id))

const lookup = async (client: Client, id: string) => (await client.query(`select id, name, aliases from persons where id = $1`, [id])).rows[0]

const inReadOnly = async <T>(client: Client, work: () => Promise<T>): Promise<T> => {
  try {
    await client.query('begin transaction read only')
    return await work()
  } finally {
    await client.query('rollback').catch(() => undefined)
  }
}

const explain = async (client: Client, r: Rendered) => {
  const { text, values } = explainOf(r)
  const lines = await inReadOnly(client, async () => (await client.query(text, values)).rows.map((row) => String(row['QUERY PLAN'])))
  return { summary: summarize(lines), plan: lines.join('\n') }
}

const explainTwice = async (client: Client, r: Rendered): Promise<{ runs: RunResult[]; error?: string }> => {
  const cold = await explain(client, r).then(
    (x) => ({ x }),
    (e) => ({ e }),
  )
  if ('e' in cold) return { runs: [], error: message(cold.e) }
  const warm = await explain(client, r).then(
    (x) => ({ x }),
    (e) => ({ e }),
  )
  const runs: RunResult[] = [{ label: 'cold', ...cold.x }, ...('x' in warm ? [{ label: 'warm' as const, ...warm.x }] : [])]
  return 'e' in warm ? { runs, error: message(warm.e) } : { runs }
}

const stats = async (client: Client, top: number): Promise<StatReport> => {
  const { text, values } = statStatementsSql(top)
  try {
    const { rows } = await inReadOnly(client, () => client.query(text, values))
    return {
      rows: rows.map((r) => ({
        query: String(r.query),
        calls: num(r.calls),
        totalMs: num(r.total_exec_time),
        meanMs: num(r.mean_exec_time),
        tempRead: num(r.temp_blks_read),
        tempWritten: num(r.temp_blks_written),
        sharedRead: num(r.shared_blks_read),
      })),
    }
  } catch (e) {
    return { error: message(e) }
  }
}

export const run = async (client: Client, opts: Opts): Promise<Result> => {
  if (!opts.force && inBuildWindow(opts.now ?? new Date()))
    return refuse('refused: inside the aggregate build window (UTC minute 17 of hours 0/6/12/18 until minute 2 of the next hour); rerun outside it or pass --force')
  const names = opts.cases?.length ? opts.cases : caseNames
  const unknown = names.filter((n) => !caseNames.includes(n))
  if (unknown.length) return refuse(`unknown case: ${unknown.join(', ')}\nvalid cases: ${caseNames.join(', ')}`)

  const days = snapDays(String(opts.days ?? 21), 21)
  const top = int(String(opts.top ?? 25), 25, 1, 100)
  const personR = await lookup(client, opts.person)
  if (!personR) return refuse(`unknown person: ${opts.person}\nknown ids: ${(await knownIds(client)).join(', ')}`)
  const otherR = opts.other
    ? await lookup(client, opts.other)
    : (await client.query(`select id, name, aliases from persons where id <> $1 order by name limit 1`, [opts.person])).rows[0]
  if (!otherR) return refuse(`unknown person: ${opts.other ?? '(no second person in persons)'}\nknown ids: ${(await knownIds(client)).join(', ')}`)

  const person = personRow(personR)
  const other = personRow(otherR)
  const converted = (await client.query(`select to_regclass('public.terms') is not null as converted`)).rows[0]?.converted === true
  const ids = (await client.query(idsSql(converted).trim(), [person.id, days])).rows.map((r) => String(r.id))
  const term = ids.find((id) => id.startsWith('word:'))?.slice('word:'.length) ?? ''
  const rendered = renderCases(queries, { person, other, ids, term, window: days }, names)

  const sections = await rendered.reduce<Promise<CaseReport[]>>(
    async (acc, r) => [
      ...(await acc),
      {
        name: r.name,
        title: `${r.name} (${person.id}${WITH_OTHER.includes(r.name) ? ` vs ${other.id}` : ''}, ${days}d)`,
        ...(await explainTwice(client, r)),
      },
    ],
    Promise.resolve([]),
  )
  const statReport = await stats(client, top)
  return { report: report(`${person.id}, ${days}d`, sections, top, statReport), failed: sections.some((s) => s.error !== undefined) }
}

const main = async () => {
  const { values: args } = parseArgs({
    options: {
      person: { type: 'string' },
      other: { type: 'string' },
      days: { type: 'string', default: '21' },
      cases: { type: 'string', default: '' },
      top: { type: 'string', default: '25' },
      out: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  })
  if (!args.person) throw new Error('usage: prod-explain.ts --person <id> [--other <id>] [--days 21] [--cases a,b] [--top 25] [--out file] [--force]')
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) {
    console.error('POSTGRES_URL_NON_POOLING, DATABASE_URL or POSTGRES_URL is required')
    process.exitCode = 1
    return
  }
  const pool = new pg.Pool({ ...poolConfig(url), max: 1 })
  try {
    const result = await run(pool, {
      person: args.person,
      other: args.other,
      days: snapDays(args.days, 21),
      cases: args.cases.split(',').filter(Boolean),
      top: int(args.top, 25, 1, 100),
      force: args.force,
    })
    if (args.out) await writeFile(args.out, result.report)
    else console.log(result.report)
    process.exitCode = result.failed ? 1 : 0
  } finally {
    await pool.end()
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href
if (isMain) await main()
