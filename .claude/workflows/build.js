export const meta = {
  name: 'build',
  description: 'Build an approved spec in its own worktree: API, UI, acceptance tests, validation loop, pull request',
  whenToUse: 'Second step of the rashomon factory, after the issue carries the spec-approved label. args: { issue: <number>, slug: <kebab-case> }',
  phases: [
    { title: 'Gate', detail: 'issue must carry spec-approved and a spec comment' },
    { title: 'Build', detail: 'builder-api then builder-ui on feat/<slug>' },
    { title: 'Verify', detail: 'tests written from the spec, validator judges, builders fix (max 2 rounds)' },
    { title: 'Release', detail: 'push and open the PR' },
  ],
}

const issue = args?.issue
const slug = args?.slug
if (!issue || !slug || !/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error('pass args: { issue: <number>, slug: <kebab-case, max 40> }')

// Custom agents in .claude/agents/ are registered when a session starts. In a session where they
// are not available yet, pass their role texts via args.roles and the same pipeline runs on general-purpose agents.
const MODEL = { validator: 'opus' }
const roles = args?.roles ?? null
const role = (name, prompt, opts = {}) =>
  roles
    ? agent(`You are acting as the "${name}" agent of the rashomon factory. Follow this role definition strictly:\n\n${roles[name]}\n\n---\n\n${prompt}`, { ...opts, agentType: 'general-purpose', model: MODEL[name] ?? 'sonnet' })
    : agent(prompt, { ...opts, agentType: name })
const branch = `feat/${slug}`
const worktree = `../rashomon-${slug}`

const GATE = {
  type: 'object',
  required: ['approved', 'title', 'spec'],
  properties: {
    approved: { type: 'boolean', description: 'true only if the issue has the label spec-approved AND a spec comment' },
    title: { type: 'string' },
    spec: { type: 'string', description: 'full text of the most recent spec comment, verbatim' },
    hasUi: { type: 'boolean', description: 'true if the spec has UI work' },
    hasApi: { type: 'boolean', description: 'true if the spec has API/SQL work' },
  },
}
const TESTS = {
  type: 'object',
  required: ['failures', 'table'],
  properties: {
    failures: { type: 'integer' },
    table: { type: 'string', description: 'criterion, test name, pass/fail/manual, message' },
  },
}
const VERDICT = {
  type: 'object',
  required: ['verdict', 'gaps'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'return'] },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'area', 'location', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'should', 'nit'] },
          area: { type: 'string', enum: ['api', 'ui', 'tests'] },
          location: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

phase('Gate')
const gate = await role('researcher', `Run \`gh issue view ${issue} --json title,labels,comments\`. Decide if the label spec-approved is present and a comment contains a spec (sections Goal, API, Acceptance criteria). Return the most recent spec comment verbatim.`,
  { label: `gate #${issue}`, schema: GATE, effort: 'low' })
if (!gate?.approved) {
  log(`issue #${issue} is not approved: add the label spec-approved after reviewing the spec comment`)
  return { issue, status: 'blocked', reason: 'missing spec-approved label or spec comment' }
}

const where = `Work ONLY inside the worktree ${worktree} on branch ${branch}. If the worktree does not exist yet, create it from this repository root with: git worktree add ${worktree} -b ${branch} master (if the branch exists, omit -b). Run pnpm install --frozen-lockfile there if node_modules is missing (a symlink to this repo's node_modules is fine). Never switch branches in the main repository.`
const specText = `Issue #${issue}: ${gate.title}\n\nApproved spec:\n${gate.spec}`

phase('Build')
const apiReport = gate.hasApi === false
  ? 'no API work in this spec'
  : await role('builder-api', `${where}\n\n${specText}\n\nImplement the API, SQL and store parts of the spec with tests. Leave public/ untouched.`, { label: `api #${issue}` })
const uiReport = gate.hasUi === false
  ? 'no UI work in this spec'
  : await role('builder-ui', `${where}\n\n${specText}\n\nAPI builder report:\n${apiReport}\n\nImplement the UI part of the spec and verify it in a browser. Leave src/ and test/ untouched.`, { label: `ui #${issue}` })

let tests = null
let verdict = null
for (let round = 1; round <= 2; round++) {
  tests = await role('test-verifier', `${where}\n\n${specText}\n\nWrite acceptance tests from the spec's criteria, run pnpm test, commit them, and report.`,
    { label: `tests #${issue} r${round}`, phase: 'Verify', schema: TESTS })
  verdict = await role('validator', `${where}\n\n${specText}\n\nBuilder reports:\n${apiReport}\n\n${uiReport}\n\nTest verifier report (${tests?.failures ?? '?'} failing):\n${tests?.table ?? 'none'}\n\nJudge the branch against the spec and CLAUDE.md.`,
    { label: `validate #${issue} r${round}`, phase: 'Verify', schema: VERDICT })
  const blocking = (verdict?.gaps ?? []).filter((g) => g.severity !== 'nit')
  if (verdict?.verdict === 'approve' && (tests?.failures ?? 1) === 0) break
  if (round === 2) break
  const gapsText = blocking.map((g) => `- [${g.severity}/${g.area}] ${g.location}: ${g.fix}`).join('\n')
  const failing = tests?.failures ? `\nFailing acceptance tests:\n${tests.table}` : ''
  const uiGaps = blocking.some((g) => g.area === 'ui')
  const apiGaps = blocking.some((g) => g.area !== 'ui') || (tests?.failures ?? 0) > 0
  if (apiGaps) await role('builder-api', `${where}\n\n${specText}\n\nFix these gaps, keep tests green:\n${gapsText}${failing}`, { label: `fix api #${issue}`, phase: 'Verify' })
  if (uiGaps) await role('builder-ui', `${where}\n\n${specText}\n\nFix these UI gaps and re-verify in the browser:\n${gapsText}`, { label: `fix ui #${issue}`, phase: 'Verify' })
}

const approved = verdict?.verdict === 'approve' && (tests?.failures ?? 1) === 0
if (!approved) {
  log(`#${issue} returned by the validator after 2 rounds; branch ${branch} kept in ${worktree} for a human`)
  return { issue, branch, worktree, status: 'returned', tests, verdict }
}

phase('Release')
const pr = await role('release', `${where}\n\nPush ${branch} and open a pull request against master that closes #${issue}. Title: ${gate.title}. Include in the body: what changed, the test verifier table, the validator verdict, screenshot paths from the UI report.\n\nTest table:\n${tests.table}\n\nValidator: approve with ${verdict.gaps.length} nits.\n\nUI report:\n${uiReport}`,
  { label: `pr #${issue}`, effort: 'low' })
return { issue, branch, worktree, status: 'pr-opened', pr }
