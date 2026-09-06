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

phase('Research')
const brief = await agent(
  `Issue #${issue} of this repository (use \`gh issue view ${issue} --comments\`). Produce the researcher brief for it.`,
  { agentType: 'researcher', label: `research #${issue}` },
)
if (!brief) throw new Error('researcher returned nothing')

phase('Spec')
const spec = await agent(
  `Issue #${issue}. Researcher brief follows. Write the spec, post it as a comment on the issue with gh, and return the full spec text.\n\n---\n${brief}`,
  { agentType: 'spec-writer', label: `spec #${issue}` },
)

log(`spec posted on #${issue}; add the label spec-approved to unlock the build workflow`)
return { issue, brief, spec }
