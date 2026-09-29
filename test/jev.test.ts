import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DECISIONS_URL,
  MARKER,
  TOKEN_CAP,
  buildQuestions,
  buildRequest,
  closedIssue,
  estimateTokens,
  findSpec,
  main,
  overCap,
  parseAnswers,
  parseCriteria,
  renderComment,
  upsertComment,
} from '../src/jev.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

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
  '   - with a JSON body',
  '3. The docs name it.',
  '',
  '## 7. Test plan',
  '',
  '1. Not a criterion.',
].join('\n')

const CONVENTION_IDS = ['conv-comment', 'conv-scoring-docs', 'conv-route-docs', 'conv-class', 'conv-issue-test', 'conv-commits']

const DECISIONS_RESPONSE = {
  id: 'gen-dec-1',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    'ac-1': { type: 'noul', noul: 0.91 },
    'ac-2': { type: 'noul', noul: 0.2 },
    'ac-3': { type: 'noul', noul: 0.7 },
    'conv-comment': { type: 'noul', noul: 0.95 },
    'conv-scoring-docs': { type: 'noul', noul: 0.88 },
    'conv-route-docs': { type: 'noul', noul: 0.97 },
    'conv-class': { type: 'noul', noul: 0.99 },
    'conv-issue-test': { type: 'noul', noul: 0.4 },
    'conv-commits': { type: 'noul', noul: 0.93 },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
}

type Comment = { id: number; body: string; created_at: string; user: { login: string } }
type Call = { method: string; url: string; body: string; headers: Record<string, string> }

// One stub for both hosts: GitHub's REST surface over an in-memory comment list, and the
// Decisions endpoint with a scripted reply. Every request is recorded.
const world = (opts: { prBody?: string; issueComments?: Comment[]; prComments?: Comment[]; decisions?: () => Response; commentStatus?: number } = {}) => {
  const calls: Call[] = []
  const prComments = opts.prComments ?? []
  let nextId = 900
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: String(init?.body ?? ''), headers: { ...(init?.headers as Record<string, string>) } })
    if (url === DECISIONS_URL) return (opts.decisions ?? (() => json(DECISIONS_RESPONSE)))()
    if (opts.commentStatus && url.includes('/comments')) return json({ message: 'forbidden' }, opts.commentStatus)
    if (/\/pulls\/\d+$/.test(url)) return json({ body: opts.prBody ?? 'Closes #257' })
    if (/\/issues\/257\/comments/.test(url)) return json(opts.issueComments ?? [])
    if (/\/issues\/260\/comments/.test(url) && method === 'GET') return json(prComments)
    if (/\/issues\/260\/comments$/.test(url) && method === 'POST') {
      const created = { id: nextId++, body: JSON.parse(String(init?.body)).body, created_at: '2026-09-28T00:00:00Z', user: { login: 'github-actions[bot]' } }
      prComments.push(created)
      return json(created, 201)
    }
    const patch = /\/issues\/comments\/(\d+)$/.exec(url)
    if (patch && method === 'PATCH') {
      const target = prComments.find((c) => c.id === Number(patch[1]))
      assert.ok(target, 'PATCH for a comment that does not exist')
      target.body = JSON.parse(String(init?.body)).body
      return json(target)
    }
    return json({ message: 'not found' }, 404)
  }) as typeof fetch
  return { fetchFn, calls, prComments, decisionsCalls: () => calls.filter((c) => c.url === DECISIONS_URL) }
}

const ENV = {
  OPENROUTER_API_KEY: 'sk-test',
  GITHUB_TOKEN: 'ghs-test',
  GITHUB_REPOSITORY: 'walter/rashomon',
  PR_NUMBER: '260',
  BASE_REF: 'master',
  HEAD_SHA: 'abc123',
}

const gitStub = (diff = 'diff --git a/src/x.ts b/src/x.ts\n+export const x = 1\n', commits = 'add x\nfix y\n') => {
  const seen: string[][] = []
  const git = async (args: string[]) => {
    seen.push(args)
    return args[0] === 'diff' ? diff : commits
  }
  return { git, seen }
}

const specComment = (createdAt: string, body = SPEC): Comment => ({ id: 1, body, created_at: createdAt, user: { login: 'walter' } })

const artifactWriter = () => {
  const files = new Map<string, string>()
  const write = async (path: string, content: string) => {
    files.set(path, content)
  }
  return { write, artifact: () => JSON.parse(files.get('jev-review.json') ?? 'null') }
}

describe('jev-review workflow file', () => {
  const yml = readFileSync(join(root, '.github', 'workflows', 'jev-review.yml'), 'utf8')

  it('triggers on opened and synchronize only', () => {
    assert.match(yml, /^on:\s*\n\s+pull_request:\s*\n\s+types:\s*\[opened, synchronize\]\s*$/m)
    assert.doesNotMatch(yml, /pull_request_target/)
    assert.match(yml, /pull-requests:\s*write/)
    assert.match(yml, /secrets\.OPENROUTER_API_KEY/)
  })

  it('never fails the job', () => {
    assert.match(yml, /continue-on-error:\s*true/)
    assert.match(yml, /timeout-minutes:\s*10/)
    assert.doesNotMatch(yml, /test -n/)
  })

  it('uploads the artifact always', () => {
    assert.match(yml, /uses:\s*actions\/upload-artifact@v4\s*\n\s+if:\s*always\(\)\s*\n\s+with:\s*\n\s+name:\s*jev-review\s*\n\s+path:\s*jev-review\.json/)
  })
})

describe('estimateTokens / overCap', () => {
  const question = buildQuestions([])[0]

  it('estimates length over four', () => {
    assert.equal(estimateTokens('abcde'), 2)
    assert.equal(estimateTokens(''), 0)
  })

  it('flags a diff over the 32k cap', () => {
    assert.equal(TOKEN_CAP, 32000)
    const over = overCap({ diff: 'a'.repeat(128_001), spec: '', commits: '', questions: [question] })
    assert.equal(typeof over, 'number')
    assert.ok(over !== null && over > TOKEN_CAP)
    assert.equal(overCap({ diff: 'a'.repeat(1000), spec: '', commits: '', questions: [question] }), null)
  })

  it('counts the longest question on top of the state', () => {
    const questions = [{ ...question, question: 'a'.repeat(400) }, question]
    assert.equal(overCap({ diff: 'a'.repeat(4 * (TOKEN_CAP - 99)), spec: '', commits: '', questions }) !== null, true)
    assert.equal(overCap({ diff: 'a'.repeat(4 * (TOKEN_CAP - 99)), spec: '', commits: '', questions: [question] }), null)
  })

  it('too-large skips the Decisions call', async () => {
    const w = world()
    const out = artifactWriter()
    const { git } = gitStub('a'.repeat(128_001))
    await main(ENV, w.fetchFn, git, out.write)
    assert.equal(w.decisionsCalls().length, 0)
    assert.equal(w.prComments.length, 1)
    assert.match(w.prComments[0].body, /diff too large for Jev \(\d+ tokens\)/)
    assert.ok(w.prComments[0].body.startsWith(MARKER))
    assert.equal(out.artifact().status, 'too-large')
  })
})

describe('findSpec / parseCriteria / closedIssue', () => {
  it('picks the most recent spec', () => {
    const older = { body: SPEC.replace('Say hello.', 'older'), createdAt: '2026-09-01T00:00:00Z' }
    const newer = { body: SPEC.replace('Say hello.', 'newer'), createdAt: '2026-09-20T00:00:00Z' }
    assert.match(findSpec([newer, older]) ?? '', /newer/)
    assert.match(findSpec([older, newer]) ?? '', /newer/)
  })

  it('rejects a comment missing a section', () => {
    const noCriteria = '## 1. Goal\n\nx\n\n## 2. API\n\ny\n'
    assert.equal(findSpec([{ body: noCriteria, createdAt: '2026-09-01T00:00:00Z' }]), null)
    assert.equal(findSpec([{ body: 'lgtm', createdAt: '2026-09-01T00:00:00Z' }]), null)
    assert.equal(findSpec([]), null)
  })

  it('accepts heading and bold styles', () => {
    const bold = '**Goal**\n\nx\n\n**API**\n\ny\n\n**Acceptance criteria**\n\n1. one\n'
    const numbered = '## 1. goal\n\nx\n\n### 2. Api\n\ny\n\n## 5. ACCEPTANCE CRITERIA\n\n1. one\n'
    assert.equal(findSpec([{ body: bold, createdAt: '2026-09-01T00:00:00Z' }]), bold)
    assert.equal(findSpec([{ body: numbered, createdAt: '2026-09-01T00:00:00Z' }]), numbered)
    assert.deepEqual(parseCriteria(bold), [{ n: 1, text: 'one' }])
  })

  it('keeps sub-bullets in their criterion', () => {
    const criteria = parseCriteria(SPEC)
    assert.equal(criteria.length, 3)
    assert.deepEqual(criteria.map((c) => c.n), [1, 2, 3])
    assert.match(criteria[1].text, /The route answers 200\.\n\s+- with a JSON body/)
    assert.ok(!criteria[0].text.includes('with a JSON body'))
  })

  it('stops at the next section', () => {
    assert.ok(parseCriteria(SPEC).every((c) => !c.text.includes('Not a criterion')))
    assert.deepEqual(parseCriteria('## 1. Goal\n\nx\n'), [])
  })

  it('reads the first closing keyword', () => {
    assert.equal(closedIssue('Closes #257'), 257)
    assert.equal(closedIssue('fixes #12 and #13'), 12)
    assert.equal(closedIssue('Resolved #4, closes #5'), 4)
    assert.equal(closedIssue('see #9'), null)
    assert.equal(closedIssue(''), null)
  })
})

describe('buildQuestions / buildRequest', () => {
  const criteria = parseCriteria(SPEC)
  const questions = buildQuestions(criteria)

  it('criteria first then six conventions', () => {
    assert.deepEqual(questions.map((q) => q.id), ['ac-1', 'ac-2', 'ac-3', ...CONVENTION_IDS])
    assert.match(questions[0].question, /^Does the diff implement acceptance criterion 1 as stated: The greeting is `hello`\.\?$/)
    for (const q of questions) {
      assert.equal(q.type, 'noul')
      assert.ok(q.criteria.true.length > 0 && q.criteria.false.length > 0)
    }
  })

  it('conventions only without a spec', () => {
    assert.deepEqual(buildQuestions([]).map((q) => q.id), CONVENTION_IDS)
  })

  it('state carries only diff spec commits', () => {
    const request = buildRequest({ diff: 'd', spec: 's', commits: 'c', questions })
    assert.equal(request.model, 'typesafe/jev-1.13')
    assert.deepEqual(Object.keys(request.state).sort(), ['commits', 'diff', 'spec'])
    assert.deepEqual(Object.keys(request.questions), questions.map((q) => q.id))
    const first = request.questions['ac-1']
    assert.equal(first.type, 'noul')
    assert.equal(first.instructions, questions[0].question)
    assert.deepEqual(Object.keys(first.criteria), ['true', 'false'])
  })

  it('no secret in the body', async () => {
    const w = world({ issueComments: [specComment('2026-09-10T00:00:00Z')] })
    await main(ENV, w.fetchFn, gitStub().git, artifactWriter().write)
    const [call] = w.decisionsCalls()
    assert.equal(call.headers.authorization, 'Bearer sk-test')
    assert.ok(!call.body.includes('sk-test'))
    assert.ok(!call.body.includes('ghs-test'))
    assert.deepEqual(Object.keys(JSON.parse(call.body).state).sort(), ['commits', 'diff', 'spec'])
    for (const other of w.calls.filter((c) => c !== call)) assert.ok(!other.body.includes('sk-test'))
  })
})

describe('parseAnswers', () => {
  it('turns noul probabilities into answers and reads the cost', () => {
    const { answers, cost } = parseAnswers(DECISIONS_RESPONSE)
    assert.deepEqual(answers.find((a) => a.id === 'ac-2'), { id: 'ac-2', answer: 'no', probability: 0.2 })
    assert.deepEqual(answers.find((a) => a.id === 'ac-1'), { id: 'ac-1', answer: 'yes', probability: 0.91 })
    assert.equal(cost, 0.000019992)
  })

  it('marks an answer with no probability as unknown and survives garbage', () => {
    assert.deepEqual(parseAnswers({ answers: { a: { type: 'noul' } } }).answers, [{ id: 'a', answer: 'unknown', probability: null }])
    assert.deepEqual(parseAnswers('not json'), { answers: [], cost: null })
    assert.deepEqual(parseAnswers(JSON.stringify(DECISIONS_RESPONSE)).answers.length, 9)
  })
})

describe('renderComment / upsertComment', () => {
  const questions = buildQuestions(parseCriteria(SPEC))
  const parsed = parseAnswers(DECISIONS_RESPONSE)
  const rows = (text: string) => text.split('\n').filter((l) => l.startsWith('| `'))

  it('starts with the marker and has one row per question', () => {
    const text = renderComment({ questions, ...parsed, hasSpec: true })
    assert.ok(text.startsWith('<!-- jev-review -->'))
    assert.match(text, /\| Pergunta \| Resposta \| Probabilidade \|/)
    const found = rows(text)
    assert.equal(found.length, questions.length)
    found.forEach((row, i) => assert.ok(row.startsWith(`| \`${questions[i].id}\``), row))
    assert.doesNotMatch(text, /só as perguntas de convenção/)
  })

  it('says only the conventions ran when there is no spec', () => {
    const text = renderComment({ questions: buildQuestions([]), answers: [], cost: null, hasSpec: false })
    assert.match(text, /só as perguntas de convenção rodaram/)
  })

  it('renders cost and missing probability', () => {
    const text = renderComment({ questions: questions.slice(0, 2), answers: [{ id: 'ac-1', answer: 'unknown', probability: null }], cost: parsed.cost, hasSpec: true })
    const [first, second] = rows(text)
    assert.match(first, /\| — \| — \|$/)
    assert.match(second, /\| — \| — \|$/)
    assert.equal(text.split('\n').at(-1), 'Custo: $0.000019992')
  })

  it('lists an unrecognized id after the known ones instead of dropping it', () => {
    const text = renderComment({ questions: questions.slice(0, 1), answers: [{ id: 'mystery', answer: 'yes', probability: 0.8 }], cost: null, hasSpec: true })
    const found = rows(text)
    assert.equal(found.length, 2)
    assert.match(found[1], /^\| `mystery` \| sim \| 0\.80 \|$/)
  })

  const bot = (id: number, body: string): Comment => ({ id, body, created_at: '2026-09-27T00:00:00Z', user: { login: 'github-actions[bot]' } })
  const stranger = (id: number, body: string): Comment => ({ id, body, created_at: '2026-09-27T00:00:00Z', user: { login: 'someone' } })
  const upsert = (w: ReturnType<typeof world>, body: string) => upsertComment({ fetch: w.fetchFn, repo: 'walter/rashomon', pr: 260, token: 't', body })

  it("patches the bot's marked comment", async () => {
    const w = world({ prComments: [bot(11, 'unrelated'), bot(12, `${MARKER}\nold`)] })
    await upsert(w, `${MARKER}\nnew`)
    assert.deepEqual(w.calls.map((c) => c.method).filter((m) => m !== 'GET'), ['PATCH'])
    assert.equal(w.prComments.find((c) => c.id === 12)?.body, `${MARKER}\nnew`)
  })

  it('ignores a marked comment by another user', async () => {
    const w = world({ prComments: [stranger(21, `${MARKER}\nforged`)] })
    await upsert(w, `${MARKER}\nmine`)
    assert.deepEqual(w.calls.map((c) => c.method).filter((m) => m !== 'GET'), ['POST'])
    assert.equal(w.prComments.length, 2)
    assert.equal(w.prComments[0].body, `${MARKER}\nforged`)
  })

  it('pages through the comment list', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => bot(100 + i, 'x'))
    const target = bot(999, `${MARKER}\nold`)
    const w = world({ prComments: [...filler, target] })
    let pages = 0
    const paged = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (/\/issues\/260\/comments\?/.test(url)) {
        pages++
        return new Response(JSON.stringify(/page=1$/.test(url) ? filler : [target]))
      }
      return w.fetchFn(input, init)
    }) as typeof fetch
    await upsertComment({ fetch: paged, repo: 'walter/rashomon', pr: 260, token: 't', body: `${MARKER}\nnew` })
    assert.equal(pages, 2)
    assert.ok(w.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/comments/999')))
  })

  it('two runs leave one comment', async () => {
    const w = world({ issueComments: [specComment('2026-09-10T00:00:00Z')] })
    const { git } = gitStub()
    await main(ENV, w.fetchFn, git, artifactWriter().write)
    await main(ENV, w.fetchFn, git, artifactWriter().write)
    assert.equal(w.prComments.filter((c) => c.body.startsWith(MARKER)).length, 1)
    assert.equal(w.decisionsCalls().length, 2)
  })
})

describe('main', () => {
  it('asks one Decisions call with the spec questions and writes the artifact', async () => {
    const w = world({ issueComments: [specComment('2026-09-10T00:00:00Z')] })
    const out = artifactWriter()
    const { git, seen } = gitStub()
    await main(ENV, w.fetchFn, git, out.write)
    assert.deepEqual(seen[0].slice(0, 2), ['diff', 'origin/master...abc123'])
    assert.ok(seen[0].includes(':!pnpm-lock.yaml') && seen[0].includes(':!public/bundle.js'))
    assert.deepEqual(seen[1], ['log', '--format=%s', 'origin/master..abc123'])
    assert.equal(w.decisionsCalls().length, 1)
    const sent = JSON.parse(w.decisionsCalls()[0].body)
    assert.deepEqual(Object.keys(sent.questions), ['ac-1', 'ac-2', 'ac-3', ...CONVENTION_IDS])
    assert.equal(sent.state.commits, 'add x\nfix y')
    const artifact = out.artifact()
    assert.equal(artifact.status, 'ok')
    assert.equal(artifact.pr, 260)
    assert.equal(artifact.head, 'abc123')
    assert.equal(artifact.issue, 257)
    assert.deepEqual(artifact.response, DECISIONS_RESPONSE)
    assert.match(w.prComments[0].body, /Custo: \$0\.000019992$/)
  })

  it('falls back to the conventions when the issue has no spec', async () => {
    for (const w of [world({ prBody: 'no closing keyword' }), world({ issueComments: [] }), world({ issueComments: [specComment('2026-09-10T00:00:00Z', '## 1. Goal\n\nx\n\n## 2. API\n\ny\n\n## 3. Acceptance criteria\n\nnone\n')] })]) {
      const out = artifactWriter()
      await main(ENV, w.fetchFn, gitStub('').git, out.write)
      const sent = JSON.parse(w.decisionsCalls()[0].body)
      assert.deepEqual(Object.keys(sent.questions), CONVENTION_IDS)
      assert.equal(sent.state.spec, '')
      assert.equal(sent.state.diff, '')
      assert.match(w.prComments[0].body, /só as perguntas de convenção rodaram/)
    }
  })
})

describe('main shadow contract', () => {
  it('no key resolves without network', async () => {
    for (const key of ['', undefined]) {
      const w = world()
      const out = artifactWriter()
      await main({ ...ENV, OPENROUTER_API_KEY: key }, w.fetchFn, gitStub().git, out.write)
      assert.equal(w.calls.length, 0)
      assert.equal(out.artifact().status, 'no-key')
    }
  })

  it('api error comments and resolves', async () => {
    for (const decisions of [() => new Response('boom', { status: 500 }), () => new Response('<html>not json</html>', { status: 200 }), () => { throw new Error('socket hang up') }]) {
      const w = world({ decisions })
      const out = artifactWriter()
      await main(ENV, w.fetchFn, gitStub().git, out.write)
      assert.equal(w.prComments.length, 1)
      assert.match(w.prComments[0].body, /Jev indisponível/)
      assert.equal(out.artifact().status, 'api-error')
    }
  })

  it('records the HTTP status and body on an api error', async () => {
    const w = world({ decisions: () => new Response('upstream down', { status: 502 }) })
    const out = artifactWriter()
    await main(ENV, w.fetchFn, gitStub().git, out.write)
    assert.match(w.prComments[0].body, /Jev indisponível \(502\)/)
    assert.deepEqual(out.artifact().response, { status: 502, body: 'upstream down' })
  })

  it('comment failure still writes the artifact', async () => {
    const w = world({ commentStatus: 403 })
    const out = artifactWriter()
    const artifact = await main(ENV, w.fetchFn, gitStub().git, out.write)
    assert.equal(artifact.status, 'ok')
    assert.equal(out.artifact().status, 'ok')
    assert.equal(w.decisionsCalls().length, 1)
  })

  it('a git failure resolves with an api-error artifact', async () => {
    const out = artifactWriter()
    await main(ENV, world().fetchFn, async () => { throw new Error('bad revision') }, out.write)
    assert.equal(out.artifact().status, 'api-error')
  })
})
