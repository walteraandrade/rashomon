import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { closedIssue, estimateTokens, findSpec } from '../src/jev.js'
import { hasVerifyBlock, legacyRounds, parseCriteria, parseVerifyBlock, renderTable, type ModelRun, type Row } from './jev/metrics.js'
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
  sonnetRequest,
} from './jev/questions.js'

export type Deps = {
  fetch: typeof fetch
  exec: (cmd: string, args: string[]) => Promise<string>
  readDir: (dir: string) => Promise<string[]>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  log: (line: string) => void
  err?: (line: string) => void
  env?: Record<string, string | undefined>
}

const DEFAULT_DIR = 'bench/jev'
const REQUEST_TIMEOUT_MS = 180_000
const KEY_MISSING = 'OPENROUTER_API_KEY not set'

type Args = { command: string | null; positional: string[]; prs: number[]; dir: string; offline: boolean; sonnetModel: string }

const parseArgs = (argv: string[]): Args =>
  argv.reduce<Args & { pending: string | null }>(
    (acc, arg) => {
      if (acc.pending !== null) {
        const key = acc.pending
        return {
          ...acc,
          pending: null,
          prs: key === '--pr' ? [...acc.prs, Number(arg)] : acc.prs,
          dir: key === '--dir' ? arg : acc.dir,
          sonnetModel: key === '--sonnet-model' ? arg : acc.sonnetModel,
        }
      }
      if (arg === '--offline') return { ...acc, offline: true }
      if (arg === '--pr' || arg === '--dir' || arg === '--sonnet-model') return { ...acc, pending: arg }
      if (arg.startsWith('--')) return acc
      return acc.command === null && (arg === 'collect' || arg === 'import') ? { ...acc, command: arg } : { ...acc, positional: [...acc.positional, arg] }
    },
    { command: null, positional: [], prs: [], dir: DEFAULT_DIR, offline: false, sonnetModel: SONNET_BASELINE_MODEL, pending: null },
  )

const isRow = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && typeof (v as Row).pr === 'number' && Array.isArray((v as Row).rounds) && Array.isArray((v as Row).criteria)

const rowPath = (dir: string, pr: number) => `${dir}/${pr}.json`
const serialize = (row: Row) => JSON.stringify(row, null, 2) + '\n'

const readRows = async (deps: Deps, dir: string): Promise<{ rows: Row[] } | { bad: string }> => {
  const names = (await deps.readDir(dir).catch(() => [])).filter((n) => n.endsWith('.json')).sort()
  const rows: Row[] = []
  for (const name of names) {
    const path = `${dir}/${name}`
    try {
      const parsed: unknown = JSON.parse(await deps.readFile(path))
      if (!isRow(parsed)) return { bad: `${path}: not a bench row` }
      rows.push(parsed)
    } catch (e) {
      return { bad: `${path}: ${e instanceof Error ? e.message : e}` }
    }
  }
  return { rows: rows.sort((a, b) => a.pr - b.pr) }
}

const offline = async (deps: Deps, dir: string): Promise<number> => {
  const read = await readRows(deps, dir)
  if ('bad' in read) {
    ;(deps.err ?? deps.log)(read.bad)
    return 1
  }
  renderTable(read.rows).forEach(deps.log)
  return 0
}

type Prepared = { row: Row; spec: string; diff: string } | { skip: string }

const json = (text: string): unknown => JSON.parse(text)

const prepare = async (deps: Deps, pr: number): Promise<Prepared> => {
  const view = json(await deps.exec('gh', ['pr', 'view', String(pr), '--json', 'body,baseRefOid,headRefOid,mergedAt'])) as {
    body: string | null
    baseRefOid: string
    headRefOid: string
    mergedAt: string | null
  }
  const body = view.body ?? ''
  const issue = closedIssue(body)
  if (issue === null) return { skip: `#${pr}: no "Closes #N" in the body, not a factory PR` }
  const thread = json(await deps.exec('gh', ['issue', 'view', String(issue), '--json', 'comments'])) as { comments: { body: string; createdAt: string }[] }
  const spec = findSpec(thread.comments)
  if (spec === null) return { skip: `#${pr}: issue #${issue} has no spec comment` }
  const verify = parseVerifyBlock(body)
  const r1 = verify.find((r) => r.round === 1)
  if (hasVerifyBlock(body) && r1 === undefined) return { skip: `#${pr}: round-1 verdict not recorded` }
  const rounds = hasVerifyBlock(body) ? verify : legacyRounds(body, view.headRefOid)
  const diffAt = r1 === undefined ? 'final' : 'round1'
  const head = r1 === undefined ? view.headRefOid : r1.headSha
  if (head === '') return { skip: `#${pr}: round-1 head not recorded` }
  await deps.exec('git', ['fetch', 'origin', `refs/pull/${pr}/head`]).catch(() => '')
  const diff = await deps
    .exec('git', ['diff', `${view.baseRefOid}...${head}`, '--', '.', ':!pnpm-lock.yaml'])
    .catch((e: unknown) => (diffAt === 'round1' ? null : Promise.reject(e)))
  if (diff === null) return { skip: `#${pr}: round-1 head ${head} not found` }
  const criteria = parseCriteria(spec)
  const diffTokens = estimateTokens(diff)
  const row: Row = {
    pr,
    issue,
    source: 'replay',
    merged: view.mergedAt !== null,
    baseSha: view.baseRefOid,
    diffAt,
    rounds,
    criteria,
    diffTokens,
    skipped: diffTokens > JEV_DIFF_CAP_TOKENS ? `diff too large (${diffTokens} tokens)` : null,
    jev: null,
    sonnet: null,
  }
  return { row, spec: criteria.length > 0 ? spec : '', diff }
}

const failure = (key: string, e: unknown): string => (e instanceof Error ? e.message : String(e)).split(key).join('[redacted]')

const ask = async (deps: Deps, key: string, url: string, body: unknown): Promise<{ ok: true; json: unknown; ms: number } | { ok: false; error: string; ms: number }> => {
  const started = Date.now()
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, ms: Date.now() - started }
    return { ok: true, json: await res.json(), ms: Date.now() - started }
  } catch (e) {
    return { ok: false, error: failure(key, e), ms: Date.now() - started }
  }
}

const failed = (error: string, ms: number): ModelRun => ({ answers: [], costUsd: null, ms, error })

const askJev = async (deps: Deps, key: string, request: ReturnType<typeof decisionRequest>): Promise<ModelRun> => {
  const res = await ask(deps, key, DECISIONS_URL, request)
  if (!res.ok) return failed(res.error, res.ms)
  const { answers, costUsd } = parseDecisions(res.json)
  return answers.length === 0 ? failed('no answers', res.ms) : { answers, costUsd, ms: res.ms, error: null }
}

const askSonnet = async (deps: Deps, key: string, request: ReturnType<typeof sonnetRequest>): Promise<ModelRun> => {
  const res = await ask(deps, key, CHAT_URL, request)
  if (!res.ok) return failed(res.error, res.ms)
  const parsed = parseSonnet(res.json)
  return 'error' in parsed ? failed(parsed.error, res.ms) : { ...parsed, ms: res.ms, error: null }
}

const collect = async (deps: Deps, args: Args): Promise<number> => {
  const key = (deps.env ?? process.env).OPENROUTER_API_KEY ?? ''
  if (key === '') {
    ;(deps.err ?? deps.log)(KEY_MISSING)
    return 1
  }
  if (args.prs.length === 0) {
    ;(deps.err ?? deps.log)('collect needs --pr <n>')
    return 1
  }
  for (const pr of args.prs) {
    const prepared = await prepare(deps, pr).then(
      (p) => p,
      (e: unknown) => ({ skip: `#${pr}: ${failure(key, e)}` }),
    )
    if ('skip' in prepared) {
      deps.log(prepared.skip)
      continue
    }
    const { row, spec, diff } = prepared
    if (row.skipped !== null) {
      await deps.writeFile(rowPath(args.dir, pr), serialize(row))
      deps.log(`#${pr}: ${row.skipped}`)
      continue
    }
    const questions = [...criterionQuestions(row.criteria), ...CONVENTION_QUESTIONS]
    const [jev, sonnet] = await Promise.all([
      askJev(deps, key, decisionRequest({ diff, spec, questions })),
      askSonnet(deps, key, sonnetRequest({ diff, spec, questions, model: args.sonnetModel })),
    ])
    await deps.writeFile(rowPath(args.dir, pr), serialize({ ...row, jev, sonnet }))
    deps.log(`#${pr}: jev ${jev.error ?? 'ok'}, sonnet ${sonnet.error ?? 'ok'}`)
  }
  return 0
}

type Artifact = { pr: number; head?: string; status?: string; tokens?: number; response?: unknown }

const importArtifact = async (deps: Deps, args: Args): Promise<number> => {
  const fail = (line: string) => {
    ;(deps.err ?? deps.log)(line)
    return 1
  }
  const [path] = args.positional
  const [pr] = args.prs
  if (path === undefined || pr === undefined) return fail('import needs <artifact.json> --pr <n>')
  return merge(deps, args, path, pr, fail).catch((e: unknown) => fail(`${path}: ${e instanceof Error ? e.message : String(e)}`))
}

const merge = async (deps: Deps, args: Args, path: string, pr: number, fail: (line: string) => number): Promise<number> => {
  const artifact = json(await deps.readFile(path)) as Artifact
  if (artifact.pr !== pr) return fail(`${path}: artifact is for PR ${artifact.pr}, not ${pr}`)
  const existing = await deps.readFile(rowPath(args.dir, pr)).then(
    (t): Row | null => json(t) as Row,
    () => null,
  )
  const fresh = existing === null ? await prepare(deps, pr) : null
  if (fresh !== null && 'skip' in fresh) return fail(fresh.skip)
  const base: Row = existing ?? { ...(fresh as { row: Row }).row, source: 'shadow' }
  const decisions = parseDecisions(artifact.response)
  const jev: ModelRun =
    artifact.status === 'ok' ? { answers: decisions.answers, costUsd: decisions.costUsd, ms: null, error: null } : failed(artifact.status ?? 'unknown', 0)
  const tooLarge = artifact.status === 'too-large' && base.skipped === null ? `diff too large (${artifact.tokens ?? 0} tokens)` : base.skipped
  await deps.writeFile(rowPath(args.dir, pr), serialize({ ...base, jev, skipped: tooLarge }))
  deps.log(`#${pr}: jev answers imported from ${path}`)
  return 0
}

export const main = async (argv: string[], deps: Deps): Promise<number> => {
  const args = parseArgs(argv)
  if (args.offline) return offline(deps, args.dir)
  if (args.command === 'collect') return collect(deps, args)
  if (args.command === 'import') return importArtifact(deps, args)
  ;(deps.err ?? deps.log)('usage: pnpm bench:jev collect --pr <n>... | import <artifact.json> --pr <n> | --offline [--dir <dir>]')
  return 1
}

const run = async () => {
  const exec = promisify(execFile)
  const code = await main(process.argv.slice(2), {
    fetch,
    exec: async (cmd, args) => (await exec(cmd, args, { maxBuffer: 256 * 1024 * 1024 })).stdout,
    readDir: (dir) => readdir(dir),
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: async (path, content) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    },
    log: (line) => console.log(line),
    err: (line) => console.error(line),
  })
  process.exitCode = code
}

if (import.meta.url === `file://${process.argv[1]}`) await run()
