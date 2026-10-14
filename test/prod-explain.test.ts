import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { before, describe, it } from 'node:test'
import { readCases } from '../scripts/bench/cases.js'
import { caseNames, explainOf, inBuildWindow, renderCases, run, statStatementsSql, summarize, type Client, type Opts } from '../scripts/prod-explain.js'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { queries } from '../src/graph.js'
import { docsText } from './docs.js'
import { persons, seed } from './fixture.js'
import './close.js'

const pexec = promisify(execFile)

const [lula, tarcisio] = persons
const ctx = { person: lula, other: tarcisio, ids: ['word:reforma', 'word:tributaria'], term: 'reforma', window: 21 }

const cannedPlan = [
  'Limit  (cost=1.00..2.00 rows=40 width=8) (actual time=1.0..2.0 rows=40 loops=1)',
  '  Buffers: shared hit=120 read=88, temp read=40 written=41',
  '  ->  Hash Join  (cost=1.00..2.00 rows=1 width=8) (actual time=1.0..2.0 rows=1 loops=1)',
  '        Buckets: 1024  Batches: 16  Memory Usage: 2049kB',
  '        Rows Removed by Join Filter: 1843220',
  '        Buffers: shared hit=999 read=777, temp read=999 written=999',
  '  ->  Sort  (cost=1.00..2.00 rows=1 width=8) (actual time=1.0..2.0 rows=1 loops=1)',
  '        Sort Method: external merge  Disk: 51232kB',
  '        Buffers: shared hit=5 read=6',
  '  ->  Sort  (cost=1.00..2.00 rows=1 width=8) (actual time=1.0..2.0 rows=1 loops=1)',
  '        Sort Method: quicksort  Memory: 25kB',
  '  ->  Hash  (cost=1.00..2.00 rows=1 width=8)',
  '        Buckets: 1024  Batches: 1  Memory Usage: 9kB',
  'Planning:',
  '  Buffers: shared hit=3',
  'Planning Time: 4.1 ms',
  'Execution Time: 25412.3 ms',
]

type Handler = (text: string, values?: unknown[]) => Record<string, unknown>[] | Error

// A recording stand-in for pg: answers the lookups, the id list, an explain and pg_stat_statements.
const fake = (over: (text: string, values?: unknown[]) => Record<string, unknown>[] | Error | undefined = () => undefined) => {
  const sent: { text: string; values?: unknown[] }[] = []
  const handler: Handler = (text, values) => {
    const custom = over(text, values)
    if (custom) return custom
    if (/^explain /.test(text)) return cannedPlan.map((l) => ({ 'QUERY PLAN': l }))
    if (text.includes('from pg_stat_statements'))
      return [
        { query: 'select 1', calls: '10', total_exec_time: 100, mean_exec_time: 10, temp_blks_read: '20', temp_blks_written: '30', shared_blks_read: '40' },
        { query: 'select\n2 | x', calls: '0', total_exec_time: 0, mean_exec_time: 0, temp_blks_read: '0', temp_blks_written: '0', shared_blks_read: '0' },
      ]
    if (text.includes('from persons where id = $1')) return [{ id: (values as string[])[0], name: (values as string[])[0], aliases: [(values as string[])[0]] }]
    if (text.includes('from persons where id <>')) return [{ id: 'bolsonaro', name: 'Bolsonaro', aliases: ['Bolsonaro'] }]
    if (text.includes('from persons order by name')) return [{ id: 'lula' }, { id: 'tarcisio' }]
    if (text.includes('doc_terms')) return [{ id: 'hashtag:reforma' }, { id: 'word:reforma' }, { id: 'word:tributaria' }]
    return []
  }
  const client: Client = {
    query: async (text, values) => {
      sent.push({ text, values })
      const out = handler(text, values)
      if (out instanceof Error) throw out
      return { rows: out }
    },
  }
  return { client, sent }
}

const opts = (over: Partial<Opts> = {}): Opts => ({ person: 'lula', now: new Date('2026-09-28T09:30:00Z'), ...over })
const explains = (sent: { text: string; values?: unknown[] }[]) => sent.filter((s) => s.text.startsWith('explain '))

describe('prod-explain rendering', () => {
  before(async () => {
    await seed()
    await buildGraphAggregates(persons)
  })

  it('renders one statement per case, identical to the route builders', () => {
    const names = [...readCases.map((c) => c.name), 'linksFast', 'compareFast', 'lensesFast']
    assert.deepEqual(caseNames, names)
    const rendered = renderCases(queries, ctx, caseNames)
    assert.deepEqual(rendered.map((r) => r.name), names)
    const expected = {
      linksFast: queries.linksFast(lula, { days: 21, source: 'all' }, ctx.ids),
      compareFast: queries.compareFast(lula, tarcisio, { days: 21, source: 'all', domain: 'all', lean: 'all', country: 'br', kind: 'word,hashtag,phrase,org', limit: 40, bridges: false }),
    }
    const lensesFast = queries.lensesFast(lula, {
      days: 21,
      kind: 'word,hashtag,phrase,org',
      limit: 40,
      bridges: false,
      a: { lens: 'source:gkg', domain: 'all', lean: 'all', source: 'gkg' },
      b: { lens: 'source:rss', domain: 'all', lean: 'all', source: 'rss' },
    })
    const byName = new Map(rendered.map((r) => [r.name, r]))
    for (const [name, sql] of Object.entries({ ...expected, lensesFast })) {
      assert.equal(byName.get(name)!.text, sql.text, name)
      assert.deepEqual(byName.get(name)!.values, sql.values, name)
    }
    for (const c of readCases) {
      const sql = c.sql(queries, ctx)
      assert.equal(byName.get(c.name)!.text, sql.text, c.name)
      assert.deepEqual(byName.get(c.name)!.values, sql.values, c.name)
    }
    assert.throws(() => renderCases(queries, ctx, ['nope']), /unknown case/)
  })

  it('every rendered case explains against the fixture', async () => {
    for (const r of renderCases(queries, ctx, caseNames)) {
      const { text, values } = explainOf(r)
      assert.match(text, /^explain \(analyze, buffers, format text\) /)
      const { rows } = await db.query<Record<string, string>>(text, values)
      const lines = rows.map((row) => row['QUERY PLAN'])
      assert.ok(lines.some((l) => l.includes('Execution Time:')), r.name)
      assert.ok(Number.isFinite(summarize(lines).executionMs), r.name)
    }
  })

  it('a person without docs in the window renders every case', async () => {
    const empty = { ...ctx, ids: [], term: '', person: { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] } }
    const rendered = renderCases(queries, empty, caseNames)
    assert.equal(rendered.length, caseNames.length)
    for (const r of rendered) {
      const { text, values } = explainOf(r)
      await assert.doesNotReject(db.query(text, values), r.name)
    }
    const { client, sent } = fake((text) => (text.includes('doc_terms') ? [] : undefined))
    const result = await run(client, opts({ cases: ['links', 'termTestimony', 'docs.term'] }))
    assert.equal(result.failed, false)
    assert.equal(explains(sent).length, 6)
  })
})

describe('prod-explain pure halves', () => {
  it('explainOf prefixes the statement and keeps its values', () => {
    assert.deepEqual(explainOf({ text: 'select $1', values: [7] }), { text: 'explain (analyze, buffers, format text) select $1', values: [7] })
  })

  it('statStatementsSql selects the seven columns by total time with one bound limit', () => {
    const { text, values } = statStatementsSql(25)
    assert.match(text, /^select query, calls, total_exec_time, mean_exec_time, temp_blks_read, temp_blks_written, shared_blks_read from pg_stat_statements order by total_exec_time desc limit \$1$/)
    assert.deepEqual(values, [25])
  })
})

describe('prod-explain summarize', () => {
  it('flags batches, external sorts and join-filter removals', () => {
    const flagged = summarize(cannedPlan).flagged
    assert.deepEqual(flagged, [
      'Buckets: 1024  Batches: 16  Memory Usage: 2049kB',
      'Rows Removed by Join Filter: 1843220',
      'Sort Method: external merge  Disk: 51232kB',
    ])
    assert.ok(!flagged.some((l) => l.includes('Batches: 1 ') || l.includes('quicksort')))
  })

  it('reads top-node buffers and defaults to zero', () => {
    const s = summarize(cannedPlan)
    assert.deepEqual(
      { hit: s.sharedHit, read: s.sharedRead, tempRead: s.tempRead, tempWritten: s.tempWritten },
      { hit: 120, read: 88, tempRead: 40, tempWritten: 41 },
    )
    assert.equal(s.executionMs, 25412.3)
    assert.equal(s.planningMs, 4.1)
    const bare = summarize(['Result  (cost=0.00..0.01 rows=1 width=4) (actual time=0.0..0.0 rows=1 loops=1)', 'Execution Time: 0.05 ms'])
    assert.deepEqual([bare.sharedHit, bare.sharedRead, bare.tempRead, bare.tempWritten], [0, 0, 0, 0])
    assert.deepEqual(summarize([]), { executionMs: 0, planningMs: 0, sharedHit: 0, sharedRead: 0, tempRead: 0, tempWritten: 0, flagged: [] })
  })
})

describe('prod-explain run', () => {
  it('sends only read-only statement shapes', async () => {
    const { client, sent } = fake()
    await run(client, opts())
    assert.ok(sent.length > 0)
    for (const { text } of sent) {
      assert.match(text, /^(begin transaction read only|rollback|explain \(analyze, buffers, format text\) |select )/)
      assert.doesNotMatch(text, /^\s*(set|reset|insert|update|delete|create|drop|alter|analyze|vacuum|truncate)\b/i)
      assert.doesNotMatch(text, /pg_stat_statements_reset/)
    }
  })

  it('runs each case twice, cold then warm, each in its own read-only transaction', async () => {
    const { client, sent } = fake()
    const result = await run(client, opts({ cases: ['graph', 'compare'] }))
    assert.equal(result.failed, false)
    const shapes = sent.map((s) => (s.text.startsWith('explain ') ? 'explain' : s.text.startsWith('begin') || s.text === 'rollback' ? s.text : 'select'))
    const trace = shapes.filter((s) => s !== 'select').join('|')
    assert.match(trace, /^(begin transaction read only\|explain\|rollback\|){4}begin transaction read only\|rollback$/)
    assert.equal(explains(sent).length, 4)
    const first = sent.findIndex((s) => s.text.startsWith('explain '))
    assert.equal(sent[first - 1].text, 'begin transaction read only')
    assert.equal(sent[first + 1].text, 'rollback')
    const sections = result.report.split('### ').slice(1)
    assert.match(sections[0], /^graph \(lula, 21d\)/)
    assert.match(sections[1], /^compare \(lula vs bolsonaro, 21d\)/)
    assert.ok(sections[0].indexOf('| cold |') > 0 && sections[0].indexOf('| cold |') < sections[0].indexOf('| warm |'))
    assert.match(result.report, /\| cold \| 25412\.3 \| 4\.1 \| 120 \| 88 \| 40 \| 41 \|/)
    assert.match(result.report, /flagged lines \(cold\):\n {2}Buckets: 1024 {2}Batches: 16/)
    assert.match(result.report, /<details><summary>plan \(cold\)<\/summary>/)
  })

  it('reports pg_stat_statements per call, never dividing by zero', async () => {
    const { client } = fake()
    const { report } = await run(client, opts({ cases: ['graph'], top: 500 }))
    assert.match(report, /### pg_stat_statements \(top 100 by total time\)/)
    assert.match(report, /\| 10 \| 100\.0 \| 10\.0 \| 2\.0 \| 3\.0 \| 4\.0 \| select 1 \|/)
    assert.match(report, /\| 0 \| 0\.0 \| 0\.0 \| - \| - \| - \| select 2 \\\| x \|/)
  })

  it('degrades when pg_stat_statements is unavailable', async () => {
    const { client, sent } = fake((text) => (text.includes('from pg_stat_statements') ? new Error('relation "pg_stat_statements" does not exist') : undefined))
    const result = await run(client, opts({ cases: ['graph', 'links'] }))
    assert.equal(result.failed, false)
    assert.match(result.report, /pg_stat_statements indisponível: relation "pg_stat_statements" does not exist/)
    assert.match(result.report, /### graph /)
    assert.match(result.report, /### links /)
    assert.equal(sent.at(-1)!.text, 'rollback')
  })

  it('a failing case is reported and the run continues', async () => {
    const { client, sent } = fake((text) => (text.includes('graph_terms') && text.startsWith('explain ') ? new Error('canceling statement due to statement timeout') : undefined))
    const result = await run(client, opts({ cases: ['graphFast', 'links', 'sources'] }))
    assert.equal(result.failed, true)
    assert.match(result.report, /### graphFast[^\n]*\n\nerror: canceling statement due to statement timeout/)
    assert.match(result.report, /### links [\s\S]*\| warm \|/)
    assert.match(result.report, /### sources [\s\S]*\| warm \|/)
    const failed = sent.findIndex((s) => s.text.startsWith('explain ') && s.text.includes('graph_terms'))
    assert.equal(sent[failed + 1].text, 'rollback')
    assert.equal(explains(sent).length, 1 + 2 + 2)
  })

  it('unknown case or person sends no explain', async () => {
    const a = fake()
    const badCase = await run(a.client, opts({ cases: ['graph', 'nope'] }))
    assert.equal(badCase.failed, true)
    assert.equal(a.sent.length, 0)
    assert.match(badCase.report, /unknown case: nope/)
    assert.ok(caseNames.every((n) => badCase.report.includes(n)))

    const b = fake((text) => (text.includes('from persons where id = $1') ? [] : undefined))
    const badPerson = await run(b.client, opts({ person: 'ghost' }))
    assert.equal(badPerson.failed, true)
    assert.equal(explains(b.sent).length, 0)
    assert.match(badPerson.report, /unknown person: ghost/)
    assert.match(badPerson.report, /lula, tarcisio/)
  })

  it('an unknown other person sends no explain and lists the known ids', async () => {
    const { client, sent } = fake((text, values) => (text.includes('from persons where id = $1') && (values as string[])[0] === 'ghost' ? [] : undefined))
    const result = await run(client, opts({ other: 'ghost' }))
    assert.equal(result.failed, true)
    assert.equal(explains(sent).length, 0)
    assert.match(result.report, /unknown person: ghost/)
    assert.match(result.report, /lula, tarcisio/)
  })

  it('days snap onto the route windows and the term seeds from the first word id', async () => {
    const { client, sent } = fake()
    const { report } = await run(client, opts({ days: 10, cases: ['docs.term'] }))
    assert.match(report, /### docs\.term \(lula, 7d\)/)
    const ids = sent.find((s) => s.text.includes('doc_terms'))!
    assert.deepEqual(ids.values, ['lula', 7])
    assert.ok(explains(sent).some((s) => (s.values ?? []).includes('reforma')))
  })

  it('refuses inside the build window unless forced', async () => {
    const a = fake()
    const refused = await run(a.client, opts({ now: new Date('2026-09-28T06:30:00Z') }))
    assert.equal(refused.failed, true)
    assert.equal(a.sent.length, 0)
    assert.match(refused.report, /--force/)
    const b = fake()
    const forced = await run(b.client, opts({ now: new Date('2026-09-28T06:30:00Z'), force: true, cases: ['graph'] }))
    assert.equal(forced.failed, false)
    assert.equal(explains(b.sent).length, 2)
  })

  it('inBuildWindow follows the 17 */6 cron plus the build', () => {
    const at = (hm: string) => inBuildWindow(new Date(`2026-09-28T${hm}:00Z`))
    for (const t of ['06:17', '06:59', '07:01', '00:17', '19:01']) assert.equal(at(t), true, t)
    for (const t of ['06:16', '07:02', '09:30', '00:00', '19:02']) assert.equal(at(t), false, t)
  })
})

describe('prod-explain cli', () => {
  const cli = (args: string[], env: Record<string, string>) =>
    pexec(process.execPath, ['--import', 'tsx', 'scripts/prod-explain.ts', ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
    }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
    )

  it('exits 1 naming the three connection variables when none is set', async () => {
    const r = await cli(['--person', 'lula'], {})
    assert.equal(r.code, 1)
    for (const name of ['POSTGRES_URL_NON_POOLING', 'DATABASE_URL', 'POSTGRES_URL']) assert.ok(r.out.includes(name), name)
  })

  it('the usage text names 21 as the default --days, never 30 (AC15)', async () => {
    const r = await cli([], {})
    assert.notEqual(r.code, 0)
    assert.match(r.out, /--days 21/)
    assert.doesNotMatch(r.out, /--days 30/)
  })

  it('an unknown case exits 1 listing the valid ones before any statement', async () => {
    const r = await cli(['--person', 'lula', '--cases', 'nope', '--force'], { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' })
    assert.equal(r.code, 1)
    assert.match(r.out, /unknown case: nope/)
    assert.ok(caseNames.every((n) => r.out.includes(n)))
  })
})

describe('prod-explain docs', () => {
  it('the docs name production EXPLAIN and pg_stat_statements as the timing source and give both reasons', () => {
    const at = docsText.indexOf('prod-explain')
    const near = docsText.slice(Math.max(0, at - 2500), at + 4000)
    assert.ok(docsText.includes('prod-explain'))
    assert.ok(docsText.includes('pg_stat_statements'))
    assert.match(near, /work_mem/)
    assert.match(near, /shared_buffers/)
    assert.match(near, /only timing source/i)
    assert.match(near, /PG_SSL_CA/)
    assert.match(near, /read-only/i)
    assert.match(near, /build window/i)
    assert.match(near, /identical rows and plan shape/i)
    assert.match(near, /PGlite[^.]*\bRAM\b/i)
    assert.match(near, /EXPLAIN \(ANALYZE, BUFFERS\)/)
    assert.match(near, /cold[^.]*not a flushed/i)
  })

  it('the harness readme no longer sells speed as a keep condition', () => {
    const readme = readFileSync(new URL('../scripts/bench/README.md', import.meta.url), 'utf8')
    assert.doesNotMatch(readme, /--gain/)
    assert.doesNotMatch(readme, /20% lower/)
  })
})
