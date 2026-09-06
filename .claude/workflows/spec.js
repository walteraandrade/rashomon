export const meta = {
  name: 'spec',
  description: 'Research one issue and post a technical spec on it for human approval',
  whenToUse: 'First step of the rashomon factory. args: { issue: <number> }',
  phases: [
    { title: 'Research', detail: 'read-only map of the code the issue touches' },
    { title: 'Spec', detail: 'acceptance criteria posted as an issue comment' },
  ],
}

const issue = args?.issue
if (!issue) throw new Error('pass args: { issue: <number> }')

// Custom agents in .claude/agents/ are registered when a session starts. In a session where they
// are not available yet, pass their role texts via args.roles and the same pipeline runs on general-purpose agents.
const MODEL = { validator: 'opus' }
const roles = args?.roles ?? null
const role = (name, prompt, opts = {}) =>
  roles
    ? agent(`You are acting as the "${name}" agent of the rashomon factory. Follow this role definition strictly:\n\n${roles[name]}\n\n---\n\n${prompt}`, { ...opts, agentType: 'general-purpose', model: MODEL[name] ?? 'sonnet' })
    : agent(prompt, { ...opts, agentType: name })

phase('Research')
const brief = await role('researcher', `Issue #${issue} of this repository (use \`gh issue view ${issue} --comments\`). Produce the researcher brief for it.`,
  { label: `research #${issue}` })
if (!brief) throw new Error('researcher returned nothing')

phase('Spec')
const spec = await role('spec-writer', `Issue #${issue}. Researcher brief follows. Write the spec, post it as a comment on the issue with gh, and return the full spec text.\n\n---\n${brief}`,
  { label: `spec #${issue}` })

log(`spec posted on #${issue}; add the label spec-approved to unlock the build workflow`)
return { issue, brief, spec }
