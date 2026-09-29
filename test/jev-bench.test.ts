import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { main, type Deps } from '../scripts/jev-bench.js'
import { decide, metrics, parseCriteria, parseVerifyBlock, renderTable, type Gap, type Row } from '../scripts/jev/metrics.js'
import {
  CHAT_URL,
  CONVENTION_QUESTIONS,
  DECISIONS_URL,
  JEV_DIFF_CAP_TOKENS,
  SONNET_BASELINE_MODEL,
  criterionQuestions,
  decisionRequest,
  parseDecisions,
  parseSonnet,
} from '../scripts/jev/questions.js'
import { docsText } from './docs.js'

const PR_259_BODY = "1. `compareFor` and `lensesFor` answer from `graph_terms`/`graph_scopes` when the recorte is precomputable (compare: `precomputable(q)` plus a `graph_scopes` row for both people; lenses: both sides `all` or `source:<name>` and `days` in `DAYS`), falling back to the unchanged live statements otherwise. New builders `compareFast`/`lensesFast` registered in `queries`/`statements` and `src/bench.ts`. No route, parameter or field changed. `/compare/bridges`, `/lenses/bridges` and rising untouched. `src/aggregate.ts` and `src/db.ts` are byte-identical to master (no new table, no extra build scan).\n2. Documented behavior change: a `null` side on a precomputed answer can mean \"below the build's kept threshold\", not only zero; docs/api.md, docs/operations.md and public/como-ler.html say so.\n3. Spec deviation chosen by the human (option b): on the precomputed lenses path a person's own name words never appear on the ruler (graph_terms never holds them); the live path still shows them. AC2 equality test is scoped to non-name keys.\n\n## Verification\n\n- `pnpm typecheck` clean, `pnpm test` 1944/1944.\n- Acceptance tests in test/aggregate.test.ts (AC1–AC7 plus routing tests for compareFor/lensesFor under a shrunk build) and test/graph.test.ts (AC8–AC11).\n- AC13 (`pnpm bench` EXPLAIN on production-shaped data, under 200 ms warm) is manual and not run here.\n- Validator: round 3 verdict \"return\" with 1 should + 3 nits, all fixed in commits 6ee8e88 and aefdfa8; no blockers remain.\n\n## Deploy note\n\nNo migration needed; a database with an existing aggregate build answers the fast paths at once.\n\nCloses #247\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"

const SPEC = [
  '# Spec: sample',
  '',
  '## 1. Goal',
  '',
  'Say hello.',
  '',
  '## 2. API',
  '',
  'None.',
  '',
  '## 5. Acceptance criteria',
  '',
  '1. The greeting is `hello`.',
  '2. The route answers 200.',
  '3. The docs name it.',
].join('\n')

const DECISIONS_RESPONSE = {
  id: 'gen-dec-1',
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    'criterion:1': { type: 'noul', noul: 0.91 },
    'criterion:2': { type: 'noul', noul: 0.2 },
    'convention:comment': { type: 'noul', noul: 0.95 },
    'ignored:thing': { type: 'noul', noul: 0.5 },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
}

type RowOptions = { pr?: number; verdict?: 'approve' | 'return'; gaps?: Gap[]; pTrue?: Record<number, number | null>; diffAt?: 'round1' | 'final'; criteria?: number; error?: string | null; skipped?: string | null }

const row = ({ pr = 1, verdict = 'approve', gaps = [], pTrue = {}, diffAt = 'round1', criteria = 3, error = null, skipped = null }: RowOptions = {}): Row => ({
  pr,
  issue: pr + 100,
  source: 'replay',
  merged: true,
  baseSha: 'base',
  diffAt,
  rounds: [{ round: 1, headSha: `head${pr}`, verdict, ms: 400000, gaps }],
  criteria: Array.from({ length: criteria }, (_, i) => ({ n: i + 1, text: `criterion ${i + 1}` })),
  diffTokens: 1000,
  skipped,
  jev: {
    answers: Array.from({ length: criteria }, (_, i) => i + 1).flatMap((n) => (pTrue[n] === null ? [] : [{ id: `criterion:${n}`, pTrue: pTrue[n] ?? 0.99 }])),
    costUsd: 0.004,
    ms: 2000,
    error,
  },
  sonnet: { answers: [{ id: 'criterion:1', pTrue: 0.9 }], costUsd: 0.01, ms: 9000, error: null },
})

const blocker = (criterion: number | null): Gap => ({ criterion, severity: 'blocker', area: 'api' })

// 5 round-1 returns (each unmet on criterion 1) and 15 approvals.
const fixture = ({ flaggedReturns, approvedPTrue }: { flaggedReturns: number; approvedPTrue: number }): Row[] => [
  ...Array.from({ length: 5 }, (_, i) => row({ pr: i + 1, verdict: 'return', gaps: [blocker(1)], pTrue: { 1: i < flaggedReturns ? 0.08 : 0.9 } })),
  ...Array.from({ length: 15 }, (_, i) => row({ pr: i + 6, pTrue: i === 0 ? { 2: approvedPTrue } : {} })),
]

type Store = Map<string, string>
type World = { deps: Deps; files: Store; logs: string[]; errs: string[]; fetched: string[]; execed: string[] }

const world = (opts: { files?: Store; env?: Record<string, string | undefined>; diff?: string; prBody?: string; fetch?: typeof fetch; issueComments?: { body: string; createdAt: string }[] } = {}): World => {
  const files: Store = opts.files ?? new Map()
  const logs: string[] = []
  const errs: string[] = []
  const fetched: string[] = []
  const execed: string[] = []
  const deps: Deps = {
    fetch:
      opts.fetch ??
      ((async (url: string | URL | Request) => {
        fetched.push(String(url))
        return String(url) === DECISIONS_URL
          ? new Response(JSON.stringify(DECISIONS_RESPONSE))
          : new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":[{"id":"criterion:1","p_true":0.88}]}' } }], usage: { cost: 0.012 } }))
      }) as typeof fetch),
    exec: async (cmd, args) => {
      execed.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'gh' && args[0] === 'pr') return JSON.stringify({ body: opts.prBody ?? 'Closes #101', baseRefOid: 'base0', headRefOid: 'headfinal', mergedAt: '2026-09-28T00:00:00Z' })
      if (cmd === 'gh' && args[0] === 'issue') return JSON.stringify({ comments: opts.issueComments ?? [{ body: SPEC, createdAt: '2026-09-27T00:00:00Z' }] })
      if (args[0] === 'diff') return opts.diff ?? 'diff --git a/x b/x\n+one\n'
      return ''
    },
    readDir: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
    readFile: async (path) => {
      const found = files.get(path)
      if (found === undefined) throw new Error(`ENOENT ${path}`)
      return found
    },
    writeFile: async (path, content) => {
      files.set(path, content)
    },
    log: (line) => logs.push(line),
    err: (line) => errs.push(line),
    env: opts.env ?? { OPENROUTER_API_KEY: 'sk-sentinel-123' },
  }
  return { deps, files, logs, errs, fetched, execed }
}

const throwing = (label: string) => async () => {
  throw new Error(`${label} must not be called`)
}

const rowsInDir = (dir: string, rows: Row[]): Store => new Map(rows.map((r) => [`${dir}/${r.pr}.json`, JSON.stringify(r)]))

describe('jev bench decision', () => {
  it('ships at the lowest threshold with zero clean-PR false positives', () => {
    const rows = fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })
    assert.equal(metrics(rows, 'jev', 0.85).cleanFlagged, 1)
    assert.equal(metrics(rows, 'jev', 0.9).cleanFlagged, 0)
    const d = decide(rows, 'jev')
    assert.equal(d.kind, 'ship')
    assert.equal(d.t, 0.9)
    assert.equal(d.text, 'DECISION: SHIP t=0.90')
    assert.equal(metrics(rows, 'jev', 0.9).saved, 2)
  })

  it('holds when no threshold is free of false positives', () => {
    const d = decide(fixture({ flaggedReturns: 2, approvedPTrue: 0.03 }), 'jev')
    assert.equal(d.text, 'DECISION: HOLD (no threshold without false positives)')
  })

  it('holds below 25% rounds saved', () => {
    assert.equal(decide(fixture({ flaggedReturns: 1, approvedPTrue: 0.12 }), 'jev').text, 'DECISION: HOLD t=0.90 saved=20%')
  })

  it('reports insufficient data under 20 rows or 5 round-1 returns', () => {
    const full = fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })
    assert.equal(decide(full.slice(1), 'jev').text, 'DECISION: INSUFFICIENT DATA (rows=19, returned=4)')
    const fewer = [...full.slice(0, 4), ...Array.from({ length: 16 }, (_, i) => row({ pr: i + 50 }))]
    assert.equal(decide(fewer, 'jev').text, 'DECISION: INSUFFICIENT DATA (rows=20, returned=4)')
    const finalDiff = [...full.slice(0, 4), row({ pr: 9, verdict: 'return', gaps: [blocker(1)], diffAt: 'final' }), ...full.slice(5)]
    assert.equal(decide(finalDiff, 'jev').text, 'DECISION: INSUFFICIENT DATA (rows=20, returned=4)')
  })

  it('ignores skipped rows and rows whose model call failed', () => {
    const full = fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })
    const noisy = [...full.slice(0, 19), row({ pr: 90, skipped: 'diff too large (40000 tokens)' }), row({ pr: 91, error: 'HTTP 500' })]
    assert.equal(decide(noisy, 'jev').text, 'DECISION: INSUFFICIENT DATA (rows=19, returned=5)')
  })
})

describe('jev bench metrics', () => {
  it('nit-only gaps count as met', () => {
    const rows = [row({ pr: 1, verdict: 'approve', gaps: [{ criterion: 1, severity: 'nit', area: 'api' }], pTrue: { 1: 0.05 } })]
    const m = metrics(rows, 'jev', 0.9)
    assert.equal(m.recall, null)
    assert.equal(m.precision, 0)
  })

  it('a flag on an unlabelled criterion is a precision miss, not a round saved', () => {
    const rows = [row({ pr: 1, verdict: 'return', gaps: [blocker(1)], pTrue: { 1: 0.5, 2: 0.05 } })]
    const m = metrics(rows, 'jev', 0.9)
    assert.equal(m.saved, 0)
    assert.equal(m.flaggedAny, 1)
    assert.equal(m.precision, 0)
    assert.equal(m.recall, 0)
    assert.equal(metrics(rows, 'jev', 0.5).saved, 1)
  })

  it('a missing answer is excluded, never counted as met', () => {
    const rows = [row({ pr: 1, verdict: 'return', gaps: [blocker(2)], pTrue: { 2: null } })]
    const m = metrics(rows, 'jev', 0.9)
    assert.equal(m.agreed, 2)
    assert.equal(m.recall, null)
    assert.equal(m.saved, 0)
    const clean = [row({ pr: 2, pTrue: { 2: null } })]
    assert.equal(metrics(clean, 'jev', 0.7).cleanFlagged, 0)
    assert.equal(metrics(clean, 'jev', 0.7).agreed, 2)
  })

  it('a returned round with no attributed gap is left out of criterion agreement', () => {
    const rows = [row({ pr: 1, verdict: 'return', gaps: [blocker(null)], pTrue: { 1: 0.01 } })]
    assert.equal(metrics(rows, 'jev', 0.9).agreed, 0)
  })

  it('unmet at t means 1 - pTrue >= t, boundary included', () => {
    const at = (pTrue: number) => metrics([row({ pr: 1, pTrue: { 1: pTrue } })], 'jev', 0.85).cleanFlagged
    assert.equal(at(0.15), 1)
    assert.equal(at(0.16), 0)
  })

  it('convention answers and a row without criteria never flag a PR', () => {
    const withConvention = { ...row({ pr: 1, criteria: 0 }), jev: { answers: [{ id: 'convention:comment', pTrue: 0.01 }], costUsd: 0.001, ms: 1, error: null } }
    const m = metrics([withConvention], 'jev', 0.7)
    assert.equal(m.cleanFlagged, 0)
    assert.equal(m.agreed, 0)
    const returned = { ...withConvention, rounds: [{ ...withConvention.rounds[0], verdict: 'return' as const, gaps: [blocker(null)] }] }
    assert.equal(metrics([returned], 'jev', 0.7).flaggedAny, 0)
  })

  it('an approve known only at the final head counts among clean PRs, never among round-1 returns', () => {
    const legacy = row({ pr: 1, diffAt: 'final', pTrue: { 1: 0.05 } })
    const m = metrics([legacy], 'jev', 0.9)
    assert.equal(m.clean, 1)
    assert.equal(m.cleanFlagged, 1)
    assert.equal(m.returned, 0)
    assert.equal(m.agreed, 0)
  })

  it('cost and wall time are the model means against the validator round mean', () => {
    const rows = [row({ pr: 1 }), { ...row({ pr: 2 }), jev: { answers: [], costUsd: 0.008, ms: 4000, error: null } }]
    const m = metrics(rows, 'jev', 0.9)
    assert.ok(Math.abs((m.costMean ?? NaN) - 0.006) < 1e-12)
    assert.equal(m.msMean, 3000)
    assert.equal(m.validatorMsMean, 400000)
    const line = renderTable(rows).find((l) => /^jev\s+0\.90/.test(l)) ?? ''
    assert.match(line, /vs n\/a/)
  })

  it('no gate baseline shows zero false positives and zero rounds saved', () => {
    const none = renderTable(fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })).find((l) => /^none\s/.test(l)) ?? ''
    assert.match(none, /0\/15/)
    assert.match(none, /0\/5/)
  })
})

describe('jev bench cli', () => {
  it('offline prints every threshold and baseline and never calls fetch or exec', async () => {
    const w = world({ files: rowsInDir('/tmp/rows', fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })) })
    const code = await main(['--offline', '--dir', '/tmp/rows'], { ...w.deps, fetch: throwing('fetch') as unknown as typeof fetch, exec: throwing('exec') })
    assert.equal(code, 0)
    for (const model of ['jev', 'sonnet'])
      for (const t of ['0.70', '0.80', '0.85', '0.90', '0.95']) assert.ok(w.logs.some((l) => new RegExp(`^${model}\\s+${t}\\s`).test(l)), `${model} ${t}`)
    assert.equal(w.logs.filter((l) => /^none\s/.test(l)).length, 1)
    assert.equal(w.logs[w.logs.length - 1], 'DECISION: SHIP t=0.90')
    assert.ok(w.logs.some((l) => l.startsWith('baseline sonnet: DECISION:')))
    assert.deepEqual(renderTable(fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })), w.logs)
  })

  it('empty dir is insufficient data, malformed file exits 1 naming it', async () => {
    const empty = world()
    assert.equal(await main(['--offline', '--dir', '/tmp/none'], empty.deps), 0)
    assert.equal(empty.logs[empty.logs.length - 1], 'DECISION: INSUFFICIENT DATA (rows=0, returned=0)')
    const broken = world({ files: new Map([['/tmp/bad/12.json', '{not json']]) })
    assert.equal(await main(['--offline', '--dir', '/tmp/bad'], broken.deps), 1)
    assert.match(broken.errs.join('\n'), /\/tmp\/bad\/12\.json/)
  })

  it('offline reads bench/jev by default and starts with a header', async () => {
    const w = world({ files: rowsInDir('bench/jev', fixture({ flaggedReturns: 2, approvedPTrue: 0.12 })) })
    assert.equal(await main(['--offline'], w.deps), 0)
    assert.match(w.logs[0], /^model\s/)
    assert.equal(w.logs[w.logs.length - 1], 'DECISION: SHIP t=0.90')
  })

  it('collect writes bench/jev/<pr>.json with the documented row shape', async () => {
    const w = world()
    assert.equal(await main(['collect', '--pr', '7'], w.deps), 0)
    const written = JSON.parse(w.files.get('bench/jev/7.json') ?? 'null')
    for (const key of ['pr', 'issue', 'source', 'merged', 'baseSha', 'rounds', 'criteria', 'diffTokens', 'skipped', 'jev', 'sonnet']) assert.ok(key in written, key)
    assert.equal(written.pr, 7)
    assert.equal(written.issue, 101)
    assert.equal(written.merged, true)
    assert.equal(written.baseSha, 'base0')
    assert.equal(written.skipped, null)
    assert.deepEqual(written.criteria, parseCriteria(SPEC))
    assert.deepEqual(Object.keys(written.jev).sort(), ['answers', 'costUsd', 'error', 'ms'])
    assert.deepEqual(Object.keys(written.sonnet).sort(), ['answers', 'costUsd', 'error', 'ms'])
    assert.equal(written.sonnet.costUsd, 0.012)
  })

  it('collect diffs base...head without the lockfile and the bundle', async () => {
    const w = world()
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    assert.ok(w.execed.includes('git diff base0...headfinal -- . :!pnpm-lock.yaml :!public/bundle.js'))
  })

  it('the diff cap is 32000 estimated tokens of chars / 4, never truncated', async () => {
    assert.equal(JEV_DIFF_CAP_TOKENS, 32000)
    const atCap = world({ diff: 'x'.repeat(128000) })
    await main(['collect', '--pr', '7', '--dir', 'out'], atCap.deps)
    assert.equal(JSON.parse(atCap.files.get('out/7.json') ?? 'null').skipped, null)
    assert.equal(atCap.fetched.length, 2)
    const over = world({ diff: 'x'.repeat(128001) })
    await main(['collect', '--pr', '7', '--dir', 'out'], over.deps)
    assert.equal(JSON.parse(over.files.get('out/7.json') ?? 'null').skipped, 'diff too large (32001 tokens)')
  })

  it('both models get one question per parsed criterion plus every convention, on the same diff and spec', async () => {
    const bodies = new Map<string, any>()
    const w = world({
      diff: 'DIFFTEXT',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        bodies.set(String(url), JSON.parse(String(init?.body)))
        return new Response(JSON.stringify(String(url) === DECISIONS_URL ? DECISIONS_RESPONSE : { choices: [{ message: { content: '{"answers":[]}' } }] }))
      }) as typeof fetch,
    })
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    const ids = [...parseCriteria(SPEC).map((c) => `criterion:${c.n}`), ...CONVENTION_QUESTIONS.map((q) => q.id)]
    const jev = bodies.get(DECISIONS_URL)
    assert.equal(jev.model, 'typesafe/jev-1.13')
    assert.deepEqual(Object.keys(jev.questions), ids)
    assert.equal(jev.state.diff, 'DIFFTEXT')
    assert.equal(jev.state.spec, SPEC)
    const sonnet = bodies.get(CHAT_URL)
    assert.equal(sonnet.model, SONNET_BASELINE_MODEL)
    const prompt = JSON.stringify(sonnet.messages)
    assert.match(prompt, /p_true/)
    assert.ok(prompt.includes('DIFFTEXT'))
    for (const id of ids) assert.ok(prompt.includes(id), id)
  })

  it('--sonnet-model overrides the baseline model', async () => {
    let model = ''
    const w = world({
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === CHAT_URL) model = JSON.parse(String(init?.body)).model
        return new Response(JSON.stringify(DECISIONS_RESPONSE))
      }) as typeof fetch,
    })
    await main(['collect', '--pr', '7', '--dir', 'out', '--sonnet-model', 'acme/other-1'], w.deps)
    assert.equal(model, 'acme/other-1')
  })

  it('collect labels an older PR approved at round 1 from its body, diffed at the final head', async () => {
    const w = world({ prBody: 'Closes #101\n\nValidator: round 1 verdict approve with 2 nits.' })
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.equal(written.diffAt, 'final')
    assert.equal(written.rounds[0].verdict, 'approve')
    assert.equal(metrics([written], 'jev', 0.9).returned, 0)
  })

  it('collect refuses without OPENROUTER_API_KEY', async () => {
    const w = world({ env: {} })
    assert.equal(await main(['collect', '--pr', '259'], w.deps), 1)
    assert.deepEqual(w.errs, ['OPENROUTER_API_KEY not set'])
    assert.deepEqual(w.fetched, [])
    assert.deepEqual(w.execed, [])
  })

  it('collect writes a row with both models and diffs at the round-1 head', async () => {
    const block = '```json factory-verify\n[{"round":1,"headSha":"r1sha","verdict":"return","ms":1000,"gaps":[{"criterion":2,"severity":"should","area":"api"}]}]\n```'
    const w = world({ prBody: `Closes #101\n\n${block}` })
    assert.equal(await main(['collect', '--pr', '7', '--dir', 'out'], w.deps), 0)
    assert.ok(w.execed.some((c) => c.includes('base0...r1sha')))
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.equal(written.diffAt, 'round1')
    assert.equal(written.rounds[0].headSha, 'r1sha')
    assert.equal(written.criteria.length, 3)
    assert.deepEqual(written.jev.answers.slice(0, 2), [{ id: 'criterion:1', pTrue: 0.91 }, { id: 'criterion:2', pTrue: 0.2 }])
    assert.equal(written.jev.costUsd, 0.000019992)
    assert.deepEqual(written.sonnet.answers, [{ id: 'criterion:1', pTrue: 0.88 }])
    assert.equal(written.source, 'replay')
    assert.deepEqual(w.fetched.sort(), [CHAT_URL, DECISIONS_URL].sort())
  })

  it('collect keeps an older PR at its final head', async () => {
    const w = world()
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    assert.ok(w.execed.some((c) => c.includes('base0...headfinal')))
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.equal(written.diffAt, 'final')
    assert.deepEqual(written.rounds, [])
  })

  it('collect goes on after a PR fails to prepare', async () => {
    const w = world()
    const exec = w.deps.exec
    const deps: Deps = {
      ...w.deps,
      exec: async (cmd, args) => {
        if (cmd === 'gh' && args[0] === 'pr' && args[2] === '1') throw new Error('no pull request found')
        return exec(cmd, args)
      },
    }
    assert.equal(await main(['collect', '--pr', '1', '--pr', '2', '--dir', 'out'], deps), 0)
    assert.equal(w.files.has('out/1.json'), false)
    assert.ok(w.files.has('out/2.json'))
    assert.match(w.logs.join('\n'), /#1: no pull request found/)
  })

  it('collect skips a PR whose round-1 head git cannot resolve', async () => {
    const block = '```json factory-verify\n[{"round":1,"headSha":"gone","verdict":"return","ms":1,"gaps":[]}]\n```'
    const w = world({ prBody: `Closes #101\n\n${block}` })
    const exec = w.deps.exec
    const deps: Deps = {
      ...w.deps,
      exec: async (cmd, args) => {
        if (args[0] === 'diff') throw new Error('bad revision')
        return exec(cmd, args)
      },
    }
    assert.equal(await main(['collect', '--pr', '7', '--dir', 'out'], deps), 0)
    assert.equal(w.files.size, 0)
    assert.match(w.logs.join('\n'), /#7: round-1 head gone not found/)
    assert.deepEqual(w.fetched, [])
  })

  it('collect skips a PR the factory did not produce', async () => {
    const noIssue = world({ prBody: 'just a change' })
    assert.equal(await main(['collect', '--pr', '7', '--dir', 'out'], noIssue.deps), 0)
    assert.equal(noIssue.files.size, 0)
    const noSpec = world({ issueComments: [{ body: 'looks good', createdAt: '2026-09-27T00:00:00Z' }] })
    await main(['collect', '--pr', '7', '--dir', 'out'], noSpec.deps)
    assert.equal(noSpec.files.size, 0)
    assert.match(noSpec.logs.join('\n'), /no spec comment/)
  })

  it('collect skips an oversized diff without asking a model', async () => {
    const w = world({ diff: 'x'.repeat((JEV_DIFF_CAP_TOKENS + 1) * 4) })
    assert.equal(await main(['collect', '--pr', '7', '--dir', 'out'], w.deps), 0)
    assert.deepEqual(w.fetched, [])
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.equal(written.skipped, `diff too large (${JEV_DIFF_CAP_TOKENS + 1} tokens)`)
    assert.equal(written.jev, null)
    assert.equal(written.sonnet, null)
  })

  it('an unparseable baseline answer is an error on that row and is never retried', async () => {
    let chat = 0
    const w = world({
      fetch: (async (url: string | URL | Request) => {
        if (String(url) === CHAT_URL) {
          chat++
          return new Response(JSON.stringify({ choices: [{ message: { content: 'sure, looks fine' } }] }))
        }
        return new Response(JSON.stringify(DECISIONS_RESPONSE))
      }) as typeof fetch,
    })
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.equal(chat, 1)
    assert.equal(written.sonnet.error, 'unparseable answer')
    assert.equal(written.jev.error, null)
  })

  it('rows never contain the api key', async () => {
    const seen: string[] = []
    const w = world({
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push(String((init?.headers as Record<string, string>).authorization))
        if (String(url) === CHAT_URL) throw new Error('connect failed for Bearer sk-sentinel-123')
        return new Response(JSON.stringify(DECISIONS_RESPONSE))
      }) as typeof fetch,
    })
    await main(['collect', '--pr', '7', '--dir', 'out'], w.deps)
    assert.ok(seen.every((h) => h === 'Bearer sk-sentinel-123'))
    assert.ok([...w.files.values()].length > 0)
    for (const content of [...w.files.values(), ...w.logs, ...w.errs]) assert.ok(!content.includes('sk-sentinel-123'))
    assert.match(w.files.get('out/7.json') ?? '', /\[redacted\]/)
  })

  it('import merges an artifact into the jev field and keeps the rest of the row', async () => {
    const existing = row({ pr: 7, verdict: 'return', gaps: [blocker(1)] })
    const w = world({ files: new Map([['out/7.json', JSON.stringify({ ...existing, jev: null })], ['a.json', JSON.stringify({ pr: 7, head: 'h', status: 'ok', response: { ...DECISIONS_RESPONSE, answers: { 'ac-1': { type: 'noul', noul: 0.3 }, 'conv-comment': { type: 'noul', noul: 0.9 }, 'zzz-1': { type: 'noul', noul: 0.9 } } } })]]) })
    assert.equal(await main(['import', 'a.json', '--pr', '7', '--dir', 'out'], w.deps), 0)
    const written = JSON.parse(w.files.get('out/7.json') ?? 'null')
    assert.deepEqual(written.jev.answers, [{ id: 'criterion:1', pTrue: 0.3 }, { id: 'convention:comment', pTrue: 0.9 }])
    assert.equal(written.source, 'replay')
    assert.equal(written.rounds.length, 1)
    assert.deepEqual(w.fetched, [])
  })

  it('import creates a shadow row when none exists, and refuses another PR', async () => {
    const artifact = JSON.stringify({ pr: 7, head: 'h', status: 'ok', response: DECISIONS_RESPONSE })
    const w = world({ files: new Map([['a.json', artifact]]) })
    assert.equal(await main(['import', 'a.json', '--pr', '7', '--dir', 'out'], w.deps), 0)
    assert.equal(JSON.parse(w.files.get('out/7.json') ?? 'null').source, 'shadow')
    const other = world({ files: new Map([['a.json', artifact]]) })
    assert.equal(await main(['import', 'a.json', '--pr', '8', '--dir', 'out'], other.deps), 1)
    assert.equal(other.files.has('out/8.json'), false)
  })
})

describe('jev questions', () => {
  it('parses the factory-verify block, empty on a body without one', () => {
    const body = ['Closes #5', '', '```json factory-verify', JSON.stringify([{ round: 1, headSha: 'abc', verdict: 'return', ms: 5, gaps: [{ criterion: 3, severity: 'should', area: 'api' }, { severity: 'blocker', area: 'tests' }] }]), '```'].join('\n')
    assert.deepEqual(parseVerifyBlock(body), [
      { round: 1, headSha: 'abc', verdict: 'return', ms: 5, gaps: [{ criterion: 3, severity: 'should', area: 'api' }, { criterion: null, severity: 'blocker', area: 'tests' }] },
    ])
    assert.deepEqual(parseVerifyBlock(PR_259_BODY), [])
    assert.deepEqual(parseVerifyBlock('```json factory-verify\nnot json\n```'), [])
  })

  it('builds one criterion question per acceptance criterion plus conventions', () => {
    const criteria = [{ n: 1, text: 'a' }, { n: 2, text: 'b' }]
    const request = decisionRequest({ diff: 'D', spec: 'S', questions: [...criterionQuestions(criteria), ...CONVENTION_QUESTIONS] })
    assert.equal(request.model, 'typesafe/jev-1.13')
    assert.deepEqual(request.state, { diff: 'D', spec: 'S' })
    const ids = Object.keys(request.questions)
    assert.deepEqual(ids.slice(0, 2), ['criterion:1', 'criterion:2'])
    assert.equal(ids.length, 2 + CONVENTION_QUESTIONS.length)
    assert.ok(CONVENTION_QUESTIONS.length > 0 && CONVENTION_QUESTIONS.every((q) => q.id.startsWith('convention:')))
    assert.match(request.questions['criterion:2'].instructions, /criterion 2/)
  })

  it('parses decisions into pTrue and cost', () => {
    assert.deepEqual(parseDecisions(DECISIONS_RESPONSE), {
      answers: [{ id: 'criterion:1', pTrue: 0.91 }, { id: 'criterion:2', pTrue: 0.2 }, { id: 'convention:comment', pTrue: 0.95 }],
      costUsd: 0.000019992,
    })
    assert.deepEqual(parseDecisions('nope'), { answers: [], costUsd: null })
  })

  it('parses the baseline answer, tolerating a fenced reply', () => {
    const reply = { choices: [{ message: { content: '```json\n{"answers":[{"id":"criterion:1","p_true":0.7},{"id":"criterion:2","p_true":4}]}\n```' } }], usage: { cost: 0.01 } }
    assert.deepEqual(parseSonnet(reply), { answers: [{ id: 'criterion:1', pTrue: 0.7 }], costUsd: 0.01 })
    assert.deepEqual(parseSonnet({}), { error: 'unparseable answer' })
  })
})

describe('docs', () => {
  it('document the jev bench, offline mode, decision rule and never-approves', () => {
    assert.match(docsText, /pnpm bench:jev/)
    assert.match(docsText, /--offline/)
    assert.match(docsText, /makes no network call/)
    assert.match(docsText, /lowest threshold with zero clean-PR false positives/)
    assert.match(docsText, /at least 25% of the round-1 returns/)
    assert.match(docsText, /at least 20 PRs and at least 5 round-1 returns/)
    assert.match(docsText, /Jev never approves a branch/)
    assert.match(docsText, /factory-verify/)
  })
})
