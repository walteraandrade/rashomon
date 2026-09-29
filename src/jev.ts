import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

export const MODEL = 'typesafe/jev-1.13'
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
export const GITHUB_API = 'https://api.github.com'
export const ARTIFACT = 'jev-review.json'
export const MARKER = '<!-- jev-review -->'
export const BOT = 'github-actions[bot]'
export const TOKEN_CAP = 32000
const DECISIONS_TIMEOUT_MS = 120_000
const PAGE = 100

export type Criterion = { n: number; text: string }
export type Question = { id: string; type: 'noul'; question: string; criteria: { true: string; false: string } }
export type Answer = { id: string; answer: 'yes' | 'no' | 'unknown'; probability: number | null }
export type SpecComment = { body: string; createdAt: string }
export type Status = 'ok' | 'too-large' | 'no-key' | 'api-error'
export type Git = (args: string[]) => Promise<string>
export type Write = (path: string, content: string) => Promise<void>
export type Env = Record<string, string | undefined>
export type Sized = { diff: string; spec: string; commits: string; questions: (Question | string)[] }
export type Rendered = { questions: Question[]; answers: Answer[]; cost: number | null; hasSpec: boolean }

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

const questionText = (q: Question | string) => (typeof q === 'string' ? q : q.question)

const totalTokens = ({ diff, spec, commits, questions }: Sized): number =>
  estimateTokens(diff + spec + commits) + questions.reduce((max, q) => Math.max(max, estimateTokens(questionText(q))), 0)

export const overCap = (input: Sized): number | null => {
  const total = totalTokens(input)
  return total > TOKEN_CAP ? total : null
}

// A heading is a `#` line or a `**` line, with an optional `5.` number.
const headingOf = (name: string) => new RegExp(String.raw`^\s*(?:#{1,6}\s+|\*\*)\s*(?:\d+\.\s*)?${name}\b`, 'i')
const GOAL = headingOf('goal')
const API = headingOf('api')
const CRITERIA = headingOf('acceptance criteria')
const SECTION_END = /^\s{0,3}#{1,6}\s|^\*\*[^*]+\*\*:?\s*$/

const hasSpecSections = (body: string): boolean => {
  const lines = body.split('\n')
  return [GOAL, API, CRITERIA].every((heading) => lines.some((line) => heading.test(line)))
}

export const findSpec = (comments: SpecComment[]): string | null => {
  const found = comments
    .map((c, i) => ({ c, i, at: Date.parse(c.createdAt) || 0 }))
    .filter(({ c }) => hasSpecSections(c.body))
    .sort((a, b) => b.at - a.at || b.i - a.i)[0]
  return found ? found.c.body : null
}

export const parseCriteria = (spec: string): Criterion[] => {
  const lines = spec.split('\n')
  const start = lines.findIndex((line) => CRITERIA.test(line))
  if (start < 0) return []
  const end = lines.findIndex((line, i) => i > start && SECTION_END.test(line))
  const items = lines.slice(start + 1, end < 0 ? undefined : end).reduce<{ n: number; lines: string[] }[]>((acc, line) => {
    const m = /^(\d+)\.\s+(.*)$/.exec(line)
    if (m) return [...acc, { n: Number(m[1]), lines: [m[2]] }]
    return acc.length ? [...acc.slice(0, -1), { ...acc[acc.length - 1], lines: [...acc[acc.length - 1].lines, line] }] : acc
  }, [])
  return items.map(({ n, lines: parts }) => ({ n, text: parts.join('\n').trim() }))
}

export const closedIssue = (prBody: string): number | null => {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(prBody)
  return m ? Number(m[1]) : null
}

// Every question is worded so that "true" means the diff conforms: one polarity for the whole table.
const convention = (id: string, question: string, yes: string, no: string): Question => ({ id, type: 'noul', question, criteria: { true: yes, false: no } })

export const CONVENTIONS: Question[] = [
  convention(
    'conv-comment',
    'Does every comment the diff adds state a constraint or a non-obvious reason, rather than history, a retelling of the issue, or what the next line plainly does?',
    'Every added comment states a constraint or a non-obvious why, or the diff adds no comment.',
    'At least one added comment narrates history, cites an issue or PR story, or restates the code.',
  ),
  convention(
    'conv-scoring-docs',
    'If the diff changes scoring in src/graph.ts, src/scoring.ts or src/aggregate.ts, does it also change web/routes/como-ler/+page.svelte or docs/terms.md?',
    'The diff does not change scoring in those files, or it also changes web/routes/como-ler/+page.svelte or docs/terms.md.',
    'The diff changes scoring in those files and neither web/routes/como-ler/+page.svelte nor docs/terms.md appears in it.',
  ),
  convention(
    'conv-route-docs',
    'If the diff adds a route or a query parameter, does it also change docs/api.md?',
    'The diff adds no route or query parameter, or it also changes docs/api.md.',
    'The diff adds a route or a query parameter and docs/api.md does not appear in it.',
  ),
  convention(
    'conv-class',
    'Is every `class` the diff adds a Data.TaggedError or a Context.Service?',
    'The diff adds no class, or every added class is a Data.TaggedError or a Context.Service.',
    'The diff adds a class that is neither a Data.TaggedError nor a Context.Service.',
  ),
  convention(
    'conv-issue-test',
    'Does the diff avoid adding any test file named after an issue, such as <issue>-acceptance.test.ts?',
    'No added test file has a name that starts with an issue number.',
    'The diff adds a test file whose name starts with an issue number.',
  ),
  convention(
    'conv-commits',
    'Is every commit subject in the commits list short, imperative and in English?',
    'Every commit subject is short, imperative and written in English.',
    'At least one commit subject is long, not imperative, or not in English.',
  ),
]

export const buildQuestions = (criteria: Criterion[]): Question[] => [
  ...criteria.map(({ n, text }) => ({
    id: `ac-${n}`,
    type: 'noul' as const,
    question: `Does the diff implement acceptance criterion ${n} as stated: ${text}?`,
    criteria: {
      true: 'The diff contains the change the criterion describes, complete as stated.',
      false: 'The diff lacks the change, implements only part of it, or contradicts it.',
    },
  })),
  ...CONVENTIONS,
]

// The Decisions API takes `questions` as an object keyed by id, each with `instructions`.
export const buildRequest = ({ diff, spec, commits, questions }: { diff: string; spec: string; commits: string; questions: Question[] }) => ({
  model: MODEL,
  state: { diff, spec, commits },
  questions: Object.fromEntries(questions.map(({ id, type, question, criteria }) => [id, { type, instructions: question, criteria }])),
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const asJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// `noul` is the probability of yes, so 0.5 is the line between the two answers.
export const parseAnswers = (raw: unknown): { answers: Answer[]; cost: number | null } => {
  const body = asJson(raw)
  const answers = isRecord(body) && isRecord(body.answers) ? body.answers : {}
  const cost = isRecord(body) && isRecord(body.usage) && typeof body.usage.cost === 'number' ? body.usage.cost : null
  return {
    answers: Object.entries(answers).map(([id, a]) => {
      const p = isRecord(a) && a.type === 'noul' && typeof a.noul === 'number' && Number.isFinite(a.noul) ? a.noul : null
      return { id, answer: p === null ? 'unknown' : p >= 0.5 ? 'yes' : 'no', probability: p }
    }),
    cost,
  }
}

const TITLE = '## Jev: revisão sombra'
const cell = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
const clip = (text: string, max = 110) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const ANSWER_LABEL = { yes: 'sim', no: 'não', unknown: '—' } as const

const costText = (cost: number | null) => (cost === null ? '—' : `$${cost.toFixed(9).replace(/\.?0+$/, '')}`)

export const renderComment = ({ questions, answers, cost, hasSpec }: Rendered): string => {
  const byId = new Map(answers.map((a) => [a.id, a]))
  const known = new Set(questions.map((q) => q.id))
  const row = (label: string, a: Answer | undefined) =>
    `| ${label} | ${a ? ANSWER_LABEL[a.answer] : '—'} | ${a && a.probability !== null ? a.probability.toFixed(2) : '—'} |`
  const rows = [
    ...questions.map((q) => row(cell(`\`${q.id}\` ${clip(q.question)}`), byId.get(q.id))),
    ...answers.filter((a) => !known.has(a.id)).map((a) => row(cell(`\`${a.id}\``), a)),
  ]
  return [
    MARKER,
    TITLE,
    '',
    ...(hasSpec ? [] : ['Sem spec na issue fechada por este PR: só as perguntas de convenção rodaram.', '']),
    '| Pergunta | Resposta | Probabilidade |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `Custo: ${costText(cost)}`,
  ].join('\n')
}

export const tooLargeComment = (tokens: number): string => [MARKER, TITLE, '', `diff too large for Jev (${tokens} tokens)`].join('\n')

export const unavailableComment = (status: string | number): string => [MARKER, TITLE, '', `Jev indisponível (${status})`].join('\n')

type Comment = { id: number; body: string; created_at: string; user: { login: string } | null }

const github = async (fetchFn: typeof fetch, token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> => {
  const res = await fetchFn(`${GITHUB_API}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} answered ${res.status}`)
  return res.json()
}

const listComments = async (fetchFn: typeof fetch, token: string, repo: string, number: number): Promise<Comment[]> => {
  const page = async (n: number): Promise<Comment[]> => {
    const rows = (await github(fetchFn, token, `/repos/${repo}/issues/${number}/comments?per_page=${PAGE}&page=${n}`)) as Comment[]
    return rows.length < PAGE ? rows : [...rows, ...(await page(n + 1))]
  }
  return page(1)
}

export const upsertComment = async ({ fetch: fetchFn, repo, pr, token, body }: { fetch: typeof fetch; repo: string; pr: number; token: string; body: string }): Promise<void> => {
  const mine = (await listComments(fetchFn, token, repo, pr)).find((c) => c.body.startsWith(MARKER) && c.user?.login === BOT)
  if (mine) await github(fetchFn, token, `/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', body: { body } })
  else await github(fetchFn, token, `/repos/${repo}/issues/${pr}/comments`, { method: 'POST', body: { body } })
}

type Artifact = { pr: number; head: string; issue: number | null; status: Status; tokens: number; questions: Question[]; response: unknown }

const decide = async (fetchFn: typeof fetch, key: string, request: ReturnType<typeof buildRequest>): Promise<{ ok: true; raw: unknown } | { ok: false; status: string | number; body: string }> => {
  try {
    const res = await fetchFn(DECISIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(DECISIONS_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, body: text }
    const raw = asJson(text)
    return parseAnswers(raw).answers.length > 0 ? { ok: true, raw } : { ok: false, status: res.status, body: text }
  } catch (e) {
    return { ok: false, status: 'sem resposta', body: e instanceof Error ? e.message : String(e) }
  }
}

const specFor = async (fetchFn: typeof fetch, env: Env, repo: string, token: string): Promise<{ issue: number | null; spec: string | null }> => {
  try {
    const pr = (await github(fetchFn, token, `/repos/${repo}/pulls/${env.PR_NUMBER}`)) as { body: string | null }
    const issue = closedIssue(pr.body ?? '')
    if (issue === null) return { issue, spec: null }
    const comments = await listComments(fetchFn, token, repo, issue)
    return { issue, spec: findSpec(comments.map((c) => ({ body: c.body, createdAt: c.created_at }))) }
  } catch (e) {
    console.log(`jev-review: could not read the spec (${e instanceof Error ? e.message : e}); running the convention questions only`)
    return { issue: null, spec: null }
  }
}

export const main = async (env: Env, fetchFn: typeof fetch, git: Git, write: Write = (path, content) => writeFile(path, content)): Promise<Artifact> => {
  const base = { pr: Number(env.PR_NUMBER), head: env.HEAD_SHA ?? '' }
  const finish = async (artifact: Artifact): Promise<Artifact> => {
    await write(ARTIFACT, JSON.stringify(artifact, null, 2) + '\n')
    return artifact
  }
  const key = env.OPENROUTER_API_KEY ?? ''
  if (key === '') {
    console.log('jev-review: OPENROUTER_API_KEY is empty (a fork PR gets no secrets); skipping')
    return finish({ ...base, issue: null, status: 'no-key', tokens: 0, questions: [], response: null })
  }
  const repo = env.GITHUB_REPOSITORY ?? ''
  const token = env.GITHUB_TOKEN ?? ''
  const comment = (body: string) =>
    upsertComment({ fetch: fetchFn, repo, pr: base.pr, token, body }).catch((e) => console.log(`jev-review: comment not posted (${e instanceof Error ? e.message : e})`))

  try {
    const range = `origin/${env.BASE_REF}`
    const diff = await git(['diff', `${range}...${base.head}`, '--', '.', ':!pnpm-lock.yaml'])
    const commits = (await git(['log', '--format=%s', `${range}..${base.head}`])).trim()
    const found = await specFor(fetchFn, env, repo, token)
    const criteria = found.spec === null ? [] : parseCriteria(found.spec)
    const spec = criteria.length > 0 && found.spec !== null ? found.spec : ''
    const questions = buildQuestions(criteria)
    const artifact = { ...base, issue: found.issue, questions }
    const size = { diff, spec, commits, questions }
    const over = overCap(size)
    if (over !== null) {
      await comment(tooLargeComment(over))
      return finish({ ...artifact, status: 'too-large', tokens: over, response: null })
    }
    const tokens = totalTokens(size)
    const result = await decide(fetchFn, key, buildRequest(size))
    if (!result.ok) {
      await comment(unavailableComment(result.status))
      return finish({ ...artifact, status: 'api-error', tokens, response: { status: result.status, body: result.body } })
    }
    const { answers, cost } = parseAnswers(result.raw)
    await comment(renderComment({ questions, answers, cost, hasSpec: spec !== '' }))
    return finish({ ...artifact, status: 'ok', tokens, response: result.raw })
  } catch (e) {
    console.log(`jev-review: failed before asking Jev (${e instanceof Error ? e.message : e})`)
    return finish({ ...base, issue: null, status: 'api-error', tokens: 0, questions: [], response: { status: 'erro local', body: e instanceof Error ? e.message : String(e) } })
  }
}

const run = async () => {
  const exec = promisify(execFile)
  const git: Git = async (args) => (await exec('git', args, { maxBuffer: 256 * 1024 * 1024 })).stdout
  await main(process.env, fetch, git)
}

if (import.meta.url === `file://${process.argv[1]}`) await run().catch((e) => console.log(`jev-review: ${e instanceof Error ? e.message : e}`))
